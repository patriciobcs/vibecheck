import { z } from "zod";
import { startRecording } from "@/domain/sessions";
import { requireParticipantFor } from "@/lib/actor";
import { fail, json, parseBody, route, statusFor } from "@/lib/api";
import { env } from "@/lib/env";
import { issueEventsToken } from "@/lib/session-token";
import { mediaClient } from "@/providers";

const Body = z.object({
  instrumentation: z.enum(["sdk", "video_only"]),
  client_clock_origin_ms: z.number().int().nonnegative(),
});

export const POST = route(
  async (req, ctx: RouteContext<"/api/assignments/[id]/recording/start">) => {
    const { id } = await ctx.params;
    const actor = await requireParticipantFor(req, id);
    const body = await parseBody(req, Body);
    const media = mediaClient();
    if (!media)
      return fail(
        503,
        "media_provider_not_configured",
        "Vonage credentials are missing; recording cannot start.",
      );
    const result = await startRecording({
      assignmentId: id,
      participantId: actor.participantId,
      media,
      instrumentation: body.instrumentation,
      clientClockOriginMs: body.client_clock_origin_ms,
    });
    if (!result.ok) return fail(statusFor(result.reason), result.reason);
    const eventsToken = await issueEventsToken({
      sessionId: result.sessionId,
      participantId: actor.participantId,
    });
    return json({
      session_id: result.sessionId,
      media: {
        provider: "vonage",
        application_id: env().vonage?.applicationId,
        session_id: result.mediaSessionId,
        token: result.clientToken,
      },
      events_token: eventsToken,
    });
  },
);
