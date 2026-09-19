import { notFound } from "next/navigation";
import { tenantFromEnvironment } from "@/lib/auth";
import { db } from "@/db";
import { discoveryRun, proposal } from "@/db/schema";
import { PublishForm } from "./PublishForm";
import { and, eq } from "drizzle-orm";

export default async function PublishPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string; task?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) notFound();
  const [result] = await db
    .select({ proposal })
    .from(proposal)
    .innerJoin(discoveryRun, eq(proposal.discoveryRunId, discoveryRun.id))
    .where(
      and(
        eq(proposal.tenantId, tenantId),
        eq(discoveryRun.tenantId, tenantId),
        eq(discoveryRun.productId, id),
        eq(proposal.discoveryRunId, query.run ?? ""),
        eq(proposal.taskId, query.task ?? ""),
      ),
    )
    .limit(1);
  if (!result) notFound();
  return (
    <main>
      <h1>Publish study</h1>
      <PublishForm productId={id} proposal={result.proposal} />
    </main>
  );
}
