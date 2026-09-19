import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { publishStudy } from "@/services/studies";
import { tenantFromEnvironment } from "@/lib/auth";

async function publish(formData: FormData) {
  "use server";
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) throw new Error("DEV_API_KEY is required");
  const result = await publishStudy(tenantId, randomUUID(), {
    product_id: formData.get("productId")!.toString(), discovery_run_id: formData.get("runId")!.toString(),
    task_id: formData.get("taskId")!.toString(), fixture_ref: formData.get("fixtureRef")!.toString(),
    baseline: { commit_sha: formData.get("commitSha")!.toString(), environment_ref: formData.get("environmentRef")!.toString() },
    task: { participant_prompt: formData.get("prompt")!.toString(), time_limit_seconds: Number(formData.get("timeLimit")) },
    recruitment: { source: formData.get("recruitmentSource")!.toString() as "direct_link" | "embedded" | "marketplace", target_count: Number(formData.get("targetCount")), cohort: formData.get("cohort")!.toString(), eligibility_rule_ref: "eligible_whiteboard_users_v1" },
    capture: { screen: formData.get("screen")!.toString() as "required" | "optional" | "off", microphone: formData.get("microphone")!.toString() as "required" | "optional" | "off", webcam: formData.get("webcam")!.toString() as "required" | "optional" | "off", pointer: formData.get("pointer")!.toString() as "on" | "off", keyboard: formData.get("keyboard")!.toString() as "semantic_only" | "off" | "on", text_values: formData.get("textValues")!.toString() as "off" | "on", retention_days: Number(formData.get("retentionDays")) },
    automation: { mode: formData.get("automationMode")!.toString() as "issues_only" | "draft_pr" | "prototype_and_retest", max_variants: Number(formData.get("maxVariants")), max_repair_attempts: Number(formData.get("maxRepairAttempts")), agent_budget_ref: "demo_budget", retest_target_count: Number(formData.get("retestTargetCount")) },
  });
  if (result) redirect(`/studies/${result.study.id}`);
}

export default async function PublishPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string; task?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) notFound();
  const proposal = await prisma.proposal.findFirst({ where: { tenantId, discoveryRun: { productId: id, tenantId }, discoveryRunId: query.run, taskId: query.task } });
  if (!proposal) notFound();
  return <main><h1>Publish study</h1><form action={publish}>
    <input type="hidden" name="productId" value={id} /><input type="hidden" name="runId" value={proposal.discoveryRunId} /><input type="hidden" name="taskId" value={proposal.taskId} />
    <label>Participant prompt<textarea name="prompt" defaultValue={proposal.participantPrompt} required /></label>
    <label>Time limit (seconds)<input name="timeLimit" type="number" defaultValue="300" /></label>
    <label>Baseline commit<input name="commitSha" defaultValue="REPLACE_WITH_REAL_SHA" required /></label>
    <label>Environment ref<input name="environmentRef" defaultValue="baseline_preview" required /></label>
    <label>Fixture ref<input name="fixtureRef" defaultValue="excalidraw_fixture_v1" required /></label>
    <fieldset><legend>Recruitment</legend><label>Source<select name="recruitmentSource" defaultValue="marketplace"><option>direct_link</option><option>embedded</option><option>marketplace</option></select></label><label>Target count<input name="targetCount" type="number" defaultValue="2" /></label><label>Cohort<input name="cohort" defaultValue="fresh" /></label></fieldset>
    <fieldset><legend>Capture</legend>{[["screen","required"],["microphone","required"],["webcam","off"]].map(([name, value]) => <label key={name}>{name}<select name={name} defaultValue={value}><option>required</option><option>optional</option><option>off</option></select></label>)}<label>Pointer<select name="pointer" defaultValue="on"><option>on</option><option>off</option></select></label><label>Keyboard<select name="keyboard" defaultValue="semantic_only"><option>semantic_only</option><option>off</option><option>on</option></select></label><label>Text values<select name="textValues" defaultValue="off"><option>off</option><option>on</option></select></label><label>Retention days<input name="retentionDays" type="number" defaultValue="30" /></label></fieldset>
    <fieldset><legend>Automation</legend><label>Mode<select name="automationMode" defaultValue="prototype_and_retest"><option>issues_only</option><option>draft_pr</option><option>prototype_and_retest</option></select></label><label>Max variants<input name="maxVariants" type="number" defaultValue="1" /></label><label>Max repair attempts<input name="maxRepairAttempts" type="number" defaultValue="2" /></label><label>Retest target count<input name="retestTargetCount" type="number" defaultValue="2" /></label></fieldset>
    <button type="submit">Publish</button>
  </form></main>;
}
