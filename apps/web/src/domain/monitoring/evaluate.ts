import { type JevQuestions, parseJevAnswers } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { type JevClient, JevProviderError } from "@/providers/jev";
import { emitEvent } from "../events";
import { type PriceMicros, reconcileUsage } from "./budget";
import { passesCandidateGate, upsertCandidate } from "./candidates";
import { currentMonitoringPolicy } from "./policy";
import type { JourneyEvent } from "./triggers";
import { buildWindow } from "./windows";

export type EvaluateDeps = { jev: JevClient; priceMicrosPer1k: PriceMicros };

/**
 * Runs one queued evaluation: rebuilds the redacted state from the immutable window, calls Jev,
 * validates the answers against the detector's questions, stores usage and model version, reconciles
 * budget, and routes to research candidates. Idempotent: a completed evaluation is never re-sent.
 */
export async function evaluateJob(
  payload: { evaluationId: string },
  deps: EvaluateDeps,
): Promise<void> {
  const evaluation = await db.query.jevEvaluations.findFirst({
    where: eq(schema.jevEvaluations.id, payload.evaluationId),
  });
  if (!evaluation) throw new Error(`unknown evaluation ${payload.evaluationId}`);
  if (evaluation.status !== "queued" && evaluation.status !== "running") return;
  const window = await db.query.observationWindows.findFirst({
    where: eq(schema.observationWindows.id, evaluation.windowId),
  });
  if (!window) throw new Error("window missing");
  const [detectorId, versionText] = evaluation.detectorRef.split(":");
  const detector = await db.query.detectorDefinitions.findFirst({
    where: (d, { and, eq }) =>
      and(
        eq(d.productId, evaluation.productId),
        eq(d.detectorId, detectorId ?? ""),
        eq(d.version, Number(versionText)),
      ),
  });
  if (!detector) throw new Error("detector missing");
  // The reservation held at scan time; released or replaced by actual usage exactly once below.
  const reservedMicros = evaluation.reservedMicros;

  await db
    .update(schema.jevEvaluations)
    .set({ status: "running" })
    .where(eq(schema.jevEvaluations.id, evaluation.id));

  const rows = window.eventIds.length
    ? await db.query.observationEvents.findMany({
        where: (e, { and, eq, inArray }) =>
          and(
            eq(e.observationSessionId, window.observationSessionId),
            inArray(e.id, window.eventIds),
          ),
      })
    : [];
  const events: JourneyEvent[] = rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    t_ms: r.tMs,
    type: r.type,
    payload: r.payload as Record<string, unknown>,
  }));
  const { policy } = await currentMonitoringPolicy(evaluation.productId);
  const built = buildWindow(events, {
    journeyInstanceId: window.journeyInstanceId,
    observationSessionId: window.observationSessionId,
    journeyId: window.journeyId,
    buildRef: window.buildRef,
    detectorRef: evaluation.detectorRef,
    policyRef: evaluation.policyRef,
    requiredEvents: detector.requiredEvents,
    windowMs: policy.window_ms,
    maxInputChars: policy.max_input_tokens * 4,
    nowMs: window.endMs,
    triggerReason: evaluation.triggerReason,
  });
  const questions = detector.questions as JevQuestions;

  let result: Awaited<ReturnType<JevClient["evaluate"]>>;
  try {
    result = await deps.jev.evaluate({ state: built.state, questions });
  } catch (err) {
    if (err instanceof JevProviderError && err.transient) {
      await db
        .update(schema.jevEvaluations)
        .set({
          status: "queued",
          statusReason: `transient:${err.code}`,
        })
        .where(eq(schema.jevEvaluations.id, evaluation.id));
      throw err; // the job queue retries with backoff, within the same reservation
    }
    const ambiguous = !(err instanceof JevProviderError);
    await db
      .update(schema.jevEvaluations)
      .set({
        status: ambiguous ? "unknown_outcome" : "failed",
        statusReason: err instanceof Error ? err.message.slice(0, 500) : "provider_error",
        completedAt: new Date(),
      })
      .where(eq(schema.jevEvaluations.id, evaluation.id));
    if (!ambiguous)
      await reconcileUsage({
        productId: evaluation.productId,
        inputTokens: 0,
        outputTokens: 0,
        priceMicrosPer1k: deps.priceMicrosPer1k,
        reservedMicros,
      });
    throw err;
  }

  const parsed = parseJevAnswers(questions, result.answers);
  if (!parsed.ok) {
    await db
      .update(schema.jevEvaluations)
      .set({
        status: "failed",
        statusReason: `malformed_answers: ${parsed.problems.join("; ").slice(0, 500)}`,
        returnedModel: result.model,
        providerRequestId: result.requestId,
        completedAt: new Date(),
      })
      .where(eq(schema.jevEvaluations.id, evaluation.id));
    await reconcileUsage({
      productId: evaluation.productId,
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
      priceMicrosPer1k: deps.priceMicrosPer1k,
      reservedMicros,
    });
    throw new Error("malformed_answers");
  }

  const inputTokens = result.usage?.input_tokens ?? null;
  const outputTokens = result.usage?.output_tokens ?? null;
  const cost =
    deps.priceMicrosPer1k && inputTokens !== null && outputTokens !== null
      ? Math.round(
          (inputTokens * deps.priceMicrosPer1k.input) / 1000 +
            (outputTokens * deps.priceMicrosPer1k.output) / 1000,
        )
      : null;
  await reconcileUsage({
    productId: evaluation.productId,
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    priceMicrosPer1k: deps.priceMicrosPer1k,
    reservedMicros,
  });

  const { answers } = parsed;
  const noul = (key: string) => {
    const a = answers[key];
    return a?.type === "noul" ? a.noul : 0;
  };
  const choice = (key: string, fallback: string) => {
    const a = answers[key];
    return a?.type === "choice" ? a.choice : fallback;
  };
  const friction = noul("ux_friction_observed");
  const research = noul("targeted_research_warranted");
  const evidence = choice("evidence_sufficiency", "insufficient") as
    | "sufficient"
    | "partial"
    | "insufficient";
  const category = choice("problem_category", "other_or_uncertain");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.jevEvaluations)
      .set({
        status: "completed",
        statusReason: null,
        answers,
        returnedModel: result.model,
        providerRequestId: result.requestId,
        inputTokens,
        outputTokens,
        estimatedCostMicros: cost,
        completedAt: new Date(),
      })
      .where(eq(schema.jevEvaluations.id, evaluation.id));
    await emitEvent(tx, {
      type: "evaluation.completed",
      tenantId: evaluation.tenantId,
      productId: evaluation.productId,
      correlationId: window.journeyInstanceId,
      idempotencyKey: `${evaluation.id}:completed`,
      payload: {
        evaluation_id: evaluation.id,
        window_id: window.id,
        model: result.model,
        evidence,
        friction,
        research,
        category,
        trigger_reason: evaluation.triggerReason,
      },
    });

    const thresholds = {
      friction: policy.candidate_friction_threshold,
      research: policy.candidate_research_threshold,
    };
    if (
      !passesCandidateGate(
        { friction, research, evidence, category },
        thresholds,
        window.eventIds.length,
      )
    )
      return;
    const limitations: string[] = [];
    if (evidence === "partial")
      limitations.push("partial evidence: some context or outcomes are missing");
    if (built.coverage.missing.length)
      limitations.push(`missing required events: ${built.coverage.missing.join(", ")}`);
    if (built.gaps.length) limitations.push("sequence gaps in the observed window");
    if (window.goalSource !== "declared") limitations.push(`goal source ${window.goalSource}`);
    const target =
      (events.find((e) => e.type === "action_result" || e.type === "action_attempt")?.payload
        .action_ref as string | undefined) ??
      (events.find((e) => e.type === "help_request") ? "help" : "journey");
    await upsertCandidate(tx, {
      tenantId: evaluation.tenantId,
      productId: evaluation.productId,
      journeyId: window.journeyId,
      targetRef: target,
      category,
      buildRef: window.buildRef,
      detectorRef: evaluation.detectorRef,
      evaluationId: evaluation.id,
      supportingEventIds: window.eventIds,
      limitations,
      friction,
      research,
      suspectedProblem: `${category} in ${window.journeyId} around ${target} (trigger: ${evaluation.triggerReason})`,
    });
  });
}
