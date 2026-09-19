import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { analysisRun, job, study } from "@/db/schema";
import { discoveryProviderSchema, type DiscoveryProviderName } from "@/agents/types";

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof postgres.PostgresError && error.code === "23505") return true;
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  if ("cause" in error) return isUniqueViolation(error.cause);
  return false;
}

export async function startAnalysis(
  tenantId: string,
  studyId: string,
  sessionId: string,
  providerName = process.env.DISCOVERY_PROVIDER ?? "fixture",
) {
  const provider = discoveryProviderSchema.parse(providerName);
  const [studyRow] = await db
    .select()
    .from(study)
    .where(and(eq(study.id, studyId), eq(study.tenantId, tenantId)))
    .limit(1);
  if (!studyRow || studyRow.status !== "published") return null;
  const runId = randomUUID();
  try {
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(analysisRun)
        .values({
          id: runId,
          tenantId,
          studyId,
          sessionId,
          status: "queued",
          provider,
          rawResponses: [],
        })
        .returning();
      await tx.insert(job).values({
        type: "analysis.run",
        tenantId,
        payload: { analysisRunId: run.id },
      });
      return run;
    });
    return { status: 201 as const, run: result };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [existing] = await db
      .select()
      .from(analysisRun)
      .where(
        and(
          eq(analysisRun.tenantId, tenantId),
          eq(analysisRun.studyId, studyId),
          eq(analysisRun.sessionId, sessionId),
        ),
      )
      .limit(1);
    if (!existing) throw error;
    return { status: 200 as const, run: existing };
  }
}

export type AnalysisProviderName = DiscoveryProviderName;
