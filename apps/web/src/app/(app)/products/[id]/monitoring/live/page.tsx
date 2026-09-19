import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NavLink, Shell } from "@/components/layout/shell";
import type { LiveSessionRef } from "@/domain/monitoring/live";
import { ownerContext, ownerProduct } from "@/domain/owner-products";
import { LiveBoard } from "./live-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live analysis" };

/** Second-screen view for a running session: polls persisted state, never simulates progress. */
export default async function LiveMonitoringPage({
  params,
  searchParams,
}: PageProps<"/products/[id]/monitoring/live">) {
  const ctx = await ownerContext();
  const { id } = await params;
  const raw = (await searchParams).session;
  const [kind, sessionId] = (typeof raw === "string" ? raw : "").split(":");
  let initial: LiveSessionRef | null = null;
  if (sessionId && (kind === "observation" || kind === "study")) initial = { kind, id: sessionId };
  if (!ctx) redirect(`/sign-in?next=/products/${id}/monitoring/live`);
  const product = await ownerProduct(ctx.tenantIds, id);
  if (!product) notFound();
  return (
    <Shell
      wide
      nav={
        <>
          <NavLink href={`/products/${product.id}/monitoring`}>Monitoring</NavLink>
          <NavLink href="/products">Products</NavLink>
          <span className="px-3 text-foreground">{ctx.email}</span>
        </>
      }
    >
      <div className="mb-6">
        <Link
          href={`/products/${product.id}/monitoring`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Monitoring
        </Link>
      </div>
      <LiveBoard
        productId={product.id}
        productName={product.name}
        productUrl={product.url}
        initial={initial}
      />
    </Shell>
  );
}
