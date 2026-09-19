import { desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Shell } from "@/components/layout/shell";
import { db, schema } from "@/db/client";

export const dynamic = "force-dynamic";

/** Local-only inbox: shows queued magic links and invitations so nothing is emailed in development. */
export default async function DevInbox() {
  if (process.env.NODE_ENV === "production") notFound();
  const messages = await db.query.notificationOutbox.findMany({
    orderBy: desc(schema.notificationOutbox.createdAt),
    limit: 30,
  });
  return (
    <Shell>
      <h1 className="text-3xl font-semibold tracking-tight">Test inbox</h1>
      <p className="mt-2 text-muted-foreground">
        Messages that would have been emailed. Development only.
      </p>
      <ul className="mt-8 space-y-3">
        {messages.length === 0 ? (
          <li className="text-sm text-muted-foreground">Nothing yet.</li>
        ) : null}
        {messages.map((m) => (
          <li key={m.id} className="surface p-5">
            <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
              <span>To {m.toEmail}</span>
              <span>{m.createdAt.toLocaleString()}</span>
            </div>
            <p className="mt-1 font-medium">{m.subject}</p>
            {m.actionUrl ? (
              <a
                href={m.actionUrl}
                className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Open link
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </Shell>
  );
}
