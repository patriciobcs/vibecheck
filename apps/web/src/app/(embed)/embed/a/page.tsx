import { env } from "@/lib/env";
import { EmbeddedAssignment } from "./embedded-assignment";

export const dynamic = "force-dynamic";

/** Dialog for a handed-off assignment. The token arrives in the URL fragment, read on the client. */
export default function EmbedAssignmentPage() {
  return <EmbeddedAssignment providersReady={env().vonage !== null} />;
}
