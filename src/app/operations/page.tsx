import { tenantFromEnvironment } from "@/lib/auth";
import { listJobs, listOutbox } from "@/services/operations";
import { isPaused } from "@/services/settings";
import { JobActions, OperationsControls } from "./OperationsControls";

export default async function OperationsPage() {
  const tenantId = await tenantFromEnvironment();
  if (!tenantId)
    return (
      <main>
        <p>DEV_API_KEY is required.</p>
      </main>
    );
  const [jobs, outbox, pausedAt] = await Promise.all([
    listJobs(tenantId),
    listOutbox(tenantId),
    isPaused(tenantId),
  ]);
  return (
    <main>
      <h1>Operations</h1>
      <p>Tenant is {pausedAt ? "paused" : "active"}.</p>
      <OperationsControls />
      <h2>Jobs</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Next run</th>
            <th>Last error</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.type}</td>
              <td>{job.status}</td>
              <td>{job.attempts}</td>
              <td>{job.nextRunAt.toISOString()}</td>
              <td>{job.lastError ?? "—"}</td>
              <td>
                {job.status === "failed" || job.status === "pending" ? (
                  <JobActions jobId={job.id} status={job.status} />
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Outbox</h2>
      <ul>
        {outbox.map((event) => (
          <li key={event.idempotencyKey}>
            {event.eventType} · {event.createdAt.toISOString()} ·{" "}
            {event.publishedAt ? "published" : "pending"}
          </li>
        ))}
      </ul>
    </main>
  );
}
