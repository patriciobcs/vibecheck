export interface PreviewDeployer {
  name: string;
  deploy(input: {
    repo: { owner: string; repo: string };
    commitSha: string;
    repairRunId: string;
  }): Promise<{ deploymentId: string; url: string }>;
  health(url: string): Promise<"healthy" | "unhealthy">;
}
