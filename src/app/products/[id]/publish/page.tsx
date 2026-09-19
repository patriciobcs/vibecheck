import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { tenantFromEnvironment } from "@/lib/auth";
import { PublishForm } from "./PublishForm";

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
  const proposal = await prisma.proposal.findFirst({
    where: {
      tenantId,
      discoveryRun: { productId: id, tenantId },
      discoveryRunId: query.run,
      taskId: query.task,
    },
  });
  if (!proposal) notFound();
  return (
    <main>
      <h1>Publish study</h1>
      <PublishForm productId={id} proposal={proposal} />
    </main>
  );
}
