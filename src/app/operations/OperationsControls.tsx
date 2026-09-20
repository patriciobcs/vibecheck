"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OperationsControls() {
  const router = useRouter();
  const [reason, setReason] = useState("");
  async function update(path: string, method: "POST" | "DELETE", body?: unknown) {
    await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    router.refresh();
  }
  return (
    <section>
      <h2>Global pause</h2>
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason (optional)"
      />
      <div>
        <button type="button" onClick={() => update("/api/settings/pause", "POST", { reason })}>
          Pause tenant
        </button>{" "}
        <button type="button" onClick={() => update("/api/settings/pause", "DELETE")}>
          Resume tenant
        </button>
      </div>
    </section>
  );
}

export function JobActions({ jobId, status }: { jobId: string; status: "pending" | "failed" }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  async function act(action: "retry" | "cancel") {
    setWorking(true);
    await fetch(`/api/operations/jobs/${jobId}/${action}`, { method: "POST" });
    setWorking(false);
    router.refresh();
  }
  return (
    <span>
      {status === "failed" && (
        <button type="button" disabled={working} onClick={() => act("retry")}>
          Retry
        </button>
      )}
      {status === "pending" && (
        <button type="button" disabled={working} onClick={() => act("cancel")}>
          Cancel
        </button>
      )}
    </span>
  );
}
