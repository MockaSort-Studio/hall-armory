import { gh, ghJson } from "../core/gh.ts";

async function repositoryId(owner, repo) {
  const query =
    "query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){id}}";
  return gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "--jq",
    ".data.repository.id",
  ]);
}

async function categoryId(owner, repo, categoryName) {
  const query =
    "query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){discussionCategories(first:20){nodes{id name}}}}";
  const categories = await ghJson([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "--jq",
    ".data.repository.discussionCategories.nodes",
  ]);
  const match = categories.find(
    (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
  );
  if (!match) throw new Error(`Unknown discussion category "${categoryName}"`);
  return match.id;
}

async function discussionNodeId(owner, repo, number) {
  const query =
    "query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){discussion(number:$num){id}}}";
  return gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "-F",
    `num=${number}`,
    "--jq",
    ".data.repository.discussion.id",
  ]);
}

export async function viewDiscussion(owner, repo, number) {
  const query =
    "query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){discussion(number:$num){id number title body url closed closedAt}}}";
  return ghJson([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "-F",
    `num=${number}`,
    "--jq",
    ".data.repository.discussion",
  ]);
}

export async function listDiscussions(owner, repo, limit = 100) {
  const query =
    "query($owner:String!,$repo:String!,$limit:Int!){repository(owner:$owner,name:$repo){discussions(first:$limit){nodes{id number title url}}}}";
  return ghJson([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `repo=${repo}`,
    "-F",
    `limit=${limit}`,
    "--jq",
    ".data.repository.discussions.nodes",
  ]);
}

export async function createDiscussion(owner, repo, title, body, categoryName) {
  const repoId = await repositoryId(owner, repo);
  const catId = await categoryId(owner, repo, categoryName);
  const mutation = `mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body}){discussion{id number url}}}`;
  const result = await gh([
    "api",
    "graphql",
    "-f",
    `query=${mutation}`,
    "-f",
    `repoId=${repoId}`,
    "-f",
    `catId=${catId}`,
    "-f",
    `title=${title}`,
    "-f",
    `body=${body}`,
    "--jq",
    ".data.createDiscussion.discussion",
  ]);
  return JSON.parse(result);
}

export async function commentOnDiscussion(owner, repo, number, body) {
  const discussionId = await discussionNodeId(owner, repo, number);
  const mutation =
    "mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{id url}}}";
  return JSON.parse(
    await gh([
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-f",
      `id=${discussionId}`,
      "-f",
      `body=${body}`,
      "--jq",
      ".data.addDiscussionComment.comment",
    ]),
  );
}

export function flattenDiscussionComments(comments) {
  return comments.flatMap((comment) => [
    {
      id: comment.id,
      url: comment.url,
      body: comment.body,
      author: comment.author,
    },
    ...(comment.replies?.nodes ?? []).map((reply) => ({
      id: reply.id,
      url: reply.url,
      body: reply.body,
      author: reply.author,
      replyToId: comment.id,
    })),
  ]);
}

export async function listComments(owner, repo, number, limit = 20) {
  const query =
    "query($owner:String!,$repo:String!,$num:Int!,$limit:Int!){repository(owner:$owner,name:$repo){discussion(number:$num){comments(first:$limit){nodes{id url body author{login} replies(first:100){nodes{id url body author{login}}}}}}}}";
  const comments = JSON.parse(
    await gh([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-F",
      `num=${number}`,
      "-F",
      `limit=${limit}`,
      "--jq",
      ".data.repository.discussion.comments.nodes",
    ]),
  );
  return flattenDiscussionComments(comments);
}

export async function deleteDiscussion(owner, repo, number) {
  const discussionId = await discussionNodeId(owner, repo, number);
  const mutation =
    "mutation($id:ID!){deleteDiscussion(input:{id:$id}){discussion{id}}}";
  return JSON.parse(
    await gh([
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-f",
      `id=${discussionId}`,
      "--jq",
      ".data.deleteDiscussion.discussion",
    ]),
  );
}

export async function updateDiscussion(owner, repo, number, title, body) {
  const discussionId = await discussionNodeId(owner, repo, number);
  const mutation =
    "mutation($id:ID!,$title:String!,$body:String!){updateDiscussion(input:{id:$id,title:$title,body:$body}){discussion{id number url}}}";
  return JSON.parse(
    await gh([
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-f",
      `id=${discussionId}`,
      "-f",
      `title=${title}`,
      "-f",
      `body=${body}`,
      "--jq",
      ".data.updateDiscussion.discussion",
    ]),
  );
}
