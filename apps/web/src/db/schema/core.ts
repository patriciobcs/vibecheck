import type {
  CheckResult,
  EvidencePackage,
  ExperimentSummary,
  Finding,
  SourceItem,
} from "@vibecheck/contracts";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").defaultNow().notNull();
export const checkStatus = pgEnum("check_status", ["passed", "failed", "error"]);

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
  /* ---- VC-01 onboarding context (imported material carries provenance + sample flag) ---- */
  description: text("description").default("").notNull(),
  language: text("language").default("en").notNull(),
  audience: text("audience").default("").notNull(),
  repoBinding: jsonb("repo_binding").$type<Record<string, unknown> | null>(),
  releaseNotes: jsonb("release_notes").$type<SourceItem[]>().notNull().default(sql`'[]'::jsonb`),
  supportComplaints: jsonb("support_complaints")
    .$type<SourceItem[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  knownJourneys: jsonb("known_journeys").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  productEvents: jsonb("product_events").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  /** VC-01 product lifecycle: draft → connecting → ready, or needs_setup with a reason. */
  status: text("status", { enum: ["draft", "connecting", "ready", "needs_setup"] })
    .default("ready")
    .notNull(),
  setupError: text("setup_error"),
  createdAt: createdAt(),
});

/** Programmatic tenant access (`Authorization: Bearer <key>`); only the hash is stored. */
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  label: text("label").notNull(),
  createdAt: createdAt(),
});

/* ---------------- VC-01 discovery ---------------- */

export const discoveryRuns = pgTable(
  "discovery_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "inspecting", "proposed", "failed", "cancelled"],
    }).notNull(),
    provider: text("provider", { enum: ["fixture", "devin"] }).notNull(),
    providerSessionId: text("provider_session_id"),
    providerSessionUrl: text("provider_session_url"),
    /** SHA-256 of the product configuration at run creation; the agent must echo it. */
    sourceRevision: text("source_revision").notNull(),
    outcome: text("outcome", { enum: ["proposed", "cannot_assess", "needs_setup"] }),
    outcomeReason: text("outcome_reason"),
    /** Raw agent responses, kept for restricted debugging (never shown to participants). */
    rawResponses: jsonb("raw_responses").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    correctionAttempts: integer("correction_attempts").default(0).notNull(),
    error: text("error"),
    /** Optional passive-screening candidates supplied as discovery input. */
    sourceCandidateRefs: jsonb("source_candidate_refs")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [index("discovery_runs_product_idx").on(t.productId)],
);

export const proposals = pgTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    discoveryRunId: text("discovery_run_id")
      .notNull()
      .references(() => discoveryRuns.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    researchQuestion: text("research_question").notNull(),
    participantPrompt: text("participant_prompt").notNull(),
    rationale: text("rationale").notNull(),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull(),
    evidenceType: text("evidence_type").notNull(),
    eligibilityRuleRef: text("eligibility_rule_ref").notNull(),
    successRuleRef: text("success_rule_ref").notNull(),
    uncertainties: jsonb("uncertainties").$type<string[]>().notNull(),
    estimatedDurationSeconds: integer("estimated_duration_seconds"),
    confidence: text("confidence"),
    sourceCandidateRefs: jsonb("source_candidate_refs")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("proposals_run_task_uq").on(t.discoveryRunId, t.taskId)],
);

/** Idempotent publish: one study per (tenant, idempotency key); replays return the stored result. */
export const publishRequests = pgTable(
  "publish_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    responseHash: text("response_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("publish_requests_tenant_key_uq").on(t.tenantId, t.idempotencyKey)],
);

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
    discoveryRunId: text("discovery_run_id"),
    sourceCandidateRefs: jsonb("source_candidate_refs")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    publishedAt: ts("published_at").notNull(),
  },
  (t) => [uniqueIndex("study_revisions_study_rev_uq").on(t.studyId, t.revision)],
);

