ALTER TABLE "participants" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "device_token_hash" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "embed_mode" text DEFAULT 'hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_device_token_hash_unique" UNIQUE("device_token_hash");