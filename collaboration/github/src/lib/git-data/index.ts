import { gh, ghJson } from "../core/gh.ts";

const parts = (repo: string) => {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length)
    throw new Error(`Invalid repository: ${repo}`);
  return { owner, name };
};

const summary = (repo, head, base, pull, existing = false) => ({
  repo,
  head,
  base,
  url: pull?.html_url,
  number: pull?.number,
  draft: Boolean(pull?.draft),
  ...(existing ? { existing: true } : {}),
});

// Idempotent: when an open pull request for this head and base already exists it is returned, not
// duplicated (a retry after a lost response, or a second salvage).
export async function createPullRequest(
  repo: string,
  head: string,
  base: string,
  title: string,
  body?: string,
  draft = false,
) {
  const { owner, name } = parts(repo);
  const lookup = async () => {
    const found = await ghJson([
      "api",
      `repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`,
    ]);
    return Array.isArray(found) ? found[0] : undefined;
  };
  const existing = await lookup();
  if (existing) return summary(repo, head, base, existing, true);
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
  try {
    return summary(repo, head, base, await ghJson(args));
  } catch (error) {
    // Lost the race with a concurrent create: the pull request exists now.
    if (error?.status === 422) {
      const raced = await lookup();
      if (raced) return summary(repo, head, base, raced, true);
    }
    throw error;
  }
}
