import { randomUUID } from "node:crypto";
import type { Proposal } from "@prisma/client";
import { redirect } from "next/navigation";
import { tenantFromEnvironment } from "@/lib/auth";
import { publishStudy } from "@/services/studies";

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`${name} is required`);
  return value;
}

function numberField(formData: FormData, name: string) {
  return Number(field(formData, name));
}

async function publish(formData: FormData) {
  "use server";
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) throw new Error("DEV_API_KEY is required");
  const result = await publishStudy(tenantId, randomUUID(), {
    product_id: field(formData, "productId"),
    discovery_run_id: field(formData, "runId"),
    task_id: field(formData, "taskId"),
    fixture_ref: field(formData, "fixtureRef"),
    baseline: {
      commit_sha: field(formData, "commitSha"),
      environment_ref: field(formData, "environmentRef"),
    },
    task: {
      participant_prompt: field(formData, "prompt"),
      time_limit_seconds: numberField(formData, "timeLimit"),
    },
    recruitment: {
      source: field(formData, "recruitmentSource"),
      target_count: numberField(formData, "targetCount"),
      cohort: field(formData, "cohort"),
    },
    capture: {
      screen: field(formData, "screen"),
      microphone: field(formData, "microphone"),
      webcam: field(formData, "webcam"),
      pointer: field(formData, "pointer"),
      keyboard: field(formData, "keyboard"),
      text_values: field(formData, "textValues"),
      retention_days: numberField(formData, "retentionDays"),
    },
    automation: {
      mode: field(formData, "automationMode"),
      max_variants: numberField(formData, "maxVariants"),
      max_repair_attempts: numberField(formData, "maxRepairAttempts"),
      retest_target_count: numberField(formData, "retestTargetCount"),
    },
  });
  if (result) redirect(`/studies/${result.study.id}`);
}

export function PublishForm({ productId, proposal }: { productId: string; proposal: Proposal }) {
  return (
    <form action={publish}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="runId" value={proposal.discoveryRunId} />
      <input type="hidden" name="taskId" value={proposal.taskId} />
      <label>
        Participant prompt
        <textarea name="prompt" defaultValue={proposal.participantPrompt} required />
      </label>
      <label>
        Time limit (seconds)
        <input name="timeLimit" type="number" defaultValue="300" />
      </label>
      <label>
        Baseline commit
        <input name="commitSha" defaultValue="REPLACE_WITH_REAL_SHA" required />
      </label>
      <label>
        Environment ref
        <input name="environmentRef" defaultValue="baseline_preview" required />
      </label>
      <label>
        Fixture ref
        <input name="fixtureRef" defaultValue="excalidraw_fixture_v1" required />
      </label>
      <fieldset>
        <legend>Recruitment</legend>
        <label>
          Source
          <select name="recruitmentSource" defaultValue="marketplace">
            <option value="direct_link">direct_link</option>
            <option value="embedded">embedded</option>
            <option value="marketplace">marketplace</option>
          </select>
        </label>
        <label>
          Target count
          <input name="targetCount" type="number" defaultValue="2" />
        </label>
        <label>
          Cohort
          <input name="cohort" defaultValue="fresh" />
        </label>
      </fieldset>
      <fieldset>
        <legend>Capture</legend>
        {[
          ["screen", "required"],
          ["microphone", "required"],
          ["webcam", "off"],
        ].map(([name, value]) => (
          <label key={name}>
            {name}
            <select name={name} defaultValue={value}>
              <option value="required">required</option>
              <option value="optional">optional</option>
              <option value="off">off</option>
            </select>
          </label>
        ))}
        <label>
          Pointer
          <select name="pointer" defaultValue="on">
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </label>
        <label>
          Keyboard
          <select name="keyboard" defaultValue="semantic_only">
            <option value="semantic_only">semantic_only</option>
            <option value="off">off</option>
            <option value="on">on</option>
          </select>
        </label>
        <label>
          Text values
          <select name="textValues" defaultValue="off">
            <option value="off">off</option>
            <option value="on">on</option>
          </select>
        </label>
        <label>
          Retention days
          <input name="retentionDays" type="number" defaultValue="30" />
        </label>
      </fieldset>
      <fieldset>
        <legend>Automation</legend>
        <label>
          Mode
          <select name="automationMode" defaultValue="prototype_and_retest">
            <option value="issues_only">issues_only</option>
            <option value="draft_pr">draft_pr</option>
            <option value="prototype_and_retest">prototype_and_retest</option>
          </select>
        </label>
        <label>
          Max variants
          <input name="maxVariants" type="number" defaultValue="1" />
        </label>
        <label>
          Max repair attempts
          <input name="maxRepairAttempts" type="number" defaultValue="2" />
        </label>
        <label>
          Retest target count
          <input name="retestTargetCount" type="number" defaultValue="2" />
        </label>
      </fieldset>
      <button type="submit">Publish</button>
    </form>
  );
}
