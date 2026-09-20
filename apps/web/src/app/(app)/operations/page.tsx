import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { NavLink, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { db, schema } from "@/db/client";
import { cancelJobAudited, listOperations, retryJobAudited } from "@/domain/operations";
import { ownerContext } from "@/domain/owner-products";
import { pauseTenant, resumeTenant } from "@/domain/tenant-pause";

export const dynamic = "force-dynamic";

const JOB_STATUS_STYLE: Record<string, string> = {
  queued: "bg-secondary text-muted-foreground",
  running: "bg-brand/10 text-brand",
  done: "bg-success/15 text-success",
  failed: "bg-destructive/10 text-destructive",
  dead: "bg-destructive/10 text-destructive",
  cancelled: "bg-secondary/50 text-muted-foreground",
};

async function setPaused(formData: FormData) {
  "use server";
  const ctx = await ownerContext();
  if (!ctx) throw new Error("sign in required");
  const tenantId = String(formData.get("tenantId"));
  if (!ctx.writableTenantIds.includes(tenantId)) throw new Error("not a writable tenant");
  const paused = formData.get("paused") === "true";
  const reason = String(formData.get("reason") ?? "") || null;
  if (paused) await pauseTenant({ tenantId, actorUserId: ctx.userId, reason });
  else await resumeTenant({ tenantId, actorUserId: ctx.userId });
  redirect("/operations");
}

async function actOnJob(formData: FormData) {
  "use server";
  const ctx = await ownerContext();
  if (!ctx) throw new Error("sign in required");
  const jobId = String(formData.get("jobId"));
  const action = String(formData.get("act"));
  if (action === "retry")
    await retryJobAudited({ tenantIds: ctx.tenantIds, jobId, actorUserId: ctx.userId });
  else if (action === "cancel")
    await cancelJobAudited({ tenantIds: ctx.tenantIds, jobId, actorUserId: ctx.userId });
  redirect("/operations");
}

export default async function OperationsPage() {
  const ctx = await ownerContext();
  if (!ctx) redirect("/sign-in?next=/operations");
  const [ops, tenants] = await Promise.all([
    listOperations(ctx.tenantIds),
    ctx.tenantIds.length
      ? db.query.tenants.findMany({
          where: inArray(schema.tenants.id, ctx.tenantIds),
          columns: { id: true, name: true, paused: true, pausedAt: true },
        })
      : [],
  ]);
  return (
    <Shell
      wide
      nav={
        <>
          <NavLink href="/products">Products</NavLink>
          <NavLink href="/owner">Sessions</NavLink>
          <NavLink href="/operations">Operations</NavLink>
          <span className="px-3 text-foreground">{ctx.email}</span>
        </>
      }
    >
      <h1 className="text-3xl font-semibold tracking-tight">Operations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Durable jobs and emitted events for your tenants.
      </p>

      <section className="surface mt-8 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Global pause
        </p>
        {tenants.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No tenants.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {tenants.map((tenant) => (
              <li
                key={tenant.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 p-4 text-sm"
              >
                <span className="font-medium">{tenant.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{tenant.id}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tenant.paused ? "bg-warning/15 text-foreground" : "bg-success/15 text-success"}`}
                >
                  {tenant.paused ? "paused" : "active"}
                </span>
                {tenant.pausedAt ? (
                  <span className="text-xs text-muted-foreground">
                    since {new Date(tenant.pausedAt).toLocaleString()}
                  </span>
                ) : null}
                {ctx.writableTenantIds.includes(tenant.id) ? (
                  <form action={setPaused} className="ml-auto flex items-center gap-2">
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <input type="hidden" name="paused" value={tenant.paused ? "false" : "true"} />
                    {tenant.paused ? null : (
                      <input
                        type="text"
                        name="reason"
                        placeholder="Reason (optional)"
                        className="h-8 rounded-full border border-border bg-card px-3 text-xs"
                      />
                    )}
                    <Button type="submit" size="sm" variant="outline" className="rounded-full">
                      {tenant.paused ? "Resume" : "Pause"}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface mt-6 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Jobs</p>
        {ops.jobs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No jobs yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Job</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Attempts</th>
                  <th className="pb-2 pr-4 font-medium">Next run</th>
                  <th className="pb-2 pr-4 font-medium">Last error</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ops.jobs.map((job) => (
                  <tr key={job.id} className="border-t border-border/50 align-top">
                    <td className="py-2 pr-4 font-mono text-xs">{job.id.slice(-8)}</td>
                    <td className="py-2 pr-4">{job.type}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${JOB_STATUS_STYLE[job.status] ?? "bg-secondary"}`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {new Date(job.nextRunAt).toLocaleString()}
                    </td>
                    <td className="max-w-xs truncate py-2 pr-4 text-xs text-muted-foreground">
                      {job.lastError ?? "—"}
                    </td>
                    <td className="py-2">
                      {["failed", "dead", "cancelled"].includes(job.status) ||
                      job.status === "queued" ? (
                        <form action={actOnJob} className="flex gap-2">
                          <input type="hidden" name="jobId" value={job.id} />
                          {["failed", "dead", "cancelled"].includes(job.status) ? (
                            <Button
                              type="submit"
                              name="act"
                              value="retry"
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                            >
                              Retry
                            </Button>
                          ) : null}
                          {job.status === "queued" ? (
                            <Button
                              type="submit"
                              name="act"
                              value="cancel"
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </form>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface mt-6 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Outbox events
        </p>
        {ops.outbox.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No events emitted yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Event</th>
                  <th className="pb-2 pr-4 font-medium">Idempotency key</th>
                  <th className="pb-2 pr-4 font-medium">Emitted</th>
                  <th className="pb-2 font-medium">Published</th>
                </tr>
              </thead>
              <tbody>
                {ops.outbox.map((event) => (
                  <tr key={event.id} className="border-t border-border/50">
                    <td className="py-2 pr-4 font-medium">{event.eventType}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                      {event.idempotencyKey}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 text-xs">
                      {event.publishedAt ? new Date(event.publishedAt).toLocaleString() : "pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
