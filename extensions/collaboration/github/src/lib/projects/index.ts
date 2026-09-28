import { gh, ghJson } from "../core/gh.ts";

export async function getFieldMap(org, project) {
  const data = await ghJson([
    "project",
    "field-list",
    String(project),
    "--owner",
    org,
    "--format",
    "json",
  ]);
  const map = {};
  for (const field of data.fields) {
    map[field.name] = { id: field.id, options: {} };
    for (const opt of field.options ?? [])
      map[field.name].options[opt.name] = opt.id;
  }
  return map;
}

export async function projectId(org, project) {
  const data = await ghJson([
    "project",
    "view",
    String(project),
    "--owner",
    org,
    "--format",
    "json",
  ]);
  return data.id;
}

export async function addItem(org, project, url) {
  return gh([
    "project",
    "item-add",
    String(project),
    "--owner",
    org,
    "--url",
    url,
    "--format",
    "json",
  ]);
}

export async function findItemId(org, project, issueNumber) {
  const data = await ghJson([
    "project",
    "item-list",
    String(project),
    "--owner",
    org,
    "--format",
    "json",
    "--limit",
    "500",
  ]);
  const item = data.items.find((it) => it.content?.number === issueNumber);
  if (!item) throw new Error(`No project item found for issue #${issueNumber}`);
  return item.id;
}

// Field/option ids are resolved live on every call — GitHub is the sole state
// model (Saga 1's design law), nothing about it gets mirrored to local disk.
export async function setField(org, project, itemId, fieldName, valueName) {
  const map = await getFieldMap(org, project);
  const field = map[fieldName];
  if (!field) throw new Error(`Unknown field "${fieldName}"`);
  const optionId = field.options[valueName];
  if (!optionId)
    throw new Error(`Unknown option "${valueName}" for field "${fieldName}"`);
  const resolvedProjectId = await projectId(org, project);
  return gh([
    "project",
    "item-edit",
    "--id",
    itemId,
    "--project-id",
    resolvedProjectId,
    "--field-id",
    field.id,
    "--single-select-option-id",
    optionId,
  ]);
}
