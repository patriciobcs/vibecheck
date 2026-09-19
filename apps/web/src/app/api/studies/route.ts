import { z } from "zod";
import { publishStudy } from "@/domain/publish";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

/** VC-01: publish a selected proposal as an immutable study plan. Requires an Idempotency-Key header. */
export const POST = route(async (req) => {
  const actor = await requireTenantActor(req);
  const key = req.headers.get("idempotency-key");
  if (!key) return fail(400, "idempotency_key_required", "Idempotency-Key header is required");
  const body = await req.json().catch(() => null);
  try {
    let result = null;
    for (const tenantId of actor.tenantIds) {
      result = await publishStudy(tenantId, key, body);
      if (result) break;
    }
    if (!result) return fail(404, "not_found", "product, run, or proposal not found");
    return json(result, { status: result.status });
  } catch (err) {
    if (err instanceof z.ZodError)
      return fail(
        400,
        "invalid_input",
        err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    throw err;
  }
});
