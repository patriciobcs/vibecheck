import { SignalSchema } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { ingestSignal, listSignals } from "./signals";

beforeEach(resetDb);

const input = (signalId: string, end: string) =>
  SignalSchema.parse({
    schema_version: "1.0",
    signal_id: signalId,
    source: "jev",
    title: "Repeated toolbar friction",
    description: "Users repeatedly hesitate at the toolbar.",
    severity: "medium",
    semantic_target: "toolbar",
    observed_sessions: ["obs_a"],
    window_start: "2025-01-01T00:00:00.000Z",
    window_end: end,
    evidence_ref: null,
  });

describe("signals", () => {
  it("creates, ignores replays, updates on a later window and isolates tenants", async () => {
    const { tenantId, productId } = await seedStudy();
    const other = await seedStudy();
    const created = await ingestSignal({
      tenantIds: [tenantId],
      productId,
      signal: input("signal-1", "2025-01-02T00:00:00.000Z"),
      actorUserId: null,
    });
    expect(created.outcome).toBe("created");

    const replay = await ingestSignal({
      tenantIds: [tenantId],
      productId,
      signal: input("signal-1", "2025-01-02T00:00:00.000Z"),
      actorUserId: null,
    });
    expect(replay.outcome).toBe("unchanged");

    const earlier = await ingestSignal({
      tenantIds: [tenantId],
      productId,
      signal: input("signal-1", "2025-01-01T12:00:00.000Z"),
      actorUserId: null,
    });
    expect(earlier.outcome).toBe("unchanged");

    const updated = await ingestSignal({
      tenantIds: [tenantId],
      productId,
      signal: input("signal-1", "2025-01-03T00:00:00.000Z"),
      actorUserId: null,
    });
    expect(updated.outcome).toBe("updated");
    expect(updated.signal.windowEnd.toISOString()).toBe("2025-01-03T00:00:00.000Z");

    await expect(
      ingestSignal({
        tenantIds: [other.tenantId],
        productId,
        signal: input("other", "2025-01-02T00:00:00.000Z"),
        actorUserId: null,
      }),
    ).rejects.toThrow(ApiError);

    const events = await db.query.eventOutbox.findMany({
      where: eq(schema.eventOutbox.eventType, "signal.flagged"),
    });
    expect(events).toHaveLength(2);
    expect(await db.$count(schema.signals)).toBe(1);
    expect(await listSignals([tenantId], productId)).toHaveLength(1);
  });
});
