import { describe, expect, it } from "vitest";
import { EventEnvelopeSchema } from "./envelope";

const base = {
  schema_version: "1.0",
  event_id: "evt_1",
  event_type: "assignment.claimed",
  occurred_at: "2026-09-19T10:00:00Z",
  tenant_id: "tenant_1",
  product_id: "product_1",
  correlation_id: "wf_1",
  idempotency_key: "assignment_1:claim",
  payload: { assignment_id: "assignment_1" },
};

describe("EventEnvelopeSchema", () => {
  it("accepts a complete envelope", () => {
    expect(EventEnvelopeSchema.parse(base)).toEqual(base);
  });

  it("rejects an envelope missing idempotency_key", () => {
    const { idempotency_key: _omit, ...rest } = base;
    expect(EventEnvelopeSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-UTC timestamp", () => {
    expect(
      EventEnvelopeSchema.safeParse({ ...base, occurred_at: "2026-09-19 10:00" }).success,
    ).toBe(false);
  });

  it("rejects unknown event types", () => {
    expect(EventEnvelopeSchema.safeParse({ ...base, event_type: "made.up" }).success).toBe(false);
  });
});
