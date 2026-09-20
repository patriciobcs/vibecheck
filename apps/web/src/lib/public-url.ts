import net from "node:net";
import { env } from "./env";

function privateAddress(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".local") || value === "::1") return true;
  if (net.isIPv4(value)) {
    const [a, b] = value.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (net.isIPv6(value))
    return (
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb")
    );
  return false;
}

export function publicDashboardUrl() {
  const configured = env().APP_BASE_URL ?? env().NEXT_PUBLIC_APP_URL;
  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol) || privateAddress(parsed.hostname))
      return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
