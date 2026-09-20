import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { evaluateJob } from "@/domain/monitoring/evaluate";
import { monitoringOverview } from "@/domain/monitoring/overview";
import { fail, json, parseBody, route } from "@/lib/api";
import type { JevClient } from "@/providers/jev";

/** Development/test helper: monitoring state for a product. */
export const GET = route(async (req) => {
  if (process.env.NODE_ENV === "production") return fail(404, "not_found");
  const productId = new URL(req.url).searchParams.get("product_id");
  if (!productId) return fail(400, "product_id_required");
  return json(await monitoringOverview(productId));
});

const Body = z.object({
  product_id: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
});

/** Development/test helper: run queued evaluations for a product with a stubbed Jev answer. */
export const POST = route(async (req) => {
  if (process.env.NODE_ENV === "production") return fail(404, "not_found");
  const body = await parseBody(req, Body);
  const stub: JevClient = {
    evaluate: async () => ({
      model: "jev-stub",
      answers: body.answers,
      usage: { input_tokens: 0, output_tokens: 0 },
      requestId: "stub",
    }),
  };
  const queued = await db.query.jevEvaluations.findMany({
    where: eq(schema.jevEvaluations.status, "queued"),
    orderBy: desc(schema.jevEvaluations.requestedAt),
  });
  const ran: string[] = [];
  for (const e of queued) {
    if (e.productId !== body.product_id) continue;
    await evaluateJob({ evaluationId: e.id }, { jev: stub, priceMicrosPer1k: null }).catch(
      () => {},
    );
    ran.push(e.id);
  }
  return json({ ran });
});
