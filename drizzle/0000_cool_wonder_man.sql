CREATE TYPE "public"."DiscoveryOutcome" AS ENUM('proposed', 'cannot_assess', 'needs_setup');--> statement-breakpoint
CREATE TYPE "public"."DiscoveryProvider" AS ENUM('fixture', 'devin');--> statement-breakpoint
CREATE TYPE "public"."DiscoveryStatus" AS ENUM('queued', 'inspecting', 'proposed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."JobStatus" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ProductStatus" AS ENUM('draft', 'connecting', 'ready', 'needs_setup');--> statement-breakpoint
CREATE TYPE "public"."StudyStatus" AS ENUM('draft', 'published', 'recruiting');--> statement-breakpoint
CREATE TABLE "ApiKey" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"keyHash" text NOT NULL,
	"label" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ApiKey_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
CREATE TABLE "DiscoveryRun" (
	"id" text PRIMARY KEY NOT NULL,
	"productId" text NOT NULL,
	"tenantId" text NOT NULL,
	"status" "DiscoveryStatus" NOT NULL,
	"provider" "DiscoveryProvider" NOT NULL,
	"providerSessionId" text,
	"providerSessionUrl" text,
	"sourceRevision" text NOT NULL,
	"outcome" "DiscoveryOutcome",
	"outcomeReason" text,
	"rawResponses" jsonb NOT NULL,
	"correctionAttempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Job" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"tenantId" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "JobStatus" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 3 NOT NULL,
	"leaseUntil" timestamp,
	"lockedBy" text,
	"nextRunAt" timestamp DEFAULT now() NOT NULL,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OutboxEvent" (
	"idempotencyKey" text PRIMARY KEY NOT NULL,
	"eventId" text NOT NULL,
	"eventType" text NOT NULL,
	"tenantId" text NOT NULL,
	"productId" text NOT NULL,
	"correlationId" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurredAt" timestamp NOT NULL,
	"publishedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "OutboxEvent_eventId_unique" UNIQUE("eventId")
);
--> statement-breakpoint
CREATE TABLE "Product" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"url" text NOT NULL,
	"permittedOrigins" text[] NOT NULL,
	"language" text NOT NULL,
	"audience" text NOT NULL,
	"repoBinding" jsonb,
	"releaseNotes" jsonb NOT NULL,
	"supportComplaints" jsonb NOT NULL,
	"knownJourneys" jsonb NOT NULL,
	"productEvents" jsonb NOT NULL,
	"status" "ProductStatus" NOT NULL,
	"setupError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"discoveryRunId" text NOT NULL,
	"tenantId" text NOT NULL,
	"taskId" text NOT NULL,
	"researchQuestion" text NOT NULL,
	"participantPrompt" text NOT NULL,
	"rationale" text NOT NULL,
	"evidenceRefs" text[] NOT NULL,
	"evidenceType" text NOT NULL,
	"eligibilityRuleRef" text NOT NULL,
	"successRuleRef" text NOT NULL,
	"uncertainties" text[] NOT NULL,
	"estimatedDurationSeconds" integer,
	"confidence" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Proposal_discoveryRunId_taskId_key" UNIQUE("discoveryRunId","taskId")
);
--> statement-breakpoint
CREATE TABLE "PublishRequest" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"studyId" text NOT NULL,
	"responseHash" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "PublishRequest_tenantId_idempotencyKey_key" UNIQUE("tenantId","idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "Study" (
	"id" text PRIMARY KEY NOT NULL,
	"productId" text NOT NULL,
	"tenantId" text NOT NULL,
	"status" "StudyStatus" NOT NULL,
	"currentRevision" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StudyPlanRevision" (
	"id" text PRIMARY KEY NOT NULL,
	"studyId" text NOT NULL,
	"revision" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"publishedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "StudyPlanRevision_studyId_revision_key" UNIQUE("studyId","revision")
);
--> statement-breakpoint
CREATE TABLE "Tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_discoveryRunId_DiscoveryRun_id_fk" FOREIGN KEY ("discoveryRunId") REFERENCES "public"."DiscoveryRun"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PublishRequest" ADD CONSTRAINT "PublishRequest_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PublishRequest" ADD CONSTRAINT "PublishRequest_studyId_Study_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Study" ADD CONSTRAINT "Study_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Study" ADD CONSTRAINT "Study_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StudyPlanRevision" ADD CONSTRAINT "StudyPlanRevision_studyId_Study_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "DiscoveryRun_tenantId_idx" ON "DiscoveryRun" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "Job_status_nextRunAt_idx" ON "Job" USING btree ("status","nextRunAt");