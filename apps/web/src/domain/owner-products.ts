import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { currentSession } from "@/auth/current-user";
import { db, schema } from "@/db/client";
import { membershipsForUser } from "./participants";

const WRITE_ROLES = ["owner", "admin", "researcher"];

/** Signed-in owner context for the VC-01 pages: the tenants the user may act for. */
export async function ownerContext() {
  const session = await currentSession();
  if (!session) return null;
  const memberships = await membershipsForUser(session.user.id);
  return {
    userId: session.user.id,
    email: session.user.email,
    tenantIds: memberships.map((m) => m.tenantId),
    writableTenantIds: memberships
      .filter((m) => WRITE_ROLES.includes(m.role))
      .map((m) => m.tenantId),
  };
}

export async function ownerProduct(tenantIds: string[], productId: string) {
  if (tenantIds.length === 0) return null;
  return db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), inArray(schema.products.tenantId, tenantIds)),
  });
}

export async function productDiscovery(productId: string) {
  const runs = await db.query.discoveryRuns.findMany({
    where: eq(schema.discoveryRuns.productId, productId),
    orderBy: desc(schema.discoveryRuns.createdAt),
  });
  const proposals = runs.length
    ? await db.query.proposals.findMany({
        where: inArray(
          schema.proposals.discoveryRunId,
          runs.map((r) => r.id),
        ),
      })
    : [];
  const studies = await db.query.studies.findMany({
    where: eq(schema.studies.productId, productId),
  });
  const revisions = studies.length
    ? await db.query.studyRevisions.findMany({
        where: inArray(
          schema.studyRevisions.studyId,
          studies.map((s) => s.id),
        ),
      })
    : [];
  return runs.map((run) => ({
    ...run,
    proposals: proposals
      .filter((p) => p.discoveryRunId === run.id)
      .map((p) => ({
        ...p,
        publishedStudyIds: revisions
          .filter(
            (r) =>
              r.discoveryRunId === run.id &&
              (r.plan as { task?: { task_id?: string } }).task?.task_id === p.taskId,
          )
          .map((r) => r.studyId),
      })),
  }));
}
