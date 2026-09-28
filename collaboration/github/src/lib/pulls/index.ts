import { gh, ghJson } from "../core/gh.ts";
import * as labels from "../labels/index.ts";

export async function listPullRequests(
  repo: string,
  state = "open",
  limit = 30,
) {
  return (
    (await ghJson([
      "pr",
      "list",
      "-R",
      repo,
      "--state",
      state,
      "--limit",
      String(limit),
      "--json",
      "number,title,state,isDraft,author,headRefName,baseRefName,url",
    ])) ?? []
  );
}

export async function viewPullRequest(repo: string, number: number) {
  return ghJson([
    "pr",
    "view",
    String(number),
    "-R",
    repo,
    "--json",
    "number,title,body,state,isDraft,author,headRefName,baseRefName,labels,reviews,statusCheckRollup,url",
  ]);
}

const REVIEW_THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved comments(first: 100) { nodes { path line originalLine body url author { login } } } }
      }
    }
  }
}`;

export function reviewThreadComments(data: any, includeResolved = false) {
  const threads =
    data?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return threads
    .filter((thread) => includeResolved || !thread.isResolved)
    .flatMap(
      (thread) =>
        thread.comments?.nodes?.map((comment) => ({
          resolved: Boolean(thread.isResolved),
          path: comment.path,
          line: comment.line ?? comment.originalLine ?? null,
          body: comment.body,
          url: comment.url,
          author: comment.author?.login ?? null,
        })) ?? [],
    );
}

export async function listPullRequestReviewThreads(
  repo: string,
  number: number,
  includeResolved = false,
) {
  const [owner, name] = repo.split("/");
  if (!owner || !name || repo.split("/").length !== 2)
    throw new Error(`Invalid repository: ${repo}`);
  const data = await ghJson([
    "api",
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${name}`,
    "-F",
    `number=${number}`,
    "-f",
    `query=${REVIEW_THREADS_QUERY}`,
  ]);
  return reviewThreadComments(data, includeResolved);
}

export async function commentOnPullRequest(
  repo: string,
  number: number,
  body: string,
) {
  await gh(["pr", "comment", String(number), "-R", repo, "--body", body]);
  return { repo, pullNumber: number, commented: true };
}

export async function updatePullRequest(
  repo: string,
  number: number,
  {
    title,
    body,
    base,
    state,
  }: { title?: string; body?: string; base?: string; state?: string },
) {
  const args = ["pr", "edit", String(number), "-R", repo];
  if (title) args.push("--title", title);
  if (body) args.push("--body", body);
  if (base) args.push("--base", base);
  await gh(args);
  if (state === "closed") await gh(["pr", "close", String(number), "-R", repo]);
  if (state === "open") await gh(["pr", "reopen", String(number), "-R", repo]);
  return viewPullRequest(repo, number);
}

export async function reviewPullRequest(
  repo: string,
  number: number,
  event: "approve" | "request-changes",
  body?: string,
) {
  const args = [
    "pr",
    "review",
    String(number),
    "-R",
    repo,
    event === "approve" ? "--approve" : "--request-changes",
  ];
  if (body) args.push("--body", body);
  await gh(args);
  return { repo, pullNumber: number, review: event, reviewed: true };
}

export async function mergePullRequest(
  repo: string,
  number: number,
  method = "squash",
) {
  await gh([
    "pr",
    "merge",
    String(number),
    "-R",
    repo,
    `--${method}`,
    "--delete-branch",
  ]);
  return viewPullRequest(repo, number);
}

export function addPullRequestLabels(
  repo: string,
  number: number,
  names: string[],
) {
  return labels.addLabels(repo, number, names);
}

export function removePullRequestLabel(
  repo: string,
  number: number,
  name: string,
) {
  return labels.removeLabel(repo, number, name);
}
