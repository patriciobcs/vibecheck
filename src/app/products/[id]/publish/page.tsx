import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { publishStudy } from "@/services/studies";
import { tenantFromEnvironment } from "@/lib/auth";

async function publish(formData: FormData) {
  "use server";
  const tenantId = await tenantFromEnvironment();
  if (!tenantId) throw new Error("DEV_API_KEY is required");
  const result = await publishStudy(tenantId, crypto.randomUUID(), {
    product_id: formData.get("productId")!.toString(), discovery_run_id: formData.get("runId")!.toString(),
    task_id: formData.get("taskId")!.toString(), fixture_ref: formData.get("fixtureRef")!.toString(),
    baseline: { commit_sha: formData.get("commitSha")!.toString(), environment_ref: formData.get("environmentRef")!.toString() },
    task: { participant_prompt: formData.get("prompt")!.toString(), time_limit_seconds: Number(formData.get("timeLimit")) },
  });
  if (result) redirect(`/studies/${result.study.id}`);
}

export default async function PublishPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string; task?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const proposal = await prisma.proposal.findFirst({ where: { discoveryRun: { productId: id }, discoveryRunId: query.run, taskId: query.task } });
  if (!proposal) return <main><p>Proposal not found.</p></main>;
  return <main><h1>Publish study</h1><form action={publish}>
    <input type="hidden" name="productId" value={id} /><input type="hidden" name="runId" value={proposal.discoveryRunId} /><input type="hidden" name="taskId" value={proposal.taskId} />
    <label>Participant prompt<textarea name="prompt" defaultValue={proposal.participantPrompt} required /></label>
    <label>Time limit (seconds)<input name="timeLimit" type="number" defaultValue="300" /></label>
    <label>Baseline commit<input name="commitSha" defaultValue="REPLACE_WITH_REAL_SHA" required /></label>
    <label>Environment ref<input name="environmentRef" defaultValue="baseline_preview" required /></label>
    <label>Fixture ref<input name="fixtureRef" defaultValue="excalidraw_fixture_v1" required /></label>
    <button type="submit">Publish</button>
  </form></main>;
}
