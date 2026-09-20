import { type SessionManifest, SessionManifestSchema } from "@vibecheck/contracts";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { buildClockMap } from "./clock-map";

/**
 * The VC-02 → VC-03 handoff. Every `*_ref` resolves through authenticated services
 * (assets by id via signed URLs, events/transcript/clock map by session id); no media URL or
 * participant data is embedded.
 */
export async function buildSessionManifest(sessionId: string): Promise<SessionManifest | null> {
  const session = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId) });
  if (!session) return null;
  const assignment = await db.query.assignments.findFirst({
    where: eq(schema.assignments.id, session.assignmentId),
  });
  if (!assignment) return null;
  const assets = await db.query.assets.findMany({
    where: eq(schema.assets.sessionId, session.id),
    orderBy: asc(schema.assets.offsetMs),
  });
  const segmentCount = await db.$count(
    schema.transcriptSegments,
    eq(schema.transcriptSegments.sessionId, session.id),
  );

  const manifest: SessionManifest = {
    schema_version: "1.0",
    session_id: session.id,
    assignment_id: assignment.id,
    study_revision: assignment.studyRevision,
    tested_commit_sha: assignment.testedCommitSha,
    consent_version: assignment.consentVersion ?? "unknown",
    capture_policy_ref: `assignment:${assignment.id}:capture_policy`,
    assets: assets.map((a) => ({
      kind: a.kind,
      asset_ref: a.id,
      status: a.status,
      duration_ms: a.durationMs,
    })),
    // Instrumented sessions always expose their event stream, even when it turned out empty.
    events_ref: session.instrumentation === "sdk" ? `events:${session.id}` : null,
    transcript_ref:
      session.transcriptStatus === "done" && segmentCount > 0 ? `transcript:${session.id}` : null,
    clock_map_ref: session.startedAt ? `clockmap:${session.id}` : null,
    completeness: session.completeness === "pending" ? "incomplete" : session.completeness,
    instrumentation: session.instrumentation,
    outcome: {
      participant_reported: session.participantReportedOutcome,
      instrumented: session.instrumentedOutcome,
    },
  };
  return SessionManifestSchema.parse(manifest);
}

/** The clock map referenced by `clock_map_ref`. */
export async function buildSessionClockMap(sessionId: string) {
  const session = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId) });
  if (!session?.startedAt) return null;
  const assets = await db.query.assets.findMany({
    where: eq(schema.assets.sessionId, session.id),
    orderBy: asc(schema.assets.offsetMs),
  });
  return buildClockMap({
    sessionStartedAt: session.startedAt,
    assets: assets.map((a) => ({
      asset_ref: a.id,
      offset_ms: a.offsetMs,
      duration_ms: a.durationMs,
    })),
    pauses: session.pauses,
  });
}
