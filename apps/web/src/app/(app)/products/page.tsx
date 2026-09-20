import { desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NavLink, SampleBadge, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { db, schema } from "@/db/client";
import { ownerContext } from "@/domain/owner-products";

export const dynamic = "force-dynamic";
export const metadata = { title: "Products" };

const STATUS: Record<string, string> = {
  draft: "Draft",
  connecting: "Connecting",
  ready: "Ready",
  needs_setup: "Needs setup",
};

export default async function ProductsPage() {
  const ctx = await ownerContext();
  if (!ctx) redirect("/sign-in?next=/products");
  const products = ctx.tenantIds.length
    ? await db.query.products.findMany({
        where: inArray(schema.products.tenantId, ctx.tenantIds),
        orderBy: desc(schema.products.createdAt),
      })
    : [];
  return (
    <Shell
      wide
      nav={
        <>
          <NavLink href="/owner">Sessions</NavLink>
          <NavLink href="/operations">Operations</NavLink>
          <span className="px-3 text-foreground">{ctx.email}</span>
        </>
      }
    >
      <div className="mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Onboarding
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Products</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Connect a product, run discovery, and publish only the tasks you choose.
          </p>
        </div>
        <Button asChild className="rounded-full px-5">
          <Link href="/products/new">Add project</Link>
        </Button>
      </div>
      {products.length === 0 ? (
        <div className="surface p-8 text-center">
          <p className="font-medium">No products yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Connect one to run discovery.</p>
        </div>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {products.map((p) => (
          <li key={p.id}>
            <Link
              href={`/products/${p.id}`}
              className="surface block p-6 transition-shadow hover:shadow-[var(--shadow-float)]"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-medium tracking-tight">{p.name}</h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${p.status === "ready" ? "bg-success/15 text-success" : p.status === "needs_setup" ? "bg-warning/15 text-foreground" : "bg-secondary"}`}
                >
                  {STATUS[p.status] ?? p.status}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {p.url ?? "Repository saved · add a live app URL when ready"}
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                {p.sample ? <SampleBadge /> : null}
                <span>
                  {p.releaseNotes.length} release notes · {p.supportComplaints.length} complaints
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
