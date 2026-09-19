import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

export async function publishStudy(tenantId: string, idempotencyKey: string, rawInput: unknown) {
  const input = publishInputSchema.parse(rawInput);
  const product = await prisma.product.findFirst({ where: { id: input.product_id, tenantId } });
  const run = await prisma.discoveryRun.findFirst({
    where: { id: input.discovery_run_id, tenantId, productId: input.product_id },
    include: { proposals: true },
  });
  const proposal = run?.proposals.find((item) => item.taskId === input.task_id);
  if (!product || !run || !proposal) return null;
  const studyId = randomUUID();
  const plan = studyPlanSchema.parse({
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
  return prisma
    .$transaction(async (tx) => {
      const revisionId = randomUUID();
      const eventId = randomUUID();
      const responseHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
      const study = await tx.study.create({
        data: { id: studyId, productId: product.id, tenantId, status: "draft", currentRevision: 1 },
      });
      await tx.publishRequest.create({ data: { tenantId, idempotencyKey, studyId, responseHash } });
      await tx.study.update({ where: { id: study.id }, data: { status: "published" } });
      await tx.studyPlanRevision.create({
        data: { id: revisionId, studyId, revision: 1, plan, publishedAt: new Date() },
      });
      const event = await tx.outboxEvent.create({
        data: {
          eventId,
          eventType: "study.published",
          idempotencyKey: `${studyId}:revision_1:publish`,
          tenantId,
          productId: product.id,
          correlationId: studyId,
          payload: { study_id: studyId, study_revision: 1, plan_ref: `studyplan:${revisionId}` },
          occurredAt: new Date(),
        },
      });
      return { status: 201, study: { ...study, status: "published" as const }, plan, event };
    })
    .catch(async (error: unknown) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
        throw error;
      const prior = await prisma.publishRequest.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        include: { study: { include: { revisions: true } } },
      });
      if (!prior) throw error;
      const revision = prior.study.revisions.find(
        (item) => item.revision === prior.study.currentRevision,
      );
      return {
        status: 200,
        study: prior.study,
        plan: revision?.plan,
        event: await prisma.outboxEvent.findUnique({
          where: { idempotencyKey: `${prior.studyId}:revision_1:publish` },
        }),
      };
    });
}
