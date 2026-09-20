/**
 * postMessage contract between the host page SDK and the VibeCheck dialog iframe.
 * Both sides validate `event.origin` before acting on any of these.
 */
export type DialogMode = "modal" | "panel" | "hidden";

export type DialogToHostMessage =
  | { type: "vibecheck:ui"; mode: DialogMode; height?: number }
  | { type: "vibecheck:session"; sessionId: string; clockOriginMs: number; eventsToken: string }
  | { type: "vibecheck:stop" }
  | { type: "vibecheck:close" };

export type HostToDialogMessage =
  | { type: "vibecheck:host"; instrumented: boolean }
  | { type: "vibecheck:instrumented" };

export const HANDOFF_FRAGMENT_KEY = "vc";

/** Reads `#vc=<token>` from a fragment string and returns the token (or null). */
export function readHandoffFragment(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get(HANDOFF_FRAGMENT_KEY);
  return token && token.length > 0 ? token : null;
}
