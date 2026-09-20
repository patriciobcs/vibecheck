import type { CheckRun } from "@/contracts/checkRun";

export interface Validator {
  version: string;
  run(input: {
    repo: { owner: string; repo: string };
    baseCommitSha: string;
    candidateCommitSha: string;
    allowedPaths: string[];
    changedPaths: string[];
  }): Promise<CheckRun>;
}
