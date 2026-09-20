import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { outboxEvent, product, signal, tenant } from "@/db/schema";
import { recordSignal } from "./signals";

const input = (signalId: string, end: string, observed = 1) => ({
  schema_version: "1.0" as const,
  signal_id: signalId,
  source: "jev" as const,
  title: "Repeated toolbar friction",
  description: "Users repeatedly hesitate at the toolbar.",
  severity: "medium" as const,
  semantic_target: "toolbar",
  observed_sessions: observed,
  window_start: "2025-01-01T00:00:00.000Z",
  window_end: end,
  evidence_ref: null,
});

describe.skipIf(!process.env.DATABASE_URL)("signals", () => {
  it("creates, replays, updates, and isolates signals", async () => {
    const [firstTenant] = await db.insert(tenant).values({ name: randomUUID() }).returning();
    const [secondTenant] = await db.insert(tenant).values({ name: randomUUID() }).returning();
    const [firstProduct] = await db
      .insert(product)
      .values({
        tenantId: firstTenant.id,
        name: "Signal product",
        description: "",
        url: "https://example.com",
        permittedOrigins: [],
        language: "en",
        audience: "",
        releaseNotes: [],
        supportComplaints: [],
        knownJourneys: [],
        productEvents: [],
        status: "ready",
      })
      .returning();
    const [secondProduct] = await db
      .insert(product)
      .values({
        tenantId: secondTenant.id,
        name: "Other product",
        description: "",
        url: "https://example.org",
        permittedOrigins: [],
        language: "en",
        audience: "",
        releaseNotes: [],
        supportComplaints: [],
        knownJourneys: [],
        productEvents: [],
        status: "ready",
      })
      .returning();
    const first = await recordSignal(
      firstTenant.id,
      firstProduct.id,
      input("signal-1", "2025-01-02T00:00:00.000Z"),
    );
    const replay = await recordSignal(
      firstTenant.id,
      firstProduct.id,
      input("signal-1", "2025-01-02T00:00:00.000Z", 8),
    );
    const updated = await recordSignal(
      firstTenant.id,
      firstProduct.id,
      input("signal-1", "2025-01-03T00:00:00.000Z", 8),
    );
    expect(first).toEqual({ action: "created" });
    expect(replay).toEqual({ action: "unchanged" });
    expect(updated).toEqual({ action: "updated" });
    await expect(
      recordSignal(secondTenant.id, firstProduct.id, input("other", "2025-01-02T00:00:00.000Z")),
    ).rejects.toThrow("product_not_found");
    const events = await db
      .select()
      .from(outboxEvent)
      .where(
        and(eq(outboxEvent.tenantId, firstTenant.id), eq(outboxEvent.eventType, "signal.flagged")),
      );
    expect(events).toHaveLength(1);
    const rows = await db.select().from(signal).where(eq(signal.tenantId, firstTenant.id));
    expect(rows[0]?.observedSessions).toBe(8);
    await db.delete(tenant).where(eq(tenant.id, firstTenant.id));
    await db.delete(tenant).where(eq(tenant.id, secondTenant.id));
    void secondProduct;
  });
});
