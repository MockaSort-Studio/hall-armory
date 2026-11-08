import { GithubCancelledError, ghJson } from "../core/gh.ts";
import { failedWorkflowRunLog } from "../workflows/index.ts";

// Waiting for a pull request's CI without burning a model's turns: one blocking operation that returns when the
// checks of the PR's current head commit have settled. It has no deadline of its own (cancel it through the abort
// signal), and a failure carries the failed step's log tail so the caller can fix it instead of guessing. A requested
// `sha` that is still not the head after the grace period returns `stale` with the current head, so the caller can
// re-target instead of waiting for a commit that will never be checked again.

const PASSING = new Set(["success", "neutral", "skipped"]);
const FAILING_STATUS = new Set(["failure", "error"]);

export type CheckItem = { name: string; status: "completed" | "pending"; conclusion: string; url?: string; runId?: number };

// A rollup entry is a CheckRun (GitHub Actions and apps) or a StatusContext (commit statuses).
export function normalizeCheck(entry: any): CheckItem {
  const url = entry.detailsUrl ?? entry.targetUrl ?? undefined;
  const runId = /\/actions\/runs\/(\d+)/.exec(url ?? "")?.[1];
  const base = { url, ...(runId ? { runId: Number(runId) } : {}) };
  if (entry.__typename === "StatusContext" || "context" in entry) {
    const state = String(entry.state ?? "").toLowerCase();
    const done = state === "success" || FAILING_STATUS.has(state);
    return { name: entry.context, status: done ? "completed" : "pending", conclusion: done ? state : "", ...base };
  }
  const completed = entry.status === "COMPLETED";
  return {
    name: entry.workflowName ? `${entry.workflowName} / ${entry.name}` : entry.name,
    status: completed ? "completed" : "pending",
    conclusion: completed ? String(entry.conclusion ?? "").toLowerCase() : "",
    ...base,
  };
}

export function summarizeChecks(rollup: any[] | null | undefined) {
  const checks = (rollup ?? []).map(normalizeCheck);
  const failed = checks.filter((check) => check.status === "completed" && !PASSING.has(check.conclusion));
  const state = !checks.length ? "none" : failed.length ? "failure" : checks.some((c) => c.status === "pending") ? "pending" : "success";
  return { state, checks, failed };
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled while waiting for checks"));
    const timer = setTimeout(() => (signal?.removeEventListener("abort", onAbort), resolve()), ms);
    const onAbort = () => (clearTimeout(timer), reject(new Error("Cancelled while waiting for checks")));
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export type WaitOptions = {
  sha?: string;
  intervalSeconds?: number;
  noChecksGraceSeconds?: number;
  failFast?: boolean;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
};

const CANCELLED = "Cancelled while waiting for checks";

async function cancellable<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GithubCancelledError || signal?.aborted) throw new Error(CANCELLED, { cause: error });
    throw error;
  }
}

export async function waitForPullRequestChecks(repo: string, number: number, options: WaitOptions = {}) {
  const { sha, intervalSeconds = 15, noChecksGraceSeconds = 90, failFast = true, signal, sleep = defaultSleep, now = Date.now } = options;
  if (signal?.aborted) throw new Error(CANCELLED);
  const started = now();
  const waited = () => Math.round((now() - started) / 1000);
  for (;;) {
    const pr = await cancellable(signal, () => ghJson(["pr", "view", String(number), "-R", repo, "--json", "headRefOid,state,isDraft,statusCheckRollup"], signal ? { signal } : {}));
    const base = { repo, pullNumber: number, headSha: pr?.headRefOid, prState: pr?.state, isDraft: Boolean(pr?.isDraft), waitedSeconds: waited() };
    if (pr?.state && pr.state !== "OPEN") return { ...base, state: "closed", checks: [], failures: [] };
    // Right after a push GitHub may still report the previous head: only the requested commit counts.
    const stale = Boolean(sha) && pr?.headRefOid !== sha;
    const summary = stale ? { state: "pending", checks: [], failed: [] } : summarizeChecks(pr?.statusCheckRollup);
    const settled =
      summary.state === "success" || (summary.state === "failure" && (failFast || !summary.checks.some((c) => c.status === "pending")));
    if (settled) {
      const failures = [];
      const seen = new Set<number>();
      for (const check of summary.failed) {
        if (!check.runId || seen.has(check.runId)) continue;
        seen.add(check.runId);
        const { log, unavailable } = await cancellable(signal, () => failedWorkflowRunLog(repo, check.runId, 4000, signal));
        failures.push({ name: check.name, url: check.url, runId: check.runId, logTail: log, ...(unavailable ? { logUnavailable: true } : {}) });
      }
      for (const check of summary.failed) if (!check.runId) failures.push({ name: check.name, url: check.url, logTail: "" });
      return { ...base, state: summary.state, checks: summary.checks, failures };
    }
    if (stale && waited() >= noChecksGraceSeconds) return { ...base, state: "stale", requestedSha: sha, checks: [], failures: [] };
    if (summary.state === "none" && waited() >= noChecksGraceSeconds) return { ...base, state: "none", checks: [], failures: [] };
    await sleep(Math.max(5, Math.min(120, intervalSeconds)) * 1000, signal);
  }
}
