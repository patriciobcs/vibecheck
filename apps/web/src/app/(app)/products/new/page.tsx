import { redirect } from "next/navigation";
import { NavLink, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ownerContext } from "@/domain/owner-products";
import { createProduct } from "@/domain/products";

export const metadata = { title: "Connect product" };

async function submit(formData: FormData) {
  "use server";
  const ctx = await ownerContext();
  const tenantId = ctx?.writableTenantIds[0];
  if (!tenantId)
    throw new Error("You need an owner or researcher membership to connect a product.");
  const sample = formData.get("sample") === "on";
  const lines = (name: string) =>
    String(formData.get(name) ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const product = await createProduct(tenantId, {
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    url: formData.get("url"),
    permitted_origins: String(formData.get("origins") ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    language: formData.get("language") || "en",
    audience: formData.get("audience") ?? "",
    release_notes: lines("release_notes").map((text, i) => ({
      id: `release_${i}`,
      text,
      source: "owner import",
      isSample: sample,
    })),
    support_complaints: lines("complaints").map((text, i) => ({
      id: `complaint_${i}`,
      text,
      source: "owner import",
      isSample: sample,
    })),
    known_journeys: lines("journeys"),
    product_events: [],
  });
  redirect(`/products/${product.id}`);
}

export default async function NewProductPage() {
  const ctx = await ownerContext();
  if (!ctx) redirect("/sign-in?next=/products/new");
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
        <h1 className="text-3xl font-semibold tracking-tight">Connect a product</h1>
        <p className="mt-2 text-muted-foreground">
          Describe the product and, optionally, paste release notes and complaints. Mark imported
          material as sample data when it is not real.
        </p>
        <form action={submit} className="surface mt-8 space-y-5 p-6">
          <Field label="Name" name="name" required placeholder="Acme Booking" />
          <Field
            label="URL"
            name="url"
            type="url"
            required
            placeholder="https://app.example.com"
            hint="Must resolve to a public address, or set ALLOW_LOCAL_TARGETS for local demos."
          />
          <Field
            label="Permitted origins"
            name="origins"
            placeholder="https://app.example.com, https://staging.example.com"
            hint="Comma separated. Where the embedded SDK may run."
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Language" name="language" defaultValue="en" />
            <Field label="Audience" name="audience" placeholder="Salon customers" />
          </div>
          <Area label="Description" name="description" rows={2} />
          <Area label="Release notes" name="release_notes" rows={4} placeholder="One per line" />
          <Area label="Support complaints" name="complaints" rows={3} placeholder="One per line" />
          <Area
            label="Known journeys"
            name="journeys"
            rows={2}
            placeholder="One per line, e.g. reschedule an appointment"
          />
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="sample" name="sample" />
            <Label htmlFor="sample" className="font-normal">
              Mark imported items as sample data
            </Label>
          </div>
          <Button type="submit" className="rounded-full px-6">
            Connect product
          </Button>
        </form>
      </div>
    </Shell>
  );
}

function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.name}>{label}</Label>
      <Input id={props.name} {...props} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Area({ label, ...props }: { label: string } & React.ComponentProps<typeof Textarea>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.name}>{label}</Label>
      <Textarea id={props.name} {...props} />
    </div>
  );
}
