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
export const jobStatus = pgEnum("JobStatus", ["pending", "running", "done", "failed"]);
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

export const tenant = pgTable("Tenant", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
