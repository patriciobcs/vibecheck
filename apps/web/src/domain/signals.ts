import type { Signal } from "@vibecheck/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { newId } from "@/lib/ids";
import { emitEvent } from "./events";

export type SignalRow = typeof schema.signals.$inferSelect;
export type SignalOutcome = "created" | "updated" | "unchanged";

async function requireTenantProduct(tenantIds: string[], productId: string) {
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), inArray(schema.products.tenantId, tenantIds)),
  });
  if (!product) throw new ApiError(404, "not_found");
  return product;
}

/**
 * Ingests one Jev signal (VC-06). Replays with the same `signal_id` at the same or an earlier
 * window end are ignored; a later window end updates the row. Signals are hints only — they
 * never create findings, issues or jobs.
 */
export async function ingestSignal(input: {
  tenantIds: string[];
  productId: string;
  signal: Signal;
  actorUserId: string | null;
}): Promise<{ outcome: SignalOutcome; signal: SignalRow }> {
  const { signal } = input;
  const product = await requireTenantProduct(input.tenantIds, input.productId);
  const windowStart = new Date(signal.window_start);
  const windowEnd = new Date(signal.window_end);
  const fields = {
    source: signal.source,
    title: signal.title,
    description: signal.description,
    severity: signal.severity,
    semanticTarget: signal.semantic_target,
    observedSessions: signal.observed_sessions ?? [],
    windowStart,
    windowEnd,
    evidenceRef: signal.evidence_ref,
  };
  return db.transaction(async (tx) => {
    const existing = await tx.query.signals.findFirst({
      where: and(
        eq(schema.signals.productId, product.id),
        eq(schema.signals.signalId, signal.signal_id),
      ),
    });
    if (existing && windowEnd <= existing.windowEnd) {
      return { outcome: "unchanged" as const, signal: existing };
    }
    const row = existing
      ? (
          await tx
            .update(schema.signals)
            .set({ ...fields, updatedAt: new Date() })
            .where(eq(schema.signals.id, existing.id))
            .returning()
        )[0]
      : (
          await tx
            .insert(schema.signals)
            .values({
              id: newId("signal"),
              tenantId: product.tenantId,
              productId: product.id,
              signalId: signal.signal_id,
              ...fields,
            })
            .returning()
        )[0];
    if (!row) throw new Error("signal write failed");
    const outcome = existing ? ("updated" as const) : ("created" as const);
    await emitEvent(tx, {
      type: "signal.flagged",
      tenantId: product.tenantId,
      productId: product.id,
      correlationId: row.id,
      idempotencyKey: `signal:${product.id}:${signal.signal_id}:${signal.window_end}`,
      payload: { ...signal, product_id: product.id },
    });
    await tx.insert(schema.auditEvents).values({
      id: newId("audit"),
      tenantId: product.tenantId,
      actorUserId: input.actorUserId,
      action: "signal.ingest",
      subjectType: "signal",
      subjectId: row.id,
      detail: { outcome, severity: signal.severity },
    });
    return { outcome, signal: row };
  });
}

export async function listSignals(tenantIds: string[], productId: string) {
  await requireTenantProduct(tenantIds, productId);
  return db.query.signals.findMany({
    where: eq(schema.signals.productId, productId),
    orderBy: desc(schema.signals.windowEnd),
  });
}
