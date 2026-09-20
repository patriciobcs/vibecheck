CREATE TYPE "public"."SignalSeverity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
ALTER TYPE "public"."JobStatus" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "AuditEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text NOT NULL,
	"details" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Signal" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"productId" text NOT NULL,
	"signalId" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" "SignalSeverity" NOT NULL,
	"semanticTarget" text NOT NULL,
	"observedSessions" integer,
	"windowStart" timestamp NOT NULL,
	"windowEnd" timestamp NOT NULL,
	"evidenceRef" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Signal_tenantId_signalId_key" UNIQUE("tenantId","signalId")
);
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN "pausedAt" timestamp;--> statement-breakpoint
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_productId_Product_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AuditEvent_tenantId_idx" ON "AuditEvent" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "Signal_tenantId_productId_idx" ON "Signal" USING btree ("tenantId","productId");