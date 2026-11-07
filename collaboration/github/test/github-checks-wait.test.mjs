import { strict as assert } from "node:assert";
import { test } from "node:test";
import { withGithubCommandTransport } from "../src/lib/core/gh.ts";
import { summarizeChecks, waitForPullRequestChecks } from "../src/lib/pulls/checks.ts";
import { pullRequestOperationDescriptors } from "../src/lib/pulls/tools.ts";

const run = (name, status, conclusion, runId = 100) => ({ __typename: "CheckRun", name, workflowName: "CI", status, conclusion, detailsUrl: `https://github.com/o/r/actions/runs/${runId}/job/1` });
const pr = (rollup, extra = {}) => ({ headRefOid: "abc", state: "OPEN", isDraft: true, statusCheckRollup: rollup, ...extra });

// A transport that answers `gh pr view` from a script (the last answer repeats) and `gh run view --log-failed` with a log.
function world(script) {
  let calls = 0;
  const transport = {
    run(args) {
      if (args[0] === "run") return `step failed: ${args[2]}\nAssertionError: expected 1 to equal 2`;
      return JSON.stringify(script[Math.min(calls++, script.length - 1)]);
    },
  };
  let clock = 0;
  const sleeps = [];
  const opts = { sleep: async (ms) => { sleeps.push(ms); clock += ms; }, now: () => clock };
  return { calls: () => calls, sleeps, wait: (extra = {}) => withGithubCommandTransport(transport, () => waitForPullRequestChecks("o/r", 7, { ...opts, ...extra })) };
}

test("summarizeChecks normalizes check runs and commit statuses into one state", () => {
  assert.equal(summarizeChecks([]).state, "none");
  assert.equal(summarizeChecks([run("a", "COMPLETED", "SUCCESS"), run("b", "COMPLETED", "SKIPPED")]).state, "success");
  assert.equal(summarizeChecks([run("a", "COMPLETED", "SUCCESS"), run("b", "IN_PROGRESS", null)]).state, "pending");
  assert.equal(summarizeChecks([run("a", "COMPLETED", "FAILURE")]).state, "failure");
  assert.equal(summarizeChecks([run("a", "COMPLETED", "TIMED_OUT")]).state, "failure");
  assert.equal(summarizeChecks([{ __typename: "StatusContext", context: "ci/x", state: "PENDING" }]).state, "pending");
  assert.equal(summarizeChecks([{ __typename: "StatusContext", context: "ci/x", state: "ERROR" }]).state, "failure");
});

test("it waits through pending checks and returns success once they all pass", async () => {
  const w = world([pr([run("test", "IN_PROGRESS", null)]), pr([run("test", "IN_PROGRESS", null)]), pr([run("test", "COMPLETED", "SUCCESS")])]);
  const result = await w.wait({ intervalSeconds: 15 });
  assert.equal(result.state, "success");
  assert.deepEqual(w.sleeps, [15000, 15000], "it slept between polls and nowhere else");
  assert.equal(result.waitedSeconds, 30);
  assert.deepEqual(result.failures, []);
});

test("a failure returns the failed step's log tail so it can be fixed", async () => {
  const w = world([pr([run("test", "COMPLETED", "FAILURE", 555), run("lint", "COMPLETED", "SUCCESS", 555)])]);
  const result = await w.wait();
  assert.equal(result.state, "failure");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].runId, 555);
  assert.match(result.failures[0].logTail, /AssertionError: expected 1 to equal 2/);
  assert.equal(result.checks.length, 2);
});

test("fail-fast returns as soon as one check fails; waiting for all is optional", async () => {
  const mixed = pr([run("test", "COMPLETED", "FAILURE"), run("slow", "IN_PROGRESS", null, 101)]);
  assert.equal((await world([mixed]).wait()).state, "failure");
  const w = world([mixed, pr([run("test", "COMPLETED", "FAILURE"), run("slow", "COMPLETED", "SUCCESS", 101)])]);
  const result = await w.wait({ failFast: false });
  assert.equal(result.state, "failure");
  assert.equal(w.calls(), 2, "it kept waiting for the other check to finish");
});

test("a stale head is never reported: only checks of the requested commit count", async () => {
  const w = world([pr([run("test", "COMPLETED", "SUCCESS")], { headRefOid: "old" }), pr([], { headRefOid: "new" }), pr([run("test", "COMPLETED", "FAILURE")], { headRefOid: "new" })]);
  const result = await w.wait({ sha: "new" });
  assert.equal(result.state, "failure", "the old commit's green result was ignored");
  assert.equal(result.headSha, "new");
});

test("no checks at all is reported as none after a grace period instead of waiting forever", async () => {
  const w = world([pr([])]);
  const result = await w.wait({ noChecksGraceSeconds: 45, intervalSeconds: 15 });
  assert.equal(result.state, "none");
  assert.ok(result.waitedSeconds >= 45);
});

test("a closed or merged pull request ends the wait", async () => {
  assert.equal((await world([pr([run("t", "IN_PROGRESS", null)], { state: "MERGED" })]).wait()).state, "closed");
});

test("cancelling stops the wait", async () => {
  const controller = new AbortController();
  const transport = { run: () => JSON.stringify(pr([run("t", "IN_PROGRESS", null)])) };
  const pending = withGithubCommandTransport(transport, () => waitForPullRequestChecks("o/r", 7, { signal: controller.signal, intervalSeconds: 5 }));
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /Cancelled while waiting for checks/);
});

test("the suite exposes the operation and passes the abort signal to it", async () => {
  const descriptor = pullRequestOperationDescriptors().find((d) => d.name === "github_pull_request_checks_wait");
  assert.ok(descriptor);
  const controller = new AbortController();
  controller.abort();
  const transport = { run: () => JSON.stringify(pr([run("t", "IN_PROGRESS", null)])) };
  await assert.rejects(withGithubCommandTransport(transport, () => descriptor.execute({ repo: "o/r", pullNumber: 7 }, { signal: controller.signal })), /Cancelled/);
});
