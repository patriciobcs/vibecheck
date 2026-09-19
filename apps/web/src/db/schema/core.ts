import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").defaultNow().notNull();

/* ---------------- Tenancy ---------------- */

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Global pause: blocks new invitations and side effects (VC-01/06). */
  paused: boolean("paused").default(false).notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "researcher", "viewer"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId)],
);

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** Explicit web origins allowed to load the embedded SDK. */
  permittedOrigins: jsonb("permitted_origins")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Origin-bound publishable key: identifies the app, grants nothing else. */
  publishableKey: text("publishable_key").notNull().unique(),
  invitationCooldownDays: integer("invitation_cooldown_days").default(7).notNull(),
  /** sdk: the product loads the embedded script and hosts the participant dialog; hosted: VibeCheck page + new window (video-only). */
  embedMode: text("embed_mode", { enum: ["sdk", "hosted"] })
    .default("hosted")
    .notNull(),
  /** Marked when the product is seeded sample data. */
  sample: boolean("sample").default(false).notNull(),
  createdAt: createdAt(),
});

/* ---------------- Studies ---------------- */

export const studies = pgTable("studies", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["draft", "published", "recruiting", "testing", "closed"],
  }).notNull(),
  currentRevision: integer("current_revision").notNull(),
  createdAt: createdAt(),
});

/** Immutable StudyPlan JSON per revision (VC-01 → VC-02 handoff). */
export const studyRevisions = pgTable(
  "study_revisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    plan: jsonb("plan").notNull(),
    /** Provenance: "vc01" for a real handoff, "sample" for seeded data. */
    provenance: text("provenance", { enum: ["vc01", "sample"] }).notNull(),
    publishedAt: ts("published_at").notNull(),
  },
  (t) => [uniqueIndex("study_revisions_study_rev_uq").on(t.studyId, t.revision)],
);

/* ---------------- Participants and invitations ---------------- */

export const participants = pgTable(
  "participants",
  {
    id: text("id").primaryKey(),
    /** Signed-in participants (direct link, marketplace). Null for anonymous device participants. */
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    /** SHA-256 of the device token held by the embedded dialog. Null for signed-in participants. */
    deviceTokenHash: text("device_token_hash").unique(),
    /** Participant agreed to receive invitations (required before any notification). */
    invitationsOptIn: boolean("invitations_opt_in").default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("participants_user_uq").on(t.userId)],
);

/** Direct-link invitation tokens. The token itself is hashed at rest. */
export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    studyRevision: integer("study_revision").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    channel: text("channel", { enum: ["direct_link", "embedded"] }).notNull(),
    /** Max assignments this invitation can create; null = unlimited until study target. */
    maxUses: integer("max_uses"),
    uses: integer("uses").default(0).notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_study_idx").on(t.studyId)],
);

