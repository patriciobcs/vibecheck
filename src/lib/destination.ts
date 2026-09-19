import dns from "node:dns/promises";
import net from "node:net";

type Resolver = (hostname: string) => Promise<string[]>;
const resolveAll: Resolver = async (hostname) => (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);

function blockedAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "0.0.0.0" || normalized === "::1" || normalized === "::") return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIPv6(address)) {
    return normalized.startsWith("fc") || normalized.startsWith("fd") ||
      normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  return true;
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
    if (blockedAddress(address) && !(allowLocal && (address === "127.0.0.1" || address === "::1"))) {
      throw new Error("destination_not_allowed");
    }
  }
  return parsed;
}

export async function checkedFetch(value: string, init?: RequestInit, resolver?: Resolver) {
  let current = value;
  for (let hop = 0; hop <= 3; hop += 1) {
    await assertAllowedDestination(current, resolver);
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    if (hop === 3) throw new Error("too_many_redirects");
    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current).toString();
  }
  throw new Error("too_many_redirects");
}
