import { SAMPLE_STUDY_PLAN, type StudyPlan } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { newId, newToken } from "@/lib/ids";
import { storage } from "@/providers/storage";
import { db, schema, sql } from "./client";

const EXCALIDRAW_PRODUCT_ID = "product_excalidraw_local";
const EXCALIDRAW_STUDY_ID = "study_excalidraw_export";

/** Stand-in study for the Excalidraw demo (VC-01 output not implemented). Neutral task, no control named. */
const EXCALIDRAW_STUDY_PLAN: StudyPlan = {
  ...SAMPLE_STUDY_PLAN,
  study_id: EXCALIDRAW_STUDY_ID,
  product_id: EXCALIDRAW_PRODUCT_ID,
  task: {
    task_id: "task_share_drawing",
    participant_prompt:
      "Sketch a quick diagram of anything, for example two boxes joined by an arrow. Then get an image of your drawing that you could attach to an email to a colleague who does not use this app.",
    research_question: "Can a new user get their drawing out of the app as an image?",
    time_limit_seconds: 240,
    success_rule_ref: "drawing_exported_v1",
    fixture_ref: "excalidraw_blank_v1", // blank canvas; the task starts with a drawing step so it is always startable
  },
  recruitment: {
    source: "embedded",
    target_count: 3,
    cohort: "fresh",
    eligibility_rule_ref: "any_visitor_v1",
  },
};

/**
 * SAMPLE DATA seed. Creates one tenant, one owner membership, one product and one
 * published study from the labeled sample StudyPlan. VC-01 discovery is not implemented,
 * so provenance is recorded as "sample" and the product is flagged `sample = true`.
 */
async function main() {
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@example.test";
  const tenantId = "tenant_sample";
  const productId = SAMPLE_STUDY_PLAN.product_id;
  const studyId = SAMPLE_STUDY_PLAN.study_id;

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.tenants)
      .values({ id: tenantId, name: "Sample Salon (sample data)" })
      .onConflictDoNothing();

    let owner = await tx.query.user.findFirst({ where: eq(schema.user.email, ownerEmail) });
    if (!owner) {
      const [created] = await tx
        .insert(schema.user)
        .values({ id: newId("user"), name: "Sample owner", email: ownerEmail, emailVerified: true })
        .returning();
      owner = created;
    }
    if (!owner) throw new Error("owner insert failed");
    await tx
      .insert(schema.memberships)
      .values({ id: newId("membership"), tenantId, userId: owner.id, role: "owner" })
      .onConflictDoNothing();

    await tx
      .insert(schema.products)
      .values({
        id: productId,
        tenantId,
        name: "Sample booking app",
        url: "http://localhost:3000/demo-target",
        permittedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
        publishableKey: `pk_sample_${newToken(12)}`,
        invitationCooldownDays: 7,
        embedMode: "sdk",
        sample: true,
      })
      .onConflictDoUpdate({
        target: schema.products.id,
        set: {
          embedMode: "sdk",
          url: "http://localhost:3000/demo-target",
          permittedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
        },
      });

    // Excalidraw demo target (local clone on :3200 with the SDK script tag). The app is real
    // open-source software; the study is still stand-in data because VC-01 discovery is not built.
    await tx
      .insert(schema.products)
      .values({
        id: EXCALIDRAW_PRODUCT_ID,
        tenantId,
        name: "Excalidraw",
        url: "http://localhost:3200/",
        permittedOrigins: ["http://localhost:3200"],
        publishableKey: `pk_excalidraw_${newToken(12)}`,
        invitationCooldownDays: 0,
        embedMode: "sdk",
        sample: false,
      })
      .onConflictDoUpdate({
        target: schema.products.id,
        set: {
          embedMode: "sdk",
          url: "http://localhost:3200/",
          permittedOrigins: ["http://localhost:3200"],
        },
      });
    await tx
      .insert(schema.studies)
      .values({
        id: EXCALIDRAW_STUDY_ID,
        tenantId,
        productId: EXCALIDRAW_PRODUCT_ID,
        status: "published",
        currentRevision: 1,
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.studyRevisions)
      .values({
        id: `studyrev_${EXCALIDRAW_STUDY_ID}_1`,
        tenantId,
        studyId: EXCALIDRAW_STUDY_ID,
        revision: 1,
        plan: EXCALIDRAW_STUDY_PLAN,
        provenance: "sample",
        publishedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.studyRevisions.id,
        set: { plan: EXCALIDRAW_STUDY_PLAN },
      });

    await tx
      .insert(schema.studies)
      .values({
        id: studyId,
        tenantId,
        productId,
        status: "published",
        currentRevision: SAMPLE_STUDY_PLAN.study_revision,
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.studyRevisions)
      .values({
        id: `studyrev_${studyId}_${SAMPLE_STUDY_PLAN.study_revision}`,
        tenantId,
        studyId,
        revision: SAMPLE_STUDY_PLAN.study_revision,
        plan: SAMPLE_STUDY_PLAN,
        provenance: "sample",
        publishedAt: new Date(),
      })
      .onConflictDoUpdate({ target: schema.studyRevisions.id, set: { plan: SAMPLE_STUDY_PLAN } });
  });

  await storage().ensureBucket();

  const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
  console.info(
    `seeded sample tenant/product/study\n owner: ${ownerEmail}\n publishable key: ${product?.publishableKey}`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
