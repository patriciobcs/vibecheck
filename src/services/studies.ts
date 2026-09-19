import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  discoveryRun,
  outboxEvent,
  product,
  proposal as proposalTable,
  publishRequest,
  study,
  studyPlanRevision,
} from "@/db/schema";
import { publishInputSchema, studyPlanSchema } from "@/contracts/studyPlan";

export const studyPlanDefaults = {
  recruitment: { source: "marketplace" as const, target_count: 2, cohort: "fresh" },
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
    mode: "prototype_and_retest" as const,
    max_variants: 1,
    max_repair_attempts: 2,
    agent_budget_ref: "demo_budget",
    retest_target_count: 2,
  },
};

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof postgres.PostgresError && error.code === "23505") return true;
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  if ("cause" in error) return isUniqueViolation(error.cause);
  return false;
}

export async function publishStudy(tenantId: string, idempotencyKey: string, rawInput: unknown) {
  const input = publishInputSchema.parse(rawInput);
  const [productRow] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, input.product_id), eq(product.tenantId, tenantId)))
    .limit(1);
  const [run] = await db
    .select()
    .from(discoveryRun)
    .where(
      and(
        eq(discoveryRun.id, input.discovery_run_id),
        eq(discoveryRun.tenantId, tenantId),
        eq(discoveryRun.productId, input.product_id),
      ),
    )
    .limit(1);
  const proposals = run
    ? await db
        .select()
        .from(proposalTable)
        .where(
          and(
            eq(proposalTable.discoveryRunId, run.id),
            eq(proposalTable.tenantId, tenantId),
            eq(proposalTable.taskId, input.task_id),
          ),
        )
        .limit(1)
    : [];
  const proposal = proposals[0];
  if (!productRow || !run || !proposal) return null;
  const studyId = randomUUID();
  const plan = studyPlanSchema.parse({
    schema_version: "1.0",
    study_id: studyId,
    study_revision: 1,
    product_id: productRow.id,
    task: {
      task_id: proposal.taskId,
      participant_prompt: input.task?.participant_prompt ?? proposal.participantPrompt,
      research_question: proposal.researchQuestion,
      time_limit_seconds: input.task?.time_limit_seconds ?? 300,
      success_rule_ref: proposal.successRuleRef,
      fixture_ref: input.fixture_ref,
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
      const revisionId = randomUUID();
      const eventId = randomUUID();
      const responseHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
      const [createdStudy] = await tx
        .insert(study)
        .values({
          id: studyId,
          productId: productRow.id,
          tenantId,
          status: "draft",
          currentRevision: 1,
        })
        .returning();
      await tx.insert(publishRequest).values({ tenantId, idempotencyKey, studyId, responseHash });
      const [publishedStudy] = await tx
        .update(study)
        .set({ status: "published" })
        .where(eq(study.id, createdStudy.id))
        .returning();
      await tx.insert(studyPlanRevision).values({
        id: revisionId,
        studyId,
        revision: 1,
        plan,
        publishedAt: new Date(),
      });
      const [event] = await tx
        .insert(outboxEvent)
        .values({
          eventId,
          eventType: "study.published",
          idempotencyKey: `${studyId}:revision_1:publish`,
          tenantId,
          productId: productRow.id,
          correlationId: studyId,
          payload: { study_id: studyId, study_revision: 1, plan_ref: `studyplan:${revisionId}` },
          occurredAt: new Date(),
        })
        .returning();
      return { status: 201 as const, study: publishedStudy, plan, event };
    });
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    const [prior] = await db
      .select()
      .from(publishRequest)
      .where(
        and(
          eq(publishRequest.tenantId, tenantId),
          eq(publishRequest.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (!prior) throw error;
    const [priorStudy] = await db.select().from(study).where(eq(study.id, prior.studyId)).limit(1);
    if (!priorStudy) throw error;
    const [revision] = await db
      .select()
      .from(studyPlanRevision)
      .where(
        and(
          eq(studyPlanRevision.studyId, priorStudy.id),
          eq(studyPlanRevision.revision, priorStudy.currentRevision),
        ),
      )
      .limit(1);
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.idempotencyKey, `${prior.studyId}:revision_1:publish`))
      .limit(1);
    return { status: 200 as const, study: priorStudy, plan: revision?.plan, event };
  }
}
