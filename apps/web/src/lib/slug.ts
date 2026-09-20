/** Tenant-unique product slug: lowercase, non-alphanumeric runs collapse to `-`. */
export function slugify(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "product";
}
