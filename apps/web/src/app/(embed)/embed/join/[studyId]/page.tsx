import { env } from "@/lib/env";
import { EmbeddedJoin } from "./embedded-join";

export const dynamic = "force-dynamic";

/** Toast acceptance: create/reuse a device participant, claim the study, then run the dialog. */
export default async function EmbedJoinPage({
  params,
  searchParams,
}: PageProps<"/embed/join/[studyId]">) {
  const { studyId } = await params;
  const sp = await searchParams;
  const key = typeof sp.key === "string" ? sp.key : "";
  return (
    <EmbeddedJoin studyId={studyId} publishableKey={key} providersReady={env().vonage !== null} />
  );
}
