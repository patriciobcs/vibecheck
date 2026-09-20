CREATE TYPE "public"."RepairMode" AS ENUM('issues_only', 'draft_pr', 'prototype_and_retest');--> statement-breakpoint
ALTER TABLE "CheckRun" DROP CONSTRAINT "CheckRun_repairRunId_RepairRun_id_fk";
--> statement-breakpoint
ALTER TABLE "RepairRun" ALTER COLUMN "mode" SET DATA TYPE "public"."RepairMode" USING "mode"::"public"."RepairMode";