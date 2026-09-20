export function safeReturnPath(value: unknown, fallback = "/products"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  try {
    const url = new URL(value, "https://seamless.invalid");
    return url.origin === "https://seamless.invalid" && url.pathname !== "/sign-in"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
