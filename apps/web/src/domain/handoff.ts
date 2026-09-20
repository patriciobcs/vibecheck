/**
 * Where a participant goes after claiming: products that load the SDK host the dialog
 * themselves and receive the assignment token in a URL fragment (never sent to a server);
 * products without it use the hosted recorder page with the same dialog.
 */
export function participantDestination(input: {
  product: { url: string | null; embedMode: "sdk" | "hosted" };
  assignmentId: string;
  token: string;
}): string {
  if (!input.product.url) throw new Error("app_url_required");
  if (input.product.embedMode === "hosted") return `/a/${input.assignmentId}#vc=${input.token}`;
  const url = new URL(input.product.url);
  url.hash = `vc=${input.token}`;
  return url.toString();
}
