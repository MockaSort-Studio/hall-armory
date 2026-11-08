import { createHash } from "node:crypto";
import { GithubCancelledError, GithubOversizedError, gh, ghBytes, ghJson } from "../core/gh.ts";
import { ArchiveError, listArchive, readArchiveEntry } from "./artifact-zip.ts";

// Failure evidence of one authorized workflow run: a selected job or step log, paged by line from its first error,
// or the text of one file inside one of the run's artifacts. Every request is bound to repo -> run -> job/artifact
// with the API before any evidence is fetched, and downloads only use URLs built from those bound ids, never URLs
// found in metadata. Each outcome is a distinct `state` so a caller can tell "not yet" from "never".

export type EvidenceState = "ok" | "running" | "unavailable" | "expired" | "missing" | "oversized" | "malformed";

export const LIMITS = {
  maxChars: 12_000,
  defaultLines: 200,
  maxLines: 2_000,
  contextLines: 30,
  maxLogBytes: 16 * 1024 * 1024,
  maxArchiveBytes: 8 * 1024 * 1024,
  maxEntryBytes: 4 * 1024 * 1024,
  maxEntries: 1_000,
  maxListedEntries: 200,
  maxPages: 10,
};

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type EvidenceInput = {
  repo: string;
  runId: number;
  maxChars?: number;
  jobId?: number;
  step?: number;
  firstFailure?: boolean;
  startLine?: number;
  maxLines?: number;
  artifactId?: number;
  artifactName?: string;
  artifactPath?: string;
};

export const EVIDENCE_OPTIONS = ["jobId", "step", "firstFailure", "startLine", "maxLines", "artifactId", "artifactName", "artifactPath"] as const;
export const wantsEvidence = (input: Record<string, unknown>) => EVIDENCE_OPTIONS.some((key) => input[key] !== undefined);

class InvalidInput extends Error {
  constructor(message: string) {
    super(`Invalid workflow evidence request: ${message}`);
    this.name = "InvalidInput";
  }
}

const positive = (value: unknown, name: string, max = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined) return;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) throw new InvalidInput(`${name} must be an integer from 1 to ${max}`);
};

// The registered schema states these bounds; the guest runner does not apply schemas, so they are checked again here.
export function validateEvidenceInput(input: EvidenceInput) {
  if (typeof input.repo !== "string" || !REPO.test(input.repo) || input.repo.split("/").some((part) => part === "." || part === ".."))
    throw new InvalidInput("repo must be owner/name");
  positive(input.runId, "runId");
  positive(input.maxChars, "maxChars", LIMITS.maxChars);
  positive(input.jobId, "jobId");
  positive(input.step, "step", 1_000);
  positive(input.startLine, "startLine");
  positive(input.maxLines, "maxLines", LIMITS.maxLines);
  positive(input.artifactId, "artifactId");
  if (input.firstFailure !== undefined && typeof input.firstFailure !== "boolean") throw new InvalidInput("firstFailure must be a boolean");
  if (input.artifactName !== undefined && (typeof input.artifactName !== "string" || !input.artifactName || input.artifactName.length > 256))
    throw new InvalidInput("artifactName must be a non-empty string");
  if (input.artifactPath !== undefined && (typeof input.artifactPath !== "string" || !input.artifactPath || input.artifactPath.length > 1024))
    throw new InvalidInput("artifactPath must be a non-empty string");
  const artifact = input.artifactId !== undefined || input.artifactName !== undefined;
  if (input.artifactPath !== undefined && !artifact) throw new InvalidInput("artifactPath needs artifactId or artifactName");
  if (artifact && (input.jobId !== undefined || input.step !== undefined || input.firstFailure !== undefined))
    throw new InvalidInput("select either a job log or an artifact, not both");
  if (input.step !== undefined && input.jobId === undefined) throw new InvalidInput("step needs jobId");
}

const result = (input: EvidenceInput, state: EvidenceState, extra: Record<string, unknown> = {}) => ({ repo: input.repo, runId: input.runId, state, ...extra });

