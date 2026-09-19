import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/auth/current-user";
import { Wordmark } from "@/components/layout/shell";
import { assignmentViewForUser } from "@/domain/assignment-view";
import { env } from "@/lib/env";
import { HostedDialog } from "./hosted-dialog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your task" };

/** Hosted recorder for products without the SDK: the same dialog over a neutral backdrop. */
export default async function AssignmentPage({ params }: PageProps<"/a/[id]">) {
  const session = await currentSession();
  const { id } = await params;
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/a/${id}`)}`);
  const view = await assignmentViewForUser(session.user.id, id);
  if (!view) notFound();
  return (
    <div className="flex min-h-screen flex-col items-center bg-secondary/60 px-4 py-10">
      <Wordmark className="mb-8 text-sm" />
      <HostedDialog
        assignmentId={id}
        productUrl={view.product.url}
        permittedOrigins={view.product.permittedOrigins}
        providersReady={env().vonage !== null}
      />
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        {view.product.name} opens in a new window when recording starts. Keep this tab open.
      </p>
    </div>
  );
}
