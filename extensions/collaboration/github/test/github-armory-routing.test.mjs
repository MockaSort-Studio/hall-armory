import { strict as assert } from "node:assert";
import test from "node:test";
import { gh, GithubError } from "../src/lib/core/gh.ts";

test("gh() keeps the static extension's host CLI adapter", async () => {
  const calls = [];
  const output = await gh(
    ["pr", "view", "7"],
    {},
    {
      execFileSync: (command, args, options) => {
        calls.push({ command, args, options });
        return "host output\n";
      },
    },
  );
  assert.equal(output, "host output");
  assert.deepEqual(calls[0].args, ["pr", "view", "7"]);
  assert.equal(calls[0].command, "gh");
});

test("gh() preserves its GithubError contract", async () => {
  const error = await gh(
    ["pr", "view", "404"],
    { operation: "view pull request", resource: "o/r#404" },
    {
      execFileSync: () => {
        const failure = new Error("Command failed");
        failure.status = 1;
        failure.stderr = "HTTP 404 Not Found";
        throw failure;
      },
    },
  ).catch((failure) => failure);
  assert.ok(error instanceof GithubError);
  assert.equal(error.status, 1);
  assert.equal(error.operation, "view pull request");
  assert.equal(error.resource, "o/r#404");
});
