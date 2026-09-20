import { StudyPlanSchema } from "@vibecheck/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { currentSession } from "@/auth/current-user";
import { NavLink, SampleBadge, Shell } from "@/components/layout/shell";
import { db, schema } from "@/db/client";
import { participantForUser } from "@/domain/participants";
import { ClaimButton } from "./claim-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketplace" };

/** Simple claim queue: open studies recruiting through the marketplace channel. */
export default async function Marketplace() {
  const session = await currentSession();
  const participant = session ? await participantForUser(session.user.id) : null;
  const studies = await db.query.studies.findMany({
    where: inArray(schema.studies.status, ["published", "recruiting"]),
  });
  const cards = [];
  for (const study of studies) {
    const rev = await db.query.studyRevisions.findFirst({
      where: and(
        eq(schema.studyRevisions.studyId, study.id),
        eq(schema.studyRevisions.revision, study.currentRevision),
      ),
    });
    if (!rev) continue;
    const plan = StudyPlanSchema.parse(rev.plan);
    if (plan.recruitment.source !== "marketplace") continue;
    const product = await db.query.products.findFirst({
      where: eq(schema.products.id, study.productId),
    });
    const tenant = product
      ? await db.query.tenants.findFirst({ where: eq(schema.tenants.id, product.tenantId) })
      : null;
    const claimed = await db.$count(
      schema.assignments,
      and(eq(schema.assignments.studyId, study.id)),
    );
    const mine = participant
      ? await db.query.assignments.findFirst({
          where: and(
            eq(schema.assignments.studyId, study.id),
            eq(schema.assignments.participantId, participant.id),
          ),
        })
      : null;
    cards.push({
      study,
      plan,
      product,
      paused: tenant?.paused ?? false,
      remaining: Math.max(0, plan.recruitment.target_count - claimed),
      provenance: rev.provenance,
      mine: mine?.id ?? null,
    });
  }

  return (
    <Shell
      nav={
        session ? (
          <span className="px-3 text-foreground">{session.user.email}</span>
        ) : (
          <NavLink href="/sign-in?next=/marketplace">Sign in</NavLink>
        )
      }
    >
      <div className="mb-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Marketplace
        </p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Open studies</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Claim a task, read what is recorded, and try it honestly. Struggling is useful evidence,
          and it still earns credit.
        </p>
      </div>
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No studies are recruiting right now.</p>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2">
        {cards.map(({ study, plan, product, paused, remaining, provenance, mine }) => (
          <li key={study.id} className="surface flex flex-col p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{product?.name ?? "Product"}</p>
              {provenance === "sample" || product?.sample ? <SampleBadge /> : null}
            </div>
            <p className="mt-3 text-lg font-medium leading-snug tracking-tight">
              One task, about {Math.max(1, Math.round(plan.task.time_limit_seconds / 60))} minutes
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The task is revealed after you claim it. Screen {plan.capture.screen}, microphone{" "}
              {plan.capture.microphone}, webcam {plan.capture.webcam}.
            </p>
            <div className="mt-6 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {paused
                  ? "Paused by owner"
                  : remaining === 0
                    ? "All spots claimed"
                    : `${remaining} spot${remaining === 1 ? "" : "s"} left`}
              </span>
              <ClaimButton
                studyId={study.id}
                disabled={paused || remaining === 0}
                signedIn={session !== null}
                existingAssignmentId={mine}
              />
            </div>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
