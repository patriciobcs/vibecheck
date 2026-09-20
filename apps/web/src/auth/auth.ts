import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { lazy } from "@/lib/lazy";
import { sendEmail } from "@/providers/email";

/** Built on first use so importing this module (e.g. during `next build`) needs no environment. */
export const auth: ReturnType<typeof createAuth> = lazy(createAuth);

function createAuth() {
  return betterAuth({
    baseURL: env().BETTER_AUTH_URL ?? env().appUrl,
    secret: env().BETTER_AUTH_SECRET,
    // The app may be opened through the public tunnel hostname in development.
    trustedOrigins: [env().appUrl, env().webhookBaseUrl].filter((v, i, a) => a.indexOf(v) === i),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: false },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          await sendEmail({
            to: email,
            subject: "Your Seamless UX sign-in link",
            text: `Open this link to sign in (valid 15 minutes):\n${url}`,
            actionUrl: url,
          });
        },
      }),
      nextCookies(),
    ],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
