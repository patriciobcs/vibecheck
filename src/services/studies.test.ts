import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { publishStudy } from "./studies";
import { GET as getProduct } from "@/app/api/products/[id]/route";

const prisma = new PrismaClient();

async function fixture() {
  const tenant = await prisma.tenant.create({ data: { name: `publish-${randomUUID()}` } });
  const product = await prisma.product.create({ data: {
    tenantId: tenant.id, name: "test", description: "", url: "http://example.com",
    permittedOrigins: [], language: "en", audience: "", releaseNotes: [], supportComplaints: [],
    knownJourneys: [], productEvents: [], status: "ready",
  } });
  const run = await prisma.discoveryRun.create({ data: { tenantId: tenant.id, productId: product.id, status: "proposed", provider: "fixture", sourceRevision: "sha", rawResponses: [] } });
  const proposal = await prisma.proposal.create({ data: {
    discoveryRunId: run.id, tenantId: tenant.id, taskId: "task", researchQuestion: "question",
    participantPrompt: "prompt", rationale: "rationale", evidenceRefs: [], evidenceType: "reported",
    eligibilityRuleRef: "eligible", successRuleRef: "success", uncertainties: [],
  } });
  return { tenant, product, run, proposal };
}

const input = (productId: string, runId: string, taskId: string) => ({
  product_id: productId, discovery_run_id: runId, task_id: taskId, fixture_ref: "fixture",
  baseline: { commit_sha: "sha", environment_ref: "env" },
});

describe.skipIf(!process.env.DATABASE_URL)("publish service", () => {
  it("deduplicates sequential and concurrent idempotent publishes", async () => {
    const { tenant, product, run, proposal } = await fixture();
    const body = input(product.id, run.id, proposal.taskId);
    const first = await publishStudy(tenant.id, "same", body);
    const second = await publishStudy(tenant.id, "same", body);
    const concurrent = await Promise.all([publishStudy(tenant.id, "concurrent", body), publishStudy(tenant.id, "concurrent", body)]);
    const studies = await prisma.study.findMany({ where: { tenantId: tenant.id } });
    const revisions = await prisma.studyPlanRevision.findMany({ where: { study: { tenantId: tenant.id } } });
    const events = await prisma.outboxEvent.findMany({ where: { tenantId: tenant.id } });
    expect({ first: first?.status, second: second?.status, sameId: first?.study.id === second?.study.id, concurrentStatuses: concurrent.map((item) => item?.status).sort(), concurrentIds: new Set(concurrent.filter((item): item is NonNullable<typeof item> => item != null).map((item) => item.study.id)).size, studies: studies.length, revisions: revisions.length, events: events.length }).toEqual({ first: 201, second: 200, sameId: true, concurrentStatuses: [200, 201], concurrentIds: 1, studies: 2, revisions: 2, events: 2 });
    const differentKey = await publishStudy(tenant.id, "different", body);
    expect({ status: differentKey?.status, studies: (await prisma.study.count({ where: { tenantId: tenant.id } })) }).toEqual({ status: 201, studies: 3 });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it("hides a product from another tenant", async () => {
    const { tenant, product } = await fixture();
    const other = await prisma.tenant.create({ data: { name: `other-${randomUUID()}` } });
    const key = `other-${randomUUID()}`;
    await prisma.apiKey.create({ data: { tenantId: other.id, keyHash: createHash("sha256").update(key).digest("hex"), label: "test" } });
    const response = await getProduct(new NextRequest("http://localhost", { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id: product.id }) });
    expect(response.status).toBe(404);
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
