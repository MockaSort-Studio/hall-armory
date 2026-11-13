import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { activateSuite } from "../src/index.ts";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the suite registers exactly the operations its manifest declares", () => {
  const tools = new Map();
  activateSuite({ registerTool: (tool) => tools.set(tool.name, tool) });
  assert.deepEqual([...tools.keys()].sort(), [...manifest.tools].sort());
  for (const tool of tools.values()) assert.ok(tool.parameters && tool.description, tool.name);
});

test("the manifest allows the npm registry host only and no credential", () => {
  assert.deepEqual(manifest.network.allowedHosts, ["registry.npmjs.org"]);
  assert.deepEqual(manifest.network.credentials, []);
  assert.equal(manifest.package.name, pkg.name);
});

test("the suite is standalone: no Crew naming and no host-specific imports", () => {
  const dir = new URL("../src/lib/", import.meta.url);
  for (const file of readdirSync(dir)) {
    const source = readFileSync(new URL(file, dir), "utf8");
    assert.doesNotMatch(source, /crew/i, file);
    for (const [, target] of source.matchAll(/from "([^"]+)"/g))
      assert.match(target, /^(\.\/|node:|typebox$)/, `${file} imports ${target}`);
  }
});
