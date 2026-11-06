import { strict as assert } from "node:assert";
import { test } from "node:test";
import { withGithubCommandTransport } from "../src/lib/core/gh.ts";
import { createPullRequest } from "../src/lib/git-data/index.ts";
import { gitDataOperationDescriptors } from "../src/lib/git-data/tools.ts";

test("generic pull request creation uses the GitHub API without a local Git checkout", async () => {
  const calls = [];
  const result = await withGithubCommandTransport(
    {
      run: async (args) => {
        calls.push(args);
        return JSON.stringify({ html_url: "https://github.test/pull/1", number: 1, draft: true });
      },
    },
    () => createPullRequest("owner/repo", "feature", "main", "Title", "Body", true),
  );
  assert.deepEqual(result, {
    repo: "owner/repo",
    head: "feature",
    base: "main",
    url: "https://github.test/pull/1",
    number: 1,
    draft: true,
  });
  assert.deepEqual(calls[0], [
    "api",
    "--method",
    "POST",
    "repos/owner/repo/pulls",
    "-f",
    "title=Title",
    "-f",
    "head=feature",
    "-f",
    "base=main",
    "-F",
    "draft=true",
    "-f",
    "body=Body",
  ]);
});

test("API write descriptors are limited to pull request creation", () => {
  assert.deepEqual(
    gitDataOperationDescriptors().map((item) => item.name),
    ["github_pull_request_create"],
  );
  const pullCreate = gitDataOperationDescriptors().find(
    (item) => item.name === "github_pull_request_create",
  );
  assert.equal(pullCreate.parameters.properties.body.maxLength, 65_536);
});