/** Every time a participant is shown/sent an invitation for a product (cooldown source). */
export const invitationDeliveries = pgTable(
  "invitation_deliveries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    studyId: text("study_id").notNull(),
    participantId: text("participant_id").notNull(),
    channel: text("channel", { enum: ["direct_link", "embedded", "marketplace"] }).notNull(),
    outcome: text("outcome", { enum: ["shown", "dismissed", "accepted"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("invitation_deliveries_participant_product_idx").on(t.participantId, t.productId)],
);

/* ---------------- Assignments and sessions ---------------- */

export const assignments = pgTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    studyRevision: integer("study_revision").notNull(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["direct_link", "embedded", "marketplace"] }).notNull(),
    cohort: text("cohort", { enum: ["fresh", "repeat"] }).notNull(),
    testedCommitSha: text("tested_commit_sha").notNull(),
    environmentRef: text("environment_ref").notNull(),
    /** Reserved fixture/account for this assignment (VC-07 supplies real fixtures later). */
    fixtureRef: text("fixture_ref").notNull(),
    state: text("state").notNull(),
    /** Optimistic concurrency for state transitions. */
    version: integer("version").default(1).notNull(),
    consentVersion: text("consent_version"),
    consentedAt: ts("consented_at"),
    capturePolicy: jsonb("capture_policy").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("assignments_participant_study_uq").on(t.participantId, t.studyId),
    index("assignments_study_idx").on(t.studyId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" })
      .unique(),
    /** Vonage session id for the recording; null until recording starts. */
    mediaSessionId: text("media_session_id"),
    mediaProvider: text("media_provider", { enum: ["vonage"] }),
    sttProvider: text("stt_provider", { enum: ["slng"] }),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    /** Client monotonic clock origin (epoch ms) reported at recording start. */
    clientClockOriginMs: bigint("client_clock_origin_ms", { mode: "number" }),
    /** Pause intervals in session ms: [{start_ms,end_ms|null}]. */
    pauses: jsonb("pauses")
      .$type<{ start_ms: number; end_ms: number | null }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    completeness: text("completeness", { enum: ["pending", "complete", "partial", "incomplete"] })
      .notNull()
      .default("pending"),
    instrumentation: text("instrumentation", { enum: ["sdk", "video_only"] }).notNull(),
    participantReportedOutcome: text("participant_reported_outcome", {
      enum: ["completed", "stuck", "gave_up", "withdrew", "unknown"],
    })
      .default("unknown")
      .notNull(),
    instrumentedOutcome: text("instrumented_outcome", {
      enum: ["completed", "not_completed", "unknown"],
    })
      .default("unknown")
      .notNull(),
    perceivedDifficulty: integer("perceived_difficulty"),
    comments: text("comments"),
    /** Count of moderation prompts shown (logged as events too). */
    moderationPrompts: integer("moderation_prompts").default(0).notNull(),
    transcriptStatus: text("transcript_status", { enum: ["none", "queued", "done", "failed"] })
      .default("none")
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_media_session_idx").on(t.mediaSessionId)],
);

/** Media assets: one per Vonage archive (pause/resume creates several). */
export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["screen_audio", "screen", "audio"] }).notNull(),
    /** Provider archive id (unique so duplicate callbacks are no-ops). */
    providerArchiveId: text("provider_archive_id").unique(),
    providerStatus: text("provider_status"),
    status: text("status", {
      enum: ["pending", "recording", "uploaded", "verified", "failed", "missing"],
    }).notNull(),
    /** Session-clock offset where this archive starts (ms). */
    offsetMs: integer("offset_ms").default(0).notNull(),
    durationMs: integer("duration_ms"),
    sizeBytes: integer("size_bytes"),
    storagePath: text("storage_path"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [index("assets_session_idx").on(t.sessionId)],
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    tMs: integer("t_ms").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("session_events_session_seq_uq").on(t.sessionId, t.sequence)],
);

/** Batch receipts so re-sent batches are acknowledged without duplicating events. */
export const eventBatches = pgTable(
  "event_batches",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    batchSequence: integer("batch_sequence").notNull(),
    eventCount: integer("event_count").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("event_batches_session_seq_uq").on(t.sessionId, t.batchSequence)],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    speaker: text("speaker", { enum: ["participant", "moderator", "unknown"] }).notNull(),
    text: text("text").notNull(),
    confidence: integer("confidence_permille"),
    createdAt: createdAt(),
  },
  (t) => [index("transcript_segments_session_idx").on(t.sessionId, t.startMs)],
);

/* ---------------- Credits, notifications, jobs, audit ---------------- */

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    participantId: text("participant_id").notNull(),
    assignmentId: text("assignment_id").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason", {
      enum: ["valid_participation", "withdrawal_partial", "manual_review"],
    }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("credit_ledger_assignment_reason_uq").on(t.assignmentId, t.reason)],
);

/** Outgoing email. In EMAIL_MODE=test_inbox nothing leaves the database. */
export const notificationOutbox = pgTable("notification_outbox", {
  id: text("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  /** Link the message carries, surfaced on /dev/inbox for local testing. */
  actionUrl: text("action_url"),
  status: text("status", { enum: ["queued", "sent", "test_inbox"] }).notNull(),
  createdAt: createdAt(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    /** Business key: enqueueing the same key twice is a no-op. */
    dedupeKey: text("dedupe_key").unique(),
    status: text("status", { enum: ["queued", "running", "done", "failed", "dead"] })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    nextRunAt: ts("next_run_at").defaultNow().notNull(),
    leaseExpiresAt: ts("lease_expires_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [index("jobs_status_next_run_idx").on(t.status, t.nextRunAt)],
);

/** Domain events emitted with the shared envelope (specs/README.md). */
export const eventOutbox = pgTable("event_outbox", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  envelope: jsonb("envelope").notNull(),
  publishedAt: ts("published_at"),
  createdAt: createdAt(),
});

/** Provider webhook receipts for deduplication and reconciliation. */
export const webhookReceipts = pgTable(
  "webhook_receipts",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    /** e.g. `${archiveId}:${status}` */
    dedupeKey: text("dedupe_key").notNull(),
    body: jsonb("body").notNull(),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex("webhook_receipts_provider_key_uq").on(t.provider, t.dedupeKey)],
);

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  detail: jsonb("detail"),
  createdAt: createdAt(),
});
