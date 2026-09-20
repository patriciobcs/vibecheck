import { SignalSchema } from "@vibecheck/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { productOverview } from "./overview";
import { ingestSignal } from "./signals";

beforeEach(resetDb);

describe("productOverview", () => {
  it("summarizes studies, findings and signals for an owned product", async () => {
    const { tenantId, productId, studyId } = await seedStudy();
    await ingestSignal({
      tenantIds: [tenantId],
      productId,
      signal: SignalSchema.parse({
        schema_version: "1.0",
        signal_id: "s1",
        source: "jev",
        title: "Toolbar hesitation",
        description: "Hesitation observed.",
        severity: "high",
        semantic_target: "toolbar",
        window_start: "2025-01-01T00:00:00Z",
        window_end: "2025-01-02T00:00:00Z",
        evidence_ref: null,
      }),
      actorUserId: null,
    });
    const overview = await productOverview([tenantId], productId);
    expect(overview?.product.id).toBe(productId);
    expect(overview?.studies.map((s) => s.id)).toEqual([studyId]);
    expect(overview?.signals_by_severity).toEqual({ low: 0, medium: 0, high: 1 });
    expect(overview?.open_issues).toBe(0);
    expect(overview?.paused).toBe(false);
    expect(await productOverview(["tenant_other"], productId)).toBeNull();
  });
});
