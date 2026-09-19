import { discoveryProviderSchema } from "@/agents/types";
import type { Prisma } from "@prisma/client";
import { tenantFromEnvironment } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createDiscoveryRun } from "@/services/products";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "./AutoRefresh";
import { RunSection } from "./_components/RunSection";

function readSourceItems(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const id = item.id;
    const isSample = item.isSample;
    return typeof id === "string"
      ? [{ id, isSample: typeof isSample === "boolean" ? isSample : undefined }]
      : [];
  });
}

async function runDiscovery(formData: FormData) {
  "use server";
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) throw new Error("DEV_API_KEY is required");
  const productId = formData.get("productId");
  if (typeof productId !== "string") throw new Error("productId is required");
  const provider = discoveryProviderSchema.parse(
    formData.get("provider") ?? process.env.DISCOVERY_PROVIDER ?? "fixture",
  );
  const run = await createDiscoveryRun(tenantId, productId, provider);
  if (run) redirect(`/products/${run.productId}`);
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromEnvironment();
  const product = tenantId
    ? await prisma.product.findFirst({
        where: { id: (await params).id, tenantId },
        include: {
          discoveryRuns: {
            include: { proposals: true },
            orderBy: { createdAt: "desc" },
          },
        },
      })
    : null;
  if (!product) notFound();
  const sourceItems = [
    ...readSourceItems(product.releaseNotes),
    ...readSourceItems(product.supportComplaints),
  ];
  const activeRuns = product.discoveryRuns.some(
    (run) => run.status === "queued" || run.status === "inspecting",
  );

  return (
    <main>
      <h1>{product.name}</h1>
      <p>{product.url}</p>
      <p>
        Status: <strong>{product.status}</strong>
      </p>
      {product.setupError && <p className="muted">{product.setupError}</p>}
      <AutoRefresh active={activeRuns} />
      <form action={runDiscovery} style={{ marginBottom: "2rem" }}>
        <input type="hidden" name="productId" value={product.id} />
        <select name="provider" defaultValue="fixture">
          <option value="fixture">Fixture (sample)</option>
          <option value="devin">Devin</option>
        </select>
        <button>Run discovery</button>
      </form>
      {product.discoveryRuns.map((run) => (
        <RunSection key={run.id} run={run} productId={product.id} sourceItems={sourceItems} />
      ))}
      {!product.discoveryRuns.length && <p>No discovery runs yet.</p>}
    </main>
  );
}