export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    status: text("status", { enum: ["queued", "analysing", "completed", "failed"] }).notNull(),
    provider: text("provider", { enum: ["fixture", "devin"] }).notNull(),
    evidenceSource: text("evidence_source", { enum: ["persisted", "fixture"] }).notNull(),
    outcome: text("outcome"),
    evidencePackage: jsonb("evidence_package").$type<EvidencePackage | null>(),
    rawResponses: jsonb("raw_responses").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    providerSessionId: text("provider_session_id"),
    providerSessionUrl: text("provider_session_url"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("analysis_runs_study_session_uq").on(t.studyId, t.sessionId),
    index("analysis_runs_tenant_idx").on(t.tenantId),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    studyRevision: integer("study_revision").notNull(),
    baselineCommitSha: text("baseline_commit_sha").notNull(),
    title: text("title").notNull(),
    fingerprint: text("fingerprint").notNull(),
    category: text("category").notNull(),
    semanticTarget: text("semantic_target").notNull(),
    observation: text("observation").notNull(),
    hypothesis: text("hypothesis").notNull(),
    impact: text("impact").notNull(),
    certainty: text("certainty", {
      enum: ["insufficient_evidence", "preliminary", "repeated_observation", "contradictory"],
    }).notNull(),
    limitations: jsonb("limitations").$type<string[]>().notNull(),
    suggestedExperiment: text("suggested_experiment"),
    evidence: jsonb("evidence").$type<Finding["evidence"]>().notNull(),
    observedSessionCount: integer("observed_session_count").notNull(),
    eligibleSessionCount: integer("eligible_session_count").notNull(),
    provenance: text("provenance").notNull(),
    issueRepo: text("issue_repo"),
    issueNumber: integer("issue_number"),
    issueUrl: text("issue_url"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("findings_study_fingerprint_uq").on(t.studyId, t.fingerprint),
    index("findings_tenant_idx").on(t.tenantId),
  ],
);

export const issuePublishRequests = pgTable(
  "issue_publish_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    action: text("action", { enum: ["created", "updated", "unchanged", "skipped"] }).notNull(),
    skipReason: text("skip_reason"),
    issueNumber: integer("issue_number"),
    issueUrl: text("issue_url"),
    observedSessionCount: integer("observed_session_count"),
    certainty: text("certainty"),
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("issue_publish_requests_tenant_key_uq").on(t.tenantId, t.idempotencyKey),
    index("issue_publish_requests_issue_repo_idx").on(t.issueNumber, t.repoOwner, t.repoName),
  ],
);

