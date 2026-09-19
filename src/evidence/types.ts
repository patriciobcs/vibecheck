import type {
  ClockMap,
  SessionManifest,
  StoredClientEvent,
  TranscriptSegment,
} from "@/contracts/session";

export interface EvidenceSource {
  manifest(sessionId: string): Promise<SessionManifest | null>;
  clockMap(sessionId: string): Promise<ClockMap | null>;
  events(sessionId: string): Promise<StoredClientEvent[]>;
  transcript(sessionId: string): Promise<TranscriptSegment[]>;
}
