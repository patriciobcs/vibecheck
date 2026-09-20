import { createHash } from "node:crypto";
import { PublishInputSchema, type StudyPlan, StudyPlanSchema } from "@vibecheck/contracts";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api-error";
import { newId } from "@/lib/ids";
import { emitEvent } from "./events";

export const studyPlanDefaults = {
  recruitment: { source: "marketplace" as const, target_count: 2, cohort: "fresh" as const },
  capture: {
    screen: "required" as const,
    microphone: "required" as const,
    webcam: "off" as const,
    pointer: "on" as const,
    keyboard: "semantic_only" as const,
    text_values: "off" as const,
    retention_days: 30,
  },
  automation: {
    mode: "draft_pr" as const,
    max_variants: 1,
    max_repair_attempts: 2,
    agent_budget_ref: "demo_budget",
    retest_target_count: 2,
  },
};

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("code" in err && (err as { code?: string }).code === "23505") return true;
  if ("cause" in err) return isUniqueViolation((err as { cause?: unknown }).cause);
  return false;
}

export type PublishResult = {
  status: 201 | 200;
  study: typeof schema.studies.$inferSelect;
  plan: StudyPlan;
  event: unknown;
};

/**
 * Owner publishes a selected proposal as an immutable StudyPlan revision (VC-01 → VC-02).
 * Idempotent per (tenant, key): the first call returns 201, replays return 200 with the stored result;
 * concurrent replays are resolved by the unique constraint inside the transaction, not by a pre-read.
 */
export async function publishStudy(
  tenantId: string,
  idempotencyKey: string,
  rawInput: unknown,
): Promise<PublishResult | null> {
  const input = PublishInputSchema.parse(rawInput);
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, input.product_id), eq(schema.products.tenantId, tenantId)),
  });
  const run = await db.query.discoveryRuns.findFirst({
    where: and(
      eq(schema.discoveryRuns.id, input.discovery_run_id),
      eq(schema.discoveryRuns.tenantId, tenantId),
      eq(schema.discoveryRuns.productId, input.product_id),
    ),
  });
  const proposal = run
    ? await db.query.proposals.findFirst({
        where: and(
          eq(schema.proposals.discoveryRunId, run.id),
          eq(schema.proposals.taskId, input.task_id),
        ),
      })
    : null;
  if (!product || !run || !proposal) return null;
  if (!product.url) {
    throw new ApiError(409, "app_url_required", "Add a live app URL before publishing a study.");
  }

  const studyId = newId("study");
  const plan = StudyPlanSchema.parse({
    schema_version: "1.0",
    study_id: studyId,
    study_revision: 1,
    product_id: product.id,
    task: {
      task_id: proposal.taskId,
      participant_prompt: input.task?.participant_prompt ?? proposal.participantPrompt,
      research_question: proposal.researchQuestion,
      time_limit_seconds: input.task?.time_limit_seconds ?? 300,
      success_rule_ref: proposal.successRuleRef,
      fixture_ref: input.fixture_ref,
      ...(proposal.scenario ? { scenario: proposal.scenario } : {}),
    },
    baseline: input.baseline,
    recruitment: {
      ...studyPlanDefaults.recruitment,
      ...input.recruitment,
      eligibility_rule_ref: input.recruitment?.eligibility_rule_ref ?? proposal.eligibilityRuleRef,
    },
    capture: { ...studyPlanDefaults.capture, ...input.capture },
    automation: { ...studyPlanDefaults.automation, ...input.automation },
  });

  try {
    return await db.transaction(async (tx) => {
      const responseHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
      const [study] = await tx
        .insert(schema.studies)
        .values({
          id: studyId,
          tenantId,
          productId: product.id,
          status: "published",
          currentRevision: 1,
        })
        .returning();
      if (!study) throw new Error("study insert failed");
      await tx
        .insert(schema.publishRequests)
        .values({ id: newId("publish"), tenantId, idempotencyKey, studyId, responseHash });
      const revisionId = newId("studyrev");
      await tx.insert(schema.studyRevisions).values({
        id: revisionId,
        tenantId,
        studyId,
        revision: 1,
        plan,
        provenance: "vc01",
        discoveryRunId: run.id,
        sourceCandidateRefs: proposal.sourceCandidateRefs,
        publishedAt: new Date(),
      });
      const event = await emitEvent(tx, {
        type: "study.published",
        tenantId,
        productId: product.id,
        correlationId: studyId,
        idempotencyKey: `${studyId}:revision_1:publish`,
        payload: { study_id: studyId, study_revision: 1, plan_ref: `studyplan:${revisionId}` },
      });
      return { status: 201 as const, study, plan, event };
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const prior = await db.query.publishRequests.findFirst({
      where: and(
        eq(schema.publishRequests.tenantId, tenantId),
        eq(schema.publishRequests.idempotencyKey, idempotencyKey),
      ),
    });
    if (!prior) throw err;
    const study = await db.query.studies.findFirst({ where: eq(schema.studies.id, prior.studyId) });
    if (!study) throw err;
    const revision = await db.query.studyRevisions.findFirst({
      where: and(
        eq(schema.studyRevisions.studyId, study.id),
        eq(schema.studyRevisions.revision, study.currentRevision),
      ),
    });
    const event = await db.query.eventOutbox.findFirst({
      where: eq(schema.eventOutbox.idempotencyKey, `${study.id}:revision_1:publish`),
    });
    return {
      status: 200 as const,
      study,
      plan: StudyPlanSchema.parse(revision?.plan),
      event: event?.envelope ?? null,
    };
  }
}
