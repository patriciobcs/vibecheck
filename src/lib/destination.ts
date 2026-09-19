import dns from "node:dns/promises";
import net from "node:net";

type Resolver = (hostname: string) => Promise<string[]>;
const resolveAll: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);

function blockedAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIPv4(mapped)) return blockedAddress(mapped);
  }
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
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
  if (net.isIPv6(address)) {
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return true;
}

export function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".local") ||
    (net.isIP(normalized) > 0 && blockedAddress(normalized))
  );
}

export async function assertAllowedDestination(value: string, resolver: Resolver = resolveAll) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("invalid_url");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported_protocol");
  const addresses = await resolver(parsed.hostname);
  const allowLocal = process.env.ALLOW_LOCAL_TARGETS === "true";
  for (const address of addresses) {
    if (
      blockedAddress(address) &&
      !(allowLocal && (address === "127.0.0.1" || address === "::1"))
    ) {
      throw new Error("destination_not_allowed");
    }
  }
  return parsed;
}
