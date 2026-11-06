import { gh, ghJson } from "../core/gh.ts";

const parts = (repo: string) => {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length)
    throw new Error(`Invalid repository: ${repo}`);
  return { owner, name };
};

const refName = (branch: string) => {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(branch) ||
    branch.includes("..") ||
    branch.endsWith("/")
  )
    throw new Error(`Invalid branch: ${branch}`);
  return `refs/heads/${branch}`;
};

export async function createBranch(repo: string, branch: string, sha: string) {
  const { owner, name } = parts(repo);
  const ref = refName(branch);
  const created = await ghJson([
    "api",
    "--method",
    "POST",
    `repos/${owner}/${name}/git/refs`,
    "-f",
    `ref=${ref}`,
    "-f",
    `sha=${sha}`,
  ]);
  return {
    repo,
    branch,
    sha: created?.object?.sha ?? sha,
    ref: created?.ref ?? ref,
  };
}

export async function updateFile(
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
) {
  const { owner, name } = parts(repo);
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Invalid repository path: ${path}`);
  const args = [
    "api",
    "--method",
    "PUT",
    `repos/${owner}/${name}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}`,
    "-f",
    `branch=${branch}`,
    "-f",
    `message=${message}`,
    "-f",
    `content=${Buffer.from(content).toString("base64")}`,
  ];
  if (sha) args.push("-f", `sha=${sha}`);
  const result = await ghJson(args);
  return {
    repo,
    branch,
    path,
    commit: result?.commit?.sha,
    blob: result?.content?.sha,
  };
}

export async function createPullRequest(
  repo: string,
  head: string,
  base: string,
  title: string,
  body?: string,
  draft = false,
) {
  const { owner, name } = parts(repo);
  const args = [
    "api",
    "--method",
    "POST",
    `repos/${owner}/${name}/pulls`,
    "-f",
    `title=${title}`,
    "-f",
    `head=${head}`,
    "-f",
    `base=${base}`,
    "-F",
    `draft=${draft}`,
  ];
  if (body) args.push("-f", `body=${body}`);
  const created = await ghJson(args);
  return { repo, head, base, url: created?.html_url, number: created?.number, draft: Boolean(created?.draft) };
}
