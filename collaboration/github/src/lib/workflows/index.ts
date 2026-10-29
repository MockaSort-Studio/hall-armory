import { gh, ghJson } from "../core/gh.ts";

const bounded = (value: string, max = 12_000) => value.length <= max ? value : `${value.slice(-max)}\n[truncated]`;

export function listWorkflowRuns(repo: string, workflow?: string, limit = 20) {
  const args = ["run", "list", "-R", repo, "--limit", String(Math.min(limit, 100)), "--json", "databaseId,name,status,conclusion,workflowName,headBranch,headSha,event,createdAt,updatedAt,url"];
  if (workflow) args.splice(2, 0, "--workflow", workflow);
  return ghJson(args);
}
export function viewWorkflowRun(repo: string, runId: number) {
  return ghJson(["run", "view", String(runId), "-R", repo, "--json", "databaseId,name,status,conclusion,workflowName,headBranch,headSha,event,createdAt,updatedAt,url,jobs"]);
}
export async function failedWorkflowRunLog(repo: string, runId: number, maxChars = 12_000) {
  try {
    return { runId, log: bounded(await gh(["run", "view", String(runId), "-R", repo, "--log-failed"]), Math.min(maxChars, 12_000)) };
  } catch (error) {
    return { runId, log: "", unavailable: String(error) };
  }
}
