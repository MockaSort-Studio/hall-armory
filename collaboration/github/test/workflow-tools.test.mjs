import assert from "node:assert/strict";
import test from "node:test";
import { activateSuite } from "../src/index.ts";

test("workflow tools use bounded typed gh contracts", async () => {
  const tools = new Map(), calls = [];
  activateSuite({ registerTool: (tool) => tools.set(tool.name, tool) }, { commandTransport: { run: async (args) => { calls.push(args); return args.includes("--log-failed") ? "x".repeat(13000) : "[]"; } } });
  await tools.get("github_workflow_runs_list").execute("x", { repo: "o/r", limit: 5 });
  await tools.get("github_workflow_run_view").execute("x", { repo: "o/r", runId: 7 });
  const result = await tools.get("github_workflow_run_failed_log").execute("x", { repo: "o/r", runId: 7 });
  assert.equal(calls[0].includes("--limit"), true);
  assert.equal(calls[1].slice(0, 3).join(" "), "run view 7");
  assert.equal(result.details.log.length, 12012);
  assert.match(result.details.log, /\[truncated\]$/);
});
