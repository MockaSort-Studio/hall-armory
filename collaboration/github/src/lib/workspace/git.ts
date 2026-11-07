import { createTwoFilesPatch } from "diff";
import * as isoGit from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { currentBackend, type WorkspaceBackend } from "./backend.ts";

// Typed Git over a workspace. The workspace arrives as a shallow checkout of one revision; these operations
// create one branch from it, stage, commit and push that branch. No operation takes a directory, remote
// URL, refspec or force flag: the workspace is fixed by the host and the remote is derived from the
// repository name, so the suite cannot be repurposed. Every operation is idempotent: repeating a call
// (a retry after a lost response, a salvage after a failure) reaches the same state and succeeds.
const MAX_DIFF_CHARS = 200_000;
const git = (isoGit as any).default ?? isoGit;

type Overrides = Partial<WorkspaceBackend>;
const context = (overrides: Overrides = {}) => {
  const backend = { ...currentBackend(), ...overrides };
  return {
    dir: backend.dir,
    fs: backend.fs,
    git: backend.git ?? git,
    http: backend.http ?? http,
    env: backend.env ?? {},
  };
};
type Context = ReturnType<typeof context>;

export function remoteUrl(repo: string) {
  const [owner, name, ...rest] = String(repo).split("/");
  if (
    !owner ||
    !name ||
    rest.length ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(name)
  )
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
    path
      .split("/")
      .some((part) => !part || part === "." || part === ".." || part === ".git")
  )
    throw new Error(`Invalid workspace path: ${path}`);
  return path;
}

const abs = (ctx: Context, path: string) =>
  `${ctx.dir.replace(/\/$/, "")}/${path}`;
const currentBranchOf = (ctx: Context) =>
  ctx.git.currentBranch({ fs: ctx.fs, dir: ctx.dir, fullname: false });
const headOf = (ctx: Context) =>
  ctx.git.resolveRef({ fs: ctx.fs, dir: ctx.dir, ref: "HEAD" });
const authorOf = (ctx: Context) => ({
  name: ctx.env.GIT_AUTHOR_NAME || "Pi Crew",
  email: ctx.env.GIT_AUTHOR_EMAIL || "pi-crew@users.noreply.github.com",
});

async function assertRepository(repo: string, ctx: Context) {
  const origin = await ctx.git.getConfig({
    fs: ctx.fs,
    dir: ctx.dir,
    path: "remote.origin.url",
  });
  if (origin !== remoteUrl(repo))
    throw new Error("Workspace is not a checkout of this repository");
}

async function currentBranch(ctx: Context) {
  const branch = await currentBranchOf(ctx);
  if (!branch)
    throw new Error(
      "Workspace has no branch checked out; run github_workspace_checkout first",
    );
  return branch;
}

// Moves HEAD from the seeded revision onto a new branch at that revision. Files and index are untouched,
// so it is cheap, and repeating it for the same branch returns the same result.
export async function checkout(
  repo: string,
  revision: string,
  branch: string,
  overrides?: Overrides,
) {
  const ctx = context(overrides);
  await assertRepository(repo, ctx);
  const name = branchName(branch);
  const current = await currentBranchOf(ctx);
  if (current === name)
    return { repo, branch: name, revision, head: await headOf(ctx) };
  if (current) throw new Error(`Workspace is already on branch ${current}`);
  const head = await headOf(ctx);
  if (head !== revision)
    throw new Error("Workspace is not at the requested revision");
  await ctx.git.writeRef({
    fs: ctx.fs,
    dir: ctx.dir,
    ref: `refs/heads/${name}`,
    value: revision,
  });
  await ctx.git.writeRef({
    fs: ctx.fs,
    dir: ctx.dir,
    ref: "HEAD",
    value: `refs/heads/${name}`,
    symbolic: true,
    force: true,
  });
  return { repo, branch: name, revision, head: revision };
}

const describe = ([, head, workdir, stage]: number[]) => ({
  staged:
    stage !== head
      ? head === 0
        ? "added"
        : stage === 0
          ? "deleted"
          : "modified"
      : undefined,
  unstaged:
    workdir !== stage
      ? stage === 0
        ? "untracked"
        : workdir === 0
          ? "deleted"
          : "modified"
      : undefined,
});

export async function status(repo: string, overrides?: Overrides) {
  const ctx = context(overrides);
  await assertRepository(repo, ctx);
  const matrix = await ctx.git.statusMatrix({ fs: ctx.fs, dir: ctx.dir });
  const files = matrix
    .filter(
      ([, head, workdir, stage]) =>
        !(head === 1 && workdir === 1 && stage === 1),
    )
    .map((row) => ({ path: row[0], ...describe(row) }));
  return { repo, branch: await currentBranchOf(ctx), files };
}

const text = (data: Uint8Array | string) =>
  typeof data === "string" ? data : Buffer.from(data).toString("utf8");
