CREATE TYPE "public"."AnalysisStatus" AS ENUM('queued', 'analysing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."FindingCertainty" AS ENUM('insufficient_evidence', 'preliminary', 'repeated_observation', 'contradictory');--> statement-breakpoint
CREATE TYPE "public"."IssueAction" AS ENUM('created', 'updated', 'skipped');--> statement-breakpoint
CREATE TABLE "AnalysisRun" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"studyId" text NOT NULL,
	"sessionId" text NOT NULL,
	"status" "AnalysisStatus" NOT NULL,
	"provider" "DiscoveryProvider" NOT NULL,
	"outcome" text,
	"evidencePackage" jsonb,
	"rawResponses" jsonb NOT NULL,
	"providerSessionId" text,
	"providerSessionUrl" text,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "AnalysisRun_studyId_sessionId_key" UNIQUE("studyId","sessionId")
);
--> statement-breakpoint
CREATE TABLE "Finding" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"studyId" text NOT NULL,
	"studyRevision" integer NOT NULL,
	"baselineCommitSha" text NOT NULL,
	"fingerprint" text NOT NULL,
	"category" text NOT NULL,
	"semanticTarget" text NOT NULL,
	"observation" text NOT NULL,
	"hypothesis" text NOT NULL,
	"impact" text NOT NULL,
	"certainty" "FindingCertainty" NOT NULL,
	"limitations" text[] NOT NULL,
	"suggestedExperiment" text,
	"evidence" jsonb NOT NULL,
	"observedSessionCount" integer NOT NULL,
	"eligibleSessionCount" integer NOT NULL,
	"provenance" text NOT NULL,
	"issueRepo" text,
	"issueNumber" integer,
	"issueUrl" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Finding_studyId_fingerprint_key" UNIQUE("studyId","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "IssuePublishRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"findingId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"action" "IssueAction" NOT NULL,
	"issueNumber" integer,
	"issueUrl" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "IssuePublishRequest_tenantId_idempotencyKey_key" UNIQUE("tenantId","idempotencyKey")
);
--> statement-breakpoint
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_studyId_Study_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_studyId_Study_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "IssuePublishRequest" ADD CONSTRAINT "IssuePublishRequest_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "IssuePublishRequest" ADD CONSTRAINT "IssuePublishRequest_findingId_Finding_id_fk" FOREIGN KEY ("findingId") REFERENCES "public"."Finding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AnalysisRun_tenantId_idx" ON "AnalysisRun" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "Finding_tenantId_idx" ON "Finding" USING btree ("tenantId");