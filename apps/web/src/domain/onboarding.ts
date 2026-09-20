import { ProductConfigSchema } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { newId } from "@/lib/ids";
import type { RepoPublisher } from "@/providers/github/types";
import { createProduct } from "./products";
import { repoBindingErrorMessage, resolveGithubBinding } from "./repo-binding";

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

export function parseGithubRepository(input: string): { owner: string; repo: string } | null {
  const value = input.trim();
  const path = value.startsWith("https://github.com/")
    ? value.slice("https://github.com/".length).split(/[?#]/, 1)[0]
    : value;
  const match = path.match(/^([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match || !/^[\w.-]+$/.test(match[1]) || !/^[\w.-]+$/.test(match[2])) return null;
  return { owner: match[1], repo: match[2] };
}

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
  const repository = text("repository");
  const parsedRepository = repository ? parseGithubRepository(repository) : null;
  if (repository && !parsedRepository) {
    return {
      success: false as const,
      error: new z.ZodError([
        {
          code: "custom",
          path: ["repository"],
          message: "Enter a repository as owner/repo or a github.com URL.",
        },
      ]),
    };
  }
  const baseline = text("baseline_commit");
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
    repo_binding: parsedRepository
      ? {
          provider: "github",
          owner: parsedRepository.owner,
          repo: parsedRepository.repo,
          ...(baseline ? { baseline_commit_sha: baseline } : {}),
          issues_enabled: true,
        }
      : undefined,
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
  publisher?: RepoPublisher,
) {
  let config = ProductConfigSchema.parse(input);
  let repoSetupError: string | null = null;
  if (config.repo_binding?.provider === "github") {
    const result = await resolveGithubBinding(config.repo_binding, publisher);
    if (result.ok) config = { ...config, repo_binding: result.binding };
    else {
      config = { ...config, repo_binding: undefined };
      repoSetupError = repoBindingErrorMessage(result.reason);
    }
  }
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
    const product = await createProduct(tenantId, config, resolver, tx);
    if (!repoSetupError) return product;
    const [updated] = await tx
      .update(schema.products)
      .set({ repoBinding: null, status: "needs_setup", setupError: repoSetupError })
      .where(eq(schema.products.id, product.id))
      .returning();
    return updated ?? product;
  });
}
