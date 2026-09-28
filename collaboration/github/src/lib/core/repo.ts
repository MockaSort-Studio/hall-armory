import { gh } from "./gh.ts";

export async function setDiscussionsEnabled(repo, enabled) {
  return gh([
    "api",
    `repos/${repo}`,
    "-X",
    "PATCH",
    "-F",
    `has_discussions=${enabled}`,
    "--jq",
    "{name, has_discussions}",
  ]);
}
