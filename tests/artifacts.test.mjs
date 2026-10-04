import { strict as assert } from "node:assert";
import test from "node:test";
import { buildArtifacts, suitesUnchanged, validateArtifacts } from "../lib/artifacts.mjs";

const root = new URL("../", import.meta.url).pathname;
const revision = "0123456789abcdef0123456789abcdef01234567";
const cache = { substituter: "https://hall-armory.cachix.org", publicKey: "hall-armory.cachix.org-1:key" };
const hash = (seed) => `${seed.repeat(32).slice(0, 32)}`;
const narHash = `sha256-${"A".repeat(43)}=`;

function fakeNix(calls) {
  return (command, args) => {
    calls.push(args);
    if (args[0] === "build") {
      const system = args.at(-1).match(/packages\.([a-z0-9_-]+)\./)[1];
      return `/nix/store/${hash(system === "x86_64-linux" ? "a" : "b")}-suite\n`;
    }
    const root = args.at(-1);
    return JSON.stringify({
      [root]: { narHash, narSize: 10 },
      [`/nix/store/${hash("c")}-gh-2`]: { narHash, narSize: 30 },
    });
  };
}

test("the document records both systems, the exact closure, and the embedded manifests", () => {
  const calls = [];
  const doc = validateArtifacts(buildArtifacts({ root, repo: "o/r", revision, cache, exec: fakeNix(calls) }));
  const suite = doc.suites["collaboration/pi-github-tools"];
  assert.deepEqual(Object.keys(suite.systems).sort(), ["aarch64-linux", "x86_64-linux"]);
  assert.equal(suite.manifest.format, "hall.armory-suite/v1");
  assert.equal(suite.systems["x86_64-linux"].closure.length, 2);
  assert.equal(suite.systems["x86_64-linux"].storePath, `/nix/store/${hash("a")}-suite`);
  assert.equal(doc.catalog.format, "hall.armory/v1");
});

test("only the cache is consulted: builds are forbidden unless explicitly allowed", () => {
  const strict = [];
  buildArtifacts({ root, repo: "o/r", revision, cache, exec: fakeNix(strict) });
  assert.ok(strict.filter((a) => a[0] === "build").every((a) => a.join(" ").includes("--max-jobs 0")));
  const loose = [];
  buildArtifacts({ root, repo: "o/r", revision, cache, allowBuild: true, local: true, exec: fakeNix(loose) });
  assert.ok(loose.filter((a) => a[0] === "build").every((a) => !a.includes("--max-jobs") && a.at(-1).startsWith("path:")));
});

test("the same locator a client uses selects the revision", () => {
  const calls = [];
  buildArtifacts({ root, repo: "o/r", revision, cache, exec: fakeNix(calls) });
  assert.match(calls[0].at(-1), new RegExp(`^github:o/r/${revision}\\?dir=collaboration/github#packages\\.x86_64-linux\\.guest$`));
});

test("validation rejects documents a client could not safely use", () => {
  const good = () => buildArtifacts({ root, repo: "o/r", revision, cache, exec: fakeNix([]) });
  const mutate = (change) => {
    const doc = good();
    change(doc);
    return () => validateArtifacts(doc);
  };
  assert.throws(mutate((d) => (d.format = "x")), /unsupported format/);
  assert.throws(mutate((d) => (d.revision = "main")), /full git commit/);
  assert.throws(mutate((d) => (d.cache = {})), /cache identity/);
  assert.throws(mutate((d) => (d.suites["collaboration/pi-github-tools"].systems["riscv"] = {})), /unknown system/);
  assert.throws(mutate((d) => (d.suites["collaboration/pi-github-tools"].systems["x86_64-linux"].closure = [])), /omits its root/);
  assert.throws(mutate((d) => (d.suites["collaboration/pi-github-tools"].systems["x86_64-linux"].storePath = "/tmp/x")), /bad store path/);
});

test("identical suites need no new release", () => {
  const a = buildArtifacts({ root, repo: "o/r", revision, cache, exec: fakeNix([]) });
  const b = buildArtifacts({ root, repo: "o/r", revision: "f".repeat(40), cache, exec: fakeNix([]) });
  assert.equal(suitesUnchanged(a, b), true);
  b.suites["collaboration/pi-github-tools"].systems["x86_64-linux"].storePath = `/nix/store/${hash("d")}-suite`;
  assert.equal(suitesUnchanged(a, b), false);
});
