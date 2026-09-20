import { SAMPLE_STUDY_PLAN, type StudyPlan } from "@vibecheck/contracts";
import { and, eq } from "drizzle-orm";
import { generateDetector } from "@/domain/monitoring/detectors";
import { currentMonitoringPolicy, setMonitoringPolicy } from "@/domain/monitoring/policy";
import { hashApiKey } from "@/lib/api-key";
import { newId, newToken } from "@/lib/ids";
import {
  EXCALIDRAW_SHARE_DRAWING_DETECTOR,
  fixtureDetectorGenerator,
} from "@/providers/detector-generation/fixture";
import { storage } from "@/providers/storage";
import { db, schema, sql } from "./client";

/** The sample target page lives on this app, so its URL follows the app origin (dev :3000, e2e :3100). */
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const EXCALIDRAW_PRODUCT_ID = "product_excalidraw_local";
/** The instrumented clone: local by default, the deployed fork in production (EXCALIDRAW_DEMO_URL). */
const EXCALIDRAW_URL = process.env.EXCALIDRAW_DEMO_URL ?? "http://localhost:3200/";
const EXCALIDRAW_ORIGINS = [...new Set([new URL(EXCALIDRAW_URL).origin, "http://localhost:3200"])];

/** SAMPLE discovery context for the Excalidraw target: release notes from upstream commit subjects, sample complaints. */
const EXCALIDRAW_RELEASE_NOTES = (
  [
    ["release_sticky_notes", "Sticky notes", 12064],
    ["release_bucket_fill", "Bucket fill", 11849],
    ["release_eyedropper", "Eyedropper", 11859],
    ["release_color_top_picks", "Customizable color top picks", 11872],
    ["release_right_click_pan", "Right-click pan", 12110],
    ["release_wheel_zoom", "Wheel-button zoom and zoom-with-scroll-wheel preference", 12099],
    ["release_lasso_selection", "Lasso selection", 11862],
  ] as const
).map(([id, text, pr]) => ({
  id,
  text,
  source: `upstream commit subject, PR #${pr}`,
  isSample: true,
}));
const EXCALIDRAW_JOURNEYS = ["capture ideas", "match colors", "navigate board", "share drawing"];
const EXCALIDRAW_COMPLAINTS = [
  {
    id: "complaint_1",
    text: "Sample complaint: a user could not find a board action.",
    source: "sample fixture",
    isSample: true,
  },
  {
    id: "complaint_2",
    text: "Sample complaint: a user was unsure how to navigate a large board.",
    source: "sample fixture",
    isSample: true,
  },
];
const EXCALIDRAW_STUDY_ID = "study_excalidraw_export";

