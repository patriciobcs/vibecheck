import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { tenantFromEnvironment } from "@/lib/auth";

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) notFound();
  const study = await prisma.study.findFirst({ where: { id: (await params).id, tenantId }, include: { revisions: true } });
  if (!study) notFound();
  const event = await prisma.outboxEvent.findFirst({ where: { correlationId: study.id, tenantId } });
  return <main><h1>Study {study.id}</h1><p>Status: {study.status}</p><h2>Plan</h2><pre>{JSON.stringify(study.revisions[0]?.plan, null, 2)}</pre><h2>Outbox event</h2><pre>{JSON.stringify(event, null, 2)}</pre></main>;
}
