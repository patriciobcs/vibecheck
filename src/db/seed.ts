import { db } from "./index";
import { apiKey, product, tenant } from "./schema";
import { hashApiKey } from "@/lib/auth";

const features = [
  ["release_sticky_notes", "Sticky notes", 12064],
  ["release_bucket_fill", "Bucket fill", 11849],
  ["release_eyedropper", "Eyedropper", 11859],
  ["release_color_top_picks", "Customizable color top picks", 11872],
  ["release_right_click_pan", "Right-click pan", 12110],
  ["release_wheel_zoom", "Wheel-button zoom and zoom-with-scroll-wheel preference", 12099],
  ["release_lasso_selection", "Lasso selection", 11862],
] as const;
const releaseNotes = features.map(([id, text, pr]) => ({
  id,
  text,
  source: `upstream commit subject, PR #${pr}`,
  isSample: true,
}));
const supportComplaints = [
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

async function main() {
  const key = process.env.DEV_API_KEY;
  if (!key) throw new Error("DEV_API_KEY required");
  const tenantId = "dev-tenant";
  await db
    .insert(tenant)
    .values({ id: tenantId, name: "dev" })
    .onConflictDoNothing({ target: tenant.id });
  await db
    .insert(apiKey)
    .values({ tenantId, keyHash: hashApiKey(key), label: "development" })
    .onConflictDoUpdate({
      target: apiKey.keyHash,
      set: { tenantId, label: "development" },
    });
  await db
    .insert(product)
    .values({
      id: "demo-product",
      tenantId,
      name: "Excalidraw (demo target, sample data)",
      description: "A sample whiteboard target for VC-01.",
      url: "http://localhost:3001",
      permittedOrigins: ["http://localhost:3001"],
      language: "en",
      audience: "whiteboard users",
      releaseNotes,
      supportComplaints,
      knownJourneys: ["capture ideas", "match colors", "navigate board"],
      productEvents: [],
      status: "ready",
    })
    .onConflictDoUpdate({
      target: product.id,
      set: { releaseNotes, supportComplaints, updatedAt: new Date() },
    });
  console.log("seeded tenant dev-tenant");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
