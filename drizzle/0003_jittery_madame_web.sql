ALTER TYPE "public"."IssueAction" ADD VALUE 'unchanged' BEFORE 'skipped';--> statement-breakpoint
ALTER TABLE "IssuePublishRequest" ADD COLUMN "observedSessionCount" integer;--> statement-breakpoint
ALTER TABLE "IssuePublishRequest" ADD COLUMN "certainty" text;--> statement-breakpoint
ALTER TABLE "IssuePublishRequest" ADD COLUMN "repoOwner" text;--> statement-breakpoint
ALTER TABLE "IssuePublishRequest" ADD COLUMN "repoName" text;