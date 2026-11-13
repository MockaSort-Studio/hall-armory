import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const runner = new URL("../guest-suite-build/runner.ts", import.meta.url).pathname;
const run = (mode, request) => {
  const dir = mkdtempSync(join(tmpdir(), "npm-guest-"));
  try {
    writeFileSync(join(dir, "in.json"), JSON.stringify(request));
    const result = spawnSync("node", [runner, mode, join(dir, "in.json"), join(dir, "out.json")], { encoding: "utf8" });
    return { status: result.status, out: JSON.parse(readFileSync(join(dir, "out.json"), "utf8")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("the guest runner describes the approved operations and refuses to invoke them: they run host-side", () => {
  const described = run("describe", { operations: ["npm_audit"] });
  assert.deepEqual(described.out.operations.map((operation) => operation.name), ["npm_audit"]);
  const invoked = run("invoke", { operations: ["npm_audit"], operation: "npm_audit", input: {} });
  assert.equal(invoked.status, 1);
  assert.match(invoked.out.error.message, /runs on the host, not in a guest/);
  assert.match(run("invoke", { operations: ["npm_audit"], operation: "npm_install_verified", input: {} }).out.error.message, /not approved/);
});
