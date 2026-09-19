import { Auth } from "@vonage/auth";
import {
  ArchiveMode,
  ArchiveOutputMode,
  LayoutType,
  MediaMode,
  Resolution,
  Video,
} from "@vonage/video";
import { jwtVerify } from "jose";
import type { VonageConfig } from "@/lib/env";

/**
 * Vonage Video adapter. Sessions are routed so archives can be recorded server-side.
 * Node SDK: @vonage/video (createSession / generateClientToken / startArchive / stopArchive / getArchive).
 * Archive status callbacks carry a JWT in the Authorization header signed with the
 * application's signature secret (developer.vonage.com/video/how-tos/verifying-webhooks).
 */

export type ArchiveInfo = {
  id: string;
  status: string;
  durationSeconds: number | null;
  sizeBytes: number | null;
  url: string | null;
  reason: string | null;
};

export type MediaClient = {
  createSession(): Promise<{ sessionId: string }>;
  clientToken(sessionId: string, data: string): string;
  startArchive(sessionId: string, name: string): Promise<{ archiveId: string }>;
  stopArchive(archiveId: string): Promise<void>;
  getArchive(archiveId: string): Promise<ArchiveInfo>;
};

export function createVonageClient(config: VonageConfig): MediaClient {
  const video = new Video(
    new Auth({ applicationId: config.applicationId, privateKey: config.privateKey }),
  );

  return {
    async createSession() {
      const session = await video.createSession({
        mediaMode: MediaMode.ROUTED,
        archiveMode: ArchiveMode.MANUAL,
        ...(config.sessionLocation ? { location: config.sessionLocation } : {}),
      });
      return { sessionId: session.sessionId };
    },
    clientToken(sessionId, data) {
      return video.generateClientToken(sessionId, {
        role: "publisher",
        data,
        expireTime: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
      });
    },
    async startArchive(sessionId, name) {
      const archive = await video.startArchive(sessionId, {
        name,
        hasAudio: true,
        hasVideo: true,
        outputMode: ArchiveOutputMode.COMPOSED,
        resolution: Resolution.HD_LANDSCAPE,
        layout: { type: LayoutType.BEST_FIT, screenshareType: "bestFit" },
      });
      return { archiveId: archive.id };
    },
    async stopArchive(archiveId) {
      await video.stopArchive(archiveId);
    },
    async getArchive(archiveId) {
      const a = await video.getArchive(archiveId);
      return {
        id: a.id,
        status: String(a.status),
        durationSeconds: typeof a.duration === "number" ? a.duration : null,
        sizeBytes: typeof a.size === "number" ? a.size : null,
        url: a.url ?? null,
        reason: a.reason ?? null,
      };
    },
  };
}

export type CallbackVerification =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: string };

export async function verifyArchiveCallback(input: {
  authorization: string | null;
  secret: string | null;
}): Promise<CallbackVerification> {
  if (!input.secret) return { ok: false, reason: "no_secret_configured" };
  const token = input.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { ok: false, reason: "missing_bearer" };
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(input.secret), {
      algorithms: ["HS256"],
    });
    return { ok: true, claims: payload as Record<string, unknown> };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "invalid_token" };
  }
}
