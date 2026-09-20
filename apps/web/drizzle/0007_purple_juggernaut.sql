CREATE TABLE "analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"study_id" text NOT NULL,
	"session_id" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"evidence_source" text NOT NULL,
	"outcome" text,
	"evidence_package" jsonb,
	"raw_responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_session_id" text,
	"provider_session_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"study_id" text NOT NULL,
	"study_revision" integer NOT NULL,
	"baseline_commit_sha" text NOT NULL,
	"title" text NOT NULL,
	"fingerprint" text NOT NULL,
	"category" text NOT NULL,
	"semantic_target" text NOT NULL,
	"observation" text NOT NULL,
	"hypothesis" text NOT NULL,
	"impact" text NOT NULL,
	"certainty" text NOT NULL,
	"limitations" jsonb NOT NULL,
	"suggested_experiment" text,
	"evidence" jsonb NOT NULL,
	"observed_session_count" integer NOT NULL,
	"eligible_session_count" integer NOT NULL,
	"provenance" text NOT NULL,
	"issue_repo" text,
	"issue_number" integer,
	"issue_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_publish_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"action" text NOT NULL,
	"skip_reason" text,
	"issue_number" integer,
	"issue_url" text,
	"observed_session_count" integer,
	"certainty" text,
	"repo_owner" text,
	"repo_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_publish_requests" ADD CONSTRAINT "issue_publish_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_publish_requests" ADD CONSTRAINT "issue_publish_requests_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_study_session_uq" ON "analysis_runs" USING btree ("study_id","session_id");--> statement-breakpoint
CREATE INDEX "analysis_runs_tenant_idx" ON "analysis_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_study_fingerprint_uq" ON "findings" USING btree ("study_id","fingerprint");--> statement-breakpoint
CREATE INDEX "findings_tenant_idx" ON "findings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_publish_requests_tenant_key_uq" ON "issue_publish_requests" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "issue_publish_requests_issue_repo_idx" ON "issue_publish_requests" USING btree ("issue_number","repo_owner","repo_name");