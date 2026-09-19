import { fail, json, route } from "@/lib/api";
import { drain } from "@/worker/runner";

/** Development/test helper: run pending jobs inline instead of waiting for the worker process. */
export const POST = route(async () => {
  if (process.env.NODE_ENV === "production") return fail(404, "not_found");
  return json({ ran: await drain("dev-drain") });
});
