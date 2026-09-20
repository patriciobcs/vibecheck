import { randomUUID } from "node:crypto";
import { RepoBindingSchema } from "@vibecheck/contracts";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { NavLink, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { db, schema } from "@/db/client";
import { ownerContext, ownerProduct } from "@/domain/owner-products";
import { publishStudy } from "@/domain/publish";
import { productPath, withSearchParams } from "@/lib/product-path";

export const dynamic = "force-dynamic";

const field = (f: FormData, n: string) => String(f.get(n) ?? "");
const num = (f: FormData, n: string) => Number(field(f, n));

async function publish(formData: FormData) {
  "use server";
  const ctx = await ownerContext();
  if (!ctx) throw new Error("sign in required");
  const productId = field(formData, "productId");
  let result = null;
  for (const tenantId of ctx.writableTenantIds) {
    result = await publishStudy(tenantId, randomUUID(), {
      product_id: productId,
      discovery_run_id: field(formData, "runId"),
      task_id: field(formData, "taskId"),
      fixture_ref: field(formData, "fixtureRef"),
      baseline: {
        commit_sha: field(formData, "commitSha"),
        environment_ref: field(formData, "environmentRef"),
      },
      task: {
        participant_prompt: field(formData, "prompt"),
        time_limit_seconds: num(formData, "timeLimit"),
      },
      recruitment: {
        source: field(formData, "source"),
        target_count: num(formData, "targetCount"),
        cohort: field(formData, "cohort"),
      },
      capture: {
        screen: field(formData, "screen"),
        microphone: field(formData, "microphone"),
        webcam: field(formData, "webcam"),
        retention_days: num(formData, "retentionDays"),
      },
      automation: {
        mode: field(formData, "mode"),
        max_variants: num(formData, "maxVariants"),
        max_repair_attempts: num(formData, "maxRepairAttempts"),
        retest_target_count: num(formData, "retestTargetCount"),
      },
    });
    if (result) break;
  }
  if (!result) throw new Error("proposal not found");
  redirect(`/studies/${result.study.id}`);
}

export default async function PublishPage({
  params,
  searchParams,
}: PageProps<"/products/[id]/publish">) {
  const ctx = await ownerContext();
  const { id } = await params;
  const q = await searchParams;
  if (!ctx) redirect(`/sign-in?next=/products/${id}`);
  const product = await ownerProduct(ctx.tenantIds, id);
  if (!product) notFound();
  if (product.slug !== id) permanentRedirect(withSearchParams(productPath(product, "/publish"), q));
  const runId = typeof q.run === "string" ? q.run : "";
  const taskId = typeof q.task === "string" ? q.task : "";
  const proposal = await db.query.proposals.findFirst({
    where: and(eq(schema.proposals.discoveryRunId, runId), eq(schema.proposals.taskId, taskId)),
  });
  if (!proposal) notFound();
  const binding = RepoBindingSchema.safeParse(product.repoBinding);
  const defaultCommitSha =
    binding.success && binding.data.provider === "github" && binding.data.baseline_commit_sha
      ? binding.data.baseline_commit_sha
      : "0000000000000000000000000000000000000000";

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
        <Link
          href={productPath(product)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {product.name}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Publish study</h1>
        <p className="mt-2 text-muted-foreground">{proposal.researchQuestion}</p>
        <form action={publish} className="surface mt-8 space-y-6 p-6">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="runId" value={proposal.discoveryRunId} />
          <input type="hidden" name="taskId" value={proposal.taskId} />
          <div className="space-y-1.5">
            <Label htmlFor="prompt">Participant prompt</Label>
            <Textarea
              id="prompt"
              name="prompt"
              rows={3}
              defaultValue={proposal.participantPrompt}
              required
            />
            <p className="text-xs text-muted-foreground">
              Neutral goal only: never name the control or the suspected problem.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <F
              label="Time limit (s)"
              name="timeLimit"
              type="number"
              defaultValue={proposal.estimatedDurationSeconds ?? 300}
            />
            <F label="Baseline commit" name="commitSha" defaultValue={defaultCommitSha} />
            <F label="Environment ref" name="environmentRef" defaultValue="baseline_preview" />
          </div>
          <F label="Fixture ref" name="fixtureRef" defaultValue="excalidraw_blank_v1" />
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Recruitment</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <S
                label="Source"
                name="source"
                defaultValue={product.embedMode === "sdk" ? "embedded" : "marketplace"}
                options={["direct_link", "embedded", "marketplace"]}
              />
              <F label="Target count" name="targetCount" type="number" defaultValue={2} />
              <S label="Cohort" name="cohort" defaultValue="fresh" options={["fresh", "repeat"]} />
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Capture</legend>
            <div className="grid gap-4 sm:grid-cols-4">
              <S
                label="Screen"
                name="screen"
                defaultValue="required"
                options={["required", "optional", "off"]}
              />
              <S
                label="Microphone"
                name="microphone"
                defaultValue="required"
                options={["required", "optional", "off"]}
              />
              <S
                label="Webcam"
                name="webcam"
                defaultValue="off"
                options={["off", "optional", "required"]}
              />
              <F label="Retention (days)" name="retentionDays" type="number" defaultValue={30} />
            </div>
            <p className="text-xs text-muted-foreground">
              Pointer on, keyboard semantic-only and text values off are fixed in the MVP.
            </p>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Automation</legend>
            <div className="grid gap-4 sm:grid-cols-4">
              <S
                label="Mode"
                name="mode"
                defaultValue="issues_only"
                options={["issues_only", "draft_pr", "prototype_and_retest"]}
              />
              <F label="Max variants" name="maxVariants" type="number" defaultValue={1} />
              <F
                label="Max repair attempts"
                name="maxRepairAttempts"
                type="number"
                defaultValue={2}
              />
              <F label="Retest target" name="retestTargetCount" type="number" defaultValue={2} />
            </div>
          </fieldset>
          <Button type="submit" className="rounded-full px-6">
            Publish
          </Button>
        </form>
      </div>
    </Shell>
  );
}

function F({ label, ...props }: { label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.name}>{label}</Label>
      <Input id={props.name} {...props} />
    </div>
  );
}

function S({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: string[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}
