import { strict as assert } from "node:assert";
import { test } from "node:test";
import { snapshotRepository } from "../src/lib/workspace/index.ts";

test("repository snapshot downloads binary archive into fixed private guest workspace", async () => {
  const downloads = [],
    commands = [];
  const result = await snapshotRepository("owner/repo", "main", {
    download: async (args, destination) => downloads.push([args, destination]),
    exec: async (command, args) => {
      commands.push([command, args]);
      return { stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(result, {
    repo: "owner/repo",
    revision: "main",
    workspace: "/workspace",
  });
  assert.match(downloads[0][0].join(" "), /repos\/owner\/repo\/tarball\/main/);
  assert.ok(
    commands.some(
      ([command, args]) =>
        command === "/bin/tar" && args.includes("/workspace"),
    ),
  );
  assert.ok(commands.some(([command]) => command === "/bin/rm"));
});

test("repository snapshot refuses nonempty workspaces, oversized archives, and malformed revisions", async () => {
  await assert.rejects(
    () =>
      snapshotRepository("owner/repo", "main", {
        exec: async () => ({ stdout: "existing\n", stderr: "" }),
      }),
    /workspace is not empty/,
  );
  await assert.rejects(
    () =>
      snapshotRepository("owner/repo", "main", {
        download: async () => undefined,
        exec: async (_command, args) => {
          if (args.join(" ").includes("wc -c")) throw new Error("too large");
          return { stdout: "", stderr: "" };
        },
      }),
    /snapshot limit/,
  );
  await assert.rejects(
    () => snapshotRepository("owner/repo", "bad\nref"),
    /Invalid repository revision/,
  );
});
