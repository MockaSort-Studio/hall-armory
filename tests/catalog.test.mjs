import { strict as assert } from "node:assert";
import test from "node:test";
import { packageSourceIsIsolated, validateCatalog } from "../lib/validate.mjs";

const root = new URL("../", import.meta.url).pathname;

test("catalog manifests are valid and uniquely indexed", () => {
  assert.deepEqual(
    [...validateCatalog(root)],
    ["collaboration/pi-github-tools"],
  );
});

test("package source is isolated below extensions", () => {
  assert.equal(packageSourceIsIsolated(root), true);
});
