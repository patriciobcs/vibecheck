import { describe, expect, it } from "vitest";
import { createVercelPreviewDeployer } from "./vercel";

const config = {
  token: "vercel_test_token",
  projectId: "project_test",
  apiBase: "https://vercel.test",
  deployTimeoutMs: 100,
  pollMs: 1,
};

describe("Vercel preview deployer", () => {
  it("waits for a deployment matching the candidate SHA", async () => {
    let calls = 0;
    const deployer = createVercelPreviewDeployer(config, async (input) => {
      calls += 1;
      expect(String(input)).toContain("sha=candidate-sha");
      return new Response(
        JSON.stringify({
          deployments: [
            {
              uid: "dpl_ready",
              url: "demo-git-feature.vercel.app",
              readyState: calls === 1 ? "BUILDING" : "READY",
              createdAt: calls,
            },
          ],
        }),
      );
    });

    await expect(
      deployer.deploy({
        repo: { owner: "minasrc", repo: "excalidraw-demo" },
        commitSha: "candidate-sha",
        repairRunId: "repair_test",
      }),
    ).resolves.toEqual({
      deploymentId: "dpl_ready",
      url: "https://demo-git-feature.vercel.app",
    });
    expect(calls).toBe(2);
  });

  it("blocks when Vercel reports a failed build", async () => {
    const deployer = createVercelPreviewDeployer(
      config,
      async () =>
        new Response(
          JSON.stringify({
            deployments: [{ uid: "dpl_failed", readyState: "ERROR", createdAt: 1 }],
          }),
        ),
    );

    await expect(
      deployer.deploy({
        repo: { owner: "minasrc", repo: "excalidraw-demo" },
        commitSha: "candidate-sha",
        repairRunId: "repair_test",
      }),
    ).rejects.toThrow("preview_build_failed");
  });

  it("blocks when no deployment appears before the timeout", async () => {
    const deployer = createVercelPreviewDeployer(
      { ...config, deployTimeoutMs: 2 },
      async () => new Response(JSON.stringify({ deployments: [] })),
    );

    await expect(
      deployer.deploy({
        repo: { owner: "minasrc", repo: "excalidraw-demo" },
        commitSha: "candidate-sha",
        repairRunId: "repair_test",
      }),
    ).rejects.toThrow("preview_not_found");
  });
});
