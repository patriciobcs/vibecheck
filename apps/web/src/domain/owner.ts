import { StudyPlanSchema } from "@vibecheck/contracts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { membershipsForUser } from "./participants";

/** Owner/researcher/viewer access: tenant scope comes from memberships, never from input. */
export async function requireMembership(
  userId: string,
  tenantId: string,
  roles: string[] = ["owner", "admin", "researcher", "viewer"],
) {
  const memberships = await membershipsForUser(userId);
  const m = memberships.find((x) => x.tenantId === tenantId && roles.includes(x.role));
  if (!m) throw new ApiError(403, "forbidden");
  return m;
}

export async function ownerOverview(userId: string) {
  const memberships = await membershipsForUser(userId);
  const tenantIds = memberships.map((m) => m.tenantId);
  if (tenantIds.length === 0) return { tenants: [], studies: [], sessions: [] };
  const tenants = await db.query.tenants.findMany({ where: inArray(schema.tenants.id, tenantIds) });
  const products = await db.query.products.findMany({
    where: inArray(schema.products.tenantId, tenantIds),
  });
  const studies = await db.query.studies.findMany({
    where: inArray(schema.studies.tenantId, tenantIds),
    orderBy: desc(schema.studies.createdAt),
  });
  const revisions = await db.query.studyRevisions.findMany({
    where: inArray(schema.studyRevisions.tenantId, tenantIds),
  });
  const assignments = await db.query.assignments.findMany({
    where: inArray(schema.assignments.tenantId, tenantIds),
  });
  const sessions = await db.query.sessions.findMany({
    where: inArray(schema.sessions.tenantId, tenantIds),
    orderBy: desc(schema.sessions.createdAt),
  });
  const invitations = await db.query.invitations.findMany({
    where: inArray(schema.invitations.tenantId, tenantIds),
    orderBy: desc(schema.invitations.createdAt),
  });

  return {
    tenants,
    studies: studies.map((s) => {
      const rev = revisions.find((r) => r.studyId === s.id && r.revision === s.currentRevision);
      const plan = rev ? StudyPlanSchema.parse(rev.plan) : null;
      const product = products.find((p) => p.id === s.productId);
      const a = assignments.filter((x) => x.studyId === s.id);
      return {
        id: s.id,
        status: s.status,
        revision: s.currentRevision,
        provenance: rev?.provenance ?? null,
        product: product
          ? {
              id: product.id,
              name: product.name,
              sample: product.sample,
              publishableKey: product.publishableKey,
            }
          : null,
        task: plan?.task ?? null,
        recruitment: plan?.recruitment ?? null,
        counts: {
          target: plan?.recruitment.target_count ?? 0,
          claimed: a.filter((x) => !["expired", "withdrawn"].includes(x.state)).length,
          completed: a.filter((x) => x.state === "complete").length,
          withdrawn: a.filter((x) => x.state === "withdrawn").length,
          incomplete: a.filter((x) => x.state === "incomplete").length,
        },
        invitations: invitations
          .filter((i) => i.studyId === s.id)
          .map((i) => ({
            id: i.id,
            uses: i.uses,
            maxUses: i.maxUses,
            expiresAt: i.expiresAt.toISOString(),
          })),
      };
    }),
    sessions: sessions.map((sess) => {
      const a = assignments.find((x) => x.id === sess.assignmentId);
      return {
        id: sess.id,
        studyId: a?.studyId ?? null,
        state: a?.state ?? "unknown",
        channel: a?.channel ?? null,
        startedAt: sess.startedAt?.toISOString() ?? null,
        endedAt: sess.endedAt?.toISOString() ?? null,
        completeness: sess.completeness,
        transcriptStatus: sess.transcriptStatus,
        outcome: sess.participantReportedOutcome,
        instrumentation: sess.instrumentation,
      };
    }),
  };
}

/** Evidence bundle for one session: manifest-like summary, assets, events and transcript. */
export async function sessionEvidence(userId: string, sessionId: string) {
  const session = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId) });
  if (!session) return null;
  await requireMembership(userId, session.tenantId);
  const assignment = await db.query.assignments.findFirst({
    where: eq(schema.assignments.id, session.assignmentId),
  });
  if (!assignment) return null;
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, assignment.studyId),
      eq(schema.studyRevisions.revision, assignment.studyRevision),
    ),
  });
  const plan = revision ? StudyPlanSchema.parse(revision.plan) : null;
  const assets = await db.query.assets.findMany({
    where: eq(schema.assets.sessionId, session.id),
    orderBy: asc(schema.assets.offsetMs),
  });
  const events = await db.query.sessionEvents.findMany({
    where: eq(schema.sessionEvents.sessionId, session.id),
    orderBy: asc(schema.sessionEvents.sequence),
    limit: 2000,
  });
  const transcript = await db.query.transcriptSegments.findMany({
    where: eq(schema.transcriptSegments.sessionId, session.id),
    orderBy: asc(schema.transcriptSegments.startMs),
  });
  const jobs = await db.query.jobs.findMany({
    where: inArray(schema.jobs.type, ["archive.fetch", "asset.transcribe"]),
    orderBy: desc(schema.jobs.createdAt),
    limit: 50,
  });
  const archiveIds = new Set(assets.map((a) => a.providerArchiveId));
  const assetIds = new Set(assets.map((a) => a.id));

  return {
    session: {
      id: session.id,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      pauses: session.pauses,
      completeness: session.completeness,
      instrumentation: session.instrumentation,
      transcriptStatus: session.transcriptStatus,
      participantReportedOutcome: session.participantReportedOutcome,
      instrumentedOutcome: session.instrumentedOutcome,
      perceivedDifficulty: session.perceivedDifficulty,
      comments: session.comments,
      moderationPrompts: session.moderationPrompts,
    },
    assignment: {
      id: assignment.id,
      state: assignment.state,
      channel: assignment.channel,
      cohort: assignment.cohort,
      studyId: assignment.studyId,
      studyRevision: assignment.studyRevision,
      testedCommitSha: assignment.testedCommitSha,
      consentVersion: assignment.consentVersion,
      fixtureRef: assignment.fixtureRef,
      capturePolicy: assignment.capturePolicy,
    },
    task: plan?.task ?? null,
    provenance: revision?.provenance ?? null,
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      status: a.status,
      providerStatus: a.providerStatus,
      offsetMs: a.offsetMs,
      durationMs: a.durationMs,
      sizeBytes: a.sizeBytes,
      hasMedia: a.storagePath !== null,
      failureReason: a.failureReason,
    })),
    events: events.map((e) => ({
      sequence: e.sequence,
      tMs: e.tMs,
      type: e.type,
      payload: e.payload,
    })),
    transcript: transcript.map((t) => ({
      id: t.id,
      assetId: t.assetId,
      startMs: t.startMs,
      endMs: t.endMs,
      text: t.text,
      confidence: t.confidence,
    })),
    jobs: jobs
      .filter((j) => {
        const p = j.payload as { archiveId?: string; assetId?: string };
        return (
          (p.archiveId && archiveIds.has(p.archiveId)) || (p.assetId && assetIds.has(p.assetId))
        );
      })
      .map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        attempts: j.attempts,
        lastError: j.lastError,
        nextRunAt: j.nextRunAt.toISOString(),
      })),
  };
}
