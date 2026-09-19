import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { fail, json, route } from "@/lib/api";

/** Development/test helper: pipeline state for one assignment's session. Disabled in production. */
export const GET = route(async (req) => {
  if (process.env.NODE_ENV === "production") return fail(404, "not_found");
  const assignmentId = new URL(req.url).searchParams.get("assignment_id");
  if (!assignmentId) return fail(400, "assignment_id_required");
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.assignmentId, assignmentId),
  });
  if (!session) return fail(404, "not_found");
  const assets = await db.query.assets.findMany({
    where: eq(schema.assets.sessionId, session.id),
    orderBy: asc(schema.assets.offsetMs),
  });
  const segments = await db.query.transcriptSegments.findMany({
    where: eq(schema.transcriptSegments.sessionId, session.id),
    orderBy: asc(schema.transcriptSegments.startMs),
  });
  const events = await db.$count(
    schema.sessionEvents,
    eq(schema.sessionEvents.sessionId, session.id),
  );
  return json({
    session_id: session.id,
    completeness: session.completeness,
    transcript_status: session.transcriptStatus,
    outcome: session.participantReportedOutcome,
    pauses: session.pauses,
    events,
    assets: assets.map((a) => ({
      status: a.status,
      provider_status: a.providerStatus,
      offset_ms: a.offsetMs,
      duration_ms: a.durationMs,
      size_bytes: a.sizeBytes,
    })),
    transcript: segments.map((s) => ({ start_ms: s.startMs, end_ms: s.endMs, text: s.text })),
  });
});
