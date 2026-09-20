import { SAMPLE_STUDY_PLAN, type StudyPlan } from "@vibecheck/contracts";
import { db, schema } from "@/db/client";
import { newId, newToken } from "@/lib/ids";

/** Inserts a tenant, product and published study; returns ids. */
export async function seedStudy(overrides: Partial<StudyPlan> = {}) {
  const tenantId = newId("tenant");
  const productId = newId("product");
  const studyId = newId("study");
  const plan: StudyPlan = {
    ...SAMPLE_STUDY_PLAN,
    ...overrides,
    product_id: productId,
    study_id: studyId,
  };
  await db.insert(schema.tenants).values({ id: tenantId, name: "Test tenant" });
  await db.insert(schema.products).values({
    id: productId,
    tenantId,
    name: "Test product",
    url: "https://app.example.test",
    permittedOrigins: ["https://app.example.test"],
    publishableKey: `pk_test_${newToken(8)}`,
    embedMode: "sdk",
    sample: true,
  });
  await db
    .insert(schema.studies)
    .values({ id: studyId, tenantId, productId, status: "recruiting", currentRevision: 1 });
  await db.insert(schema.studyRevisions).values({
    id: newId("studyrev"),
    tenantId,
    studyId,
    revision: 1,
    plan,
    provenance: "sample",
    publishedAt: new Date(),
  });
  return { tenantId, productId, studyId, plan };
}

export async function seedParticipant(email = `${newToken(4)}@example.test`) {
  const userId = newId("user");
  const participantId = newId("participant");
  await db
    .insert(schema.user)
    .values({ id: userId, name: email.split("@")[0] ?? "p", email, emailVerified: true });
  await db
    .insert(schema.participants)
    .values({ id: participantId, userId, invitationsOptIn: true });
  return { userId, participantId, email };
}
