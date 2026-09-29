import { strict as assert } from "node:assert";
import test from "node:test";
import { activateSuite } from "../src/index.ts";

test("registered operations use an injected command transport", async () => {
  const tools = new Map();
  const calls = [];
  activateSuite(
    { registerTool: (tool) => tools.set(tool.name, tool) },
    {
      commandTransport: {
        run: async (args) => {
          calls.push(args);
          return JSON.stringify({ number: 7, title: "Guest issue" });
        },
      },
    },
  );
  const result = await tools.get("github_issue_view").execute("call", { repo: "o/r", issueNumber: 7 });
  assert.deepEqual(result.details, { number: 7, title: "Guest issue" });
  assert.deepEqual(calls, [["issue", "view", "7", "-R", "o/r", "--json", "number,title,body,labels,milestone,state,url"]]);
});
