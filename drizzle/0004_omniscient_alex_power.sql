ALTER TABLE "Finding" ADD COLUMN "title" text;--> statement-breakpoint
UPDATE "Finding" SET "title" = 'UX finding: ' || "semanticTarget" WHERE "title" IS NULL;--> statement-breakpoint
ALTER TABLE "Finding" ALTER COLUMN "title" SET NOT NULL;