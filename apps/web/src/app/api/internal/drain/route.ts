import { retryDeferredEvaluations, sweepIdleJourneys } from "@/domain/monitoring/screening";
import { fail, json, route } from "@/lib/api";
import { env } from "@/lib/env";
import { drain } from "@/worker/runner";

export const maxDuration = 60;

/**
 * Serverless stand-in for the worker loop: runs the idle-journey sweep, retries budget-deferred
 * evaluations and drains due jobs. Called by Vercel Cron (Authorization: Bearer CRON_SECRET) or
 * any scheduler with the same secret. Refused without the secret.
 */
async function handle(req: Request) {
  const secret = env().CRON_SECRET;
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!secret || bearer !== secret) return fail(401, "unauthorized");
  const swept = await sweepIdleJourneys();
  const retried = await retryDeferredEvaluations();
  const ran = await drain("cron", 25);
  return json({ swept: swept.length, retried: retried.length, ran: ran.length });
}

export const GET = route(handle);
export const POST = route(handle);