// A GitHub failure becomes an evidence state; cancellation and anything unexpected stay errors.
function classify(error: any): { state: EvidenceState; reason: string } {
  if (error instanceof GithubCancelledError) throw error;
  if (error instanceof GithubOversizedError) return { state: "oversized", reason: error.message };
  if (error?.status === 410) return { state: "expired", reason: "GitHub reports the evidence has expired (HTTP 410)" };
  if (error?.status === 404) return { state: "unavailable", reason: "GitHub has no such evidence (HTTP 404)" };
  if (error instanceof SyntaxError || error?.cause instanceof SyntaxError) return { state: "malformed", reason: "GitHub returned malformed JSON" };
  return { state: "unavailable", reason: String(error?.message ?? error) };
}

async function bindRun(input: EvidenceInput, signal?: AbortSignal) {
  try {
    const run = await ghJson(["api", `repos/${input.repo}/actions/runs/${input.runId}`], { signal, operation: "view workflow run", resource: `${input.repo} run ${input.runId}` });
    if (!run || run.id !== input.runId) return { failure: result(input, "malformed", { reason: "GitHub returned a different or empty run" }) };
    const owner = run.repository?.full_name;
    if (owner && owner.toLowerCase() !== input.repo.toLowerCase()) return { failure: result(input, "missing", { reason: `run ${input.runId} is not in ${input.repo}` }) };
    return { run };
  } catch (error) {
    const { state, reason } = classify(error);
    return { failure: result(input, state === "unavailable" && (error as any)?.status === 404 ? "missing" : state, { reason }) };
  }
}

async function pages(input: EvidenceInput, path: string, key: string, signal?: AbortSignal) {
  const items = [];
  for (let page = 1; page <= LIMITS.maxPages; page++) {
    const body = await ghJson(["api", `${path}?per_page=100&page=${page}`], { signal, operation: `list ${key}`, resource: `${input.repo} run ${input.runId}` });
    const batch = body?.[key];
    if (!Array.isArray(batch)) throw new SyntaxError(`GitHub returned no ${key} list`);
    items.push(...batch);
    if (batch.length < 100 || items.length >= (body.total_count ?? 0)) return items;
  }
  return items;
}

const sanitize = (line: string) => line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "\uFFFD");

// One page of lines: at most `maxLines` lines and `maxChars` characters, with an explicit continuation.
export function page(lines: string[], start: number, maxLines: number, maxChars: number) {
  const totalLines = lines.length;
  const out: string[] = [];
  let chars = 0, lineTruncated = false, index = start - 1;
  for (; index < totalLines && out.length < maxLines; index++) {
    const line = lines[index];
    const cost = line.length + (out.length ? 1 : 0);
    if (chars + cost > maxChars) {
      if (out.length) break;
      out.push(line.slice(0, maxChars));
      lineTruncated = true;
      index++;
      break;
    }
    out.push(line);
    chars += cost;
  }
  const endLine = index;
  const truncated = endLine < totalLines;
  return {
    startLine: start,
    endLine,
    totalLines,
    text: out.join("\n"),
    truncated,
    ...(lineTruncated ? { lineTruncated: true } : {}),
    continuation: truncated ? { startLine: endLine + 1 } : null,
  };
}

function pageOrMissing(input: EvidenceInput, lines: string[], start: number, extra: Record<string, unknown>) {
  if (start > Math.max(lines.length, 1)) return result(input, "missing", { ...extra, totalLines: lines.length, reason: `startLine ${start} is beyond the last line ${lines.length}` });
  return result(input, "ok", { ...extra, ...page(lines, start, input.maxLines ?? LIMITS.defaultLines, input.maxChars ?? LIMITS.maxChars) });
}

const jobSummary = (job) => ({ id: job.id, name: job.name, status: job.status, conclusion: job.conclusion });
const stepSummary = (step) => step && { number: step.number, name: step.name, status: step.status, conclusion: step.conclusion };

