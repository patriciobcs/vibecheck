import { describe, expect, it } from "vitest";
import { AgentOutputSchema, agentOutputJsonSchema } from "./agent-output";
import { ProductConfigSchema } from "./product-config";
import { PublishInputSchema } from "./publish-input";

describe("AgentOutputSchema", () => {
  it("rejects proposals when the outcome is cannot_assess", () => {
    const res = AgentOutputSchema.safeParse({
      schema_version: "1.0",
      discovery_run_id: "run",
      source_revision: "sha",
      outcome: "cannot_assess",
      proposals: [
        {
          task_id: "x",
          research_question: "q",
          participant_prompt: "p",
          rationale: "r",
          evidence_refs: [],
          evidence_type: "reported",
          eligibility_rule_ref: "e",
          success_rule_ref: "s",
          uncertainties: [],
        },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("rejects more than three proposals", () => {
    const p = {
      task_id: "x",
      research_question: "q",
      participant_prompt: "p",
      rationale: "r",
      evidence_refs: [],
      evidence_type: "reported",
      eligibility_rule_ref: "e",
      success_rule_ref: "s",
      uncertainties: [],
    };
    expect(
      AgentOutputSchema.safeParse({
        schema_version: "1.0",
        discovery_run_id: "r",
        source_revision: "s",
        proposals: [p, p, p, p],
      }).success,
    ).toBe(false);
  });

  it("exports a root object JSON schema without refs", () => {
    const json = agentOutputJsonSchema as { type?: string };
    expect(json.type).toBe("object");
    expect(JSON.stringify(json)).not.toContain('"$ref"');
  });
});

describe("ProductConfigSchema", () => {
  it("applies defaults and requires a valid URL", () => {
    const cfg = ProductConfigSchema.parse({ name: "x", url: "https://example.com" });
    expect(cfg.release_notes).toEqual([]);
    expect(cfg.language).toBe("en");
    expect(ProductConfigSchema.safeParse({ name: "x", url: "not a url" }).success).toBe(false);
  });
});

describe("PublishInputSchema", () => {
  it("accepts a minimal publish request", () => {
    expect(
      PublishInputSchema.safeParse({
        product_id: "p",
        discovery_run_id: "r",
        task_id: "t",
        fixture_ref: "f",
        baseline: {
          commit_sha: "0000000000000000000000000000000000000000",
          environment_ref: "env",
        },
      }).success,
    ).toBe(true);
  });
});
