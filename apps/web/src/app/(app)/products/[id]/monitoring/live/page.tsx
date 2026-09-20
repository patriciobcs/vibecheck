import { notFound, permanentRedirect, redirect } from "next/navigation";
import type { LiveSessionRef } from "@/domain/monitoring/live";
import { ownerContext, ownerProduct } from "@/domain/owner-products";
import { productPath, withSearchParams } from "@/lib/product-path";
import { LiveBoard } from "./live-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live analysis" };

/**
 * Second-screen console for a running session. Fills the viewport with its own top bar (no page
 * shell): every panel scrolls internally, the page never does. Polls persisted state only.
 */
export default async function LiveMonitoringPage({
  params,
  searchParams,
}: PageProps<"/products/[id]/monitoring/live">) {
  const ctx = await ownerContext();
  const { id } = await params;
  if (!ctx) redirect(`/sign-in?next=/products/${id}/monitoring/live`);
  const product = await ownerProduct(ctx.tenantIds, id);
  if (!product) notFound();
  const sp = await searchParams;
  if (product.slug !== id)
    permanentRedirect(withSearchParams(productPath(product, "/monitoring/live"), sp));
  const raw = sp.session;
  const [kind, sessionId] = (typeof raw === "string" ? raw : "").split(":");
  let initial: LiveSessionRef | null = null;
  if (sessionId && (kind === "observation" || kind === "study")) initial = { kind, id: sessionId };
  return (
    <LiveBoard
      productId={product.id}
      productName={product.name}
      productUrl={product.url}
      productHref={productPath(product, "/monitoring")}
      ownerEmail={ctx.email}
      initial={initial}
    />
  );
}
