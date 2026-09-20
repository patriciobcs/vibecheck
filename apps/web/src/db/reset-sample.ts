import { SAMPLE_STUDY_PLAN } from "@vibecheck/contracts";
import { eq, inArray } from "drizzle-orm";
import { db, schema, sql } from "./client";

/**
 * Development helper: removes assignments, sessions and invitations created against studies
 * whose revision is labeled SAMPLE data, so local runs and e2e tests start from an empty
 * recruiting state. Refuses to touch anything that is not sample data.
 */
async function main() {
  for (const studyId of [SAMPLE_STUDY_PLAN.study_id, "study_excalidraw_export"])
    await resetStudy(studyId);
  await sql.end();
}

async function resetStudy(studyId: string) {
  const study = await db.query.studies.findFirst({ where: eq(schema.studies.id, studyId) });
  if (!study) {
    console.info(`${studyId} not present; nothing to reset`);
    return;
  }
  const revision = await db.query.studyRevisions.findFirst({
    where: eq(schema.studyRevisions.studyId, study.id),
  });
  if (revision?.provenance !== "sample")
    throw new Error(`refusing to reset ${studyId}: not sample data`);

  await db.transaction(async (tx) => {
    const assignments = await tx.query.assignments.findMany({
      where: eq(schema.assignments.studyId, study.id),
    });
    const ids = assignments.map((a) => a.id);
    if (ids.length > 0) {
      const sessions = await tx.query.sessions.findMany({
        where: inArray(schema.sessions.assignmentId, ids),
      });
      const sessionIds = sessions.map((s) => s.id);
      if (sessionIds.length > 0) {
        await tx
          .delete(schema.transcriptSegments)
          .where(inArray(schema.transcriptSegments.sessionId, sessionIds));
        await tx
          .delete(schema.sessionEvents)
          .where(inArray(schema.sessionEvents.sessionId, sessionIds));
        await tx
          .delete(schema.eventBatches)
          .where(inArray(schema.eventBatches.sessionId, sessionIds));
        await tx.delete(schema.assets).where(inArray(schema.assets.sessionId, sessionIds));
        await tx.delete(schema.sessions).where(inArray(schema.sessions.id, sessionIds));
      }
      await tx.delete(schema.creditLedger).where(inArray(schema.creditLedger.assignmentId, ids));
      await tx.delete(schema.assignments).where(inArray(schema.assignments.id, ids));
    }
    await tx
      .delete(schema.invitationDeliveries)
      .where(eq(schema.invitationDeliveries.studyId, study.id));
    await tx.delete(schema.invitations).where(eq(schema.invitations.studyId, study.id));
    await tx
      .update(schema.studies)
      .set({ status: "published" })
      .where(eq(schema.studies.id, study.id));
    console.info(`reset ${studyId}: removed ${ids.length} assignment(s)`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
