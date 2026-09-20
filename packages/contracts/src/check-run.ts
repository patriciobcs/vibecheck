import { z } from "zod";

export const checkResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  details: z.string().optional(),
});
export const checkRunSchema = z.object({
  validator_version: z.string().min(1),
  commit_sha: z.string().min(1),
  status: z.enum(["passed", "failed", "error"]),
  results: z.array(checkResultSchema),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime(),
});

export type CheckResult = z.infer<typeof checkResultSchema>;
export type CheckRun = z.infer<typeof checkRunSchema>;
