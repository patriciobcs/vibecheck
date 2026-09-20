import {
  GeneratedDetectorSchema,
  type JevQuestions,
  JevQuestionsSchema,
  validateDetectorQuestions,
} from "@vibecheck/contracts";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { createDevinDetectorGenerator } from "@/providers/detector-generation/devin";
import { fixtureDetectorGenerator } from "@/providers/detector-generation/fixture";
import type { DetectorGenerator } from "@/providers/detector-generation/types";
import { emitEvent } from "../events";
import { toProductConfig } from "../products";

export type DetectorRow = typeof schema.detectorDefinitions.$inferSelect;
export const detectorRef = (d: Pick<DetectorRow, "detectorId" | "version">) =>
  `${d.detectorId}:${d.version}`;

type CreateInput = {
  productId: string;
  detectorId: string;
  journeyId: string;
  appBuildRef: string;
  requiredEvents: string[];
  questions: unknown;
  sourceRefs: string[];
  provenance?: "manual" | "devin" | "fixture";
  missingInstrumentation?: string[];
  evaluationPolicyRef?: string;
};

export type CreateResult = { ok: true; detector: DetectorRow } | { ok: false; problems: string[] };

/**
 * Publishes a new immutable detector version after schema + authoring checks. Missing required
 * instrumentation makes it `needs_instrumentation` instead of active; activation never bypasses validation.
 */
export async function createManualDetector(input: CreateInput): Promise<CreateResult> {
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, input.productId),
  });
  if (!product) return { ok: false, problems: ["product not found"] };
  const questions = JevQuestionsSchema.safeParse(input.questions);
  if (!questions.success)
    return {
      ok: false,
      problems: questions.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  const problems = validateDetectorQuestions(questions.data as JevQuestions);
  if (!/^[a-z][a-z0-9_]*$/.test(input.detectorId))
    problems.push("detector_id must be a lowercase identifier");
  if (input.requiredEvents.length === 0) problems.push("required_events must not be empty");
  if (problems.length) return { ok: false, problems };

  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ v: sql<number>`coalesce(max(${schema.detectorDefinitions.version}), 0)::int` })
      .from(schema.detectorDefinitions)
      .where(
        and(
          eq(schema.detectorDefinitions.productId, input.productId),
          eq(schema.detectorDefinitions.detectorId, input.detectorId),
        ),
      );
    const version = (latest?.v ?? 0) + 1;
    const missing = input.missingInstrumentation ?? [];
    const [detector] = await tx
      .insert(schema.detectorDefinitions)
      .values({
        id: newId("detector"),
        tenantId: product.tenantId,
        productId: input.productId,
        detectorId: input.detectorId,
        version,
        journeyId: input.journeyId,
        appBuildRef: input.appBuildRef,
        instrumentationSchemaVersion: "1.0",
        requiredEvents: input.requiredEvents,
        questions: questions.data,
        evaluationPolicyRef: input.evaluationPolicyRef ?? `monitoring_policy:${input.productId}`,
        provenance: input.provenance ?? "manual",
        sourceRefs: input.sourceRefs,
        status: missing.length ? "needs_instrumentation" : "active",
        statusReason: missing.length ? `missing instrumentation: ${missing.join(", ")}` : null,
      })
      .returning();
    if (!detector) throw new Error("detector insert failed");
    // Older versions of the same detector stop evaluating.
    await tx
      .update(schema.detectorDefinitions)
      .set({ status: "disabled", statusReason: `superseded by version ${version}` })
      .where(
        and(
          eq(schema.detectorDefinitions.productId, input.productId),
          eq(schema.detectorDefinitions.detectorId, input.detectorId),
          sql`${schema.detectorDefinitions.version} < ${version}`,
          eq(schema.detectorDefinitions.status, "active"),
        ),
      );
    await emitEvent(tx, {
      type: "detector.published",
      tenantId: product.tenantId,
      productId: input.productId,
      correlationId: `${input.detectorId}:${version}`,
      idempotencyKey: `detector:${input.productId}:${input.detectorId}:${version}:published`,
      payload: {
        detector_id: input.detectorId,
        version,
        journey_id: input.journeyId,
        app_build_ref: input.appBuildRef,
        status: detector.status,
        provenance: detector.provenance,
      },
    });
    return { ok: true, detector };
  });
}

export async function activeDetectorsForJourney(
  productId: string,
  journeyId: string,
  buildRef: string,
) {
  return db.query.detectorDefinitions.findMany({
    where: and(
      eq(schema.detectorDefinitions.productId, productId),
      eq(schema.detectorDefinitions.journeyId, journeyId),
      eq(schema.detectorDefinitions.appBuildRef, buildRef),
      eq(schema.detectorDefinitions.status, "active"),
    ),
    orderBy: desc(schema.detectorDefinitions.version),
  });
}

/** A new build makes detectors bound to older builds stale rather than silently applying them. */
export async function markDetectorsStaleForBuild(
  productId: string,
  newBuildRef: string,
): Promise<number> {
  const rows = await db
    .update(schema.detectorDefinitions)
    .set({
      status: "stale",
      statusReason: `build ${newBuildRef} observed; compatibility not verified`,
    })
    .where(
      and(
        eq(schema.detectorDefinitions.productId, productId),
        eq(schema.detectorDefinitions.status, "active"),
        sql`${schema.detectorDefinitions.appBuildRef} <> ${newBuildRef}`,
      ),
    )
    .returning({ id: schema.detectorDefinitions.id });
  return rows.length;
}

export function detectorGeneratorFor(name: "fixture" | "devin"): DetectorGenerator {
  if (name === "fixture") return fixtureDetectorGenerator;
  const cfg = env().devin;
  if (!cfg) throw new Error("devin_not_configured");
  return createDevinDetectorGenerator(cfg);
}

/** Generates a detector through an agent and publishes it only if it validates. */
export async function generateDetector(
  input: { productId: string; detectorId: string; appBuildRef: string; journeyHint: string },
  generator: DetectorGenerator,
  onSession?: (h: { sessionId?: string; url?: string }) => Promise<void>,
): Promise<CreateResult & { raw?: unknown }> {
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, input.productId),
  });
  if (!product) return { ok: false, problems: ["product not found"] };
  const observed = await db
    .selectDistinct({ type: schema.observationEvents.type })
    .from(schema.observationEvents)
    .innerJoin(
      schema.observationSessions,
      eq(schema.observationEvents.observationSessionId, schema.observationSessions.id),
    )
    .where(eq(schema.observationSessions.productId, input.productId));
  const result = await generator.generate(
    {
      product: toProductConfig(product),
      appBuildRef: input.appBuildRef,
      journeyHint: input.journeyHint,
      observedEventTypes: observed.map((o) => o.type),
      knownJourneys: product.knownJourneys,
    },
    onSession,
  );
  const parsed = GeneratedDetectorSchema.safeParse(result.raw);
  if (!parsed.success)
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      raw: result.raw,
    };
  const created = await createManualDetector({
    productId: input.productId,
    detectorId: input.detectorId,
    journeyId: parsed.data.journey_id,
    appBuildRef: input.appBuildRef,
    requiredEvents: parsed.data.required_events,
    questions: parsed.data.questions,
    sourceRefs: [
      generator.name === "fixture"
        ? "fixture"
        : `${generator.name}:${result.handle.sessionId ?? "session"}`,
    ],
    provenance: generator.name === "fixture" ? "fixture" : "devin",
    missingInstrumentation: parsed.data.missing_instrumentation,
  });
  return created.ok ? { ...created, raw: result.raw } : { ...created, raw: result.raw };
}
