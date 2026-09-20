CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text,
	"provider_session_url" text,
	"source_revision" text NOT NULL,
	"outcome" text,
	"outcome_reason" text,
	"raw_responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correction_attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"source_candidate_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"discovery_run_id" text NOT NULL,
	"task_id" text NOT NULL,
	"research_question" text NOT NULL,
	"participant_prompt" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"evidence_type" text NOT NULL,
	"eligibility_rule_ref" text NOT NULL,
	"success_rule_ref" text NOT NULL,
	"uncertainties" jsonb NOT NULL,
	"estimated_duration_seconds" integer,
	"confidence" text,
	"source_candidate_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"study_id" text NOT NULL,
	"response_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "audience" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "repo_binding" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "release_notes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "support_complaints" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "known_journeys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_events" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "setup_error" text;--> statement-breakpoint
ALTER TABLE "study_revisions" ADD COLUMN "discovery_run_id" text;--> statement-breakpoint
ALTER TABLE "study_revisions" ADD COLUMN "source_candidate_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_discovery_run_id_discovery_runs_id_fk" FOREIGN KEY ("discovery_run_id") REFERENCES "public"."discovery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_runs_product_idx" ON "discovery_runs" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_run_task_uq" ON "proposals" USING btree ("discovery_run_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_requests_tenant_key_uq" ON "publish_requests" USING btree ("tenant_id","idempotency_key");