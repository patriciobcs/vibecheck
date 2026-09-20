ALTER TABLE "Preview" DROP CONSTRAINT "Preview_repairRunId_RepairRun_id_fk";
--> statement-breakpoint
ALTER TABLE "CheckRun" ADD CONSTRAINT "CheckRun_repairRunId_RepairRun_id_fk" FOREIGN KEY ("repairRunId") REFERENCES "public"."RepairRun"("id") ON DELETE cascade ON UPDATE no action;