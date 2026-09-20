import { randomUUID } from "node:crypto";
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import type { ProductConfig } from "@/contracts/productConfig";
import type { StudyPlan } from "@/contracts/studyPlan";
import type { EvidencePackage } from "@/contracts/evidencePackage";
import type { Finding as FindingContract } from "@/contracts/finding";
import { REPAIR_STATES } from "@/contracts/repairRun";
import type { CheckRun } from "@/contracts/checkRun";
import type { ExperimentSummary } from "@/contracts/experimentSummary";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => randomUUID());
const createdAt = () => timestamp("createdAt", { mode: "date" }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updatedAt", { mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const productStatus = pgEnum("ProductStatus", [
  "draft",
  "connecting",
  "ready",
  "needs_setup",
]);
export const discoveryStatus = pgEnum("DiscoveryStatus", [
  "queued",
  "inspecting",
  "proposed",
  "failed",
  "cancelled",
]);
export const discoveryProvider = pgEnum("DiscoveryProvider", ["fixture", "devin"]);
export const discoveryOutcome = pgEnum("DiscoveryOutcome", [
  "proposed",
  "cannot_assess",
  "needs_setup",
]);
export const studyStatus = pgEnum("StudyStatus", ["draft", "published", "recruiting"]);
export const jobStatus = pgEnum("JobStatus", ["pending", "running", "done", "failed", "cancelled"]);
export const analysisStatus = pgEnum("AnalysisStatus", [
  "queued",
  "analysing",
  "completed",
  "failed",
]);
export const findingCertainty = pgEnum("FindingCertainty", [
  "insufficient_evidence",
  "preliminary",
  "repeated_observation",
  "contradictory",
]);
export const issueAction = pgEnum("IssueAction", ["created", "updated", "unchanged", "skipped"]);
export const repairStatus = pgEnum("RepairStatus", REPAIR_STATES);
export const repairMode = pgEnum("RepairMode", ["issues_only", "draft_pr", "prototype_and_retest"]);
export const checkStatus = pgEnum("CheckStatus", ["passed", "failed", "error"]);
export const participationKind = pgEnum("ParticipationKind", [
  "invited",
  "accepted",
  "dismissed",
  "started",
  "completed",
  "abandoned",
]);
export const summaryStatus = pgEnum("SummaryStatus", [
  "collecting",
  "summarized",
  "insufficient_data",
  "failed",
]);
export const signalSeverity = pgEnum("SignalSeverity", ["low", "medium", "high"]);

