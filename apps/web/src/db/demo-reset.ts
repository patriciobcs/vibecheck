import { eq, inArray } from "drizzle-orm";
import { storage } from "@/providers/storage";
import { db, schema } from "./client";

export const DEMO_PRODUCT_ID = "product_excalidraw_local";
export const DEMO_STUDY_ID = "study_excalidraw_export";

/**
 * Clears everything the Excalidraw demo product shows on its live console, so a demo starts at
 * "Waiting for the first session": passive observation sessions (with their events, windows, Jev
 * evaluations and reservations), research candidates, and the demo study's assignments with their
 * sessions, media files, events, transcripts, analyses and credits. The product, study, detectors,
 * monitoring policy and budget ledger stay. Refuses to run unless the study is labeled sample data.
 */
export async function resetDemoProduct() {
  const revision = await db.query.studyRevisions.findFirst({
    where: eq(schema.studyRevisions.studyId, DEMO_STUDY_ID),
  });
  if (revision && revision.provenance !== "sample")
    throw new Error(`refusing to reset ${DEMO_STUDY_ID}: not sample data`);

  const assignments = await db.query.assignments.findMany({
    where: eq(schema.assignments.studyId, DEMO_STUDY_ID),
  });
  const assignmentIds = assignments.map((a) => a.id);
  const sessions = assignmentIds.length
    ? await db.query.sessions.findMany({
        where: inArray(schema.sessions.assignmentId, assignmentIds),
      })
    : [];
  const sessionIds = sessions.map((s) => s.id);
  const assets = sessionIds.length
    ? await db.query.assets.findMany({ where: inArray(schema.assets.sessionId, sessionIds) })
    : [];
  const mediaPaths = assets.map((a) => a.storagePath).filter((p): p is string => !!p);

  const passive = await db.transaction(async (tx) => {
    if (sessionIds.length) {
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
      await tx
        .delete(schema.analysisRuns)
        .where(inArray(schema.analysisRuns.sessionId, sessionIds));
      await tx
        .delete(schema.participationEvents)
        .where(inArray(schema.participationEvents.sessionId, sessionIds));
      await tx.delete(schema.sessions).where(inArray(schema.sessions.id, sessionIds));
    }
    if (assignmentIds.length) {
      await tx
        .delete(schema.creditLedger)
        .where(inArray(schema.creditLedger.assignmentId, assignmentIds));
      await tx.delete(schema.assignments).where(inArray(schema.assignments.id, assignmentIds));
    }
    const observation = await tx
      .delete(schema.observationSessions)
      .where(eq(schema.observationSessions.productId, DEMO_PRODUCT_ID))
      .returning({ id: schema.observationSessions.id });
    await tx
      .delete(schema.observationWindows)
      .where(eq(schema.observationWindows.productId, DEMO_PRODUCT_ID));
    await tx
      .delete(schema.evaluationReservations)
      .where(eq(schema.evaluationReservations.productId, DEMO_PRODUCT_ID));
    const candidates = await tx
      .delete(schema.researchCandidates)
      .where(eq(schema.researchCandidates.productId, DEMO_PRODUCT_ID))
      .returning({ id: schema.researchCandidates.id });
    return { observationSessions: observation.length, candidates: candidates.length };
  });

  // Media files are removed after the rows are gone; a storage failure leaves orphans, not evidence.
  if (mediaPaths.length)
    await storage()
      .remove(mediaPaths)
      .catch((err: unknown) =>
        console.warn(`media removal failed: ${err instanceof Error ? err.message : err}`),
      );

  return {
    assignments: assignmentIds.length,
    sessions: sessionIds.length,
    mediaFiles: mediaPaths.length,
    ...passive,
  };
}
