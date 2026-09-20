import type { PreviewDeployer } from "./types";

export type VercelPreviewConfig = {
  token: string;
  projectId: string;
  teamId?: string;
  apiBase: string;
  deployTimeoutMs: number;
  pollMs: number;
};

type VercelDeployment = {
  uid?: string;
  id?: string;
  url?: string | null;
  readyState?: string;
  createdAt?: number | string;
  created?: number | string;
};

type VercelDeploymentsResponse = {
  deployments?: VercelDeployment[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createdAt(deployment: VercelDeployment) {
  const value = deployment.createdAt ?? deployment.created;
  return typeof value === "number" ? value : Number(value ?? 0);
}

function deploymentUrl(value: string) {
  return `https://${value.replace(/^https?:\/\//, "")}`;
}

export function createVercelPreviewDeployer(
  config: VercelPreviewConfig,
  fetchImpl: typeof fetch = fetch,
): PreviewDeployer {
  const base = config.apiBase.replace(/\/$/, "");

  async function listDeployments(commitSha: string) {
    const params = new URLSearchParams({
      projectId: config.projectId,
      sha: commitSha,
      target: "preview",
    });
    if (config.teamId) params.set("teamId", config.teamId);
    let response = await fetchImpl(`${base}/v7/deployments?${params.toString()}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.token}`,
      },
    });
    if (!response.ok && [400, 404].includes(response.status)) {
      params.delete("sha");
      params.set("meta-githubCommitSha", commitSha);
      response = await fetchImpl(`${base}/v7/deployments?${params.toString()}`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.token}`,
        },
      });
    }
    if (!response.ok) throw new Error(`vercel_api_${response.status}`);
    const body = (await response.json()) as VercelDeploymentsResponse;
    if (!Array.isArray(body.deployments)) throw new Error("vercel_api_invalid_response");
    return body.deployments;
  }

  return {
    name: "vercel",
    async deploy(input) {
      const deadline = Date.now() + config.deployTimeoutMs;
      while (Date.now() <= deadline) {
        const deployments = await listDeployments(input.commitSha);
        const deployment = deployments.slice().sort((a, b) => createdAt(b) - createdAt(a))[0];
        if (deployment?.readyState === "ERROR" || deployment?.readyState === "CANCELED") {
          throw new Error("preview_build_failed");
        }
        if (deployment?.readyState === "READY" && deployment.url) {
          const deploymentId = deployment.uid ?? deployment.id;
          if (!deploymentId) throw new Error("vercel_api_invalid_response");
          return {
            deploymentId,
            url: deploymentUrl(deployment.url),
          };
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(config.pollMs, remaining));
      }
      throw new Error("preview_not_found");
    },
    async health(url) {
      try {
        if ((await fetchImpl(url)).status === 200) return "healthy";
      } catch {
        // Retry once below after the deployment has had time to become reachable.
      }
      await sleep(5_000);
      try {
        return (await fetchImpl(url)).status === 200 ? "healthy" : "unhealthy";
      } catch {
        return "unhealthy";
      }
    },
  };
}
