import { strict as assert } from "node:assert";
import { test } from "node:test";
import { withGithubCommandTransport } from "../src/lib/core/gh.ts";
import {
  createBranch,
  createPullRequest,
  updateFile,
} from "../src/lib/git-data/index.ts";
import { gitDataOperationDescriptors } from "../src/lib/git-data/tools.ts";

test("generic GitHub ref and file primitives use only caller-supplied repository state", async () => {
  const calls = [];
  const transport = {
    run: async (args) => {
      calls.push(args);
      if (args.some((value) => String(value).includes("/git/refs")))
        return JSON.stringify({
          ref: "refs/heads/topic",
          object: { sha: "new-sha" },
        });
      return JSON.stringify({
        commit: { sha: "commit-sha" },
        content: { sha: "blob-sha" },
      });
    },
  };
  const result = await withGithubCommandTransport(transport, async () => {
    const ref = await createBranch("owner/repo", "topic", "base-sha");
    const file = await updateFile(
      "owner/repo",
      "topic",
      "src/a.mjs",
      "export default 1;",
      "change",
    );
    return { ref, file };
  });
  assert.deepEqual(result.ref, {
    repo: "owner/repo",
    branch: "topic",
    sha: "new-sha",
    ref: "refs/heads/topic",
  });
  assert.deepEqual(result.file, {
    repo: "owner/repo",
    branch: "topic",
    path: "src/a.mjs",
    commit: "commit-sha",
    blob: "blob-sha",
  });
  assert.ok(calls.flat().includes("ref=refs/heads/topic"));
  assert.ok(
    calls.flat().some((value) => String(value).startsWith("content=ZXhwb3J0")),
  );
});

test("generic pull request creation returns gh's URL without Crew semantics", async () => {
  const calls = [];
  const result = await withGithubCommandTransport(
    {
      run: async (args) => {
        calls.push(args);
        return "https://github.test/pull/1";
      },
    },
    () => createPullRequest("owner/repo", "feature", "main", "Title", "Body"),
  );
  assert.deepEqual(result, {
    repo: "owner/repo",
    head: "feature",
    base: "main",
    url: "https://github.test/pull/1",
  });
  assert.deepEqual(calls[0], [
    "pr",
    "create",
    "-R",
    "owner/repo",
    "--head",
    "feature",
    "--base",
    "main",
    "--title",
    "Title",
    "--body",
    "Body",
  ]);
});

test("write descriptors bound content before it reaches gh", () => {
  const fileUpdate = gitDataOperationDescriptors().find(
    (item) => item.name === "github_file_update",
  );
  assert.equal(fileUpdate.parameters.properties.content.maxLength, 700_000);
  const pullCreate = gitDataOperationDescriptors().find(
    (item) => item.name === "github_pull_request_create",
  );
  assert.equal(pullCreate.parameters.properties.body.maxLength, 65_536);
});

test("generic GitHub primitives reject malformed repository paths and refs", async () => {
  await assert.rejects(
    () => createBranch("owner/repo", "../bad", "sha"),
    /Invalid branch/,
  );
  await assert.rejects(
    () => updateFile("owner/repo", "branch", "../secret", "x", "message"),
    /Invalid repository path/,
  );
});
