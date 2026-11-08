import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { activateSuite } from "../src/index.ts";
import { githubOperationDescriptors } from "../src/lib/suite.ts";
import { fakeGithub, fakePi, httpError } from "./helpers/fake-github.mjs";
import { zip } from "./helpers/zip.mjs";

const RUN = "api repos/o/r/actions/runs/7";
const JOBS = "api repos/o/r/actions/runs/7/jobs?per_page=100&page=1";
const ARTIFACTS = "api repos/o/r/actions/runs/7/artifacts?per_page=100&page=1";
const LOG = "run view 7 -R o/r --job 21 --log";
const ZIP = "api repos/o/r/actions/artifacts/11/zip";

const run = (extra = {}) => ({ id: 7, status: "completed", conclusion: "failure", repository: { full_name: "o/r" }, ...extra });
const jobs = (extra = {}) => ({
  total_count: 3,
  jobs: [
    { id: 20, run_id: 7, name: "lint", status: "completed", conclusion: "success", started_at: "2024-01-01T00:00:01Z", steps: [] },
    { id: 21, run_id: 7, name: "build", status: "completed", conclusion: "failure", started_at: "2024-01-01T00:00:02Z", steps: [
      { number: 1, name: "Set up job", status: "completed", conclusion: "success" },
      { number: 2, name: "Run tests", status: "completed", conclusion: "failure" },
    ], ...extra },
    // A job that claims another run is never selectable through this one.
    { id: 99, run_id: 8, name: "other", status: "completed", conclusion: "failure", started_at: "2024-01-01T00:00:00Z", steps: [] },
  ],
});
// gh prints `job<TAB>step<TAB>timestamp line` for every job log line.
const jobLog = [
  ...Array.from({ length: 5 }, (_, i) => `build\tSet up job\t2024-01-01T00:00:00Z setup ${i + 1}`),
  ...Array.from({ length: 100 }, (_, i) => `build\tRun tests\t2024-01-01T00:00:01Z ${i + 1 === 60 ? "##[error]boom" : `test line ${i + 1}`}`),
].join("\n");

function suite(routes) {
  const github = fakeGithub(routes);
  const pi = fakePi();
  activateSuite(pi, { commandTransport: github.transport });
  const call = (name, input, signal) => pi.tools.get(name).execute("call", input, signal).then((r) => r.details);
  return { ...github, call, evidence: (input, signal) => call("github_workflow_run_failed_log", { repo: "o/r", runId: 7, ...input }, signal) };
}

test("the catalog keeps its 49 operations and only adds optional evidence inputs", () => {
  const descriptors = githubOperationDescriptors();
  assert.equal(descriptors.length, 49);
  const failedLog = descriptors.find((d) => d.name === "github_workflow_run_failed_log").parameters;
  assert.deepEqual([...failedLog.required].sort(), ["repo", "runId"]);
  for (const key of ["maxChars", "jobId", "step", "firstFailure", "startLine", "maxLines", "artifactId", "artifactName", "artifactPath"])
    assert.ok(failedLog.properties[key], `${key} is declared`);
  assert.equal(failedLog.properties.maxLines.maximum, 2000);
  const view = descriptors.find((d) => d.name === "github_workflow_run_view").parameters;
  assert.deepEqual([...view.required].sort(), ["repo", "runId"]);
  assert.ok(view.properties.artifacts);
});

test("without evidence options the failed log is the original bounded tail through the same command", async () => {
  const s = suite({ "run view 7 -R o/r --log-failed": "y".repeat(13000) });
  const result = await s.evidence({ maxChars: 100 });
  assert.deepEqual(Object.keys(result).sort(), ["log", "runId"]);
  assert.equal(result.log, `${"y".repeat(100)}\n[truncated]`);
  assert.deepEqual(s.calls, [{ args: ["run", "view", "7", "-R", "o/r", "--log-failed"], options: {} }], "old transports receive the same options");
});

