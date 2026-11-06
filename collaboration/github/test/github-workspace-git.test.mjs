import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as isoGit from "isomorphic-git";
import * as workspace from "../src/lib/workspace/git.ts";
import { workspaceOperationDescriptors } from "../src/lib/workspace/tools.ts";

const repo = "owner/repo";
const run = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A source repository with history, and a shallow checkout of one revision with the GitHub
// origin, as the Crew seeds a worker's private workspace.
function seededWorkspace(t) {
  const root = mkdtempSync(join(tmpdir(), "armory-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const dir = join(root, "workspace");
  execFileSync("git", ["init", "-q", source]);
  for (const [name, content] of [["a.txt", "one\n"], ["b.txt", "keep\n"]]) writeFileSync(join(source, name), content);
  run(source, "add", ".");
  run(source, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
  writeFileSync(join(source, "a.txt"), "two\n");
  run(source, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "second");
  const revision = run(source, "rev-parse", "HEAD");
  execFileSync("git", ["init", "-q", dir]);
  run(dir, "-c", "protocol.version=2", "fetch", "-q", "--depth", "1", `file://${source}`, revision);
  run(dir, "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", "FETCH_HEAD");
  run(dir, "remote", "add", "origin", "https://github.com/owner/repo.git");
  return { dir, revision };
}

test("checkout moves the seeded revision onto the worker branch without touching files", async (t) => {
  const { dir, revision } = seededWorkspace(t);
  const result = await workspace.checkout(repo, revision, "crew/run/dev", { dir });
  assert.deepEqual(result, { repo, branch: "crew/run/dev", revision, head: revision });
  assert.equal(run(dir, "symbolic-ref", "HEAD"), "refs/heads/crew/run/dev");
  assert.deepEqual((await workspace.status(repo, { dir })).files, []);
  assert.deepEqual(await workspace.checkout(repo, revision, "crew/run/dev", { dir }), result);
  await assert.rejects(workspace.checkout(repo, revision, "crew/run/other", { dir }), /already on branch/);
});

test("checkout refuses another repository, revision, or a malformed branch", async (t) => {
  const { dir, revision } = seededWorkspace(t);
  await assert.rejects(workspace.checkout("other/repo", revision, "b", { dir }), /not a checkout of this repository/);
  await assert.rejects(workspace.checkout(repo, "0".repeat(40), "b", { dir }), /not at the requested revision/);
  for (const branch of ["../x", "a..b", "-x", "a/", "x.lock"])
    await assert.rejects(workspace.checkout(repo, revision, branch, { dir }), /Invalid branch/);
});

test("multi-file edit, stage, diff and commit produce one real Git commit on the branch", async (t) => {
  const { dir, revision } = seededWorkspace(t);
  await workspace.checkout(repo, revision, "crew/run/dev", { dir });
  writeFileSync(join(dir, "a.txt"), "three\n");
  writeFileSync(join(dir, "c.txt"), "new\n");
  unlinkSync(join(dir, "b.txt"));
  const { diff } = await workspace.diff(repo, undefined, { dir });
  assert.match(diff, /-two\n\+three/);
  assert.match(diff, /\+\+\+ b\/c\.txt/);
  assert.match(diff, /--- a\/b\.txt\n\+\+\+ \/dev\/null/);
  await assert.rejects(workspace.commit(repo, "nothing", { dir }), /Nothing is staged/);
  const staged = await workspace.stage(repo, ["a.txt", "b.txt", "c.txt"], { dir });
  assert.deepEqual(
    staged.files.map(({ path, staged }) => [path, staged]),
    [["a.txt", "modified"], ["b.txt", "deleted"], ["c.txt", "added"]],
  );
  const { commit } = await workspace.commit(repo, "Change files", { dir, env: {} });
  assert.equal(run(dir, "rev-parse", "HEAD"), commit);
  assert.equal(run(dir, "rev-parse", "HEAD^"), revision);
  assert.equal(run(dir, "show", "--name-status", "--format=", "HEAD"), "M\ta.txt\nD\tb.txt\nA\tc.txt");
  assert.equal(run(dir, "fsck", "--no-progress"), "");
});

test("stage and diff refuse paths outside the working tree", async (t) => {
  const { dir, revision } = seededWorkspace(t);
  await workspace.checkout(repo, revision, "crew/run/dev", { dir });
  for (const path of ["/etc/passwd", "../x", "a/../../x", ".git/config", "a/.git/x", ""])
    await assert.rejects(workspace.stage(repo, [path], { dir }), /Invalid workspace path/);
  await assert.rejects(workspace.diff(repo, [".git/HEAD"], { dir }), /Invalid workspace path/);
});

test("push sends only the checked-out branch, fast-forward, to the derived GitHub remote", async (t) => {
  const { dir, revision } = seededWorkspace(t);
  await workspace.checkout(repo, revision, "crew/run/dev", { dir });
  const calls = [];
  const git = { ...(isoGit.default ?? isoGit), push: async (options) => (calls.push(options), { ok: true, refs: {} }) };
  await assert.rejects(workspace.push(repo, "main", { dir, git, env: { GITHUB_TOKEN: "t" } }), /other than the checked-out/);
  await assert.rejects(workspace.push(repo, "crew/run/dev", { dir, git, env: {} }), /requires GITHUB_TOKEN/);
  const result = await workspace.push(repo, "crew/run/dev", { dir, git, env: { GITHUB_TOKEN: "placeholder" } });
  assert.equal(result.commit, revision);
  const [options] = calls;
  assert.equal(options.url, "https://github.com/owner/repo.git");
  assert.equal(options.ref, "refs/heads/crew/run/dev");
  assert.equal(options.remoteRef, "refs/heads/crew/run/dev");
  assert.equal(options.force, false);
  assert.deepEqual(options.onAuth(), { username: "x-access-token", password: "placeholder" });
  const rejected = { ...git, push: async () => ({ ok: false, refs: { x: "non-fast-forward" } }) };
  await assert.rejects(workspace.push(repo, "crew/run/dev", { dir, git: rejected, env: { GITHUB_TOKEN: "t" } }), /rejected/);
});

test("workspace descriptors are closed and take no directory, remote, refspec or force", () => {
  const descriptors = workspaceOperationDescriptors();
  assert.deepEqual(
    descriptors.map((item) => item.name),
    ["github_workspace_checkout", "github_git_status", "github_git_diff", "github_git_stage", "github_git_commit", "github_git_push"],
  );
  for (const { parameters } of descriptors) {
    assert.equal(parameters.additionalProperties, false);
    for (const key of ["dir", "url", "remote", "refspec", "force"]) assert.ok(!(key in parameters.properties), key);
  }
});
