import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const proposalSchema = z.object({
  task_id: z.string().min(1),
  research_question: z.string().min(1),
  participant_prompt: z.string().min(1),
  rationale: z.string().min(1),
  evidence_refs: z.array(z.string()),
  evidence_type: z.string().min(1),
  eligibility_rule_ref: z.string().min(1),
  success_rule_ref: z.string().min(1),
  uncertainties: z.array(z.string()),
  estimated_duration_seconds: z.number().int().positive().optional(),
  confidence: z.string().optional(),
});

export const agentOutputSchema = z.object({
  schema_version: z.literal("1.0"),
  discovery_run_id: z.string(),
  source_revision: z.string(),
  outcome: z.enum(["proposed", "cannot_assess", "needs_setup"]).default("proposed"),
  outcome_reason: z.string().optional(),
  proposals: z.array(proposalSchema),
}).superRefine((value, ctx) => {
  if (value.outcome !== "proposed" && value.proposals.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proposals"], message: "proposals must be empty unless outcome is proposed" });
  }
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;
export const agentOutputJsonSchema = zodToJsonSchema(agentOutputSchema, { $refStrategy: "none" });
