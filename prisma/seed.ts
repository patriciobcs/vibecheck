import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const features = [
  "Sticky notes (#12064)", "Bucket fill and eyedropper (#11849, #11859)",
  "Customizable color top picks (#11872)", "Right-click pan and wheel-button zoom (#12110)",
  "Zoom with scroll wheel preference (#12099)", "Lasso selection (#11862)", "Board navigation improvements",
];

async function main() {
  const tenant = await prisma.tenant.upsert({ where: { id: "dev-tenant" }, update: {}, create: { id: "dev-tenant", name: "dev" } });
  const key = process.env.DEV_API_KEY || `dev_${randomUUID()}`;
  await prisma.apiKey.upsert({ where: { keyHash: createHash("sha256").update(key).digest("hex") }, update: {}, create: { tenantId: tenant.id, keyHash: createHash("sha256").update(key).digest("hex"), label: "development" } });
  await prisma.product.upsert({ where: { id: "demo-product" }, update: {}, create: {
    id: "demo-product", tenantId: tenant.id, name: "Excalidraw (demo target, sample data)",
    description: "A sample whiteboard target for VC-01.", url: "http://localhost:3001",
    permittedOrigins: ["http://localhost:3001"], language: "en", audience: "whiteboard users",
    releaseNotes: features.map((text, i) => ({ id: `release_${i}`, text, source: "upstream commit subject PR #NNNN", isSample: true })),
    supportComplaints: [
      { id: "complaint_1", text: "Sample complaint: a user could not find a board action.", source: "sample fixture", isSample: true },
      { id: "complaint_2", text: "Sample complaint: a user was unsure how to navigate a large board.", source: "sample fixture", isSample: true },
    ], knownJourneys: ["capture ideas", "match colors", "navigate board"], productEvents: [], status: "ready",
  } });
  console.log(`Development API key: ${key}`);
}

main().finally(() => prisma.$disconnect());
