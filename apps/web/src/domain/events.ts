import { type EventEnvelope, EventEnvelopeSchema, type EventType } from "@vibecheck/contracts";
import type { Tx } from "@/db/client";
import { schema } from "@/db/client";
import { newId } from "@/lib/ids";

/**
 * Writes a domain event with the shared envelope into the outbox inside the caller's transaction.
 * Duplicate idempotency keys are ignored, so re-running a business operation emits one event.
 */
export async function emitEvent(
  tx: Tx,
  input: {
    type: EventType;
    tenantId: string;
    productId: string;
    correlationId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  },
): Promise<EventEnvelope> {
  const envelope = EventEnvelopeSchema.parse({
    schema_version: "1.0",
    event_id: newId("evt"),
    event_type: input.type,
    occurred_at: new Date().toISOString(),
    tenant_id: input.tenantId,
    product_id: input.productId,
    correlation_id: input.correlationId,
    idempotency_key: input.idempotencyKey,
    payload: input.payload,
  });
  await tx
    .insert(schema.eventOutbox)
    .values({
      id: envelope.event_id,
      eventType: envelope.event_type,
      idempotencyKey: envelope.idempotency_key,
      envelope,
    })
    .onConflictDoNothing({ target: schema.eventOutbox.idempotencyKey });
  return envelope;
}
