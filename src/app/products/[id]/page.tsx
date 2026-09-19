import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createDiscoveryRun } from "@/services/products";
import { tenantFromEnvironment } from "@/lib/auth";

async function runDiscovery(formData: FormData) {
  "use server";
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) throw new Error("DEV_API_KEY is required");
  const run = await createDiscoveryRun(tenantId, formData.get("productId")!.toString(), formData.get("provider")?.toString());
  if (run) redirect(`/products/${run.productId}`);
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const product = await prisma.product.findFirst({ where: { id: (await params).id }, include: { discoveryRuns: { include: { proposals: true }, orderBy: { createdAt: "desc" } } } });
  if (!product) notFound();
  return <main><h1>{product.name}</h1><p>{product.url}</p><p>Status: <strong>{product.status}</strong></p>{product.setupError && <p className="muted">{product.setupError}</p>}
    <form action={runDiscovery} style={{ marginBottom: "2rem" }}><input type="hidden" name="productId" value={product.id} /><select name="provider" defaultValue="fixture"><option value="fixture">Fixture (sample)</option><option value="devin">Devin</option></select><button>Run discovery</button></form>
    {product.discoveryRuns.map((run) => <section key={run.id}><h2>Run {run.id.slice(-8)} · {run.status}</h2><div className="grid">{run.proposals.map((proposal) => <article className="card" key={proposal.id}><h3>{proposal.taskId}</h3><p>{proposal.participantPrompt}</p><p>{proposal.researchQuestion}</p><p>{proposal.rationale}</p><p className="muted">Evidence: {proposal.evidenceRefs.join(", ")} ({proposal.evidenceType})</p><p className="muted">Eligibility: {proposal.eligibilityRuleRef} · Success: {proposal.successRuleRef}</p><p className="muted">{proposal.uncertainties.join(" ")}</p><Link href={`/products/${product.id}/publish?run=${run.id}&task=${proposal.taskId}`}><button>Publish study</button></Link></article>)}</div></section>)}
  </main>;
}
