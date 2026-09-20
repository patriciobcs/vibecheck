CREATE TABLE "candidate_study_links" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"study_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detector_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"detector_id" text NOT NULL,
	"version" integer NOT NULL,
	"journey_id" text NOT NULL,
	"app_build_ref" text NOT NULL,
	"instrumentation_schema_version" text NOT NULL,
	"required_events" jsonb NOT NULL,
	"questions" jsonb NOT NULL,
	"evaluation_policy_ref" text NOT NULL,
	"provenance" text NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_budget_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"day" text NOT NULL,
	"evaluations" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jev_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"window_id" text NOT NULL,
	"detector_ref" text NOT NULL,
	"policy_ref" text NOT NULL,
	"request_hash" text NOT NULL,
	"requested_model" text NOT NULL,
	"returned_model" text,
	"provider_request_id" text,
	"trigger_reason" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"answers" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_micros" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monitoring_policy_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"revision" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"observation_session_id" text NOT NULL,
	"journey_instance_id" text NOT NULL,
	"journey_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"t_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"build_ref" text NOT NULL,
	"instrumentation_schema_version" text NOT NULL,
	"collection_policy_ref" text NOT NULL,
	"suppressed_until" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"observation_session_id" text NOT NULL,
	"journey_instance_id" text NOT NULL,
	"journey_id" text NOT NULL,
	"build_ref" text NOT NULL,
	"detector_ref" text NOT NULL,
	"policy_ref" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"event_ids" jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goal_source" text NOT NULL,
	"coverage" jsonb NOT NULL,
	"prior_progress_summary" jsonb,
	"trigger_reason" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"journey_id" text NOT NULL,
	"target_ref" text NOT NULL,
	"category" text NOT NULL,
	"baseline_build_ref" text NOT NULL,
	"detector_ref" text NOT NULL,
	"suspected_problem" text NOT NULL,
	"evaluation_refs" jsonb NOT NULL,
	"supporting_event_refs" jsonb NOT NULL,
	"evidence_limitations" jsonb NOT NULL,
	"distinct_observation_sessions" integer NOT NULL,
	"distinct_journey_instances" integer NOT NULL,
	"latest_friction_permille" integer,
	"latest_research_permille" integer,
	"state" text NOT NULL,
	"state_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_study_links" ADD CONSTRAINT "candidate_study_links_candidate_id_research_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."research_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detector_definitions" ADD CONSTRAINT "detector_definitions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jev_evaluations" ADD CONSTRAINT "jev_evaluations_window_id_observation_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."observation_windows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_policy_revisions" ADD CONSTRAINT "monitoring_policy_revisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_events" ADD CONSTRAINT "observation_events_observation_session_id_observation_sessions_id_fk" FOREIGN KEY ("observation_session_id") REFERENCES "public"."observation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_sessions" ADD CONSTRAINT "observation_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_candidates" ADD CONSTRAINT "research_candidates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_study_links_uq" ON "candidate_study_links" USING btree ("candidate_id","study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "detector_definitions_product_detector_version_uq" ON "detector_definitions" USING btree ("product_id","detector_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_budget_ledger_product_day_uq" ON "evaluation_budget_ledger" USING btree ("product_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "jev_evaluations_request_hash_uq" ON "jev_evaluations" USING btree ("request_hash");--> statement-breakpoint
CREATE INDEX "jev_evaluations_product_time_idx" ON "jev_evaluations" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_events_session_seq_uq" ON "observation_events" USING btree ("observation_session_id","sequence");--> statement-breakpoint
CREATE INDEX "observation_events_journey_idx" ON "observation_events" USING btree ("journey_instance_id","t_ms");--> statement-breakpoint
CREATE INDEX "observation_sessions_product_idx" ON "observation_sessions" USING btree ("product_id","last_event_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_windows_hash_detector_uq" ON "observation_windows" USING btree ("content_hash","detector_ref");--> statement-breakpoint
CREATE INDEX "observation_windows_journey_idx" ON "observation_windows" USING btree ("journey_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_candidates_group_uq" ON "research_candidates" USING btree ("product_id","journey_id","target_ref","category","baseline_build_ref","detector_ref");