import { ProductConfigSchema } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { newId } from "@/lib/ids";
import { createProduct } from "./products";

const webUrl = z.url({ protocol: /^https?$/, error: "Enter a valid http:// or https:// URL." });
const OnboardingSchema = ProductConfigSchema.extend({
  name: z.string().trim().min(1, "Enter a project name."),
  url: webUrl,
  permitted_origins: z.array(
    webUrl.refine((value) => new URL(value).origin === value, {
      error: "Use origins without paths, such as https://app.example.com.",
    }),
  ),
});

export function parseOnboardingForm(formData: FormData) {
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const lines = (name: string) =>
    text(name)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const sourceItems = (name: string, prefix: string) =>
    lines(name).map((value, i) => ({
      id: `${prefix}_${i}`,
      text: value,
      source: "owner import",
      isSample: formData.get("sample") === "on",
    }));
  const parsed = OnboardingSchema.safeParse({
    name: text("name"),
    url: text("url"),
    description: text("description"),
    audience: text("audience"),
    language: text("language") || "en",
    permitted_origins: text("origins")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    release_notes: sourceItems("release_notes", "release"),
    support_complaints: sourceItems("complaints", "complaint"),
    known_journeys: lines("journeys"),
  });
  if (parsed.success && parsed.data.permitted_origins.length === 0) {
    parsed.data.permitted_origins = [new URL(parsed.data.url).origin];
  }
  return parsed;
}

export async function createOwnerProduct(
  userId: string,
  input: unknown,
  selectedTenantId?: string,
  resolver?: Parameters<typeof createProduct>[2],
) {
  const config = ProductConfigSchema.parse(input);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .for("update");
    if (!user) throw new ApiError(401, "unauthorized", "Sign in to add your project.");
    const memberships = await tx.query.memberships.findMany({
      where: eq(schema.memberships.userId, userId),
    });
    const writable = memberships.filter((member) =>
      ["owner", "admin", "researcher"].includes(member.role),
    );
    let tenantId: string;
    if (selectedTenantId) {
      if (!writable.some((member) => member.tenantId === selectedTenantId)) {
        throw new ApiError(403, "forbidden", "Choose a workspace where you can add projects.");
      }
      tenantId = selectedTenantId;
    } else if (writable.length > 1) {
      throw new ApiError(400, "tenant_required", "Choose a workspace for this project.");
    } else if (writable[0]) {
      tenantId = writable[0].tenantId;
    } else if (memberships.length > 0) {
      throw new ApiError(
        403,
        "forbidden",
        "You need an owner or researcher role to add a project.",
      );
    } else {
      tenantId = newId("tenant");
      await tx.insert(schema.tenants).values({ id: tenantId, name: config.name });
      await tx.insert(schema.memberships).values({
        id: newId("membership"),
        tenantId,
        userId,
        role: "owner",
      });
    }
    return createProduct(tenantId, config, resolver, tx);
  });
}
