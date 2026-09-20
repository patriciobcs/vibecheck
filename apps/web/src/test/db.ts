import { sql as dsql } from "drizzle-orm";
import { db } from "@/db/client";

const TABLES = [
  "evaluation_reservations",
  "candidate_study_links",
  "research_candidates",
  "jev_evaluations",
  "observation_windows",
  "observation_events",
  "observation_sessions",
  "monitoring_policy_revisions",
  "detector_definitions",
  "evaluation_budget_ledger",
  "publish_requests",
  "proposals",
  "discovery_runs",
  "api_keys",
  "audit_events",
  "webhook_receipts",
  "event_outbox",
  "jobs",
  "notification_outbox",
  "credit_ledger",
  "transcript_segments",
  "event_batches",
  "session_events",
  "assets",
  "sessions",
  "assignments",
  "invitation_deliveries",
  "invitations",
  "participants",
  "study_revisions",
  "studies",
  "products",
  "memberships",
  "tenants",
  "verification",
  "account",
  "session",
  '"user"',
];

/** Integration tests run against the local Supabase Postgres. Wipes every app table. */
export async function resetDb() {
  await db.execute(dsql.raw(`TRUNCATE TABLE ${TABLES.join(", ")} CASCADE`));
}
