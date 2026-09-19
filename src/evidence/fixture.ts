import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  clockMapSchema,
  sessionManifestSchema,
  storedClientEventSchema,
  transcriptSegmentSchema,
} from "@/contracts/session";
import type { EvidenceSource } from "./types";

const sessionIdPattern = /^[\w-]+$/;
const fixtureRoot = path.join(process.cwd(), "fixtures", "sessions");

async function readJson(sessionId: string, file: string): Promise<unknown> {
  if (!sessionIdPattern.test(sessionId)) throw new Error("invalid_session_id");
  return JSON.parse(await readFile(path.join(fixtureRoot, sessionId, file), "utf8")) as unknown;
}

export const fixtureEvidenceSource: EvidenceSource = {
  async manifest(sessionId) {
    try {
      return sessionManifestSchema.parse(await readJson(sessionId, "manifest.json"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  },
  async clockMap(sessionId) {
    return clockMapSchema.parse(await readJson(sessionId, "clockmap.json"));
  },
  async events(sessionId) {
    return storedClientEventSchema.array().parse(await readJson(sessionId, "events.json"));
  },
  async transcript(sessionId) {
    return transcriptSegmentSchema.array().parse(await readJson(sessionId, "transcript.json"));
  },
};

export function evidenceSource(): EvidenceSource {
  if ((process.env.EVIDENCE_SOURCE ?? "fixture") === "fixture") return fixtureEvidenceSource;
  throw new Error("unsupported_evidence_source");
}

export type { EvidenceSource };
