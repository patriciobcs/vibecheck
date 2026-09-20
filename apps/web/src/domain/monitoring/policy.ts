import {
  DEFAULT_MONITORING_POLICY,
  type MonitoringPolicy,
  MonitoringPolicySchema,
} from "@vibecheck/contracts";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { newId } from "@/lib/ids";

/** Latest policy revision for a product, or the disabled default (revision 0). */
export async function currentMonitoringPolicy(
  productId: string,
): Promise<{ revision: number; policy: MonitoringPolicy; policyRef: string }> {
  const latest = await db.query.monitoringPolicyRevisions.findFirst({
    where: eq(schema.monitoringPolicyRevisions.productId, productId),
    orderBy: desc(schema.monitoringPolicyRevisions.revision),
  });
  if (!latest)
    return {
      revision: 0,
      policy: DEFAULT_MONITORING_POLICY(`monitoring_policy:${productId}:0`),
      policyRef: `monitoring_policy:${productId}:0`,
    };
  return {
    revision: latest.revision,
    policy: MonitoringPolicySchema.parse(latest.policy),
    policyRef: `monitoring_policy:${productId}:${latest.revision}`,
  };
}

/** Owner changes create a new immutable revision (merged over the current one). */
export async function setMonitoringPolicy(
  productId: string,
  patch: Partial<Omit<MonitoringPolicy, "schema_version" | "policy_id">>,
  userId: string | null,
) {
  const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
  if (!product) throw new Error("product not found");
  const current = await currentMonitoringPolicy(productId);
  const revision = current.revision + 1;
  const policy = MonitoringPolicySchema.parse({
    ...current.policy,
    ...patch,
    schema_version: "1.0",
    policy_id: `monitoring_policy:${productId}:${revision}`,
  });
  await db.insert(schema.monitoringPolicyRevisions).values({
    id: newId("policyrev"),
    tenantId: product.tenantId,
    productId,
    revision,
    policy,
    createdByUserId: userId,
  });
  return { revision, policy, policyRef: policy.policy_id };
}
