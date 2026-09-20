const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{32,}$/;

/** Drop query strings and fragments and mask token-like path segments (VC-02 navigation events). */
export function scrubUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return "invalid";
  }
  const path = url.pathname
    .split("/")
    .map((seg) => (TOKEN_SEGMENT.test(seg) ? "[token]" : seg))
    .join("/");
  return `${url.origin}${path}`;
}
export type TargetInfo = {
  tag: string;
  testId: string | null;
  id: string | null;
  role: string | null;
  text: string | null;
};

const LABEL_TAGS = new Set(["button", "a", "summary"]);
const MAX_LABEL = 18;

/**
 * Builds a "safe target identity" for an event: stable selectors only, never field content.
 * Short labels are kept for buttons/links because they identify controls, not user data.
 */
export function safeTargetRef(t: TargetInfo): string {
  const tag = t.tag.toLowerCase();
  if (t.testId) return `${tag}[data-testid=${t.testId}]`;
  if (t.id) return `${tag}#${t.id}`;
  if (t.role) return `${tag}[role=${t.role}]`;
  if (LABEL_TAGS.has(tag) && t.text) {
    const label = t.text.trim().replace(/\s+/g, " ");
    const short = label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL)}…` : label;
    return `${tag}:"${short}"`;
  }
  return tag;
}
