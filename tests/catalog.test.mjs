import { strict as assert } from "node:assert";
import test from "node:test";
import {
  suiteClosuresAreCoLocated,
  suitePackagesAreCoLocated,
  validateCatalog,
} from "../lib/validate.mjs";

const root = new URL("../", import.meta.url).pathname;

test("catalog manifests are valid and uniquely indexed", () => {
  assert.deepEqual(
    [...validateCatalog(root)],
    ["collaboration/pi-github-tools"],
  );
});

test("each cataloged suite has a co-located locked Nix closure definition", () => {
  assert.equal(suiteClosuresAreCoLocated(root), true);
});

test("each cataloged suite has co-located package source", () => {
  assert.equal(suitePackagesAreCoLocated(root), true);
});
