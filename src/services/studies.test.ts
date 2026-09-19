import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { publishStudy } from "./studies";
import { GET as getProduct } from "@/app/api/products/[id]/route";
import { db } from "@/db";
import {
  apiKey,
  discoveryRun,
  outboxEvent,
  product,
  proposal,
  study,
  studyPlanRevision,
  tenant as tenantTable,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

async function fixture() {
  const [tenantRow] = await db
    .insert(tenantTable)
    .values({ name: `publish-${randomUUID()}` })
    .returning();
  const [productRow] = await db
    .insert(product)
    .values({
      tenantId: tenantRow.id,
      name: "test",
      description: "",
      url: "http://example.com",
      permittedOrigins: [],
      language: "en",
      audience: "",
      releaseNotes: [],
      supportComplaints: [],
      knownJourneys: [],
      productEvents: [],
      status: "ready",
    })
    .returning();
  const [runRow] = await db
    .insert(discoveryRun)
    .values({
      tenantId: tenantRow.id,
      productId: productRow.id,
      status: "proposed",
      provider: "fixture",
      sourceRevision: "sha",
      rawResponses: [],
    })
    .returning();
  const [proposalRow] = await db
    .insert(proposal)
    .values({
      discoveryRunId: runRow.id,
      tenantId: tenantRow.id,
      taskId: "task",
      researchQuestion: "question",
      participantPrompt: "prompt",
      rationale: "rationale",
      evidenceRefs: [],
      evidenceType: "reported",
      eligibilityRuleRef: "eligible",
      successRuleRef: "success",
      uncertainties: [],
    })
    .returning();
  return { tenant: tenantRow, product: productRow, run: runRow, proposal: proposalRow };
}

const input = (productId: string, runId: string, taskId: string) => ({
  product_id: productId,
  discovery_run_id: runId,
  task_id: taskId,
  fixture_ref: "fixture",
  baseline: { commit_sha: "sha", environment_ref: "env" },
});

describe.skipIf(!process.env.DATABASE_URL)("publish service", () => {
  it("deduplicates sequential and concurrent idempotent publishes", async () => {
    const { tenant, product, run, proposal } = await fixture();
    const body = input(product.id, run.id, proposal.taskId);
    const first = await publishStudy(tenant.id, "same", body);
    const second = await publishStudy(tenant.id, "same", body);
    const concurrent = await Promise.all([
      publishStudy(tenant.id, "concurrent", body),
      publishStudy(tenant.id, "concurrent", body),
    ]);
    const studies = await db.select().from(study).where(eq(study.tenantId, tenant.id));
    const revisions = await db
      .select()
      .from(studyPlanRevision)
      .where(
        inArray(
          studyPlanRevision.studyId,
          studies.map((item) => item.id),
        ),
      );
    const events = await db.select().from(outboxEvent).where(eq(outboxEvent.tenantId, tenant.id));
    expect({
      first: first?.status,
      second: second?.status,
      sameId: first?.study.id === second?.study.id,
      concurrentStatuses: concurrent.map((item) => item?.status).sort(),
      concurrentIds: new Set(
        concurrent
          .filter((item): item is NonNullable<typeof item> => item != null)
          .map((item) => item.study.id),
      ).size,
      studies: studies.length,
      revisions: revisions.length,
      events: events.length,
    }).toEqual({
      first: 201,
      second: 200,
      sameId: true,
      concurrentStatuses: [200, 201],
      concurrentIds: 1,
      studies: 2,
      revisions: 2,
      events: 2,
    });
    const differentKey = await publishStudy(tenant.id, "different", body);
    expect({
      status: differentKey?.status,
      studies: (await db.select().from(study).where(eq(study.tenantId, tenant.id))).length,
    }).toEqual({ status: 201, studies: 3 });
    await db.delete(tenantTable).where(eq(tenantTable.id, tenant.id));
  });

  it("hides a product from another tenant", async () => {
    const { tenant, product } = await fixture();
    const [other] = await db
      .insert(tenantTable)
      .values({ name: `other-${randomUUID()}` })
      .returning();
    const key = `other-${randomUUID()}`;
    await db.insert(apiKey).values({
      tenantId: other.id,
      keyHash: createHash("sha256").update(key).digest("hex"),
      label: "test",
    });
    const response = await getProduct(
      new NextRequest("http://localhost", { headers: { authorization: `Bearer ${key}` } }),
      { params: Promise.resolve({ id: product.id }) },
    );
    expect(response.status).toBe(404);
    await db.delete(tenantTable).where(eq(tenantTable.id, tenant.id));
    await db.delete(tenantTable).where(eq(tenantTable.id, other.id));
  });
});
