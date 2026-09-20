import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { NavLink, Shell } from "@/components/layout/shell";
import { db, schema } from "@/db/client";
import { createOwnerProduct, parseOnboardingForm } from "@/domain/onboarding";
import { ownerContext } from "@/domain/owner-products";
import { ApiError } from "@/lib/api";
import { productPath } from "@/lib/product-path";
import { type FormState, ProductForm } from "./product-form";

/** Reads env and the database at request time; never prerendered at build. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Add your project" };

async function submit(_previous: FormState, formData: FormData): Promise<FormState> {
  "use server";
  const ctx = await ownerContext();
  if (!ctx) redirect("/sign-in?next=/products/new");
  const values = Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !entry[0].startsWith("$ACTION_"),
    ),
  );
  const parsed = parseOnboardingForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details.", values };
  }
  let product: { id: string; slug: string | null };
  try {
    product = await createOwnerProduct(ctx.userId, parsed.data, values.tenant_id || undefined);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message, values };
    return { error: "We couldn't save your project. Please try again.", values };
  }
  redirect(productPath(product));
}

export default async function NewProductPage() {
  const ctx = await ownerContext();
  if (!ctx) redirect("/sign-in?next=/products/new");
  const workspaces =
    ctx.writableTenantIds.length > 1
      ? await db.query.tenants.findMany({
          where: inArray(schema.tenants.id, ctx.writableTenantIds),
          columns: { id: true, name: true },
        })
      : [];
  return (
    <Shell
      nav={
        <>
          <NavLink href="/products">Products</NavLink>
          <span className="px-3 text-foreground">{ctx.email}</span>
        </>
      }
    >
      <div className="mx-auto max-w-2xl">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Onboarding
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Add your project</h1>
        <p className="mt-2 text-muted-foreground">
          All you need is a name and a link to your app. Then choose what to research.
        </p>
        <ProductForm action={submit} workspaces={workspaces} />
      </div>
    </Shell>
  );
}
