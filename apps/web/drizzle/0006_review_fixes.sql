DROP INDEX "observation_events_journey_idx";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "transcript_status" text;--> statement-breakpoint
ALTER TABLE "jev_evaluations" ADD COLUMN "reservation_id" text;--> statement-breakpoint
ALTER TABLE "jev_evaluations" ADD COLUMN "reserved_micros" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jev_evaluations" ADD COLUMN "estimated_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "observation_events" ADD COLUMN "event_id" text;--> statement-breakpoint
UPDATE "observation_events" SET "event_id" = "id" WHERE "event_id" IS NULL;--> statement-breakpoint
ALTER TABLE "observation_events" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "observation_events_session_event_uq" ON "observation_events" USING btree ("observation_session_id","event_id");--> statement-breakpoint
CREATE INDEX "observation_events_journey_idx" ON "observation_events" USING btree ("observation_session_id","journey_instance_id","sequence");