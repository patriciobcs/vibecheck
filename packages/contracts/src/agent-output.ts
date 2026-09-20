import { z } from "zod";

export const MAX_PROPOSALS = 3;
const ScenarioSchema = z.object({
  intro: z.string().min(1).max(400),
  steps: z
    .array(
      z.object({
        order: z.number().int().positive(),
        instruction: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(7),
  think_aloud_cues: z.array(z.string().min(1).max(200)).max(5),
  estimated_minutes: z.number().int().positive().max(60),
});

export const ProposalSchema = z.object({
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
  /** Optional provenance when a proposal was derived from passive-screening candidates. */
  source_candidate_refs: z.array(z.string()).optional(),
  scenario: ScenarioSchema.optional(),
});

/** Discovery agent output (VC-01). Proposals must be empty unless the outcome is `proposed`. */
export const AgentOutputSchema = z
  .object({
    schema_version: z.literal("1.0"),
    discovery_run_id: z.string(),
    source_revision: z.string(),
    outcome: z.enum(["proposed", "cannot_assess", "needs_setup"]).default("proposed"),
    outcome_reason: z.string().optional(),
    proposals: z.array(ProposalSchema).max(MAX_PROPOSALS),
  })
  .superRefine((value, ctx) => {
    if (value.outcome !== "proposed" && value.proposals.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["proposals"],
        message: "proposals must be empty unless outcome is proposed",
      });
    }
  });

export type AgentOutput = z.infer<typeof AgentOutputSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;

/** JSON Schema handed to the agent as `structured_output_schema`. Inlined, no $ref. */
export const agentOutputJsonSchema = z.toJSONSchema(AgentOutputSchema, {
  reused: "inline",
  io: "input",
});