export async function jobLogEvidence(input: EvidenceInput, signal?: AbortSignal) {
  const { run, failure } = await bindRun(input, signal);
  if (failure) return failure;
  let jobs;
  try {
    jobs = (await pages(input, `repos/${input.repo}/actions/runs/${input.runId}/jobs`, "jobs", signal)).filter((job) => job?.run_id === input.runId);
  } catch (error) {
    const { state, reason } = classify(error);
    return result(input, state, { reason });
  }
  const ordered = [...jobs].sort((a, b) => String(a.started_at ?? "").localeCompare(String(b.started_at ?? "")) || a.id - b.id);
  const job = input.jobId !== undefined ? jobs.find((candidate) => candidate.id === input.jobId) : ordered.find((candidate) => FAILED.has(candidate.conclusion));
  if (!job) {
    if (input.jobId !== undefined) return result(input, "missing", { reason: `job ${input.jobId} is not part of run ${input.runId} in ${input.repo}` });
    if (run.status !== "completed") return result(input, "running", { runStatus: run.status, reason: "the run has no failed job yet" });
    return result(input, "missing", { runConclusion: run.conclusion, reason: "the run has no failed job" });
  }
  if (job.status !== "completed") return result(input, "running", { job: jobSummary(job), reason: "the job has not completed" });
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const step = input.step !== undefined ? steps.find((candidate) => candidate.number === input.step) : steps.find((candidate) => FAILED.has(candidate.conclusion));
  if (input.step !== undefined && !step) return result(input, "missing", { job: jobSummary(job), reason: `step ${input.step} is not part of job ${job.id}` });

  let text: string;
  try {
    // `gh` resolves and downloads the job's own log from these bound ids; it prefixes each line with job and step.
    text = await gh(["run", "view", String(input.runId), "-R", input.repo, "--job", String(job.id), "--log"], {
      signal,
      maxBuffer: LIMITS.maxLogBytes,
      operation: "read job log",
      resource: `${input.repo} job ${job.id}`,
    });
  } catch (error) {
    const { state, reason } = classify(error);
    return result(input, state, { job: jobSummary(job), reason });
  }
  const rows = text ? text.split(/\r?\n/).map((row) => {
    const [, stepName, ...rest] = row.split("\t");
    return rest.length ? { step: stepName, line: sanitize(rest.join("\t")) } : { step: undefined, line: sanitize(row) };
  }) : [];
  let selected = step ? rows.filter((row) => row.step === step.name) : rows;
  const stepResolved = !step || selected.length > 0;
  if (!stepResolved) selected = rows;
  const lines = selected.map((row) => row.line);
  const firstError = lines.findIndex((line) => line.includes("##[error]"));
  const fromFailure = input.startLine === undefined && input.firstFailure !== false;
  const start = input.startLine ?? (fromFailure && firstError >= 0 ? Math.max(1, firstError + 1 - LIMITS.contextLines) : 1);
  return pageOrMissing(input, lines, start, {
    source: "job_log",
    job: jobSummary(job),
    step: stepSummary(step) ?? null,
    stepResolved,
    firstErrorLine: firstError >= 0 ? firstError + 1 : null,
  });
}

const artifactSummary = (artifact) => ({
  id: artifact.id,
  name: artifact.name,
  sizeInBytes: artifact.size_in_bytes,
  expired: Boolean(artifact.expired),
  ...(artifact.digest ? { digest: artifact.digest } : {}),
  createdAt: artifact.created_at,
  expiresAt: artifact.expires_at,
});

// Artifacts of one run; download URLs from the metadata are deliberately dropped.
export async function listRunArtifacts(repo: string, runId: number, signal?: AbortSignal) {
  const input = { repo, runId };
  validateEvidenceInput(input);
  const artifacts = await pages(input, `repos/${repo}/actions/runs/${runId}/artifacts`, "artifacts", signal);
  return artifacts.filter((artifact) => artifact?.workflow_run?.id === undefined || artifact.workflow_run.id === runId).map(artifactSummary);
}

function verifyDigest(bytes: Uint8Array, digest: unknown) {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(String(digest ?? ""));
  if (!match) return "not-provided";
  return createHash("sha256").update(bytes).digest("hex") === match[1].toLowerCase() ? "sha256-verified" : "mismatch";
}

