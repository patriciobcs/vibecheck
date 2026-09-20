import { beforeEach, describe, expect, it } from "vitest";
import { POST as postParticipation } from "@/app/api/studies/[id]/participation/route";
import { GET as getSummary, POST as postSummary } from "@/app/api/studies/[id]/summary/route";
import { db, schema } from "@/db/client";
import { hashApiKey } from "@/lib/tenant-access";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";

const request = (url: string, key: string, init: RequestInit = {}) =>
  new Request(`http://localhost${url}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
  });

describe("VC-05 summary APIs", () => {
  beforeEach(() => resetDb());

  it("denies a cross-tenant participation write", async () => {
    const { tenantId, studyId } = await seedStudy();
    await db.insert(schema.tenants).values({ id: "tenant-other", name: "Other" });
    await db.insert(schema.apiKeys).values([
      { id: "key-owner", tenantId, keyHash: hashApiKey("owner-key"), label: "owner" },
      {
        id: "key-other",
        tenantId: "tenant-other",
        keyHash: hashApiKey("other-key"),
        label: "other",
      },
    ]);
    const response = await postParticipation(
      request(`/api/studies/${studyId}/participation`, "other-key", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "1.0",
          event_id: "evt-cross-tenant",
          study_id: studyId,
          study_revision: 1,
          participant_ref: "opaque",
          kind: "invited",
          occurred_at: new Date().toISOString(),
          session_id: null,
        }),
      }),
      { params: Promise.resolve({ id: studyId }) } as never,
    );
    expect(response.status).toBe(404);
  });

  it("queues summary generation and reports no summary before generation", async () => {
    const { tenantId, studyId } = await seedStudy();
    await db.insert(schema.apiKeys).values({
      id: "key-owner",
      tenantId,
      keyHash: hashApiKey("owner-key"),
      label: "owner",
    });
    const before = await getSummary(request(`/api/studies/${studyId}/summary`, "owner-key"), {
      params: Promise.resolve({ id: studyId }),
    } as never);
    const queued = await postSummary(
      request(`/api/studies/${studyId}/summary`, "owner-key", { method: "POST" }),
      { params: Promise.resolve({ id: studyId }) } as never,
    );
    expect({ before: before.status, queued: queued.status }).toEqual({ before: 404, queued: 202 });
  });
});
