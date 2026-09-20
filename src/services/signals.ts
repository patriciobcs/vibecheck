import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { outboxEvent, product, signal } from "@/db/schema";
import { signalSchema, type Signal } from "@/contracts/signal";
import { randomUUID } from "node:crypto";

export async function recordSignal(tenantId: string, productId: string, input: Signal) {
  const parsed = signalSchema.parse(input);
  const [productRow] = await db
    .select({ id: product.id })
    .from(product)
    .where(and(eq(product.id, productId), eq(product.tenantId, tenantId)))
    .limit(1);
  if (!productRow) throw new Error("product_not_found");
  const [existing] = await db
    .select()
    .from(signal)
    .where(and(eq(signal.tenantId, tenantId), eq(signal.signalId, parsed.signal_id)))
    .limit(1);
  if (!existing) {
    await db.transaction(async (tx) => {
      await tx.insert(signal).values({
        tenantId,
        productId,
        signalId: parsed.signal_id,
        source: parsed.source,
        title: parsed.title,
        description: parsed.description,
        severity: parsed.severity,
        semanticTarget: parsed.semantic_target,
        observedSessions: parsed.observed_sessions ?? null,
        windowStart: new Date(parsed.window_start),
        windowEnd: new Date(parsed.window_end),
        evidenceRef: parsed.evidence_ref,
      });
      await tx
        .insert(outboxEvent)
        .values({
          eventId: randomUUID(),
          eventType: "signal.flagged",
          idempotencyKey: `${tenantId}:signal:${parsed.signal_id}`,
          tenantId,
          productId,
          correlationId: parsed.signal_id,
          payload: {
            product_id: productId,
            signal_id: parsed.signal_id,
            severity: parsed.severity,
          },
          occurredAt: new Date(parsed.window_end),
        })
        .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
    });
    return { action: "created" as const };
  }
  if (new Date(parsed.window_end) <= existing.windowEnd) return { action: "unchanged" as const };
  await db
    .update(signal)
    .set({
      productId,
      source: parsed.source,
      title: parsed.title,
      description: parsed.description,
      severity: parsed.severity,
      semanticTarget: parsed.semantic_target,
      observedSessions: parsed.observed_sessions ?? null,
      windowStart: new Date(parsed.window_start),
      windowEnd: new Date(parsed.window_end),
      evidenceRef: parsed.evidence_ref,
    })
    .where(eq(signal.id, existing.id));
  return { action: "updated" as const };
}

export async function listSignals(tenantId: string, productId: string) {
  const [productRow] = await db
    .select({ id: product.id })
    .from(product)
    .where(and(eq(product.id, productId), eq(product.tenantId, tenantId)))
    .limit(1);
  if (!productRow) throw new Error("product_not_found");
  return db
    .select()
    .from(signal)
    .where(and(eq(signal.tenantId, tenantId), eq(signal.productId, productId)))
    .orderBy(desc(signal.windowEnd));
}
