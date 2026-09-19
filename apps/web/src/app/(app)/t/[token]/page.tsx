import { StudyPlanSchema } from "@vibecheck/contracts";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/auth/current-user";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { db, schema } from "@/db/client";
import { resolveInvitationToken } from "@/domain/invitations";
import { RedeemButton } from "./redeem-button";

export const dynamic = "force-dynamic";

/** Direct-link landing: neutral preview, then sign-in, then token exchange for an assignment. */
export default async function InvitationPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const resolved = await resolveInvitationToken(token);
  if (!resolved.ok) {
    return (
      <Shell>
        <div className="mx-auto max-w-md pt-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {resolved.reason === "expired" ? "This invitation has expired" : "Invitation not found"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Ask the person who invited you for a new link.
          </p>
        </div>
      </Shell>
    );
  }
  const session = await currentSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/t/${token}`)}`);

  const inv = resolved.invitation;
  const rev = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, inv.studyId),
      eq(schema.studyRevisions.revision, inv.studyRevision),
    ),
  });
  const plan = rev ? StudyPlanSchema.parse(rev.plan) : null;
  const product = plan
    ? await db.query.products.findFirst({ where: eq(schema.products.id, plan.product_id) })
    : null;
  const minutes = plan ? Math.max(1, Math.round(plan.task.time_limit_seconds / 60)) : null;

  return (
    <Shell>
      <div className="mx-auto max-w-lg pt-8">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          You are invited
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Try one task in {product?.name ?? "an app"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          About {minutes} minute{minutes === 1 ? "" : "s"}. Your screen and voice are recorded while
          you try it. You will see the task and choose what to share before anything is captured.
          Not finishing the task is fine and still counts.
        </p>
        <div className="surface mt-8 space-y-4 p-6">
          <Row
            label="Recording"
            value={`Screen ${plan?.capture.screen ?? "—"} · Microphone ${plan?.capture.microphone ?? "—"} · Webcam ${plan?.capture.webcam ?? "off"}`}
          />
          <Row label="Keyboard" value="Only Tab, Enter and Escape; never what you type" />
          <Row
            label="Kept for"
            value={`${plan?.capture.retention_days ?? "—"} days, then deleted`}
          />
          <Row label="Reward" value="One participation credit for an honest attempt" />
        </div>
        <div className="mt-8 flex items-center gap-3">
          <RedeemButton token={token} />
          <Button asChild variant="ghost" className="rounded-full">
            <Link href="/">Not now</Link>
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
