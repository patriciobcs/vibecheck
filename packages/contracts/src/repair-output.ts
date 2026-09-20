import { z } from "zod";

export const repairOutputSchema = z
  .object({
    schema_version: z.literal("1.0"),
    repair_run_id: z.string().min(1),
    reproduced: z.boolean(),
    reproduction_notes: z.string().min(1),
    outcome: z.enum(["candidate", "cannot_reproduce", "out_of_scope"]),
    branch: z.string().nullable(),
    summary: z.string().min(1).max(600),
    changed_paths: z.array(z.string()),
    limitations: z.array(z.string()),
  })
  .superRefine((output, context) => {
    if (output.outcome === "candidate") {
      if (!output.branch) {
        context.addIssue({
          code: "custom",
          path: ["branch"],
          message: "candidate requires a branch",
        });
      }
      if (output.changed_paths.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["changed_paths"],
          message: "candidate requires changed paths",
        });
      }
    } else if (output.branch !== null) {
      context.addIssue({
        code: "custom",
        path: ["branch"],
        message: "non-candidate outcomes must not include a branch",
      });
    }
  });

export const repairOutputJsonSchema = z.toJSONSchema(repairOutputSchema, {
  reused: "inline",
  io: "input",
});

export type RepairOutput = z.infer<typeof repairOutputSchema>;
