import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { newId } from "@/lib/ids";

export type BudgetPolicy = {
  max_evaluations_per_product_day: number;
  max_evaluations_per_session_hour: number;
  max_input_tokens: number;
  max_output_tokens_budget: number;
  daily_spend_cap_usd: number;
};
export type PriceMicros = { input: number; output: number } | null;

export type ReserveResult =
  | { ok: true; spendEnforced: boolean; reservationId: string; reservedMicros: number }
  | {
      ok: false;
      reason: "product_day_cap" | "session_hour_cap" | "input_tokens_cap" | "spend_cap";
    };

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const estimateMicros = (inputTokens: number, outputTokens: number, price: PriceMicros) =>
  price ? Math.round((inputTokens * price.input) / 1000 + (outputTokens * price.output) / 1000) : 0;

/**
 * Reserves one evaluation against every cap at once inside a row lock on the product-day ledger,
 * so concurrent workers cannot exceed the limits. Spend is enforced only when a price is configured;
 * otherwise cost stays "unpriced" and only call/token caps apply.
 */
export async function reserveEvaluation(input: {
  productId: string;
  observationSessionId: string;
  policy: BudgetPolicy;
  priceMicrosPer1k: PriceMicros;
  estimatedInputTokens: number;
}): Promise<ReserveResult> {
  if (input.estimatedInputTokens > input.policy.max_input_tokens)
    return { ok: false, reason: "input_tokens_cap" };
  return db.transaction(async (tx) => {
    await tx
      .insert(schema.evaluationBudgetLedger)
      .values({ id: newId("budget"), productId: input.productId, day: day() })
      .onConflictDoNothing();
    const [ledger] = await tx
      .select()
      .from(schema.evaluationBudgetLedger)
      .where(
        and(
          eq(schema.evaluationBudgetLedger.productId, input.productId),
          eq(schema.evaluationBudgetLedger.day, day()),
        ),
      )
      .for("update");
    if (!ledger) throw new Error("ledger row missing");
    if (ledger.evaluations >= input.policy.max_evaluations_per_product_day)
      return { ok: false, reason: "product_day_cap" };

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.evaluationReservations)
      .where(
        and(
          eq(schema.evaluationReservations.observationSessionId, input.observationSessionId),
          gte(schema.evaluationReservations.reservedAt, hourAgo),
        ),
      );
    if (n >= input.policy.max_evaluations_per_session_hour)
      return { ok: false, reason: "session_hour_cap" };

    const spendEnforced = input.priceMicrosPer1k !== null;
    const reservedMicros = estimateMicros(
      input.estimatedInputTokens,
      input.policy.max_output_tokens_budget,
      input.priceMicrosPer1k,
    );
    const projected = ledger.estimatedCostMicros + reservedMicros;
    if (spendEnforced && projected > Math.round(input.policy.daily_spend_cap_usd * 1_000_000))
      return { ok: false, reason: "spend_cap" };

    const reservationId = newId("reservation");
    await tx.insert(schema.evaluationReservations).values({
      id: reservationId,
      productId: input.productId,
      observationSessionId: input.observationSessionId,
      estimatedCostMicros: reservedMicros,
    });
    await tx
      .update(schema.evaluationBudgetLedger)
      .set({ evaluations: ledger.evaluations + 1, estimatedCostMicros: projected })
      .where(eq(schema.evaluationBudgetLedger.id, ledger.id));
    return { ok: true, spendEnforced, reservationId, reservedMicros };
  });
}

/** Replace the reservation's estimate with returned usage (or release it entirely on failure). */
export async function reconcileUsage(input: {
  productId: string;
  inputTokens: number;
  outputTokens: number;
  priceMicrosPer1k: PriceMicros;
  reservedMicros?: number;
}) {
  const actual =
    estimateMicros(input.inputTokens, input.outputTokens, input.priceMicrosPer1k) -
    (input.reservedMicros ?? 0);
  const [row] = await db
    .insert(schema.evaluationBudgetLedger)
    .values({
      id: newId("budget"),
      productId: input.productId,
      day: day(),
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostMicros: actual,
    })
    .onConflictDoUpdate({
      target: [schema.evaluationBudgetLedger.productId, schema.evaluationBudgetLedger.day],
      set: {
        inputTokens: sql`${schema.evaluationBudgetLedger.inputTokens} + ${input.inputTokens}`,
        outputTokens: sql`${schema.evaluationBudgetLedger.outputTokens} + ${input.outputTokens}`,
        estimatedCostMicros: sql`${schema.evaluationBudgetLedger.estimatedCostMicros} + ${actual}`,
      },
    })
    .returning();
  if (!row) throw new Error("ledger upsert failed");
  return row;
}
