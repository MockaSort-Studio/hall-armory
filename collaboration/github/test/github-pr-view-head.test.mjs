import { strict as assert } from "node:assert";
import { test } from "node:test";
import { withGithubCommandTransport } from "../src/lib/core/gh.ts";
import { viewPullRequest } from "../src/lib/pulls/index.ts";

// A pull request view must name the exact head commit it describes, so a caller can tie the checks it reads to a head
// without a second request that could race a push.
test("viewing a pull request requests and returns the head commit with its checks", async () => {
  const seen = [];
  const transport = {
    async run(args) {
      seen.push(args);
      return JSON.stringify({ number: 7, headRefOid: "a".repeat(40), statusCheckRollup: [] });
    },
  };
  const view = await withGithubCommandTransport(transport, () => viewPullRequest("o/r", 7));
  const fields = seen[0][seen[0].indexOf("--json") + 1].split(",");
  assert.ok(fields.includes("headRefOid") && fields.includes("statusCheckRollup"));
  assert.equal(view.headRefOid, "a".repeat(40));
});
