import { gh, ghJson } from "../core/gh.ts";

const parts = (repo: string) => {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length)
    throw new Error(`Invalid repository: ${repo}`);
  return { owner, name };
};

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
