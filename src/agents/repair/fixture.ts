import type { ProviderHandle, ProviderResult } from "@/agents/types";
import { demoAllowedPaths } from "./demoPolicy";
import type { RepairProvider } from "./types";

export const fixtureRepairProvider: RepairProvider = {
  name: "fixture",
  async start(context, onSession) {
    const handle: ProviderHandle = {
      runId: context.repairRunId,
      branchName: context.branchName,
    };
    await onSession?.(handle);
    return {
      handle,
      raw: {
        schema_version: "1.0",
        repair_run_id: context.repairRunId,
        reproduced: true,
        reproduction_notes: "Fixture adapter reproduced the recorded behavior.",
        outcome: "candidate",
        branch: context.branchName,
        summary: "Fixture candidate for the bounded UX change.",
        changed_paths: [`${demoAllowedPaths[0]}components/Toolbar.tsx`],
        limitations: ["Fixture adapter does not modify a repository."],
      },
    };
  },
  async revise(handle, diagnostics) {
    return {
      handle,
      raw: {
        schema_version: "1.0",
        repair_run_id: handle.runId ?? "fixture-repair",
        reproduced: true,
        reproduction_notes: "Fixture adapter reproduced the recorded behavior.",
        outcome: "candidate",
        branch: handle.branchName ?? "vibecheck/repair-fixture",
        summary: `Fixture revision after: ${diagnostics}`,
        changed_paths: [`${demoAllowedPaths[0]}components/Toolbar.tsx`],
        limitations: ["Fixture adapter does not modify a repository."],
      },
    };
  },
};
