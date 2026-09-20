import { z } from "zod";

export const REPAIR_STATES = [
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
] as const;

export const repairModeSchema = z.enum(["issues_only", "draft_pr", "prototype_and_retest"]);
export const repairStatusSchema = z.enum(REPAIR_STATES);

export const repairRunSchema = z.object({
  schema_version: z.literal("1.0"),
  repair_run_id: z.string().min(1),
  finding_id: z.string().min(1),
  issue_ref: z.string().min(1),
  mode: repairModeSchema,
  base_commit_sha: z.string().min(1),
  candidate_commit_sha: z.string().min(1).nullable(),
  devin_session_ref: z.string().min(1).nullable(),
  variant_id: z.literal("variant_a"),
  attempt: z.number().int().positive(),
  validator_version: z.string().min(1),
  checks_ref: z.string().min(1).nullable(),
  preview_ref: z.string().min(1).nullable(),
  pull_request_ref: z.string().min(1).nullable(),
  status: repairStatusSchema,
});

export type RepairRunContract = z.infer<typeof repairRunSchema>;

export function toRepairRunContract(row: {
  id: string;
  findingId: string;
  issueRepo: string;
  issueNumber: number;
  mode: RepairRunContract["mode"];
  baseCommitSha: string;
  candidateCommitSha: string | null;
  devinSessionId: string | null;
  devinSessionUrl: string | null;
  attempt: number;
  validatorVersion: string;
  checkRunId?: string | null;
  previewId: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  status: RepairRunContract["status"];
}): RepairRunContract {
  return {
    schema_version: "1.0",
    repair_run_id: row.id,
    finding_id: row.findingId,
    issue_ref: `${row.issueRepo}#${row.issueNumber}`,
    mode: row.mode,
    base_commit_sha: row.baseCommitSha,
    candidate_commit_sha: row.candidateCommitSha,
    devin_session_ref: row.devinSessionId
      ? row.devinSessionUrl
        ? `${row.devinSessionId}|${row.devinSessionUrl}`
        : row.devinSessionId
      : null,
    variant_id: "variant_a",
    attempt: row.attempt,
    validator_version: row.validatorVersion,
    checks_ref: row.checkRunId ?? null,
    preview_ref: row.previewId,
    pull_request_ref: row.pullRequestNumber
      ? row.pullRequestUrl
        ? `#${row.pullRequestNumber}|${row.pullRequestUrl}`
        : `#${row.pullRequestNumber}`
      : null,
    status: row.status,
  };
}