export const repairRuns = pgTable(
  "repair_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    studyRevision: integer("study_revision").notNull(),
    issueRepo: text("issue_repo").notNull(),
    issueNumber: integer("issue_number").notNull(),
    mode: text("mode", { enum: ["issues_only", "draft_pr", "prototype_and_retest"] }).notNull(),
    baseCommitSha: text("base_commit_sha").notNull(),
    candidateCommitSha: text("candidate_commit_sha"),
    branch: text("branch"),
    devinSessionId: text("devin_session_id"),
    devinSessionUrl: text("devin_session_url"),
    attempt: integer("attempt").notNull().default(1),
    maxAttempts: integer("max_attempts").notNull(),
    validatorVersion: text("validator_version").notNull(),
    pullRequestNumber: integer("pull_request_number"),
    pullRequestUrl: text("pull_request_url"),
    previewId: text("preview_id"),
    status: text("status", {
      enum: [
        "queued",
        "preparing",
        "reproducing",
        "implementing",
        "validating",
        "retrying",
        "deploying",
        "draft_pr_ready",
        "preview_ready",
        "blocked",
        "failed",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    blockedReason: text("blocked_reason"),
    lastOutput: jsonb("last_output"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("repair_runs_finding_uq").on(t.findingId),
    index("repair_runs_tenant_idx").on(t.tenantId),
  ],
);

export const checkRuns = pgTable(
  "check_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    repairRunId: text("repair_run_id")
      .notNull()
      .references(() => repairRuns.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    commitSha: text("commit_sha").notNull(),
    validatorVersion: text("validator_version").notNull(),
    status: checkStatus("status").notNull(),
    results: jsonb("results").$type<CheckResult[]>().notNull(),
    diagnostics: text("diagnostics"),
    startedAt: ts("started_at").notNull(),
    finishedAt: ts("finished_at").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [index("check_runs_repair_run_idx").on(t.repairRunId)],
);

export const previews = pgTable(
  "previews",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    repairRunId: text("repair_run_id")
      .notNull()
      .references(() => repairRuns.id, { onDelete: "cascade" }),
    candidateCommitSha: text("candidate_commit_sha").notNull(),
    provider: text("provider").notNull(),
    deploymentId: text("deployment_id").notNull(),
    url: text("url").notNull(),
    healthStatus: text("health_status").notNull(),
    fixtureRef: text("fixture_ref").notNull(),
    accessPolicy: text("access_policy").notNull().default("assigned_only"),
    expiresAt: ts("expires_at"),
    cleanupStatus: text("cleanup_status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [index("previews_repair_run_idx").on(t.repairRunId)],
);
/* ---------------- VC-05 participation and summaries ---------------- */

export const participationEvents = pgTable(
  "participation_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    studyRevision: integer("study_revision").notNull(),
    eventId: text("event_id").notNull(),
    participantRef: text("participant_ref").notNull(),
    kind: text("kind", {
      enum: ["invited", "accepted", "dismissed", "started", "completed", "abandoned"] as const,
    }).notNull(),
    sessionId: text("session_id"),
    occurredAt: ts("occurred_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("participation_events_tenant_event_uq").on(t.tenantId, t.eventId),
    index("participation_events_study_rev_idx").on(t.studyId, t.studyRevision),
  ],
);

export const experimentSummaries = pgTable(
  "experiment_summaries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    studyRevision: integer("study_revision").notNull(),
    revision: integer("revision").notNull(),
    status: text("status", {
      enum: ["collecting", "summarized", "insufficient_data", "failed"],
    }).notNull(),
    inputsHash: text("inputs_hash").notNull(),
    summary: jsonb("summary").$type<ExperimentSummary>().notNull(),
    narrativeRaw: jsonb("narrative_raw").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    provider: text("provider"),
    providerSessionId: text("provider_session_id"),
    providerSessionUrl: text("provider_session_url"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("experiment_summaries_study_rev_hash_uq").on(
      t.studyId,
      t.studyRevision,
      t.inputsHash,
    ),
    uniqueIndex("experiment_summaries_study_rev_revision_uq").on(
      t.studyId,
      t.studyRevision,
      t.revision,
    ),
  ],
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
    /** Per-asset transcription outcome; null until a transcription job has run. */
    transcriptStatus: text("transcript_status", { enum: ["done", "failed"] }),
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

/* ---------------- Continuous discovery (passive observation + Jev screening) ---------------- */

/** Immutable, versioned detector: Jev questions + required telemetry, bound to a build. */
export const detectorDefinitions = pgTable(
  "detector_definitions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    detectorId: text("detector_id").notNull(),
    version: integer("version").notNull(),
    journeyId: text("journey_id").notNull(),
    appBuildRef: text("app_build_ref").notNull(),
    instrumentationSchemaVersion: text("instrumentation_schema_version").notNull(),
    requiredEvents: jsonb("required_events").$type<string[]>().notNull(),
    questions: jsonb("questions").notNull(),
    evaluationPolicyRef: text("evaluation_policy_ref").notNull(),
    /** manual (hand-authored), devin (generated), fixture. */
    provenance: text("provenance", { enum: ["manual", "devin", "fixture"] }).notNull(),
    sourceRefs: jsonb("source_refs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status", {
      enum: ["draft", "active", "stale", "needs_instrumentation", "disabled"],
    }).notNull(),
    statusReason: text("status_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("detector_definitions_product_detector_version_uq").on(
      t.productId,
      t.detectorId,
      t.version,
    ),
  ],
);

/** Owner-configurable monitoring policy; a snapshot is referenced by every window and evaluation. */
export const monitoringPolicyRevisions = pgTable("monitoring_policy_revisions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  policy: jsonb("policy").notNull(),
  createdByUserId: text("created_by_user_id"),
  createdAt: createdAt(),
});

/** Pseudonymous passive session (no assignment, no person). */
export const observationSessions = pgTable(
  "observation_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    buildRef: text("build_ref").notNull(),
    instrumentationSchemaVersion: text("instrumentation_schema_version").notNull(),
    collectionPolicyRef: text("collection_policy_ref").notNull(),
    /** Set while a research assignment is active so passive events are suppressed. */
    suppressedUntil: ts("suppressed_until"),
    lastEventAt: ts("last_event_at"),
    createdAt: createdAt(),
  },
  (t) => [index("observation_sessions_product_idx").on(t.productId, t.lastEventAt)],
);

export const observationEvents = pgTable(
  "observation_events",
  {
    /** Server-generated; the client-supplied `event_id` is only unique within its session. */
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    observationSessionId: text("observation_session_id")
      .notNull()
      .references(() => observationSessions.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    /** Client-chosen and only meaningful together with the observation session. */
    journeyInstanceId: text("journey_instance_id").notNull(),
    journeyId: text("journey_id").notNull(),
    sequence: integer("sequence").notNull(),
    tMs: integer("t_ms").notNull(),
    receivedAt: createdAt(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    uniqueIndex("observation_events_session_seq_uq").on(t.observationSessionId, t.sequence),
    uniqueIndex("observation_events_session_event_uq").on(t.observationSessionId, t.eventId),
    index("observation_events_journey_idx").on(
      t.observationSessionId,
      t.journeyInstanceId,
      t.sequence,
    ),
  ],
);

export const observationWindows = pgTable(
  "observation_windows",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    observationSessionId: text("observation_session_id").notNull(),
    journeyInstanceId: text("journey_instance_id").notNull(),
    journeyId: text("journey_id").notNull(),
    buildRef: text("build_ref").notNull(),
    detectorRef: text("detector_ref").notNull(),
    policyRef: text("policy_ref").notNull(),
    revision: integer("revision").default(1).notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    eventIds: jsonb("event_ids").$type<string[]>().notNull(),
    gaps: jsonb("gaps")
      .$type<{ after_sequence: number; missing: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    goalSource: text("goal_source", { enum: ["declared", "inferred", "unknown"] }).notNull(),
    coverage: jsonb("coverage").notNull(),
    priorProgressSummary: jsonb("prior_progress_summary"),
    triggerReason: text("trigger_reason").notNull(),
    /** Content hash used for evaluation deduplication. */
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("observation_windows_hash_detector_uq").on(t.contentHash, t.detectorRef),
    index("observation_windows_journey_idx").on(t.journeyInstanceId),
  ],
);

export const jevEvaluations = pgTable(
  "jev_evaluations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    windowId: text("window_id")
      .notNull()
      .references(() => observationWindows.id, { onDelete: "cascade" }),
    detectorRef: text("detector_ref").notNull(),
    policyRef: text("policy_ref").notNull(),
    requestHash: text("request_hash").notNull(),
    requestedModel: text("requested_model").notNull(),
    returnedModel: text("returned_model"),
    providerRequestId: text("provider_request_id"),
    triggerReason: text("trigger_reason").notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "deferred", "unknown_outcome"],
    }).notNull(),
    statusReason: text("status_reason"),
    /** Budget reservation held for this evaluation (null while deferred). */
    reservationId: text("reservation_id"),
    reservedMicros: integer("reserved_micros").default(0).notNull(),
    estimatedInputTokens: integer("estimated_input_tokens").default(0).notNull(),
    answers: jsonb("answers"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** Estimated cost in micro-USD when a price is configured; null means unpriced. */
    estimatedCostMicros: integer("estimated_cost_micros"),
    requestedAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    uniqueIndex("jev_evaluations_request_hash_uq").on(t.requestHash),
    index("jev_evaluations_product_time_idx").on(t.productId, t.requestedAt),
  ],
);

export const researchCandidates = pgTable(
  "research_candidates",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    journeyId: text("journey_id").notNull(),
    targetRef: text("target_ref").notNull(),
    category: text("category").notNull(),
    baselineBuildRef: text("baseline_build_ref").notNull(),
    detectorRef: text("detector_ref").notNull(),
    suspectedProblem: text("suspected_problem").notNull(),
    evaluationRefs: jsonb("evaluation_refs").$type<string[]>().notNull(),
    supportingEventRefs: jsonb("supporting_event_refs").$type<string[]>().notNull(),
    evidenceLimitations: jsonb("evidence_limitations").$type<string[]>().notNull(),
    distinctObservationSessions: integer("distinct_observation_sessions").notNull(),
    distinctJourneyInstances: integer("distinct_journey_instances").notNull(),
    /** Latest friction / research-warranted probabilities from Jev (0..1, stored in permille). */
    latestFrictionPermille: integer("latest_friction_permille"),
    latestResearchPermille: integer("latest_research_permille"),
    state: text("state", { enum: ["proposed", "accepted", "dismissed", "study_linked"] }).notNull(),
    stateReason: text("state_reason"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("research_candidates_group_uq").on(
      t.productId,
      t.journeyId,
      t.targetRef,
      t.category,
      t.baselineBuildRef,
      t.detectorRef,
    ),
  ],
);

export const candidateStudyLinks = pgTable(
  "candidate_study_links",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => researchCandidates.id, { onDelete: "cascade" }),
    studyId: text("study_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("candidate_study_links_uq").on(t.candidateId, t.studyId)],
);

/** Per-product daily budget ledger, reserved transactionally before each provider call. */
export const evaluationBudgetLedger = pgTable(
  "evaluation_budget_ledger",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    day: text("day").notNull(),
    evaluations: integer("evaluations").default(0).notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    estimatedCostMicros: integer("estimated_cost_micros").default(0).notNull(),
  },
  (t) => [uniqueIndex("evaluation_budget_ledger_product_day_uq").on(t.productId, t.day)],
);

/** One row per reserved evaluation, so per-session caps can be checked before any provider call exists. */
export const evaluationReservations = pgTable(
  "evaluation_reservations",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    observationSessionId: text("observation_session_id").notNull(),
    estimatedCostMicros: integer("estimated_cost_micros").default(0).notNull(),
    reservedAt: createdAt(),
  },
  (t) => [
    index("evaluation_reservations_session_time_idx").on(t.observationSessionId, t.reservedAt),
  ],
);
