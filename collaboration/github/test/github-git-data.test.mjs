import { strict as assert } from "node:assert";
import { test } from "node:test";
import { withGithubCommandTransport } from "../src/lib/core/gh.ts";
import { createPullRequest } from "../src/lib/git-data/index.ts";
import { gitDataOperationDescriptors } from "../src/lib/git-data/tools.ts";

test("pull request creation looks for an existing one first, then uses the API without a local Git checkout", async () => {
  const calls = [];
  const result = await withGithubCommandTransport(
    {
      run: async (args) => {
        calls.push(args);
        return args.includes("POST")
          ? JSON.stringify({
              html_url: "https://github.test/pull/1",
              number: 1,
              draft: true,
            })
          : "[]";
      },
    },
    () =>
      createPullRequest("owner/repo", "feature", "main", "Title", "Body", true),
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
    "repos/owner/repo/pulls?state=open&head=owner%3Afeature&base=main",
  ]);
  assert.deepEqual(calls[1], [
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

test("pull request creation is idempotent: an open one is returned, never duplicated", async () => {
  const calls = [];
  const open = [
    { html_url: "https://github.test/pull/9", number: 9, draft: true },
  ];
  const result = await withGithubCommandTransport(
    { run: async (args) => (calls.push(args), JSON.stringify(open)) },
    () => createPullRequest("owner/repo", "feature", "main", "Title"),
  );
  assert.deepEqual(result, {
    repo: "owner/repo",
    head: "feature",
    base: "main",
    url: "https://github.test/pull/9",
    number: 9,
    draft: true,
    existing: true,
  });
  assert.equal(calls.length, 1, "no create call was made");
});

test("a create that loses a race to another create returns the pull request that won", async () => {
  let lookups = 0;
  const result = await withGithubCommandTransport(
    {
      run: async (args) => {
        if (args.includes("POST"))
          throw Object.assign(
            new Error("HTTP 422 A pull request already exists"),
            { stderr: "HTTP 422" },
          );
        lookups += 1;
        return lookups === 1
          ? "[]"
          : JSON.stringify([
              {
                html_url: "https://github.test/pull/3",
                number: 3,
                draft: false,
              },
            ]);
      },
    },
    () => createPullRequest("owner/repo", "feature", "main", "Title"),
  );
  assert.equal(result.number, 3);
  assert.equal(result.existing, true);
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
