import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/auth/current-user";
import { safeReturnPath } from "@/auth/return-path";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { SignInForm } from "./sign-in-form";

/** Reads env and the database at request time; never prerendered at build. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  if (await currentSession()) redirect(next);
  const config = env();
  const demo = config.demo;
  const localInbox = config.EMAIL_MODE === "test_inbox" && process.env.NODE_ENV !== "production";
  const emailReady =
    config.EMAIL_MODE === "resend" && Boolean(config.RESEND_API_KEY && config.EMAIL_FROM);
  const onboarding = next === "/products/new";
  return (
    <Shell>
      <div className="mx-auto max-w-md pt-10">
        {onboarding ? (
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Step 1 of 2 · Sign in
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight">
          {onboarding ? "Sign in to add your project" : "Sign in"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {onboarding
            ? "First access your account. Next, add your GitHub repository."
            : "Access your workspace with a one-time sign-in link."}
        </p>
        {localInbox || emailReady ? (
          <div className="surface mt-6 p-6">
            {localInbox ? (
              <p className="mb-4 text-sm text-muted-foreground">
                Local development: sign-in links go to the test inbox. No email is sent.
              </p>
            ) : null}
            <SignInForm next={next} localInbox={localInbox} />
          </div>
        ) : (
          <p role="status" className="surface mt-6 p-6 text-sm text-muted-foreground">
            Email sign-in is not configured on this deployment. Contact the workspace administrator
            {demo ? ", or explore the shared demo below." : "."}
          </p>
        )}
        {demo ? (
          <div className="surface mt-8 p-6">
            <p className="text-sm font-medium">Explore a shared demo instead</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Two seeded identities. The product owner runs the Excalidraw workspace; the tester
              takes studies. This skips email sign-in using a shared demo account; it does not
              create a private workspace.
            </p>
            <div className="mt-4 grid gap-2">
              <Button asChild className="w-full rounded-full">
                <Link href={`/api/demo/enter?as=owner&next=${encodeURIComponent(next)}`}>
                  Enter as product owner
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full rounded-full">
                <Link href="/api/demo/enter?as=tester">Enter as tester</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
