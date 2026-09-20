import type { PreviewDeployer } from "./types";

export const fixturePreviewDeployer: PreviewDeployer = {
  name: "fixture",
  async deploy(input) {
    return {
      deploymentId: `fixture-${input.repairRunId}`,
      url: `https://preview.invalid/${input.commitSha}`,
    };
  },
  async health() {
    return "healthy";
  },
};
