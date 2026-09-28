import { ghJson } from "../core/gh.ts";
import { viewPullRequest } from "./index.ts";

const identityQuery = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id headRefOid author { login } } }
}`;
const startReviewMutation = `mutation($pullRequestId: ID!, $body: String!) {
  addPullRequestReview(input: {pullRequestId: $pullRequestId, body: $body}) { pullRequestReview { id } }
}`;
const inlineCommentMutation = `mutation($reviewId: ID!, $body: String!, $path: String!, $line: Int!, $side: DiffSide!) {
  addPullRequestReviewThread(input: {pullRequestReviewId: $reviewId, body: $body, path: $path, line: $line, side: $side}) {
    thread { id }
  }
}`;
const submitReviewMutation = `mutation($reviewId: ID!, $event: PullRequestReviewEvent!, $body: String!) {
  submitPullRequestReview(input: {pullRequestReviewId: $reviewId, event: $event, body: $body}) {
    pullRequestReview { id state }
  }
}`;

const repoParts = (repo: string) => {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length)
    throw new Error(`Invalid repository: ${repo}`);
  return { owner, name };
};

export function inlineReviewInput(input: {
  path: string;
  line: number;
  side?: string;
  body: string;
}) {
  if (
    !input.path?.trim() ||
    !Number.isInteger(input.line) ||
    input.line < 1 ||
    !input.body?.trim()
  )
    throw new Error(
      "Inline review comment requires a path, positive line, and body.",
    );
  const side = input.side ?? "RIGHT";
  if (!["LEFT", "RIGHT"].includes(side))
    throw new Error("Inline review comment side must be LEFT or RIGHT.");
  return { path: input.path, line: input.line, side, body: input.body };
}

export function changedPullRequestLine(
  files: any[],
  path: string,
  line: number,
  side: string,
) {
  const patch = files.find((file) => file.filename === path)?.patch;
  if (!patch) return false;
  let oldLine = 0;
  let newLine = 0;
  for (const text of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
    } else if (text.startsWith("+") && !text.startsWith("+++")) {
      if (side === "RIGHT" && newLine === line) return true;
      newLine++;
    } else if (text.startsWith("-") && !text.startsWith("---")) {
      if (side === "LEFT" && oldLine === line) return true;
      oldLine++;
    } else if (text.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }
  return false;
}

export function assertNotSelfReview(
  pullRequestAuthor: string | undefined,
  reviewer: string | undefined,
) {
  if (
    pullRequestAuthor &&
    reviewer &&
    pullRequestAuthor.toLowerCase() === reviewer.toLowerCase()
  )
    throw new Error("Cannot review your own pull request.");
}

export function reviewSubmissionInput(input: {
  event: string;
  body?: string;
  hasBlockingFindings: boolean;
}) {
  if (input.event === "approve" && input.hasBlockingFindings)
    throw new Error("Cannot approve with blocking findings.");
  if (!(["approve", "request-changes"] as string[]).includes(input.event))
    throw new Error("Invalid review event.");
  return {
    event: input.event === "approve" ? "APPROVE" : "REQUEST_CHANGES",
    body: input.body ?? "",
  };
}

async function reviewIdentity(repo: string, number: number) {
  const { owner, name } = repoParts(repo);
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
    `query=${identityQuery}`,
  ]);
  const pullRequest = data?.data?.repository?.pullRequest;
  if (!pullRequest?.id)
    throw new Error(`Pull request not found: ${repo}#${number}`);
  return pullRequest;
}

export async function listPullRequestFiles(repo: string, number: number) {
  repoParts(repo);
  return (await ghJson(["api", `repos/${repo}/pulls/${number}/files`])) ?? [];
}

export async function listPullRequestChecks(repo: string, number: number) {
  return (await viewPullRequest(repo, number))?.statusCheckRollup ?? [];
}

export async function startPullRequestReview(
  repo: string,
  number: number,
  body = "",
) {
  const pullRequest = await reviewIdentity(repo, number);
  assertNotSelfReview(
    pullRequest.author?.login,
    (await ghJson(["api", "user"]))?.login,
  );
  const data = await ghJson([
    "api",
    "graphql",
    "-f",
    `pullRequestId=${pullRequest.id}`,
    "-f",
    `body=${body}`,
    "-f",
    `query=${startReviewMutation}`,
  ]);
  return {
    repo,
    pullNumber: number,
    reviewId: data?.data?.addPullRequestReview?.pullRequestReview?.id,
  };
}

export async function addInlinePullRequestReviewComment(
  repo: string,
  number: number,
  reviewId: string,
  input: Parameters<typeof inlineReviewInput>[0],
) {
  const comment = inlineReviewInput(input);
  if (
    !changedPullRequestLine(
      await listPullRequestFiles(repo, number),
      comment.path,
      comment.line,
      comment.side,
    )
  )
    throw new Error(
      "Inline review comment line is not part of the pull-request diff.",
    );
  const data = await ghJson([
    "api",
    "graphql",
    "-f",
    `reviewId=${reviewId}`,
    "-f",
    `body=${comment.body}`,
    "-f",
    `path=${comment.path}`,
    "-F",
    `line=${comment.line}`,
    "-f",
    `side=${comment.side}`,
    "-f",
    `query=${inlineCommentMutation}`,
  ]);
  return {
    reviewId,
    ...comment,
    threadId: data?.data?.addPullRequestReviewThread?.thread?.id,
  };
}

export async function submitPullRequestReview(
  reviewId: string,
  input: Parameters<typeof reviewSubmissionInput>[0],
) {
  const review = reviewSubmissionInput(input);
  const data = await ghJson([
    "api",
    "graphql",
    "-f",
    `reviewId=${reviewId}`,
    "-f",
    `event=${review.event}`,
    "-f",
    `body=${review.body}`,
    "-f",
    `query=${submitReviewMutation}`,
  ]);
  return {
    reviewId,
    ...review,
    submitted: Boolean(
      data?.data?.submitPullRequestReview?.pullRequestReview?.id,
    ),
  };
}
