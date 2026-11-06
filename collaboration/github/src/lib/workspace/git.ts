import * as fs from "node:fs";
import { createTwoFilesPatch } from "diff";
import * as isoGit from "isomorphic-git";
import http from "isomorphic-git/http/node";

// Typed Git over a guest's private /workspace. The workspace arrives as a shallow checkout of
// one revision; these operations create one branch from it, stage, commit and push that branch.
// No operation takes a directory, remote URL, refspec or force flag: the workspace is fixed and
// the remote is derived from the repository name, so the suite cannot be repurposed.
const WORKSPACE = "/workspace";
const MAX_DIFF_CHARS = 200_000;
const git = isoGit.default ?? isoGit;

type Dependencies = { dir?: string; git?: typeof git; http?: unknown; env?: NodeJS.ProcessEnv };
const context = (dependencies: Dependencies = {}) => ({
  dir: dependencies.dir ?? WORKSPACE,
  git: dependencies.git ?? git,
  http: dependencies.http ?? http,
  env: dependencies.env ?? process.env,
});

export function remoteUrl(repo: string) {
  const [owner, name, ...rest] = String(repo).split("/");
  if (!owner || !name || rest.length || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name))
    throw new Error(`Invalid repository: ${repo}`);
  return `https://github.com/${owner}/${name}.git`;
}

export function branchName(branch: string) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock")
  )
    throw new Error(`Invalid branch: ${branch}`);
  return branch;
}

export function workspacePath(path: string) {
  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    /[\0-\x1f\x7f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")
  )
    throw new Error(`Invalid workspace path: ${path}`);
  return path;
}

async function assertRepository(repo: string, ctx) {
  const origin = await ctx.git.getConfig({ fs, dir: ctx.dir, path: "remote.origin.url" });
  if (origin !== remoteUrl(repo)) throw new Error("Workspace is not a checkout of this repository");
}

async function currentBranch(ctx) {
  const branch = await ctx.git.currentBranch({ fs, dir: ctx.dir, fullname: false });
  if (!branch) throw new Error("Workspace has no branch checked out; run github_workspace_checkout first");
  return branch;
}

// Moves HEAD from the seeded revision onto a new branch at that revision. Files and index are
// untouched, so it is cheap and idempotent for the same branch.
export async function checkout(repo: string, revision: string, branch: string, dependencies?: Dependencies) {
  const ctx = context(dependencies);
  await assertRepository(repo, ctx);
  const name = branchName(branch);
  const current = await ctx.git.currentBranch({ fs, dir: ctx.dir, fullname: false });
  if (current === name) return { repo, branch: name, revision, head: await ctx.git.resolveRef({ fs, dir: ctx.dir, ref: "HEAD" }) };
  if (current) throw new Error(`Workspace is already on branch ${current}`);
  const head = await ctx.git.resolveRef({ fs, dir: ctx.dir, ref: "HEAD" });
  if (head !== revision) throw new Error("Workspace is not at the requested revision");
  await ctx.git.writeRef({ fs, dir: ctx.dir, ref: `refs/heads/${name}`, value: revision });
  await ctx.git.writeRef({ fs, dir: ctx.dir, ref: "HEAD", value: `refs/heads/${name}`, symbolic: true, force: true });
  return { repo, branch: name, revision, head: revision };
}

const describe = ([, head, workdir, stage]: number[]) => {
  const staged = stage !== head ? (head === 0 ? "added" : stage === 0 ? "deleted" : "modified") : undefined;
  const unstaged = workdir !== stage ? (stage === 0 ? "untracked" : workdir === 0 ? "deleted" : "modified") : undefined;
  return { staged, unstaged };
};

export async function status(repo: string, dependencies?: Dependencies) {
  const ctx = context(dependencies);
  await assertRepository(repo, ctx);
  const matrix = await ctx.git.statusMatrix({ fs, dir: ctx.dir });
  const files = matrix
    .filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))
    .map((row) => ({ path: row[0], ...describe(row) }));
  return { repo, branch: await ctx.git.currentBranch({ fs, dir: ctx.dir, fullname: false }), files };
}

