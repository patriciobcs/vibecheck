CREATE TABLE "experiment_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"study_id" text NOT NULL,
	"study_revision" integer NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"summary" jsonb NOT NULL,
	"narrative_raw" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text,
	"provider_session_id" text,
	"provider_session_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"study_id" text NOT NULL,
	"study_revision" integer NOT NULL,
	"event_id" text NOT NULL,
	"participant_ref" text NOT NULL,
	"kind" text NOT NULL,
	"session_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiment_summaries" ADD CONSTRAINT "experiment_summaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_summaries" ADD CONSTRAINT "experiment_summaries_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_events" ADD CONSTRAINT "participation_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_events" ADD CONSTRAINT "participation_events_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_summaries_study_rev_hash_uq" ON "experiment_summaries" USING btree ("study_id","study_revision","inputs_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_summaries_study_rev_revision_uq" ON "experiment_summaries" USING btree ("study_id","study_revision","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "participation_events_tenant_event_uq" ON "participation_events" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE INDEX "participation_events_study_rev_idx" ON "participation_events" USING btree ("study_id","study_revision");