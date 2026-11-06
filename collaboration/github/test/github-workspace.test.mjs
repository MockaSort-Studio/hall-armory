import { strict as assert } from "node:assert";
import { test } from "node:test";
import { withGithubCommandTransport } from "../src/lib/core/gh.ts";
import { snapshotRepository } from "../src/lib/workspace/index.ts";

test("repository snapshot uses a generic revision and fixed private guest workspace", async () => {
  const ghCalls = [];
  const commands = [];
  const result = await withGithubCommandTransport(
    {
      run: async (args) => {
        ghCalls.push(args);
        return "";
      },
    },
    () =>
      snapshotRepository("owner/repo", "main", {
        exec: async (command, args) => {
          commands.push([command, args]);
          return { stdout: "", stderr: "" };
        },
      }),
  );
  assert.deepEqual(result, {
    repo: "owner/repo",
    revision: "main",
    workspace: "/workspace",
  });
  assert.match(ghCalls[0].join(" "), /repos\/owner\/repo\/tarball\/main/);
  assert.ok(
    commands.some(
      ([command, args]) =>
        command === "/bin/tar" &&
        args.includes("-C") &&
        args.includes("/workspace"),
    ),
  );
  assert.ok(commands.some(([command]) => command === "/bin/rm"));
});

test("repository snapshot refuses nonempty workspaces and malformed revisions", async () => {
  await assert.rejects(
    () =>
      snapshotRepository("owner/repo", "main", {
        exec: async () => ({ stdout: "existing\n", stderr: "" }),
      }),
    /workspace is not empty/,
  );
  await assert.rejects(
    () => snapshotRepository("owner/repo", "bad\nref"),
    /Invalid repository revision/,
  );
});
