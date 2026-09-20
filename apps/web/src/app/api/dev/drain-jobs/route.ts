import { z } from "zod";
import { fail, json, parseBody, route } from "@/lib/api";
import { drain } from "@/worker/runner";

const Body = z.object({ types: z.array(z.string().min(1)).min(1).optional() });

/**
 * Development/test helper: run pending jobs inline instead of waiting for the worker process.
 * `types` limits which jobs run, so a test can drain `monitoring.scan` and stub the evaluation
 * instead of letting a configured provider key turn the run into a real (billed) call.
 */
export const POST = route(async (req) => {
  if (process.env.NODE_ENV === "production") return fail(404, "not_found");
  const body = (await req.text()).trim();
  const { types } = body
    ? await parseBody(new Request(req.url, { method: "POST", body, headers: req.headers }), Body)
    : { types: undefined };
  return json({ ran: await drain("dev-drain", 20, types) });
});
