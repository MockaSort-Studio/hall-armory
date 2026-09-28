import { gh, ghJson } from "../core/gh.ts";

export async function listLabels(repo: string) {
  return ghJson([
    "label",
    "list",
    "-R",
    repo,
    "--json",
    "name,color,description",
  ]);
}

export async function createLabel(
  repo: string,
  name: string,
  color: string,
  description?: string,
) {
  const args = [
    "label",
    "create",
    name,
    "-R",
    repo,
    "--color",
    color,
    "--force",
  ];
  if (description) args.push("--description", description);
  await gh(args);
  return { repo, name, color, description: description ?? "" };
}

export async function updateLabel(
  repo: string,
  name: string,
  color?: string,
  description?: string,
) {
  const args = ["label", "edit", name, "-R", repo];
  if (color) args.push("--color", color);
  if (description !== undefined) args.push("--description", description);
  await gh(args);
  return { repo, name, color, description };
}

export async function addLabels(
  repo: string,
  issueNumber: number,
  labels: string[],
) {
  await gh([
    "issue",
    "edit",
    String(issueNumber),
    "-R",
    repo,
    "--add-label",
    labels.join(","),
  ]);
  return viewLabels(repo, issueNumber);
}

export async function removeLabel(
  repo: string,
  issueNumber: number,
  label: string,
) {
  await gh([
    "issue",
    "edit",
    String(issueNumber),
    "-R",
    repo,
    "--remove-label",
    label,
  ]);
  return viewLabels(repo, issueNumber);
}

async function viewLabels(repo: string, issueNumber: number) {
  return ghJson([
    "issue",
    "view",
    String(issueNumber),
    "-R",
    repo,
    "--json",
    "number,title,labels,url",
  ]);
}
