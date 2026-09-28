import { strict as assert } from "node:assert";
import test from "node:test";
import { catalogHasOnlyMetadata, validateCatalog } from "../lib/validate.mjs";

const root = new URL("../", import.meta.url).pathname;

test("catalog manifests are valid and uniquely indexed", () => {
  assert.deepEqual(
    [...validateCatalog(root)],
    ["collaboration/pi-github-tools"],
  );
});

test("catalog contains metadata, not package handlers", () => {
  assert.equal(catalogHasOnlyMetadata(root), true);
});