const readHead = async (ctx, path) => {
  try {
    const { blob } = await ctx.git.readBlob({ fs, dir: ctx.dir, oid: await ctx.git.resolveRef({ fs, dir: ctx.dir, ref: "HEAD" }), filepath: path });
    return Buffer.from(blob).toString("utf8");
  } catch {
    return "";
  }
};
const readWorkdir = (ctx, path) => {
  try {
    return fs.readFileSync(`${ctx.dir}/${path}`, "utf8");
  } catch {
    return "";
  }
};

// Unified diff of the working tree against the current commit, optionally for some paths.
export async function diff(repo: string, paths: string[] | undefined, dependencies?: Dependencies) {
  const ctx = context(dependencies);
  await assertRepository(repo, ctx);
  const wanted = paths?.map(workspacePath);
  const matrix = await ctx.git.statusMatrix({ fs, dir: ctx.dir, ...(wanted ? { filepaths: wanted } : {}) });
  let text = "";
  for (const [path, head, workdir] of matrix) {
    if (head === 1 && workdir === 1) continue;
    const before = head ? await readHead(ctx, path) : "";
    const after = workdir ? readWorkdir(ctx, path) : "";
    text += createTwoFilesPatch(head ? `a/${path}` : "/dev/null", workdir ? `b/${path}` : "/dev/null", before, after);
    if (text.length > MAX_DIFF_CHARS) return { repo, diff: `${text.slice(0, MAX_DIFF_CHARS)}\n… [diff truncated]`, truncated: true };
  }
  return { repo, diff: text, truncated: false };
}

// Stages each path as it is now: an existing file is added, a missing one is removed.
export async function stage(repo: string, paths: string[], dependencies?: Dependencies) {
  const ctx = context(dependencies);
  await assertRepository(repo, ctx);
  if (!Array.isArray(paths) || !paths.length) throw new Error("Stage requires at least one path");
  for (const path of paths.map(workspacePath)) {
    if (fs.existsSync(`${ctx.dir}/${path}`)) await ctx.git.add({ fs, dir: ctx.dir, filepath: path });
    else await ctx.git.remove({ fs, dir: ctx.dir, filepath: path });
  }
  return status(repo, dependencies);
}

export async function commit(repo: string, message: string, dependencies?: Dependencies) {
  const ctx = context(dependencies);
  await assertRepository(repo, ctx);
  const branch = await currentBranch(ctx);
  if (typeof message !== "string" || !message.trim()) throw new Error("Commit requires a message");
  const staged = (await ctx.git.statusMatrix({ fs, dir: ctx.dir })).some(([, head, , stage]) => stage !== head);
  if (!staged) throw new Error("Nothing is staged to commit");
  const author = {
    name: ctx.env.GIT_AUTHOR_NAME || "Pi Crew",
    email: ctx.env.GIT_AUTHOR_EMAIL || "pi-crew@users.noreply.github.com",
  };
  const oid = await ctx.git.commit({ fs, dir: ctx.dir, message, author });
  return { repo, branch, commit: oid };
}

// Pushes the checked-out branch to the same-named remote branch, fast-forward only.
export async function push(repo: string, branch: string, dependencies?: Dependencies) {
  const ctx = context(dependencies);
  await assertRepository(repo, ctx);
  const name = branchName(branch);
  if ((await currentBranch(ctx)) !== name) throw new Error("Push names a branch other than the checked-out one");
  const token = ctx.env.GITHUB_TOKEN;
  if (!token) throw new Error("Push requires GITHUB_TOKEN");
  const result = await ctx.git.push({
    fs,
    http: ctx.http,
    dir: ctx.dir,
    url: remoteUrl(repo),
    ref: `refs/heads/${name}`,
    remoteRef: `refs/heads/${name}`,
    force: false,
    onAuth: () => ({ username: "x-access-token", password: token }),
  });
  if (!result?.ok) throw new Error(`Push was rejected: ${JSON.stringify(result?.refs ?? {})}`);
  return { repo, branch: name, commit: await ctx.git.resolveRef({ fs, dir: ctx.dir, ref: "HEAD" }) };
}
