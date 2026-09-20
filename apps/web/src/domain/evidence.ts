import {
  type ClockMapSchema,
  type SessionManifestSchema,
  StoredClientEventSchema,
  TranscriptSegmentSchema,
} from "@vibecheck/contracts";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { buildSessionClockMap, buildSessionManifest } from "./manifest";

export type EvidenceSource = {
  manifest(sessionId: string): Promise<ReturnType<typeof SessionManifestSchema.parse> | null>;
  clockMap(sessionId: string): Promise<ReturnType<typeof ClockMapSchema.parse> | null>;
  events(sessionId: string): Promise<ReturnType<typeof StoredClientEventSchema.parse>[]>;
  transcript(sessionId: string): Promise<ReturnType<typeof TranscriptSegmentSchema.parse>[]>;
};

export const persistedEvidenceSource: EvidenceSource = {
  manifest: buildSessionManifest,
  clockMap: buildSessionClockMap,
  async events(sessionId) {
    const rows = await db.query.sessionEvents.findMany({
      where: eq(schema.sessionEvents.sessionId, sessionId),
      orderBy: asc(schema.sessionEvents.sequence),
    });
    return rows.map((row) =>
      StoredClientEventSchema.parse({
        event_id: row.id,
        session_id: row.sessionId,
        sequence: row.sequence,
        t_ms: row.tMs,
        type: row.type,
        payload: row.payload,
      }),
    );
  },
  async transcript(sessionId) {
    const rows = await db.query.transcriptSegments.findMany({
      where: eq(schema.transcriptSegments.sessionId, sessionId),
      orderBy: asc(schema.transcriptSegments.startMs),
    });
    return rows.map((row) =>
      TranscriptSegmentSchema.parse({
        segment_id: row.id,
        start_ms: row.startMs,
        end_ms: row.endMs,
        speaker: row.speaker,
        text: row.text,
        ...(row.confidence !== null ? { confidence: row.confidence / 1000 } : {}),
      }),
    );
  },
};

export { buildSessionClockMap, buildSessionManifest };
