import assert from "node:assert/strict";
import test from "node:test";
import { activateSuite } from "../src/index.ts";
import { LIMITS } from "../src/lib/limits.ts";
import { fakeFetch, fakeWorkspace, lockfile } from "./helpers.mjs";

const ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const entry = (version, extra = {}) => ({ version, resolved: "https://registry.npmjs.org/x/-/x.tgz", integrity: "x", ...extra });
const audit = async (packages, fetch, input = {}) => {
  const tools = new Map();
  const workspace = fakeWorkspace({ "/workspace/package-lock.json": lockfile(packages) });
  activateSuite({ registerTool: (tool) => tools.set(tool.name, tool) }, { workspace, fetch });
  return (await tools.get("npm_audit").execute("id", input)).details;
};
const packages = {
  "node_modules/a": entry("1.0.0"),
  "node_modules/b": entry("2.0.0"),
  "node_modules/b/node_modules/a": entry("1.1.0"),
  "node_modules/dev-only": entry("3.0.0", { dev: true }),
  "node_modules/linked": { link: true, resolved: "../x" },
};

test("the audit posts the exact name@version pairs to the registry's bulk endpoint and summarizes advisories", async () => {
  const fetch = fakeFetch({
    [ENDPOINT]: JSON.stringify({ a: [{ id: 1, severity: "high", title: "Bad", url: "https://u", vulnerable_versions: "<1.1.0" }] }),
  });
  const result = await audit(packages, fetch);
  const [call] = fetch.calls;
  assert.equal(fetch.calls.length, 1);
  assert.equal(call.url, ENDPOINT);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "error");
  assert.deepEqual(JSON.parse(call.init.body), { a: ["1.0.0", "1.1.0"], b: ["2.0.0"], "dev-only": ["3.0.0"] });
  assert.deepEqual([result.advisories, result.counts, result.truncated], [1, { high: 1 }, false]);
  assert.deepEqual(result.vulnerabilities[0], {
    name: "a", severity: "high", title: "Bad", url: "https://u", range: "<1.1.0", versions: ["1.0.0", "1.1.0"],
  });
  const production = fakeFetch({ [ENDPOINT]: "{}" });
  await audit(packages, production, { include: "production" });
  assert.ok(!("dev-only" in JSON.parse(production.calls[0].init.body)));
});

test("a clean result is only ever a valid empty advisory answer; every failure is an error", async () => {
  assert.equal((await audit(packages, fakeFetch({ [ENDPOINT]: "{}" }))).advisories, 0);
  for (const [name, route] of [
    ["unreachable", { status: 503, body: "" }],
    ["not JSON", "<html>"],
    ["an array", "[]"],
    ["a non-list value", JSON.stringify({ a: "none" })],
  ])
    await assert.rejects(audit(packages, fakeFetch({ [ENDPOINT]: route })), /registry|unexpected shape|not JSON/, name);
  await assert.rejects(audit(packages, async () => { throw new Error("network down"); }), /network down/);
});

test("output and response are bounded, and large lockfiles are sent in batches", async () => {
  const many = JSON.stringify({ a: Array.from({ length: 500 }, (_, index) => ({ severity: "low", title: "t".repeat(1000), url: "u", vulnerable_versions: "*", id: index })) });
  const result = await audit(packages, fakeFetch({ [ENDPOINT]: many }));
  assert.equal(result.vulnerabilities.length, LIMITS.auditItems);
  assert.equal(result.advisories, 500);
  assert.equal(result.truncated, true);
  assert.ok(result.vulnerabilities.every((item) => item.title.length <= LIMITS.auditText));
  await assert.rejects(
    audit(packages, fakeFetch({ [ENDPOINT]: { body: "{}", headers: { "content-length": String(LIMITS.auditResponseBytes + 1) } } })),
    /larger than/,
  );
  const wide = Object.fromEntries(Array.from({ length: LIMITS.auditBatch * 2 + 1 }, (_, index) => [`node_modules/p${index}`, entry("1.0.0")]));
  const batched = fakeFetch({ [ENDPOINT]: "{}" });
  await audit(wide, batched);
  assert.equal(batched.calls.length, 3);
});
