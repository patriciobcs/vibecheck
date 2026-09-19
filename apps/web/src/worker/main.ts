import { hostname } from "node:os";
import { enqueueJob } from "@/domain/jobs";
import { env } from "@/lib/env";
import { tick } from "./runner";

/**
 * Durable worker: leases jobs from the database table and runs provider work outside
 * any browser request. Restart-safe: leases expire and jobs are business-keyed.
 */
const workerId = `${hostname()}:${process.pid}`;
const { WORKER_POLL_INTERVAL_MS: pollMs, WORKER_LEASE_SECONDS: leaseSeconds } = env();
let stopping = false;

/** Retrospective journey ends are found by a periodic sweep, deduplicated per minute. */
async function scheduleSweep() {
  const minute = Math.floor(Date.now() / 60_000);
  await enqueueJob({
    type: "monitoring.sweep",
    payload: {},
    dedupeKey: `monitoring.sweep:${minute}`,
    maxAttempts: 1,
  });
}

async function loop() {
  console.info(`[worker] ${workerId} started; poll ${pollMs}ms lease ${leaseSeconds}s`);
  let lastSweep = 0;
  while (!stopping) {
    if (Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now();
      await scheduleSweep().catch((err) => console.error("[worker] sweep scheduling failed", err));
    }
    let didWork = false;
    try {
      const r = await tick(workerId);
      didWork = r.ran;
      if (r.ran) console.info(`[worker] ${r.type} ${r.id} ${r.ok ? "done" : `failed: ${r.error}`}`);
    } catch (err) {
      console.error("[worker] tick error", err);
    }
    if (!didWork) await new Promise((r) => setTimeout(r, pollMs));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    console.info("[worker] stopping after current job");
  });
}

loop().then(() => process.exit(0));
