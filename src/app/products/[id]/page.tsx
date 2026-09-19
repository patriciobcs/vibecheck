import { discoveryProviderSchema } from "@/agents/types";
import { tenantFromEnvironment } from "@/lib/auth";
import { db } from "@/db";
import { discoveryRun, product, proposal } from "@/db/schema";
import { createDiscoveryRun } from "@/services/products";
import { and, desc, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "./AutoRefresh";
import { RunSection } from "./_components/RunSection";

function readSourceItems(value: unknown) {
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
  const [productRow] = tenantId
    ? await db
        .select()
        .from(product)
        .where(and(eq(product.id, (await params).id), eq(product.tenantId, tenantId)))
        .limit(1)
    : [];
  if (!productRow) notFound();
  const runs = await db
    .select()
    .from(discoveryRun)
    .where(
      and(eq(discoveryRun.productId, productRow.id), eq(discoveryRun.tenantId, tenantId ?? "")),
    )
    .orderBy(desc(discoveryRun.createdAt));
  const proposals = runs.length
    ? await db
        .select()
        .from(proposal)
        .where(
          and(
            inArray(
              proposal.discoveryRunId,
              runs.map((run) => run.id),
            ),
            eq(proposal.tenantId, tenantId ?? ""),
          ),
        )
    : [];
  const sourceItems = [
    ...readSourceItems(productRow.releaseNotes),
    ...readSourceItems(productRow.supportComplaints),
  ];
  const activeRuns = runs.some((run) => run.status === "queued" || run.status === "inspecting");

  return (
    <main>
      <h1>{productRow.name}</h1>
      <p>{productRow.url}</p>
      <p>
        Status: <strong>{productRow.status}</strong>
      </p>
      {productRow.setupError && <p className="muted">{productRow.setupError}</p>}
      <AutoRefresh active={activeRuns} />
      <form action={runDiscovery} style={{ marginBottom: "2rem" }}>
        <input type="hidden" name="productId" value={productRow.id} />
        <select name="provider" defaultValue="fixture">
          <option value="fixture">Fixture (sample)</option>
          <option value="devin">Devin</option>
        </select>
        <button>Run discovery</button>
      </form>
      {runs.map((run) => (
        <RunSection
          key={run.id}
          run={{ ...run, proposals: proposals.filter((item) => item.discoveryRunId === run.id) }}
          productId={productRow.id}
          sourceItems={sourceItems}
        />
      ))}
      {!runs.length && <p>No discovery runs yet.</p>}
    </main>
  );
}
