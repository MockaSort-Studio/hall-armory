import { gh, ghJson } from "../core/gh.ts";
import { listRunArtifacts, wantsEvidence, workflowRunEvidence, type EvidenceInput } from "./evidence.ts";

const bounded = (value: string, max = 12_000) => value.length <= max ? value : `${value.slice(-max)}\n[truncated]`;

export function listWorkflowRuns(repo: string, workflow?: string, limit = 20) {
  const args = ["run", "list", "-R", repo, "--limit", String(Math.min(limit, 100)), "--json", "databaseId,name,status,conclusion,workflowName,headBranch,headSha,event,createdAt,updatedAt,url"];
  if (workflow) args.splice(2, 0, "--workflow", workflow);
  return ghJson(args);
}

// `artifacts: true` adds the run's artifact metadata (ids, names, sizes, expiry, digest; never download URLs).
export async function viewWorkflowRun(repo: string, runId: number, options: { artifacts?: boolean; signal?: AbortSignal } = {}) {
  const run = await ghJson(["run", "view", String(runId), "-R", repo, "--json", "databaseId,name,status,conclusion,workflowName,headBranch,headSha,event,createdAt,updatedAt,url,jobs"], options.signal ? { signal: options.signal } : {});
  if (!options.artifacts) return run;
  return { ...run, artifacts: await listRunArtifacts(repo, runId, options.signal) };
}

export async function failedWorkflowRunLog(repo: string, runId: number, maxChars = 12_000, signal?: AbortSignal) {
  try {
    return { runId, log: bounded(await gh(["run", "view", String(runId), "-R", repo, "--log-failed"], signal ? { signal } : {}), Math.min(maxChars, 12_000)) };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { runId, log: "", unavailable: String(error) };
  }
}

// Without evidence options this is the original bounded failed-log tail; with them it is the selected evidence page.
export function workflowRunFailureEvidence(input: EvidenceInput, signal?: AbortSignal) {
  return wantsEvidence(input as Record<string, unknown>) ? workflowRunEvidence(input, signal) : failedWorkflowRunLog(input.repo, input.runId, input.maxChars, signal);
}
