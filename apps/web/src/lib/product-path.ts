/** Canonical owner-UI product URL: the tenant-unique slug, with the id as fallback. */
export function productPath(p: { id: string; slug: string | null }, sub = "") {
  return `/products/${p.slug ?? p.id}${sub}`;
}

/** Appends Next.js searchParams to a path so id→slug redirects keep the query string. */
export function withSearchParams(
  base: string,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") qs.append(key, value);
    else if (Array.isArray(value)) for (const item of value) qs.append(key, item);
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}
