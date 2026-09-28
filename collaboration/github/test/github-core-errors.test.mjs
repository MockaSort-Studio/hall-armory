import { strict as assert } from "node:assert";
import test from "node:test";
import { GithubError, githubError } from "../src/lib/core/gh.ts";

test("GitHub core errors retain operation/resource, HTTP status, and transient classification", () => {
  for (const [status, transient] of [
    [403, false],
    [404, false],
    [422, false],
    [429, true],
  ]) {
    const error = githubError(
      { stderr: `HTTP ${status} response` },
      "view issue",
      "owner/repo#7",
    );
    assert.ok(error instanceof GithubError);
    assert.equal(error.status, status);
    assert.equal(error.transient, transient);
    assert.match(error.message, /view issue/);
    assert.match(error.message, /owner\/repo#7/);
  }
});

test("already contextualized GitHub errors are not double-wrapped", () => {
  const original = new GithubError("already useful", {
    status: 409,
    operation: "update",
    resource: "owner/repo",
  });
  assert.equal(githubError(original, "other", "other-resource"), original);
});
