import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  analysisRun,
  finding,
  outboxEvent,
  product,
  study,
  studyPlanRevision,
  tenant,
} from "@/db/schema";
import { handleAnalysisRun } from "./analysisHandler";
import type { AnalysisProvider } from "@/agents/analysis/types";

describe.skipIf(!process.env.DATABASE_URL)("analysis worker handler", () => {
  it("persists a fixture finding and completion event", async () => {
    const [tenantRow] = await db
      .insert(tenant)
      .values({ name: `analysis-${randomUUID()}` })
      .returning();
    const [productRow] = await db
      .insert(product)
      .values({
        tenantId: tenantRow.id,
        name: "fixture product",
        description: "fixture",
        url: "http://example.com",
        permittedOrigins: [],
        language: "en",
        audience: "testers",
        releaseNotes: [],
        supportComplaints: [],
        knownJourneys: [],
        productEvents: [],
        status: "ready",
      })
      .returning();
    const [studyRow] = await db
      .insert(study)
      .values({
        tenantId: tenantRow.id,
        productId: productRow.id,
        status: "published",
        currentRevision: 1,
      })
      .returning();
    const plan = {
      schema_version: "1.0" as const,
      study_id: studyRow.id,
      study_revision: 1,
      product_id: productRow.id,
      task: {
        task_id: "task_capture_ideas",
        participant_prompt: "Add an idea.",
        research_question: "Can users add ideas?",
        time_limit_seconds: 300,
        success_rule_ref: "stickynote_capture_v1",
        fixture_ref: "fixture",
      },
      baseline: {
        commit_sha: "97c68dd371e13c017a8dcca49f8b3995ba7890a8",
        environment_ref: "fixture",
      },
      recruitment: {
        source: "marketplace" as const,
        target_count: 1,
        cohort: "fixture",
        eligibility_rule_ref: "eligible_whiteboard_users_v1",
      },
      capture: {
        screen: "required" as const,
        microphone: "off" as const,
        webcam: "off" as const,
        pointer: "on" as const,
        keyboard: "semantic_only" as const,
        text_values: "off" as const,
        retention_days: 1,
      },
      automation: {
        mode: "issues_only" as const,
        max_variants: 0,
        max_repair_attempts: 0,
        agent_budget_ref: "fixture",
        retest_target_count: 0,
      },
    };
    await db.insert(studyPlanRevision).values({
      studyId: studyRow.id,
      revision: 1,
      plan,
      publishedAt: new Date(),
    });
    const [run] = await db
      .insert(analysisRun)
      .values({
        tenantId: tenantRow.id,
        studyId: studyRow.id,
        sessionId: "sample_session_capture_ideas",
        status: "queued",
        provider: "fixture",
        rawResponses: [],
      })
      .returning();
    const provider: AnalysisProvider = {
      name: "fixture",
      analyse: async (evidence) => ({
        raw: {
          schema_version: "1.0",
          evidence_package_id: evidence.evidence_package_id,
          session_id: evidence.session_id,
          outcome: "findings",
          findings: [
            {
              category: "discoverability",
              semantic_target: "toolbar.sticky_note",
              observation: "The participant searched for a note tool.",
              hypothesis: "The note tool may be difficult to discover.",
              evidence: [
                {
                  segment_ids: ["segment_01"],
                  event_ids: ["event_03"],
                  start_ms: 7000,
                  end_ms: 12000,
                  quote:
                    "I need to add a few ideas to this board, but I do not immediately see how to add a note.",
                },
              ],
              impact: "task_slowed",
              limitations: ["fixture"],
            },
          ],
        },
        handle: {},
      }),
      requestCorrection: async () => ({ raw: null, handle: {} }),
    };
    await handleAnalysisRun(run.id, { provider });
    const [stored] = await db.select().from(finding).where(eq(finding.studyId, studyRow.id));
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(
        and(eq(outboxEvent.correlationId, run.id), eq(outboxEvent.eventType, "analysis.completed")),
      );
    expect({ certainty: stored?.certainty, event: event?.eventType }).toEqual({
      certainty: "preliminary",
      event: "analysis.completed",
    });
    await db.delete(tenant).where(eq(tenant.id, tenantRow.id));
  });
});
