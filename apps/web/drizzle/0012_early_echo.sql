ALTER TABLE "products" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "products" p SET "slug" = s.slug FROM (
  SELECT id,
    base || CASE WHEN row_number() OVER (PARTITION BY tenant_id, base ORDER BY created_at, id) = 1 THEN '' ELSE '-' || right(id, 4) END AS slug
  FROM (
    SELECT id, tenant_id, created_at,
      COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'product') AS base
    FROM "products"
  ) b
) s WHERE p.id = s.id AND p."slug" IS NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_slug_uq" ON "products" ("tenant_id", "slug");
