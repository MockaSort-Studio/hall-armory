import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;

test("the extension bundle is self-contained, deterministic and registers the suite", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "armory-bundle-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const build = () => JSON.parse(execFileSync("node", ["scripts/bundle-extensions.mjs", "--out", out], { cwd: root, encoding: "utf8" }));
  const sources = build();
  const entry = sources["collaboration/pi-github-tools"];
  const bytes = readFileSync(join(out, entry.file));
  assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(entry.size, bytes.length);
  assert.deepEqual(build(), sources, "the same sources produce the same bytes, so unchanged suites need no release");

  // Imported from a directory with no node_modules anywhere above it.
  const module = await import(join(out, entry.file));
  const registered = [];
  module.activateSuite({ registerTool: (tool) => registered.push(tool.name) });
  for (const name of ["github_git_push", "github_workspace_checkout", "github_pull_request_create", "github_issue_view"])
    assert.ok(registered.includes(name), `${name} is registered`);
  assert.equal(typeof module.default, "function");
  const specifiers = [...bytes.toString().matchAll(/(?:\bfrom|\brequire\()\s*"([A-Za-z0-9@][A-Za-z0-9@/._:-]*)"/g)].map((match) => match[1]);
  const external = specifiers.filter(
    (name) => !name.startsWith("node:") && !builtinModules.includes(name) && !name.startsWith("@earendil-works/"),
  );
  assert.deepEqual([...new Set(external)], [], "only Node builtins and Pi packages are left external");
});