async function readHead(ctx: Context, path: string) {
  try {
    const { blob } = await ctx.git.readBlob({
      fs: ctx.fs,
      dir: ctx.dir,
      oid: await headOf(ctx),
      filepath: path,
    });
    return text(blob);
  } catch {
    return "";
  }
}
async function readWorkdir(ctx: Context, path: string) {
  try {
    return text(await ctx.fs.promises.readFile(abs(ctx, path)));
  } catch {
    return "";
  }
}
async function exists(ctx: Context, path: string) {
  try {
    await ctx.fs.promises.lstat(abs(ctx, path));
    return true;
  } catch {
    return false;
  }
}

// Unified diff of the working tree against the current commit, optionally for some paths.
export async function diff(
  repo: string,
  paths: string[] | undefined,
  overrides?: Overrides,
) {
  const ctx = context(overrides);
  await assertRepository(repo, ctx);
  const wanted = paths?.map(workspacePath);
  const matrix = await ctx.git.statusMatrix({
    fs: ctx.fs,
    dir: ctx.dir,
    ...(wanted ? { filepaths: wanted } : {}),
  });
  let out = "";
  for (const [path, head, workdir] of matrix) {
    if (head === 1 && workdir === 1) continue;
    const before = head ? await readHead(ctx, path) : "";
    const after = workdir ? await readWorkdir(ctx, path) : "";
    out += createTwoFilesPatch(
      head ? `a/${path}` : "/dev/null",
      workdir ? `b/${path}` : "/dev/null",
      before,
      after,
    );
    if (out.length > MAX_DIFF_CHARS)
      return {
        repo,
        diff: `${out.slice(0, MAX_DIFF_CHARS)}\n… [diff truncated]`,
        truncated: true,
      };
  }
  return { repo, diff: out, truncated: false };
}

// Stages each path as it is now: an existing file is added, a missing one is removed. Staging a path that
// is already staged the same way changes nothing.
export async function stage(
  repo: string,
  paths: string[],
  overrides?: Overrides,
) {
  const ctx = context(overrides);
  await assertRepository(repo, ctx);
  if (!Array.isArray(paths) || !paths.length)
    throw new Error("Stage requires at least one path");
  for (const path of paths.map(workspacePath)) {
    if (await exists(ctx, path))
      await ctx.git.add({ fs: ctx.fs, dir: ctx.dir, filepath: path });
    else await ctx.git.remove({ fs: ctx.fs, dir: ctx.dir, filepath: path });
  }
  return status(repo, overrides);
}

// With nothing staged, a repeat of the commit that is already HEAD (same message, same author) returns that
// commit as `unchanged`; any other empty commit is an error.
export async function commit(
  repo: string,
  message: string,
  overrides?: Overrides,
) {
  const ctx = context(overrides);
  await assertRepository(repo, ctx);
  const branch = await currentBranch(ctx);
  if (typeof message !== "string" || !message.trim())
    throw new Error("Commit requires a message");
  const matrix = await ctx.git.statusMatrix({ fs: ctx.fs, dir: ctx.dir });
  const author = authorOf(ctx);
  if (!matrix.some(([, head, , stage]) => stage !== head)) {
    const oid = await headOf(ctx);
    const { commit: previous } = await ctx.git.readCommit({
      fs: ctx.fs,
      dir: ctx.dir,
      oid,
    });
    if (
      previous.message.trim() === message.trim() &&
      previous.author.email === author.email
    )
      return { repo, branch, commit: oid, unchanged: true };
    throw new Error("Nothing is staged to commit");
  }
  const oid = await ctx.git.commit({
    fs: ctx.fs,
    dir: ctx.dir,
    message,
    author,
  });
  return { repo, branch, commit: oid };
}

// isomorphic-git reports remote refs as a tree split on "/" (heads.crew.run.dev), not a flat map.
export const remoteTip = (info: any, name: string) => {
  const tip = name.split("/").reduce((node, part) => node?.[part], info?.refs?.heads);
  return typeof tip === "string" ? tip : undefined;
};

// Pushes the checked-out branch to the same-named remote branch, fast-forward only. When the remote already
// has this exact commit nothing is sent and the result says so.
export async function push(
  repo: string,
  branch: string,
  overrides?: Overrides,
) {
  const ctx = context(overrides);
  await assertRepository(repo, ctx);
  const name = branchName(branch);
  if ((await currentBranch(ctx)) !== name)
    throw new Error("Push names a branch other than the checked-out one");
  const token = ctx.env.GITHUB_TOKEN;
  if (!token) throw new Error("Push requires GITHUB_TOKEN");
  const onAuth = () => ({ username: "x-access-token", password: token });
  const url = remoteUrl(repo);
  const head = await headOf(ctx);
  const info = await ctx.git.getRemoteInfo({ http: ctx.http, url, onAuth });
  if (remoteTip(info, name) === head)
    return { repo, branch: name, commit: head, upToDate: true };
  const result = await ctx.git.push({
    fs: ctx.fs,
    http: ctx.http,
    dir: ctx.dir,
    url,
    ref: `refs/heads/${name}`,
    remoteRef: `refs/heads/${name}`,
    force: false,
    onAuth,
  });
  if (!result?.ok)
    throw new Error(`Push was rejected: ${JSON.stringify(result?.refs ?? {})}`);
  return { repo, branch: name, commit: head };
}
