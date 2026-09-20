import type { CheckRun } from "@vibecheck/contracts";
import type { Validator } from "./types";

export const fixtureValidator: Validator = {
  version: "fixture_validator_v1",
  async run(input): Promise<CheckRun> {
    const started = new Date();
    const allowed = input.changedPaths.every((path) =>
      input.allowedPaths.some((prefix) => path.startsWith(prefix)),
    );
    const finished = new Date();
    return {
      validator_version: "fixture_validator_v1",
      commit_sha: input.candidateCommitSha,
      status: allowed ? "passed" : "failed",
      results: [
        {
          id: "diff_scope",
          name: "permitted diff scope",
          status: allowed ? "passed" : "failed",
          details: allowed
            ? "All changed paths are within the allowed scope."
            : "A changed path is outside the allowed scope.",
        },
      ],
      started_at: started.toISOString(),
      finished_at: finished.toISOString(),
    };
  },
};