function decodeText(bytes: Uint8Array) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  return text.includes("\u0000") ? undefined : text;
}

export async function artifactEvidence(input: EvidenceInput, signal?: AbortSignal) {
  const { run, failure } = await bindRun(input, signal);
  if (failure) return failure;
  if (run.status !== "completed") return result(input, "running", { runStatus: run.status, reason: "artifacts are read only from a completed run" });
  let artifacts;
  try {
    artifacts = await pages(input, `repos/${input.repo}/actions/runs/${input.runId}/artifacts`, "artifacts", signal);
  } catch (error) {
    const { state, reason } = classify(error);
    return result(input, state, { reason });
  }
  const artifact = artifacts.find((candidate) =>
    candidate &&
    (input.artifactId === undefined || candidate.id === input.artifactId) &&
    (input.artifactName === undefined || candidate.name === input.artifactName) &&
    (candidate.workflow_run?.id === undefined || candidate.workflow_run.id === input.runId));
  const wanted = input.artifactId !== undefined ? `artifact ${input.artifactId}` : `artifact ${JSON.stringify(input.artifactName)}`;
  if (!artifact || !Number.isInteger(artifact.id)) return result(input, "missing", { reason: `${wanted} is not part of run ${input.runId} in ${input.repo}` });
  const summary = artifactSummary(artifact);
  if (artifact.expired) return result(input, "expired", { artifact: summary, reason: "the artifact has expired" });
  if (!(artifact.size_in_bytes <= LIMITS.maxArchiveBytes))
    return result(input, "oversized", { artifact: summary, reason: `the artifact is ${artifact.size_in_bytes} bytes; the limit is ${LIMITS.maxArchiveBytes}` });

  let bytes: Uint8Array;
  try {
    bytes = await ghBytes(["api", `repos/${input.repo}/actions/artifacts/${artifact.id}/zip`], {
      maxBytes: LIMITS.maxArchiveBytes,
      signal,
      operation: "download artifact",
      resource: `${input.repo} artifact ${artifact.id}`,
    });
  } catch (error) {
    const { state, reason } = classify(error);
    return result(input, state, { artifact: summary, reason });
  }
  const integrity = verifyDigest(bytes, artifact.digest);
  if (integrity === "mismatch") return result(input, "malformed", { artifact: summary, integrity, reason: "the downloaded artifact does not match its digest" });
  const limits = { maxEntries: LIMITS.maxEntries, maxEntryBytes: LIMITS.maxEntryBytes };
  try {
    if (input.artifactPath === undefined) {
      const entries = (await listArchive(bytes, limits)).filter((entry) => !entry.directory);
      return result(input, "ok", {
        source: "artifact",
        artifact: summary,
        integrity,
        entries: entries.slice(0, LIMITS.maxListedEntries).map(({ path, size }) => ({ path, size })),
        totalEntries: entries.length,
        truncated: entries.length > LIMITS.maxListedEntries,
      });
    }
    const content = await readArchiveEntry(bytes, input.artifactPath, limits);
    if (!content) return result(input, "missing", { artifact: summary, integrity, reason: `the artifact has no file ${JSON.stringify(input.artifactPath)}` });
    const text = decodeText(content);
    if (text === undefined) return result(input, "malformed", { artifact: summary, integrity, path: input.artifactPath, reason: "the file is not UTF-8 text" });
    const lines = text ? text.split(/\r?\n/).map(sanitize) : [];
    return pageOrMissing(input, lines, input.startLine ?? 1, { source: "artifact", artifact: summary, integrity, path: input.artifactPath });
  } catch (error) {
    if (error instanceof ArchiveError) return result(input, error.state, { artifact: summary, integrity, reason: error.message });
    throw error;
  }
}

export function workflowRunEvidence(input: EvidenceInput, signal?: AbortSignal) {
  validateEvidenceInput(input);
  return input.artifactId !== undefined || input.artifactName !== undefined ? artifactEvidence(input, signal) : jobLogEvidence(input, signal);
}
