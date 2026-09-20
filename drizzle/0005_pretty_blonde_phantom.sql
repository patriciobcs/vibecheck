CREATE TYPE "public"."CheckStatus" AS ENUM('passed', 'failed', 'error');--> statement-breakpoint
CREATE TYPE "public"."RepairMode" AS ENUM('issues_only', 'draft_pr', 'prototype_and_retest');--> statement-breakpoint
CREATE TYPE "public"."RepairStatus" AS ENUM('queued', 'preparing', 'reproducing', 'implementing', 'validating', 'retrying', 'deploying', 'draft_pr_ready', 'preview_ready', 'blocked', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "CheckRun" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"repairRunId" text NOT NULL,
	"attempt" integer NOT NULL,
	"commitSha" text NOT NULL,
	"validatorVersion" text NOT NULL,
	"status" "CheckStatus" NOT NULL,
	"results" jsonb NOT NULL,
	"diagnostics" text,
	"startedAt" timestamp NOT NULL,
	"finishedAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Preview" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"repairRunId" text NOT NULL,
	"candidateCommitSha" text NOT NULL,
	"provider" text NOT NULL,
	"deploymentId" text NOT NULL,
	"url" text NOT NULL,
	"healthStatus" text NOT NULL,
	"fixtureRef" text NOT NULL,
	"accessPolicy" text DEFAULT 'assigned_only' NOT NULL,
	"expiresAt" timestamp,
	"cleanupStatus" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RepairRun" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"findingId" text NOT NULL,
	"studyId" text NOT NULL,
	"studyRevision" integer NOT NULL,
	"issueRepo" text NOT NULL,
	"issueNumber" integer NOT NULL,
	"mode" "RepairMode" NOT NULL,
	"baseCommitSha" text NOT NULL,
	"candidateCommitSha" text,
	"branch" text,
	"devinSessionId" text,
	"devinSessionUrl" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"maxAttempts" integer NOT NULL,
	"validatorVersion" text NOT NULL,
	"pullRequestNumber" integer,
	"pullRequestUrl" text,
	"previewId" text,
	"status" "RepairStatus" DEFAULT 'queued' NOT NULL,
	"blockedReason" text,
	"lastOutput" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "RepairRun_findingId_key" UNIQUE("findingId")
);
--> statement-breakpoint
ALTER TABLE "CheckRun" ADD CONSTRAINT "CheckRun_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "CheckRun" ADD CONSTRAINT "CheckRun_repairRunId_RepairRun_id_fk" FOREIGN KEY ("repairRunId") REFERENCES "public"."RepairRun"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Preview" ADD CONSTRAINT "Preview_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RepairRun" ADD CONSTRAINT "RepairRun_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RepairRun" ADD CONSTRAINT "RepairRun_findingId_Finding_id_fk" FOREIGN KEY ("findingId") REFERENCES "public"."Finding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RepairRun" ADD CONSTRAINT "RepairRun_studyId_Study_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."Study"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CheckRun_repairRunId_idx" ON "CheckRun" USING btree ("repairRunId");--> statement-breakpoint
CREATE INDEX "Preview_repairRunId_idx" ON "Preview" USING btree ("repairRunId");--> statement-breakpoint
CREATE INDEX "RepairRun_tenantId_idx" ON "RepairRun" USING btree ("tenantId");