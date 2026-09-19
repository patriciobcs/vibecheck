import { z } from "zod";
import { enqueueJob } from "@/domain/jobs";
import { createManualDetector } from "@/domain/monitoring/detectors";
import { ownerProduct } from "@/domain/owner-products";
import { fail, json, parseBody, route } from "@/lib/api";
import { env } from "@/lib/env";
import { requireTenantActor } from "@/lib/tenant-access";

const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("manual"),
    detector_id: z.string().min(1),
    journey_id: z.string().min(1),
    app_build_ref: z.string().min(1),
    required_events: z.array(z.string()).min(1),
    questions: z.record(z.string(), z.unknown()),
    source_refs: z.array(z.string()).default([]),
  }),
  z.object({
    mode: z.literal("generate"),
    detector_id: z.string().min(1),
    journey_hint: z.string().min(1),
    app_build_ref: z.string().min(1),
    provider: z.enum(["fixture", "devin"]).default("fixture"),
  }),
]);

/** Publish a hand-authored detector, or queue agent generation (validated before activation). */
export const POST = route(async (req, ctx: RouteContext<"/api/owner/products/[id]/detectors">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const product = await ownerProduct(actor.tenantIds, id);
  if (!product) return fail(404, "not_found");
  const body = await parseBody(req, Body);
  if (body.mode === "manual") {
    const res = await createManualDetector({
      productId: product.id,
      detectorId: body.detector_id,
      journeyId: body.journey_id,
      appBuildRef: body.app_build_ref,
      requiredEvents: body.required_events,
      questions: body.questions,
      sourceRefs: body.source_refs,
    });
    if (!res.ok) return fail(422, "invalid_detector", res.problems.join("; "));
    return json(res.detector, { status: 201 });
  }
  if (body.provider === "devin" && !env().devin) return fail(503, "devin_not_configured");
  const job = await enqueueJob({
    type: "detector.generate",
    payload: {
      productId: product.id,
      detectorId: body.detector_id,
      appBuildRef: body.app_build_ref,
      journeyHint: body.journey_hint,
      provider: body.provider,
    },
    dedupeKey: `detector.generate:${product.id}:${body.detector_id}:${body.app_build_ref}:${Date.now()}`,
    maxAttempts: 2,
  });
  return json({ job_id: job.id, status: "queued" }, { status: 202 });
});
