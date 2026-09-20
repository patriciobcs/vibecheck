import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const demo = env().demo;
  return (
    <Shell>
      <div className="mx-auto max-w-md pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-muted-foreground">We will send a one-time link. No passwords.</p>
        {demo ? (
          <div className="surface mt-8 p-6">
            <p className="text-sm font-medium">Try the demo without an account</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Two seeded identities. The product owner runs the Excalidraw workspace; the tester
              takes studies. Demo data is labeled as such.
            </p>
            <div className="mt-4 grid gap-2">
              <Button asChild className="w-full rounded-full">
                <Link
                  href={`/api/demo/enter?as=owner${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`}
                >
                  Enter as product owner
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full rounded-full">
                <Link href="/api/demo/enter?as=tester">Enter as tester</Link>
              </Button>
            </div>
          </div>
        ) : null}
        <div className="surface mt-6 p-6">
          <SignInForm next={next} showInbox={!demo} />
        </div>
        {!demo ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Local development delivers links to the{" "}
            <a className="underline" href="/dev/inbox">
              test inbox
            </a>
            . No email is sent.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
