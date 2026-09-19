CREATE TABLE "evaluation_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"observation_session_id" text NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "evaluation_reservations_session_time_idx" ON "evaluation_reservations" USING btree ("observation_session_id","created_at");