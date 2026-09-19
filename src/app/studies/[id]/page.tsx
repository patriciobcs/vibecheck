import { notFound } from "next/navigation";
import { tenantFromEnvironment } from "@/lib/auth";
import { db } from "@/db";
import { outboxEvent, study, studyPlanRevision } from "@/db/schema";
import { analysisRun, finding } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { AnalysesSection } from "./_components/AnalysesSection";
import { FindingsSection } from "./_components/FindingsSection";

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) notFound();
  const [studyRow] = await db
    .select()
    .from(study)
    .where(and(eq(study.id, (await params).id), eq(study.tenantId, tenantId)))
    .limit(1);
  if (!studyRow) notFound();
  const [revision] = await db
    .select()
    .from(studyPlanRevision)
    .where(
      and(
        eq(studyPlanRevision.studyId, studyRow.id),
        eq(studyPlanRevision.revision, studyRow.currentRevision),
      ),
    )
    .limit(1);
  const [event] = await db
    .select()
    .from(outboxEvent)
    .where(and(eq(outboxEvent.correlationId, studyRow.id), eq(outboxEvent.tenantId, tenantId)))
    .limit(1);
  const runs = await db
    .select()
    .from(analysisRun)
    .where(and(eq(analysisRun.studyId, studyRow.id), eq(analysisRun.tenantId, tenantId)));
  const findings = await db
    .select()
    .from(finding)
    .where(and(eq(finding.studyId, studyRow.id), eq(finding.tenantId, tenantId)));
  return (
    <main>
      <h1>Study {studyRow.id}</h1>
      <p>Status: {studyRow.status}</p>
      <h2>Plan</h2>
      <pre>{JSON.stringify(revision?.plan, null, 2)}</pre>
      <h2>Outbox event</h2>
      <pre>{JSON.stringify(event, null, 2)}</pre>
      <AnalysesSection studyId={studyRow.id} runs={runs} />
      <FindingsSection findings={findings} />
    </main>
  );
}
