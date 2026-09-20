CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider_archive_id" text,
	"provider_status" text,
	"status" text NOT NULL,
	"offset_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"size_bytes" integer,
	"storage_path" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_provider_archive_id_unique" UNIQUE("provider_archive_id")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"study_id" text NOT NULL,
	"study_revision" integer NOT NULL,
	"participant_id" text NOT NULL,
	"channel" text NOT NULL,
	"cohort" text NOT NULL,
	"tested_commit_sha" text NOT NULL,
	"environment_ref" text NOT NULL,
	"fixture_ref" text NOT NULL,
	"state" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"consent_version" text,
	"consented_at" timestamp with time zone,
	"capture_policy" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"batch_sequence" integer NOT NULL,
	"event_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "invitation_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"study_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"channel" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"study_id" text NOT NULL,
	"study_revision" integer NOT NULL,
	"token_hash" text NOT NULL,
	"channel" text NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"action_url" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"invitations_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"permitted_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publishable_key" text NOT NULL,
	"invitation_cooldown_days" integer DEFAULT 7 NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_publishable_key_unique" UNIQUE("publishable_key")
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"t_ms" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"media_session_id" text,
	"media_provider" text,
	"stt_provider" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"client_clock_origin_ms" integer,
	"pauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completeness" text DEFAULT 'pending' NOT NULL,
	"instrumentation" text NOT NULL,
	"participant_reported_outcome" text DEFAULT 'unknown' NOT NULL,
	"instrumented_outcome" text DEFAULT 'unknown' NOT NULL,
	"perceived_difficulty" integer,
	"comments" text,
	"moderation_prompts" integer DEFAULT 0 NOT NULL,
	"transcript_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_assignment_id_unique" UNIQUE("assignment_id")
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"status" text NOT NULL,
	"current_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"study_id" text NOT NULL,
	"revision" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"provenance" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	"confidence_permille" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_revisions" ADD CONSTRAINT "study_revisions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "assets_session_idx" ON "assets" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_participant_study_uq" ON "assignments" USING btree ("participant_id","study_id");--> statement-breakpoint
CREATE INDEX "assignments_study_idx" ON "assignments" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_assignment_reason_uq" ON "credit_ledger" USING btree ("assignment_id","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "event_batches_session_seq_uq" ON "event_batches" USING btree ("session_id","batch_sequence");--> statement-breakpoint
CREATE INDEX "invitation_deliveries_participant_product_idx" ON "invitation_deliveries" USING btree ("participant_id","product_id");--> statement-breakpoint
CREATE INDEX "invitations_study_idx" ON "invitations" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "jobs_status_next_run_idx" ON "jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_uq" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_user_uq" ON "participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_session_seq_uq" ON "session_events" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "sessions_media_session_idx" ON "sessions" USING btree ("media_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_revisions_study_rev_uq" ON "study_revisions" USING btree ("study_id","revision");--> statement-breakpoint
CREATE INDEX "transcript_segments_session_idx" ON "transcript_segments" USING btree ("session_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_receipts_provider_key_uq" ON "webhook_receipts" USING btree ("provider","dedupe_key");