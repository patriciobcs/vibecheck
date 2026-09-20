CREATE TYPE "public"."ParticipationKind" AS ENUM('invited', 'accepted', 'dismissed', 'started', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."SummaryStatus" AS ENUM('collecting', 'summarized', 'insufficient_data', 'failed');--> statement-breakpoint
CREATE TABLE "ExperimentSummary" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"studyId" text NOT NULL,
	"studyRevision" integer NOT NULL,
	"revision" integer NOT NULL,
	"status" "SummaryStatus" NOT NULL,
	"inputsHash" text NOT NULL,
	"summary" jsonb NOT NULL,
	"narrativeRaw" jsonb NOT NULL,
	"provider" text,
	"providerSessionId" text,
	"providerSessionUrl" text,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ExperimentSummary_studyId_revision_key" UNIQUE("studyId","studyRevision","revision"),
	CONSTRAINT "ExperimentSummary_studyId_inputsHash_key" UNIQUE("studyId","studyRevision","inputsHash")
);
--> statement-breakpoint
CREATE TABLE "ParticipationEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"studyId" text NOT NULL,
	"studyRevision" integer NOT NULL,
	"eventId" text NOT NULL,
	"participantRef" text NOT NULL,
	"kind" "ParticipationKind" NOT NULL,
	"sessionId" text,
	"occurredAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ParticipationEvent_tenantId_eventId_key" UNIQUE("tenantId","eventId"),
	CONSTRAINT "ParticipationEvent_studyId_revision_participant_kind_key" UNIQUE("studyId","studyRevision","participantRef","kind")
);
--> statement-breakpoint
ALTER TABLE "Study" ADD COLUMN "latestSummaryId" text;--> statement-breakpoint
ALTER TABLE "ExperimentSummary" ADD CONSTRAINT "ExperimentSummary_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ExperimentSummary" ADD CONSTRAINT "ExperimentSummary_studyId_Study_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ParticipationEvent" ADD CONSTRAINT "ParticipationEvent_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ParticipationEvent" ADD CONSTRAINT "ParticipationEvent_studyId_Study_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ExperimentSummary_tenantId_idx" ON "ExperimentSummary" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "ParticipationEvent_tenantId_idx" ON "ParticipationEvent" USING btree ("tenantId");