export const tenant = pgTable("Tenant", {
  id: id(),
  name: text("name").notNull(),
  pausedAt: timestamp("pausedAt", { mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditEvent = pgTable(
  "AuditEvent",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("targetType").notNull(),
    targetId: text("targetId").notNull(),
    details: jsonb("details").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("AuditEvent_tenantId_idx").on(table.tenantId)],
);

export const apiKey = pgTable("ApiKey", {
  id: id(),
  tenantId: text("tenantId")
    .notNull()
    .references(() => tenant.id, { onDelete: "cascade" }),
  keyHash: text("keyHash").notNull().unique(),
  label: text("label").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const product = pgTable("Product", {
  id: id(),
  tenantId: text("tenantId")
    .notNull()
    .references(() => tenant.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  url: text("url").notNull(),
  permittedOrigins: text("permittedOrigins").array().notNull(),
  language: text("language").notNull(),
  audience: text("audience").notNull(),
  repoBinding: jsonb("repoBinding").$type<ProductConfig["repo_binding"] | null>(),
  releaseNotes: jsonb("releaseNotes").$type<ProductConfig["release_notes"]>().notNull(),
  supportComplaints: jsonb("supportComplaints")
    .$type<ProductConfig["support_complaints"]>()
    .notNull(),
  knownJourneys: jsonb("knownJourneys").$type<ProductConfig["known_journeys"]>().notNull(),
  productEvents: jsonb("productEvents").$type<ProductConfig["product_events"]>().notNull(),
  status: productStatus("status").notNull(),
  setupError: text("setupError"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const signal = pgTable(
  "Signal",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    productId: text("productId")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    signalId: text("signalId").notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    severity: signalSeverity("severity").notNull(),
    semanticTarget: text("semanticTarget").notNull(),
    observedSessions: integer("observedSessions"),
    windowStart: timestamp("windowStart", { mode: "date" }).notNull(),
    windowEnd: timestamp("windowEnd", { mode: "date" }).notNull(),
    evidenceRef: text("evidenceRef"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("Signal_tenantId_signalId_key").on(table.tenantId, table.signalId),
    index("Signal_tenantId_productId_idx").on(table.tenantId, table.productId),
  ],
);

export const discoveryRun = pgTable(
  "DiscoveryRun",
  {
    id: id(),
    productId: text("productId")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    status: discoveryStatus("status").notNull(),
    provider: discoveryProvider("provider").notNull(),
    providerSessionId: text("providerSessionId"),
    providerSessionUrl: text("providerSessionUrl"),
    sourceRevision: text("sourceRevision").notNull(),
    outcome: discoveryOutcome("outcome"),
    outcomeReason: text("outcomeReason"),
    rawResponses: jsonb("rawResponses").$type<unknown[]>().notNull(),
    correctionAttempts: integer("correctionAttempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("DiscoveryRun_tenantId_idx").on(table.tenantId)],
);

export const proposal = pgTable(
  "Proposal",
  {
    id: id(),
    discoveryRunId: text("discoveryRunId")
      .notNull()
      .references(() => discoveryRun.id, { onDelete: "cascade" }),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    taskId: text("taskId").notNull(),
    researchQuestion: text("researchQuestion").notNull(),
    participantPrompt: text("participantPrompt").notNull(),
    rationale: text("rationale").notNull(),
    evidenceRefs: text("evidenceRefs").array().notNull(),
    evidenceType: text("evidenceType").notNull(),
    eligibilityRuleRef: text("eligibilityRuleRef").notNull(),
    successRuleRef: text("successRuleRef").notNull(),
    uncertainties: text("uncertainties").array().notNull(),
    estimatedDurationSeconds: integer("estimatedDurationSeconds"),
    confidence: text("confidence"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [unique("Proposal_discoveryRunId_taskId_key").on(table.discoveryRunId, table.taskId)],
);

export const study = pgTable("Study", {
  id: id(),
  productId: text("productId")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
  tenantId: text("tenantId")
    .notNull()
    .references(() => tenant.id, { onDelete: "cascade" }),
  status: studyStatus("status").notNull(),
  currentRevision: integer("currentRevision").notNull(),
  latestSummaryId: text("latestSummaryId"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const studyPlanRevision = pgTable(
  "StudyPlanRevision",
  {
    id: id(),
    studyId: text("studyId")
      .notNull()
      .references(() => study.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    plan: jsonb("plan").$type<StudyPlan>().notNull(),
    publishedAt: timestamp("publishedAt", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [unique("StudyPlanRevision_studyId_revision_key").on(table.studyId, table.revision)],
);

export const outboxEvent = pgTable("OutboxEvent", {
  idempotencyKey: text("idempotencyKey").primaryKey(),
  eventId: text("eventId").notNull().unique(),
  eventType: text("eventType").notNull(),
  tenantId: text("tenantId").notNull(),
  productId: text("productId").notNull(),
  correlationId: text("correlationId").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  occurredAt: timestamp("occurredAt", { mode: "date" }).notNull(),
  publishedAt: timestamp("publishedAt", { mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const publishRequest = pgTable(
  "PublishRequest",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotencyKey").notNull(),
    studyId: text("studyId")
      .notNull()
      .references(() => study.id, { onDelete: "cascade" }),
    responseHash: text("responseHash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("PublishRequest_tenantId_idempotencyKey_key").on(table.tenantId, table.idempotencyKey),
  ],
);

export const job = pgTable(
  "Job",
  {
    id: id(),
    type: text("type").notNull(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: jobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(3),
    leaseUntil: timestamp("leaseUntil", { mode: "date" }),
    lockedBy: text("lockedBy"),
    nextRunAt: timestamp("nextRunAt", { mode: "date" }).notNull().defaultNow(),
    lastError: text("lastError"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("Job_status_nextRunAt_idx").on(table.status, table.nextRunAt)],
);

export const analysisRun = pgTable(
  "AnalysisRun",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    studyId: text("studyId")
      .notNull()
      .references(() => study.id, { onDelete: "cascade" }),
    sessionId: text("sessionId").notNull(),
    status: analysisStatus("status").notNull(),
    provider: discoveryProvider("provider").notNull(),
    outcome: text("outcome"),
    evidencePackage: jsonb("evidencePackage").$type<EvidencePackage | null>(),
    rawResponses: jsonb("rawResponses").$type<unknown[]>().notNull(),
    providerSessionId: text("providerSessionId"),
    providerSessionUrl: text("providerSessionUrl"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("AnalysisRun_studyId_sessionId_key").on(table.studyId, table.sessionId),
    index("AnalysisRun_tenantId_idx").on(table.tenantId),
  ],
);

export const finding = pgTable(
  "Finding",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    studyId: text("studyId")
      .notNull()
      .references(() => study.id, { onDelete: "cascade" }),
    studyRevision: integer("studyRevision").notNull(),
    baselineCommitSha: text("baselineCommitSha").notNull(),
    title: text("title").notNull(),
    fingerprint: text("fingerprint").notNull(),
    category: text("category").notNull(),
    semanticTarget: text("semanticTarget").notNull(),
    observation: text("observation").notNull(),
    hypothesis: text("hypothesis").notNull(),
    impact: text("impact").notNull(),
    certainty: findingCertainty("certainty").notNull(),
    limitations: text("limitations").array().notNull(),
    suggestedExperiment: text("suggestedExperiment"),
    evidence: jsonb("evidence").$type<FindingContract["evidence"]>().notNull(),
    observedSessionCount: integer("observedSessionCount").notNull(),
    eligibleSessionCount: integer("eligibleSessionCount").notNull(),
    provenance: text("provenance").notNull(),
    issueRepo: text("issueRepo"),
    issueNumber: integer("issueNumber"),
    issueUrl: text("issueUrl"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("Finding_studyId_fingerprint_key").on(table.studyId, table.fingerprint),
    index("Finding_tenantId_idx").on(table.tenantId),
  ],
);

export const issuePublishRequest = pgTable(
  "IssuePublishRequest",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    findingId: text("findingId")
      .notNull()
      .references(() => finding.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotencyKey").notNull(),
    action: issueAction("action").notNull(),
    skipReason: text("skipReason").$type<"github_disconnected" | "no_token">(),
    issueNumber: integer("issueNumber"),
    issueUrl: text("issueUrl"),
    observedSessionCount: integer("observedSessionCount"),
    certainty: text("certainty"),
    repoOwner: text("repoOwner"),
    repoName: text("repoName"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("IssuePublishRequest_tenantId_idempotencyKey_key").on(
      table.tenantId,
      table.idempotencyKey,
    ),
  ],
);

export const participationEvent = pgTable(
  "ParticipationEvent",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    studyId: text("studyId")
      .notNull()
      .references(() => study.id, { onDelete: "cascade" }),
    studyRevision: integer("studyRevision").notNull(),
    eventId: text("eventId").notNull(),
    participantRef: text("participantRef").notNull(),
    kind: participationKind("kind").notNull(),
    sessionId: text("sessionId"),
    occurredAt: timestamp("occurredAt", { mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("ParticipationEvent_tenantId_eventId_key").on(table.tenantId, table.eventId),
    unique("ParticipationEvent_studyId_revision_participant_kind_key").on(
      table.studyId,
      table.studyRevision,
      table.participantRef,
      table.kind,
    ),
    index("ParticipationEvent_tenantId_idx").on(table.tenantId),
  ],
);

export const experimentSummary = pgTable(
  "ExperimentSummary",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    studyId: text("studyId")
      .notNull()
      .references(() => study.id, { onDelete: "cascade" }),
    studyRevision: integer("studyRevision").notNull(),
    revision: integer("revision").notNull(),
    status: summaryStatus("status").notNull(),
    inputsHash: text("inputsHash").notNull(),
    summary: jsonb("summary").$type<ExperimentSummary>().notNull(),
    narrativeRaw: jsonb("narrativeRaw").$type<unknown[]>().notNull(),
    provider: text("provider"),
    providerSessionId: text("providerSessionId"),
    providerSessionUrl: text("providerSessionUrl"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("ExperimentSummary_studyId_revision_key").on(
      table.studyId,
      table.studyRevision,
      table.revision,
    ),
    unique("ExperimentSummary_studyId_inputsHash_key").on(
      table.studyId,
      table.studyRevision,
      table.inputsHash,
    ),
    index("ExperimentSummary_tenantId_idx").on(table.tenantId),
  ],
);

export const repairRun = pgTable(
  "RepairRun",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    findingId: text("findingId")
      .notNull()
      .references(() => finding.id, { onDelete: "cascade" }),
    studyId: text("studyId")
      .notNull()
      .references(() => study.id, { onDelete: "cascade" }),
    studyRevision: integer("studyRevision").notNull(),
    issueRepo: text("issueRepo").notNull(),
    issueNumber: integer("issueNumber").notNull(),
    mode: repairMode("mode").notNull(),
    baseCommitSha: text("baseCommitSha").notNull(),
    candidateCommitSha: text("candidateCommitSha"),
    branch: text("branch"),
    devinSessionId: text("devinSessionId"),
    devinSessionUrl: text("devinSessionUrl"),
    attempt: integer("attempt").notNull().default(1),
    maxAttempts: integer("maxAttempts").notNull(),
    validatorVersion: text("validatorVersion").notNull(),
    pullRequestNumber: integer("pullRequestNumber"),
    pullRequestUrl: text("pullRequestUrl"),
    previewId: text("previewId"),
    status: repairStatus("status").notNull().default("queued"),
    blockedReason: text("blockedReason"),
    lastOutput: jsonb("lastOutput").$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("RepairRun_findingId_key").on(table.findingId),
    index("RepairRun_tenantId_idx").on(table.tenantId),
  ],
);

export const checkRun = pgTable(
  "CheckRun",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    repairRunId: text("repairRunId")
      .notNull()
      .references(() => repairRun.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    commitSha: text("commitSha").notNull(),
    validatorVersion: text("validatorVersion").notNull(),
    status: checkStatus("status").notNull(),
    results: jsonb("results").$type<CheckRun["results"]>().notNull(),
    diagnostics: text("diagnostics"),
    startedAt: timestamp("startedAt", { mode: "date" }).notNull(),
    finishedAt: timestamp("finishedAt", { mode: "date" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("CheckRun_repairRunId_idx").on(table.repairRunId)],
);

export const preview = pgTable(
  "Preview",
  {
    id: id(),
    tenantId: text("tenantId")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    repairRunId: text("repairRunId").notNull(),
    candidateCommitSha: text("candidateCommitSha").notNull(),
    provider: text("provider").notNull(),
    deploymentId: text("deploymentId").notNull(),
    url: text("url").notNull(),
    healthStatus: text("healthStatus").notNull(),
    fixtureRef: text("fixtureRef").notNull(),
    accessPolicy: text("accessPolicy").notNull().default("assigned_only"),
    expiresAt: timestamp("expiresAt", { mode: "date" }),
    cleanupStatus: text("cleanupStatus").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("Preview_repairRunId_idx").on(table.repairRunId)],
);

export type Tenant = typeof tenant.$inferSelect;
export type ApiKey = typeof apiKey.$inferSelect;
export type Product = typeof product.$inferSelect;
export type DiscoveryRun = typeof discoveryRun.$inferSelect;
export type Proposal = typeof proposal.$inferSelect;
export type Study = typeof study.$inferSelect;
export type StudyPlanRevision = typeof studyPlanRevision.$inferSelect;
export type OutboxEvent = typeof outboxEvent.$inferSelect;
export type PublishRequest = typeof publishRequest.$inferSelect;
export type Job = typeof job.$inferSelect;
export type AnalysisRun = typeof analysisRun.$inferSelect;
export type Finding = typeof finding.$inferSelect;
export type IssuePublishRequest = typeof issuePublishRequest.$inferSelect;
export type RepairRun = typeof repairRun.$inferSelect;
export type CheckRunRow = typeof checkRun.$inferSelect;
export type Preview = typeof preview.$inferSelect;
