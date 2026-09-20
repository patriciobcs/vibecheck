import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ClockMapSchema,
  SessionManifestSchema,
  StoredClientEventSchema,
  TranscriptSegmentSchema,
} from "@vibecheck/contracts";
import type { EvidenceSource } from "./evidence";

const fixtureRoot = path.join(process.cwd(), "src", "fixtures", "sessions");
const sessionIdPattern = /^[\w-]+$/;
async function readJson(sessionId: string, file: string) {
  if (!sessionIdPattern.test(sessionId)) throw new Error("invalid_session_id");
  return JSON.parse(await readFile(path.join(fixtureRoot, sessionId, file), "utf8")) as unknown;
}

export const fixtureEvidenceSource: EvidenceSource = {
  async manifest(sessionId) {
    try {
      return SessionManifestSchema.parse(await readJson(sessionId, "manifest.json"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  },
  async clockMap(sessionId) {
    return ClockMapSchema.parse(await readJson(sessionId, "clockmap.json"));
  },
  async events(sessionId) {
    const rawEvents = await readJson(sessionId, "events.json");
    if (!Array.isArray(rawEvents)) throw new Error("fixture_events_not_array");
    return StoredClientEventSchema.array().parse(
      rawEvents.map((event) => {
        if (!event || typeof event !== "object") throw new Error("fixture_event_not_object");
        const record = event as Record<string, unknown>;
        const { event_id, session_id, sequence, t_ms, type, ...payload } = record;
        return { event_id, session_id, sequence, t_ms, type, payload };
      }),
    );
  },
  async transcript(sessionId) {
    return TranscriptSegmentSchema.array().parse(await readJson(sessionId, "transcript.json"));
  },
};
