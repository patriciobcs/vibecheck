import { and, asc, eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/db/client";
import { newId } from "@/lib/ids";
import type { MediaClient } from "@/providers/vonage";
import { scheduleArchiveReconcile } from "./archive-pipeline";
import type { AssignmentRow } from "./assignments";
import { canTransition, type ParticipantState } from "./participant-flow";

type Fail = {
  ok: false;
  reason: "not_found" | "invalid_transition" | "media_unavailable" | "no_active_archive";
};

/** Loads the assignment only if it belongs to the acting participant. */
async function ownedAssignment(
  tx: Tx,
  assignmentId: string,
  participantId: string,
): Promise<AssignmentRow | null> {
  const [row] = await tx
    .select()
    .from(schema.assignments)
    .where(
      and(
        eq(schema.assignments.id, assignmentId),
        eq(schema.assignments.participantId, participantId),
      ),
    )
    .for("update");
  return row ?? null;
}

async function moveState(
  tx: Tx,
  a: AssignmentRow,
  to: ParticipantState,
  extra: Partial<typeof schema.assignments.$inferInsert> = {},
) {
  if (!canTransition(a.state as ParticipantState, to)) return false;
  const res = await tx
    .update(schema.assignments)
    .set({ state: to, version: a.version + 1, updatedAt: new Date(), ...extra })
    .where(and(eq(schema.assignments.id, a.id), eq(schema.assignments.version, a.version)))
    .returning({ id: schema.assignments.id });
  return res.length === 1;
}

/* ---------------- Consent and device check ---------------- */

export async function recordConsent(input: {
  assignmentId: string;
  participantId: string;
  consentVersion: string;
}): Promise<{ ok: true } | Fail> {
  return db.transaction(async (tx) => {
    const a = await ownedAssignment(tx, input.assignmentId, input.participantId);
    if (!a) return { ok: false, reason: "not_found" };
    if (a.state === "consent" || a.state === "device_check") return { ok: true };
    const moved = await moveState(tx, a, "consent", {
      consentVersion: input.consentVersion,
      consentedAt: new Date(),
    });
    if (!moved) return { ok: false, reason: "invalid_transition" };
    await tx.insert(schema.auditEvents).values({
      id: newId("audit"),
      tenantId: a.tenantId,
      actorUserId: null,
      action: "consent.recorded",
      subjectType: "assignment",
      subjectId: a.id,
      detail: { consent_version: input.consentVersion, capture_policy: a.capturePolicy },
    });
    return { ok: true };
  });
}

/* ---------------- Recording ---------------- */

export type StartResult =
  | { ok: true; sessionId: string; mediaSessionId: string; clientToken: string }
  | Fail;

/**
 * Consent → device_check → recording in one step once the browser has granted permissions.
 * Creates the Vonage session and starts the first composed archive.
 */
export async function startRecording(input: {
  assignmentId: string;
  participantId: string;
  media: MediaClient;
  instrumentation: "sdk" | "video_only";
  clientClockOriginMs: number;
}): Promise<StartResult> {
  const prepared = await db.transaction(
    async (
      tx,
    ): Promise<
      { a: AssignmentRow; existing: typeof schema.sessions.$inferSelect | null } | Fail
    > => {
      const a = await ownedAssignment(tx, input.assignmentId, input.participantId);
      if (!a) return { ok: false, reason: "not_found" };
      const existing = await tx.query.sessions.findFirst({
        where: eq(schema.sessions.assignmentId, a.id),
      });
      if (a.state === "recording" && existing?.mediaSessionId) return { a, existing };
      if (a.state === "consent") {
        const moved = await moveState(tx, a, "device_check");
        if (!moved) return { ok: false, reason: "invalid_transition" };
        a.state = "device_check";
        a.version += 1;
      }
      if (a.state !== "device_check") return { ok: false, reason: "invalid_transition" };
      return { a, existing: existing ?? null };
    },
  );
  if ("ok" in prepared) return prepared;
  const { a, existing } = prepared;

  if (existing?.mediaSessionId && a.state === "recording") {
    const token = input.media.clientToken(existing.mediaSessionId, `assignment=${a.id}`);
    return {
      ok: true,
      sessionId: existing.id,
      mediaSessionId: existing.mediaSessionId,
      clientToken: token,
    };
  }

  let mediaSessionId: string;
  try {
    mediaSessionId = (await input.media.createSession()).sessionId;
  } catch (err) {
    console.error("media provider failed", err);
    return { ok: false, reason: "media_unavailable" };
  }

  const sessionId = existing?.id ?? newId("session");
  const now = new Date();
  await db.transaction(async (tx) => {
    const fresh = await ownedAssignment(tx, a.id, input.participantId);
    if (!fresh) throw new Error("assignment vanished");
    if (existing) {
      await tx
        .update(schema.sessions)
        .set({
          mediaSessionId,
          mediaProvider: "vonage",
          startedAt: now,
          clientClockOriginMs: input.clientClockOriginMs,
          instrumentation: input.instrumentation,
        })
        .where(eq(schema.sessions.id, sessionId));
    } else {
      await tx.insert(schema.sessions).values({
        id: sessionId,
        tenantId: a.tenantId,
        assignmentId: a.id,
        mediaSessionId,
        mediaProvider: "vonage",
        startedAt: now,
        clientClockOriginMs: input.clientClockOriginMs,
        instrumentation: input.instrumentation,
      });
    }
    const moved = await moveState(tx, fresh, "recording");
    if (!moved) throw new Error("could not enter recording state");
  });

  const token = input.media.clientToken(mediaSessionId, `assignment=${a.id}`);
  return { ok: true, sessionId, mediaSessionId, clientToken: token };
}

/**
 * Starts the composed archive once the browser has connected and published (Vonage returns 404
 * for archives on sessions without clients). Idempotent while an archive is already recording.
 */
export async function startArchive(input: {
  assignmentId: string;
  participantId: string;
  media: MediaClient;
  tMs: number;
}): Promise<{ ok: true } | Fail> {
  const ctx = await db.transaction(async (tx) => {
    const a = await ownedAssignment(tx, input.assignmentId, input.participantId);
    if (a?.state !== "recording") return { fail: "invalid_transition" as const };
    const session = await tx.query.sessions.findFirst({
      where: eq(schema.sessions.assignmentId, a.id),
    });
    if (!session?.mediaSessionId) return { fail: "not_found" as const };
    const active = await activeAsset(tx, session.id);
    // The study's snapshotted capture policy decides what the archive contains.
    const screen = (a.capturePolicy as { screen?: string } | null)?.screen ?? "required";
    return {
      session,
      tenantId: a.tenantId,
      alreadyRecording: active !== undefined,
      hasVideo: screen !== "off",
    };
  });
  if ("fail" in ctx && ctx.fail) return { ok: false, reason: ctx.fail };
  if (!("session" in ctx) || ctx.alreadyRecording || !ctx.session.mediaSessionId)
    return { ok: true };
  let archiveId: string;
  try {
    archiveId = (
      await input.media.startArchive(
        ctx.session.mediaSessionId,
        `assignment ${input.assignmentId}`,
        { hasVideo: ctx.hasVideo },
      )
    ).archiveId;
  } catch (err) {
    console.error("startArchive failed", err);
    return { ok: false, reason: "media_unavailable" };
  }
  await db.insert(schema.assets).values({
    id: newId("asset"),
    tenantId: ctx.tenantId,
    sessionId: ctx.session.id,
    kind: ctx.hasVideo ? "screen_audio" : "audio",
    providerArchiveId: archiveId,
    providerStatus: "started",
    status: "recording",
    offsetMs: input.tMs,
  });
  return { ok: true };
}

async function activeAsset(tx: Tx, sessionId: string) {
  return tx.query.assets.findFirst({
    where: and(eq(schema.assets.sessionId, sessionId), eq(schema.assets.status, "recording")),
  });
}

export async function pauseRecording(input: {
  assignmentId: string;
  participantId: string;
  media: MediaClient;
  tMs: number;
}): Promise<{ ok: true } | Fail> {
  const ctx = await db.transaction(async (tx) => {
    const a = await ownedAssignment(tx, input.assignmentId, input.participantId);
    if (a?.state !== "recording") return null;
    const session = await tx.query.sessions.findFirst({
      where: eq(schema.sessions.assignmentId, a.id),
    });
    if (!session) return null;
    // Idempotent: pausing while paused is a no-op. A missing archive (e.g. its start failed)
    // still records the pause interval so the session clock stays honest.
    const asset = await activeAsset(tx, session.id);
    const pauses = [...session.pauses];
    if (pauses.at(-1)?.end_ms === null) return { session, asset: null, alreadyPaused: true };
    pauses.push({ start_ms: input.tMs, end_ms: null });
    await tx.update(schema.sessions).set({ pauses }).where(eq(schema.sessions.id, session.id));
    if (asset) {
      await tx
        .update(schema.assets)
        .set({ status: "uploaded", providerStatus: "stopping", updatedAt: new Date() })
        .where(eq(schema.assets.id, asset.id));
    }
    return { session, asset: asset ?? null, alreadyPaused: false };
  });
  if (!ctx) return { ok: false, reason: "not_found" };
  if (!ctx.alreadyPaused && ctx.asset?.providerArchiveId) {
    try {
      await input.media.stopArchive(ctx.asset.providerArchiveId);
    } catch (err) {
      console.error("stopArchive on pause failed; provider will pause it when streams stop", err);
    }
  }
  return { ok: true };
}

export async function resumeRecording(input: {
  assignmentId: string;
  participantId: string;
  media: MediaClient;
  tMs: number;
}): Promise<{ ok: true } | Fail> {
  const ctx = await db.transaction(async (tx) => {
    const a = await ownedAssignment(tx, input.assignmentId, input.participantId);
    if (a?.state !== "recording") return null;
    const session = await tx.query.sessions.findFirst({
      where: eq(schema.sessions.assignmentId, a.id),
    });
    if (!session?.mediaSessionId) return null;
    const pauses = [...session.pauses];
    const open = pauses.at(-1);
    const screen = (a.capturePolicy as { screen?: string } | null)?.screen ?? "required";
    const hasVideo = screen !== "off";
    if (!open || open.end_ms !== null) return { session, resumed: false, hasVideo };
    pauses[pauses.length - 1] = { start_ms: open.start_ms, end_ms: input.tMs };
    await tx.update(schema.sessions).set({ pauses }).where(eq(schema.sessions.id, session.id));
    return { session, resumed: true, tenantId: a.tenantId, hasVideo };
  });
  if (!ctx) return { ok: false, reason: "not_found" };
  if (!ctx.resumed || !ctx.session.mediaSessionId) return { ok: true };
  let archiveId: string;
  try {
    ({ archiveId } = await input.media.startArchive(
      ctx.session.mediaSessionId,
      `assignment ${input.assignmentId} resume`,
      { hasVideo: ctx.hasVideo },
    ));
  } catch (err) {
    // Reopen the pause so the clock map stays truthful; the client shows the error and stays paused.
    console.error("startArchive on resume failed", err);
    await db.transaction(async (tx) => {
      const fresh = await tx.query.sessions.findFirst({
        where: eq(schema.sessions.id, ctx.session.id),
      });
      if (!fresh) return;
      const pauses = [...fresh.pauses];
      const last = pauses.at(-1);
      if (last) pauses[pauses.length - 1] = { start_ms: last.start_ms, end_ms: null };
      await tx.update(schema.sessions).set({ pauses }).where(eq(schema.sessions.id, fresh.id));
    });
    return { ok: false, reason: "media_unavailable" };
  }
  await db.insert(schema.assets).values({
    id: newId("asset"),
    tenantId: ctx.session.tenantId,
    sessionId: ctx.session.id,
    kind: ctx.hasVideo ? "screen_audio" : "audio",
    providerArchiveId: archiveId,
    providerStatus: "started",
    status: "recording",
    offsetMs: input.tMs,
  });
  return { ok: true };
}

export type FinishReason = "finished" | "finished_early" | "stuck" | "withdraw" | "failure";

/** Stops the running archive. Withdraw/failure go to their terminal states; otherwise → submitting. */
export async function finishRecording(input: {
  assignmentId: string;
  participantId: string;
  media: MediaClient;
  tMs: number;
  reason: FinishReason;
}): Promise<{ ok: true } | Fail> {
  const ctx = await db.transaction(async (tx) => {
    const a = await ownedAssignment(tx, input.assignmentId, input.participantId);
    if (!a) return { fail: "not_found" as const };
    const session = await tx.query.sessions.findFirst({
      where: eq(schema.sessions.assignmentId, a.id),
    });
    const asset = session ? await activeAsset(tx, session.id) : null;
    const target: ParticipantState =
      input.reason === "withdraw"
        ? "withdrawn"
        : input.reason === "failure"
          ? "incomplete"
          : "submitting";
    if (a.state === target) return { asset: null };
    const moved = await moveState(tx, a, target);
    if (!moved) return { fail: "invalid_transition" as const };
    if (session) {
      const pauses = [...session.pauses];
      const open = pauses.at(-1);
      if (open && open.end_ms === null)
        pauses[pauses.length - 1] = { start_ms: open.start_ms, end_ms: input.tMs };
      await tx
        .update(schema.sessions)
        .set({
          endedAt: new Date(),
          pauses,
          completeness: input.reason === "failure" ? "incomplete" : session.completeness,
          participantReportedOutcome:
            input.reason === "withdraw"
              ? "withdrew"
              : input.reason === "stuck"
                ? "stuck"
                : session.participantReportedOutcome,
        })
        .where(eq(schema.sessions.id, session.id));
    }
    if (asset) {
      await tx
        .update(schema.assets)
        .set({ status: "uploaded", providerStatus: "stopping", updatedAt: new Date() })
        .where(eq(schema.assets.id, asset.id));
    }
    return { asset };
  });
  if ("fail" in ctx && ctx.fail) return { ok: false, reason: ctx.fail };
  if (ctx.asset?.providerArchiveId) {
    try {
      await input.media.stopArchive(ctx.asset.providerArchiveId);
    } catch (err) {
      console.error("stopArchive failed; reconciliation job will retry", err);
    }
    await scheduleArchiveReconcile(ctx.asset.providerArchiveId);
  }
  return { ok: true };
}

/* ---------------- Outcome and credit ---------------- */

export async function submitOutcome(input: {
  assignmentId: string;
  participantId: string;
  participantReported: "completed" | "stuck" | "gave_up";
  perceivedDifficulty: number;
  comments: string | null;
}): Promise<{ ok: true } | Fail> {
  return db.transaction(async (tx) => {
    const a = await ownedAssignment(tx, input.assignmentId, input.participantId);
    if (!a) return { ok: false, reason: "not_found" };
    if (a.state === "complete") return { ok: true };
    const moved = await moveState(tx, a, "complete");
    if (!moved) return { ok: false, reason: "invalid_transition" };
    await tx
      .update(schema.sessions)
      .set({
        participantReportedOutcome: input.participantReported,
        perceivedDifficulty: input.perceivedDifficulty,
        comments: input.comments,
      })
      .where(eq(schema.sessions.assignmentId, a.id));
    // Fixed credit for valid participation; task failure never denies it (VC-02).
    await tx
      .insert(schema.creditLedger)
      .values({
        id: newId("credit"),
        tenantId: a.tenantId,
        participantId: a.participantId,
        assignmentId: a.id,
        amount: 1,
        reason: "valid_participation",
      })
      .onConflictDoNothing();
    return { ok: true };
  });
}

/* ---------------- Reads ---------------- */

export async function sessionForAssignment(assignmentId: string) {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.assignmentId, assignmentId),
  });
  if (!session) return null;
  const assets = await db.query.assets.findMany({
    where: eq(schema.assets.sessionId, session.id),
    orderBy: asc(schema.assets.offsetMs),
  });
  return { session, assets };
}
