import { Shell } from "@/components/layout/shell";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  return (
    <Shell>
      <div className="mx-auto max-w-md pt-10">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-muted-foreground">We will send a one-time link. No passwords.</p>
        <div className="surface mt-8 p-6">
          <SignInForm next={next} />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Local development delivers links to the{" "}
          <a className="underline" href="/dev/inbox">
            test inbox
          </a>
          . No email is sent.
        </p>
      </div>
    </Shell>
  );
}
