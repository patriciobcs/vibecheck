CREATE TYPE "public"."check_status" AS ENUM('passed', 'failed', 'error');--> statement-breakpoint
CREATE TABLE "check_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"repair_run_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"commit_sha" text NOT NULL,
	"validator_version" text NOT NULL,
	"status" "check_status" NOT NULL,
	"results" jsonb NOT NULL,
	"diagnostics" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "previews" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"repair_run_id" text NOT NULL,
	"candidate_commit_sha" text NOT NULL,
	"provider" text NOT NULL,
	"deployment_id" text NOT NULL,
	"url" text NOT NULL,
	"health_status" text NOT NULL,
	"fixture_ref" text NOT NULL,
	"access_policy" text DEFAULT 'assigned_only' NOT NULL,
	"expires_at" timestamp with time zone,
	"cleanup_status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"study_id" text NOT NULL,
	"study_revision" integer NOT NULL,
	"issue_repo" text NOT NULL,
	"issue_number" integer NOT NULL,
	"mode" text NOT NULL,
	"base_commit_sha" text NOT NULL,
	"candidate_commit_sha" text,
	"branch" text,
	"devin_session_id" text,
	"devin_session_url" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer NOT NULL,
	"validator_version" text NOT NULL,
	"pull_request_number" integer,
	"pull_request_url" text,
	"preview_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"blocked_reason" text,
	"last_output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_repair_run_id_repair_runs_id_fk" FOREIGN KEY ("repair_run_id") REFERENCES "public"."repair_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_repair_run_id_repair_runs_id_fk" FOREIGN KEY ("repair_run_id") REFERENCES "public"."repair_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_runs" ADD CONSTRAINT "repair_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_runs" ADD CONSTRAINT "repair_runs_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_runs" ADD CONSTRAINT "repair_runs_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_runs_repair_run_idx" ON "check_runs" USING btree ("repair_run_id");--> statement-breakpoint
CREATE INDEX "previews_repair_run_idx" ON "previews" USING btree ("repair_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_runs_finding_uq" ON "repair_runs" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "repair_runs_tenant_idx" ON "repair_runs" USING btree ("tenant_id");