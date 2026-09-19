import dns from "node:dns/promises";
import net from "node:net";

type Resolver = (hostname: string) => Promise<string[]>;
const resolveAll: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true })).map((e) => e.address);

/** Loopback, RFC 1918, link-local, 0.0.0.0/8, carrier-grade NAT and their IPv4-mapped IPv6 forms. */
function blockedAddress(address: string): boolean {
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
      (a === 100 && (b ?? 0) >= 64 && (b ?? 0) <= 127) ||
      (a === 172 && (b ?? 0) >= 16 && (b ?? 0) <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (net.isIPv6(address)) return /^(fc|fd|fe[89ab])/.test(normalized);
  return true;
}

/**
 * Server-side destination rule (VC-01): product URLs and origins must resolve to public addresses
 * before any backend fetch. `ALLOW_LOCAL_TARGETS=true` is a development-only opt-in for loopback.
 */
export async function assertAllowedDestination(
  value: string,
  resolver: Resolver = resolveAll,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("invalid_url");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported_protocol");
  const allowLocal = process.env.ALLOW_LOCAL_TARGETS === "true";
  const addresses = await resolver(parsed.hostname);
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
