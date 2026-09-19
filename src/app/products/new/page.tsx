import { redirect } from "next/navigation";
import { createProduct } from "@/services/products";
import { tenantFromEnvironment } from "@/lib/auth";

async function submit(formData: FormData) {
  "use server";
  const lines = (formData.get("release_notes")?.toString() ?? "").split("\n").filter(Boolean);
  const complaints = (formData.get("complaints")?.toString() ?? "").split("\n").filter(Boolean);
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) throw new Error("DEV_API_KEY is required");
  const product = await createProduct(tenantId, {
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    url: formData.get("url"),
    permitted_origins: (formData.get("origins")?.toString() ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    language: formData.get("language") ?? "en",
    audience: formData.get("audience") ?? "",
    release_notes: lines.map((text, i) => ({
      id: `release_${i}`,
      text,
      source: "owner import",
      isSample: formData.get("sample") === "on",
    })),
    support_complaints: complaints.map((text, i) => ({
      id: `complaint_${i}`,
      text,
      source: "owner import",
      isSample: formData.get("sample") === "on",
    })),
    known_journeys: [],
    product_events: [],
  });
  redirect(`/products/${product.id}`);
}

export default function NewProduct() {
  return (
    <main>
      <h1>Connect a product</h1>
      <form action={submit}>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Description
          <textarea name="description" />
        </label>
        <label>
          URL
          <input name="url" type="url" placeholder="https://example.com" required />
        </label>
        <label>
          Permitted origins
          <input name="origins" placeholder="https://example.com" />
        </label>
        <label>
          Language
          <input name="language" defaultValue="en" />
        </label>
        <label>
          Audience
          <textarea name="audience" />
        </label>
        <label>
          Release notes
          <textarea name="release_notes" placeholder="One per line" />
        </label>
        <label>
          Support complaints
          <textarea name="complaints" placeholder="One per line" />
        </label>
        <label>
          <input name="sample" type="checkbox" /> Mark imported items as sample data
        </label>
        <button type="submit">Connect product</button>
      </form>
    </main>
  );
}