/** Stand-in study for the Excalidraw demo (VC-01 output not implemented). Neutral task, no control named. */
const EXCALIDRAW_STUDY_PLAN: StudyPlan = {
  ...SAMPLE_STUDY_PLAN,
  study_id: EXCALIDRAW_STUDY_ID,
  product_id: EXCALIDRAW_PRODUCT_ID,
  task: {
    task_id: "task_share_drawing",
    participant_prompt:
      "Sketch two boxes joined by an arrow. Then get a PNG image of your drawing that you could email to a colleague who does not use this app.",
    research_question: "Can a new user get their drawing out of the app as an image?",
    time_limit_seconds: 240,
    success_rule_ref: "drawing_exported_v1",
    fixture_ref: "excalidraw_blank_v1", // blank canvas; the task starts with a drawing step so it is always startable
  },
  recruitment: {
    source: "embedded",
    target_count: 500, // public demo: every visitor of the clone can take part
    cohort: "fresh",
    eligibility_rule_ref: "any_visitor_v1",
  },
  // Demo: instrumentation logs plus the transcribed microphone are the evidence; no screen capture.
  capture: { ...SAMPLE_STUDY_PLAN.capture, screen: "off" },
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

    // Demo tester: a signed-in participant for the marketplace and direct-link channels.
    const testerEmail = process.env.DEMO_TESTER_EMAIL ?? "tester@example.test";
    let tester = await tx.query.user.findFirst({ where: eq(schema.user.email, testerEmail) });
    if (!tester) {
      const [created] = await tx
        .insert(schema.user)
        .values({ id: newId("user"), name: "Demo tester", email: testerEmail, emailVerified: true })
        .returning();
      tester = created;
    }
    if (!tester) throw new Error("tester insert failed");
    const participant = await tx.query.participants.findFirst({
      where: eq(schema.participants.userId, tester.id),
    });
    if (!participant)
      await tx
        .insert(schema.participants)
        .values({ id: newId("participant"), userId: tester.id, invitationsOptIn: true });

    await tx
      .insert(schema.products)
      .values({
        id: productId,
        tenantId,
        name: "Sample booking app",
        slug: "sample-booking-app",
        url: `${APP_URL}/demo-target`,
        permittedOrigins: [APP_URL],
        publishableKey: `pk_sample_${newToken(12)}`,
        invitationCooldownDays: 7,
        embedMode: "sdk",
        sample: true,
        description: "Sample booking flow used as the built-in demo target.",
      })
      .onConflictDoUpdate({
        target: schema.products.id,
        set: {
          slug: "sample-booking-app",
          description: "Sample booking flow used as the built-in demo target.",
          embedMode: "sdk",
          url: `${APP_URL}/demo-target`,
          permittedOrigins: [APP_URL],
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
        slug: "excalidraw",
        url: EXCALIDRAW_URL,
        permittedOrigins: EXCALIDRAW_ORIGINS,
        publishableKey: `pk_excalidraw_${newToken(12)}`,
        invitationCooldownDays: 0,
        embedMode: "sdk",
        sample: false,
        description: "Open-source whiteboard for diagrams and sketches.",
        language: "en",
        audience: "whiteboard users",
        releaseNotes: EXCALIDRAW_RELEASE_NOTES,
        supportComplaints: EXCALIDRAW_COMPLAINTS,
        knownJourneys: EXCALIDRAW_JOURNEYS,
        productEvents: [],
        status: "ready",
        repoBinding: {
          provider: "github",
          owner: "seamlessux",
          repo: "excalidraw-seamlessux",
          default_branch: "main",
          baseline_commit_sha: "740a3f85ee0f883b763839b99c7676b6364d2942",
          issues_enabled: true,
        },
      })
      .onConflictDoUpdate({
        target: schema.products.id,
        set: {
          slug: "excalidraw",
          description: "Open-source whiteboard for diagrams and sketches.",
          embedMode: "sdk",
          url: EXCALIDRAW_URL,
          permittedOrigins: EXCALIDRAW_ORIGINS,
          releaseNotes: EXCALIDRAW_RELEASE_NOTES,
          supportComplaints: EXCALIDRAW_COMPLAINTS,
          knownJourneys: EXCALIDRAW_JOURNEYS,
          status: "ready",
          repoBinding: {
            provider: "github",
            owner: "seamlessux",
            repo: "excalidraw-seamlessux",
            default_branch: "main",
            baseline_commit_sha: "740a3f85ee0f883b763839b99c7676b6364d2942",
            issues_enabled: true,
          },
        },
      });

    // Programmatic API key for the sample tenant (hashed at rest), used by tests and scripts.
    const devKey = process.env.DEV_API_KEY;
    if (devKey && !/^REPLACE_WITH_/.test(devKey)) {
      await tx
        .insert(schema.apiKeys)
        .values({ id: "apikey_dev", tenantId, keyHash: hashApiKey(devKey), label: "development" })
        .onConflictDoUpdate({
          target: schema.apiKeys.keyHash,
          set: { tenantId, label: "development" },
        });
    }
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

  // DEMO ONLY: passive monitoring is disabled by default for real products. The local Excalidraw
  // target gets an enabled policy and a fixture detector so the screening loop can be exercised.
  const monitoring = await currentMonitoringPolicy(EXCALIDRAW_PRODUCT_ID);
  const previousSeed =
    monitoring.policy.batch_delay_ms === 4000 && monitoring.policy.cooldown_ms === 30_000;
  if (monitoring.revision === 0 || previousSeed) {
    // Short batch delay and cooldown so a live demo shows the screening within seconds.
    await setMonitoringPolicy(
      EXCALIDRAW_PRODUCT_ID,
      {
        enabled: true,
        allowed_journeys: ["share_drawing"],
        batch_delay_ms: 1500,
        cooldown_ms: 8_000,
        max_evaluations_per_product_day: 200,
      },
      null,
    );
  }
  const existingDetector = await db.query.detectorDefinitions.findFirst({
    where: and(
      eq(schema.detectorDefinitions.productId, EXCALIDRAW_PRODUCT_ID),
      eq(schema.detectorDefinitions.status, "active"),
    ),
  });
  const wantedQuestions = Object.keys(EXCALIDRAW_SHARE_DRAWING_DETECTOR.questions).sort().join(",");
  const currentQuestions = existingDetector
    ? Object.keys(existingDetector.questions as object)
        .sort()
        .join(",")
    : "";
  // A changed fixture publishes a new detector version; older versions are superseded.
  if (!existingDetector || currentQuestions !== wantedQuestions) {
    const res = await generateDetector(
      {
        productId: EXCALIDRAW_PRODUCT_ID,
        detectorId: "share_drawing_export",
        appBuildRef: "vibecheck-demo",
        journeyHint: "share_drawing",
      },
      fixtureDetectorGenerator,
    );
    if (!res.ok) throw new Error(`fixture detector invalid: ${res.problems.join("; ")}`);
  }

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
