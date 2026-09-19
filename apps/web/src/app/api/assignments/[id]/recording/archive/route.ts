import { z } from "zod";
import { startArchive } from "@/domain/sessions";
import { requireParticipantFor } from "@/lib/actor";
import { fail, json, parseBody, route, statusFor } from "@/lib/api";
import { mediaClient } from "@/providers";

const Body = z.object({ t_ms: z.number().int().nonnegative() });

/** Called once the browser has connected and published; Vonage refuses archives for empty sessions. */
export const POST = route(
  async (req, ctx: RouteContext<"/api/assignments/[id]/recording/archive">) => {
    const { id } = await ctx.params;
    const actor = await requireParticipantFor(req, id);
    const body = await parseBody(req, Body);
    const media = mediaClient();
    if (!media) return fail(503, "media_provider_not_configured");
    const result = await startArchive({
      assignmentId: id,
      participantId: actor.participantId,
      media,
      tMs: body.t_ms,
    });
    if (!result.ok) return fail(statusFor(result.reason), result.reason);
    return json({ ok: true });
  },
);