test("the first failure block is the failed step of the first failed job, paged from its first error", async () => {
  const s = suite({ [RUN]: run(), [JOBS]: jobs(), [LOG]: jobLog });
  const first = await s.evidence({ maxLines: 20 });
  assert.equal(first.state, "ok");
  assert.equal(first.source, "job_log");
  assert.deepEqual(first.job, { id: 21, name: "build", status: "completed", conclusion: "failure" });
  assert.equal(first.step.name, "Run tests");
  assert.equal(first.stepResolved, true);
  assert.equal(first.totalLines, 100);
  assert.equal(first.firstErrorLine, 60);
  assert.equal(first.startLine, 30);
  assert.equal(first.endLine, 49);
  assert.equal(first.truncated, true);
  assert.deepEqual(first.continuation, { startLine: 50 });
  assert.match(first.text, /^2024-01-01T00:00:01Z test line 30\n/);
  assert.ok(!first.text.includes("\t"), "job and step columns are metadata, not text");

  const next = await s.evidence({ jobId: 21, startLine: first.continuation.startLine, maxLines: 20 });
  assert.equal(next.startLine, 50);
  assert.match(next.text, /##\[error\]boom/);

  const last = await s.evidence({ jobId: 21, startLine: 95, maxLines: 20 });
  assert.equal(last.endLine, 100);
  assert.equal(last.truncated, false);
  assert.equal(last.continuation, null);

  const whole = await s.evidence({ jobId: 21, step: 1 });
  assert.equal(whole.step.name, "Set up job");
  assert.equal(whole.totalLines, 5);
  assert.equal(whole.firstErrorLine, null);

  const fromTop = await s.evidence({ firstFailure: false, maxLines: 1 });
  assert.equal(fromTop.startLine, 1);
  assert.ok(s.keys().every((key) => [RUN, JOBS, LOG].includes(key)), "only bound ids reach GitHub");
});

test("maxChars bounds the page and an over-long line is cut with an explicit flag", async () => {
  const s = suite({ [RUN]: run(), [JOBS]: jobs(), [LOG]: `build\tRun tests\t${"z".repeat(500)}\nbuild\tRun tests\tnext` });
  const result = await s.evidence({ jobId: 21, maxChars: 100 });
  assert.equal(result.text.length, 100);
  assert.equal(result.lineTruncated, true);
  assert.deepEqual(result.continuation, { startLine: 2 });
});

test("jobs and steps must belong to the requested run before any log is fetched", async () => {
  const s = suite({ [RUN]: run(), [JOBS]: jobs(), [LOG]: jobLog });
  const crossRun = await s.evidence({ jobId: 99 });
  assert.equal(crossRun.state, "missing");
  assert.match(crossRun.reason, /not part of run 7/);
  const noStep = await s.evidence({ jobId: 21, step: 9 });
  assert.equal(noStep.state, "missing");
  assert.ok(!s.keys().includes(LOG), "no log was fetched for an unbound job");
  assert.ok(!s.keys().some((key) => key.includes("--job 99")));
});

test("a run in another repository or a missing run is missing, not fetched", async () => {
  const foreign = suite({ "api repos/o/x/actions/runs/7": run() });
  const result = await foreign.call("github_workflow_run_failed_log", { repo: "o/x", runId: 7, jobId: 21 });
  assert.equal(result.state, "missing");
  assert.match(result.reason, /not in o\/x/);
  assert.deepEqual(foreign.keys(), ["api repos/o/x/actions/runs/7"]);
  const gone = suite({});
  assert.equal((await gone.evidence({ jobId: 21 })).state, "missing");
});

test("malformed bounds and selectors are rejected before calling GitHub", async () => {
  const s = suite({});
  for (const input of [{ maxLines: 0 }, { maxLines: 2001 }, { startLine: 0 }, { startLine: 1.5 }, { step: 2 }, { artifactPath: "a.txt" }, { jobId: 21, artifactId: 11 }, { maxChars: 12001, jobId: 1 }, { firstFailure: "yes" }]) {
    await assert.rejects(s.evidence(input), /Invalid workflow evidence request/, JSON.stringify(input));
  }
  await assert.rejects(s.call("github_workflow_run_failed_log", { repo: "o/r/../x", runId: 7, jobId: 1 }), /repo must be owner\/name/);
  assert.deepEqual(s.calls, []);
  const beyond = suite({ [RUN]: run(), [JOBS]: jobs(), [LOG]: jobLog });
  const result = await beyond.evidence({ jobId: 21, startLine: 500 });
  assert.equal(result.state, "missing");
  assert.match(result.reason, /beyond the last line 100/);
});

test("running, expired, unavailable and oversized logs are distinct results", async () => {
  const running = suite({ [RUN]: run({ status: "in_progress", conclusion: null }), [JOBS]: jobs({ status: "in_progress", conclusion: null }) });
  assert.equal((await running.evidence({ jobId: 21 })).state, "running");
  const noFailureYet = suite({ [RUN]: run({ status: "in_progress", conclusion: null }), [JOBS]: { total_count: 0, jobs: [] } });
  assert.equal((await noFailureYet.evidence({ maxLines: 5 })).state, "running");
  const passed = suite({ [RUN]: run({ conclusion: "success" }), [JOBS]: { total_count: 0, jobs: [] } });
  assert.equal((await passed.evidence({ maxLines: 5 })).state, "missing");
  assert.equal((await suite({ [RUN]: run(), [JOBS]: jobs(), [LOG]: httpError(410) }).evidence({ jobId: 21 })).state, "expired");
  assert.equal((await suite({ [RUN]: run(), [JOBS]: jobs(), [LOG]: httpError(404) }).evidence({ jobId: 21 })).state, "unavailable");
  const big = suite({ [RUN]: run(), [JOBS]: jobs(), [LOG]: Object.assign(new Error("spawnSync gh ENOBUFS"), { code: "ENOBUFS" }) });
  assert.equal((await big.evidence({ jobId: 21 })).state, "oversized");
  assert.equal(big.calls.find((c) => c.args.includes("--log")).options.maxBuffer, 16 * 1024 * 1024);
  assert.equal((await suite({ [RUN]: run(), [JOBS]: "{not json" }).evidence({ jobId: 21 })).state, "malformed");
});

test("aborting during a log download rejects through the registered tool and reaches the transport", async () => {
  let seen;
  const s = suite({ [RUN]: run(), [JOBS]: jobs(), [LOG]: (_args, options) => { seen = options.signal; return new Promise(() => {}); } });
  const controller = new AbortController();
  const pending = s.evidence({ jobId: 21 }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /Cancelled/);
  assert.equal(seen, controller.signal, "the transport received the tool call's signal");
});

// Artifacts.
const archive = zip([{ name: "reports/", data: "" }, { name: "reports/junit.txt", data: "case a ok\ncase b FAILED\nexpected 1 got 2" }, { name: "trace.bin", data: Buffer.from([0, 1, 2]) }]);
const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
const artifact = (extra = {}) => ({ id: 11, name: "diagnostics", size_in_bytes: archive.length, expired: false, digest, workflow_run: { id: 7 }, archive_download_url: "https://attacker.example/steal", created_at: "c", expires_at: "e", ...extra });
const artifacts = (...list) => ({ total_count: list.length, artifacts: list });
const bytesRoute = (bytes) => (_args, options) => (options.encoding === "buffer" ? bytes : bytes.toString("latin1"));

test("artifact text is read from the bound run's artifact by id-built URL only", async () => {
  const s = suite({ [RUN]: run(), [ARTIFACTS]: artifacts(artifact()), [ZIP]: bytesRoute(archive) });
  const listing = await s.evidence({ artifactName: "diagnostics" });
  assert.equal(listing.state, "ok");
  assert.equal(listing.integrity, "sha256-verified");
  assert.deepEqual(listing.entries, [{ path: "reports/junit.txt", size: 40 }, { path: "trace.bin", size: 3 }]);
  assert.ok(!JSON.stringify(listing).includes("attacker"), "download URLs from metadata are not echoed");

  const page = await s.evidence({ artifactId: 11, artifactPath: "reports/junit.txt", maxLines: 2 });
  assert.equal(page.state, "ok");
  assert.equal(page.text, "case a ok\ncase b FAILED");
  assert.deepEqual(page.continuation, { startLine: 3 });
  assert.ok(s.keys().every((key) => [RUN, ARTIFACTS, ZIP].includes(key)));
  const download = s.calls.find((c) => c.args.join(" ") === ZIP);
  assert.equal(download.options.encoding, "buffer");
  assert.equal(download.options.maxBuffer, 8 * 1024 * 1024);

  const binary = await s.evidence({ artifactId: 11, artifactPath: "trace.bin" });
  assert.equal(binary.state, "malformed");
  assert.match(binary.reason, /not UTF-8 text/);
  assert.equal((await s.evidence({ artifactId: 11, artifactPath: "nope.txt" })).state, "missing");
});

test("run view lists artifacts without download URLs only when asked", async () => {
  const s = suite({ "run view 7 -R o/r --json databaseId,name,status,conclusion,workflowName,headBranch,headSha,event,createdAt,updatedAt,url,jobs": { databaseId: 7 }, [ARTIFACTS]: artifacts(artifact()) });
  assert.deepEqual(await s.call("github_workflow_run_view", { repo: "o/r", runId: 7 }), { databaseId: 7 });
  assert.equal(s.calls.length, 1);
  const withArtifacts = await s.call("github_workflow_run_view", { repo: "o/r", runId: 7, artifacts: true });
  assert.deepEqual(withArtifacts.artifacts, [{ id: 11, name: "diagnostics", sizeInBytes: archive.length, expired: false, digest, createdAt: "c", expiresAt: "e" }]);
});

test("artifacts of another run, expired, oversized or of a running run are not downloaded", async () => {
  const cases = [
    [{ [RUN]: run(), [ARTIFACTS]: artifacts(artifact()) }, { artifactId: 12 }, "missing"],
    [{ [RUN]: run(), [ARTIFACTS]: artifacts(artifact({ workflow_run: { id: 8 } })) }, { artifactId: 11 }, "missing"],
    [{ [RUN]: run(), [ARTIFACTS]: artifacts(artifact({ expired: true })) }, { artifactId: 11 }, "expired"],
    [{ [RUN]: run(), [ARTIFACTS]: artifacts(artifact({ size_in_bytes: 9 * 1024 * 1024 })) }, { artifactId: 11 }, "oversized"],
    [{ [RUN]: run({ status: "in_progress" }) }, { artifactId: 11 }, "running"],
    [{ [RUN]: run(), [ARTIFACTS]: artifacts(artifact({ name: "other" })) }, { artifactId: 11, artifactName: "diagnostics" }, "missing"],
  ];
  for (const [routes, input, state] of cases) {
    const s = suite({ ...routes, [ZIP]: bytesRoute(archive) });
    assert.equal((await s.evidence(input)).state, state, JSON.stringify(input));
    assert.ok(!s.keys().includes(ZIP), `no download for ${state}`);
  }
});

test("integrity, transport and archive failures are distinct results", async () => {
  const tampered = suite({ [RUN]: run(), [ARTIFACTS]: artifacts(artifact({ digest: `sha256:${"0".repeat(64)}` })), [ZIP]: bytesRoute(archive) });
  const mismatch = await tampered.evidence({ artifactId: 11 });
  assert.equal(mismatch.state, "malformed");
  assert.equal(mismatch.integrity, "mismatch");
  const noDigest = suite({ [RUN]: run(), [ARTIFACTS]: artifacts(artifact({ digest: undefined })), [ZIP]: bytesRoute(archive) });
  assert.equal((await noDigest.evidence({ artifactId: 11 })).integrity, "not-provided");
  // An old transport that only returns text cannot carry bytes: reported, never decoded as if it were the archive.
  const textOnly = suite({ [RUN]: run(), [ARTIFACTS]: artifacts(artifact()), [ZIP]: () => archive.toString("latin1") });
  const unavailable = await textOnly.evidence({ artifactId: 11 });
  assert.equal(unavailable.state, "unavailable");
  assert.match(unavailable.reason, /cannot return binary/);
  const big = suite({ [RUN]: run(), [ARTIFACTS]: artifacts(artifact({ digest: undefined })), [ZIP]: Object.assign(new Error("stdout maxBuffer length exceeded"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }) });
  assert.equal((await big.evidence({ artifactId: 11 })).state, "oversized");
  const evil = zip([{ name: "../escape.txt", data: "x" }]);
  const unsafe = suite({ [RUN]: run(), [ARTIFACTS]: artifacts(artifact({ digest: undefined, size_in_bytes: evil.length })), [ZIP]: bytesRoute(evil) });
  assert.equal((await unsafe.evidence({ artifactId: 11, artifactPath: "../escape.txt" })).state, "malformed");
  assert.equal((await suite({ [RUN]: run(), [ARTIFACTS]: artifacts(artifact()), [ZIP]: httpError(410) }).evidence({ artifactId: 11 })).state, "expired");
});

test("aborting during an artifact download rejects and reaches the transport", async () => {
  let seen;
  const s = suite({ [RUN]: run(), [ARTIFACTS]: artifacts(artifact()), [ZIP]: (_args, options) => { seen = options.signal; return new Promise(() => {}); } });
  const controller = new AbortController();
  const pending = s.evidence({ artifactId: 11, artifactPath: "reports/junit.txt" }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /Cancelled/);
  assert.equal(seen, controller.signal);
});
