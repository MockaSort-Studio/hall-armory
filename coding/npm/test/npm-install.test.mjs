import assert from "node:assert/strict";
import test from "node:test";
import { activateSuite } from "../src/index.ts";
import { LIMITS } from "../src/lib/limits.ts";
import { fakeFetch, fakeWorkspace, lockfile, locked, packageTarball, sri, tarEntry, tarball, url } from "./helpers.mjs";

const run = async (workspace, fetch, input = {}) => {
  const tools = new Map();
  activateSuite({ registerTool: (tool) => tools.set(tool.name, tool) }, { workspace, fetch });
  return (await tools.get("npm_install_verified").execute("id", input)).details;
};
const setup = (packages, extra = {}) => {
  const routes = {};
  const entries = {};
  for (const [key, item] of Object.entries(packages)) {
    entries[key] = item.entry;
    routes[item.entry.resolved] = item.archive;
  }
  const workspace = fakeWorkspace({ "/workspace/package-lock.json": lockfile(entries), ...extra });
  return { workspace, fetch: fakeFetch(routes) };
};

test("a locked tree is verified and written exactly as locked, from the registry only, with no redirects", async () => {
  const a = locked("left-pad", "1.3.0", { "bin/run.js": "#!/usr/bin/env node\n" });
  const b = locked("@scope/nested", "2.0.0");
  const { workspace, fetch } = setup({ "node_modules/left-pad": a, "node_modules/left-pad/node_modules/@scope/nested": b });
  const result = await run(workspace, fetch);
  assert.equal(result.installed, 2);
  assert.equal(workspace.files.get("/workspace/node_modules/left-pad/bin/run.js").toString(), "#!/usr/bin/env node\n");
  assert.ok(workspace.files.has("/workspace/node_modules/left-pad/node_modules/@scope/nested/index.js"));
  assert.ok(!workspace.files.has("/workspace/node_modules/left-pad/package/index.js"), "the leading package/ is stripped");
  assert.equal(fetch.calls.length, 2);
  for (const call of fetch.calls) {
    assert.match(call.url, /^https:\/\/registry\.npmjs\.org\//);
    assert.equal(call.init.redirect, "error");
  }
  assert.match(result.note, /No scripts were run/);
});

test("an integrity mismatch is refused before the archive is read, and nothing is written", async () => {
  const good = locked("left-pad", "1.3.0");
  // Hostile bytes that would fail the tar rules too: the error must be the integrity one, proving order.
  const hostile = tarball([tarEntry("package/x", "", { type: "2", linkname: "/etc/passwd" })]);
  const { workspace } = setup({ "node_modules/left-pad": good });
  const result = run(workspace, fakeFetch({ [good.entry.resolved]: hostile }));
  await assert.rejects(result, /node_modules\/left-pad: integrity mismatch/);
  assert.deepEqual([...workspace.files.keys()], ["/workspace/package-lock.json"]);
});

test("lock entries this suite cannot install exactly as locked refuse the whole install", async () => {
  const good = locked("left-pad", "1.3.0");
  const bad = [
    ["http source", { ...good.entry, resolved: good.entry.resolved.replace("https:", "http:") }],
    ["another host", { ...good.entry, resolved: "https://registry.example.com/left-pad/-/left-pad-1.3.0.tgz" }],
    ["lookalike host", { ...good.entry, resolved: "https://registry.npmjs.org.evil.test/left-pad/-/left-pad-1.3.0.tgz" }],
    ["userinfo", { ...good.entry, resolved: "https://user:pw@registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz" }],
    ["port", { ...good.entry, resolved: "https://registry.npmjs.org:8443/left-pad/-/left-pad-1.3.0.tgz" }],
    ["git source", { ...good.entry, resolved: "git+https://github.com/o/r.git#abc" }],
    ["no integrity", { version: "1.3.0", resolved: good.entry.resolved }],
    ["sha1 integrity", { ...good.entry, integrity: "sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }],
    ["two hashes", { ...good.entry, integrity: `${good.entry.integrity} sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=` }],
  ];
  for (const [name, entry] of bad) {
    const workspace = fakeWorkspace({ "/workspace/package-lock.json": lockfile({ "node_modules/left-pad": entry }) });
    const fetch = fakeFetch({ "*": good.archive });
    await assert.rejects(run(workspace, fetch), /left-pad/, name);
    assert.equal(fetch.calls.length, 0, `${name}: nothing is downloaded`);
  }
  for (const [name, packages] of [
    ["a link", { "node_modules/app": { resolved: "packages/app", link: true } }],
    ["a workspace path", { "packages/app": { version: "1.0.0" } }],
    ["a traversal key", { "node_modules/../evil": good.entry }],
  ]) {
    const workspace = fakeWorkspace({ "/workspace/package-lock.json": lockfile(packages) });
    await assert.rejects(run(workspace, fakeFetch({})), /unsupported lockfile entry/, name);
  }
  const v1 = fakeWorkspace({ "/workspace/package-lock.json": JSON.stringify({ lockfileVersion: 1, dependencies: {} }) });
  await assert.rejects(run(v1, fakeFetch({})), /lockfileVersion 2 or 3/);
});

test("optional packages that fail are reported, dev packages are left out of a production install", async () => {
  const main = locked("left-pad", "1.3.0");
  const dev = locked("tester", "1.0.0", undefined, { dev: true });
  const optional = locked("native-thing", "1.0.0", undefined, { optional: true });
  const bundled = locked("inside", "1.0.0", undefined, { inBundle: true });
  const { workspace, fetch } = setup({
    "node_modules/left-pad": main,
    "node_modules/tester": dev,
    "node_modules/native-thing": { ...optional, entry: { ...optional.entry, integrity: sri(Buffer.from("other")) } },
    "node_modules/left-pad/node_modules/inside": bundled,
  });
  const result = await run(workspace, fetch, { include: "production" });
  assert.equal(result.installed, 1);
  assert.deepEqual(
    result.skipped.map((item) => [item.path, item.reason]).sort(),
    [
      ["node_modules/left-pad/node_modules/inside", "bundled in its parent package"],
      ["node_modules/native-thing", "integrity mismatch"],
      ["node_modules/tester", "development dependency"],
    ],
  );
  assert.ok(!workspace.files.has("/workspace/node_modules/tester/index.js"));
});

test("an existing node_modules is never overwritten", async () => {
  const { workspace, fetch } = setup({ "node_modules/left-pad": locked("left-pad", "1.3.0") });
  workspace.directories.add("/workspace/node_modules");
  await assert.rejects(run(workspace, fetch), /never overwrites/);
  assert.equal(fetch.calls.length, 0);
});

test("a write failure leaves no partial tree behind", async () => {
  const a = locked("left-pad", "1.3.0", { "a.js": "1", "b.js": "2", "c.js": "3" });
  const { workspace: seeded, fetch } = setup({ "node_modules/left-pad": a });
  const workspace = fakeWorkspace(Object.fromEntries(seeded.files), { failWriteAt: 3 });
  await assert.rejects(run(workspace, fetch), /disk full/);
  assert.deepEqual([...workspace.files.keys()], ["/workspace/package-lock.json"]);
  assert.ok(![...workspace.directories].some((path) => path.includes("node_modules")));
});

test("download, unpacked-size and entry caps refuse the install", async () => {
  const a = locked("left-pad", "1.3.0");
  const oversized = new Response("x", { headers: { "content-length": String(LIMITS.tarballBytes + 1) } });
  const first = setup({ "node_modules/left-pad": a });
  await assert.rejects(run(first.workspace, fakeFetch({ [a.entry.resolved]: oversized })), /larger than/);
  const saved = { ...LIMITS };
  try {
    LIMITS.totalUnpackedBytes = 4;
    const second = setup({ "node_modules/left-pad": a });
    await assert.rejects(run(second.workspace, second.fetch), /total size or entry cap/);
    LIMITS.totalUnpackedBytes = saved.totalUnpackedBytes;
    LIMITS.totalEntries = 2;
    const third = setup({ "node_modules/left-pad": a });
    await assert.rejects(run(third.workspace, third.fetch), /total size or entry cap|too many entries/);
  } finally {
    Object.assign(LIMITS, saved);
  }
});

test("registry failures are errors, the lockfile and paths stay inside the workspace, and the source never executes anything", async () => {
  const a = locked("left-pad", "1.3.0");
  const { workspace } = setup({ "node_modules/left-pad": a });
  await assert.rejects(run(workspace, fakeFetch({ [a.entry.resolved]: { status: 503, body: "" } })), /HTTP 503/);
  for (const input of [{ lockfile: "../lock.json" }, { lockfile: "/etc/passwd" }, { dir: "a/../../b" }, { dir: "a\\b" }])
    await assert.rejects(run(workspace, fakeFetch({}), input), /workspace/);
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../src/lib/", import.meta.url);
  for (const file of readdirSync(dir))
    assert.doesNotMatch(readFileSync(new URL(file, dir), "utf8"), /child_process|execFile|spawn\(|eval\(|new Function/, file);
});

test("an answer that was redirected, or came from another URL, is refused even if fetch ignored redirect:error", async () => {
  const a = locked("left-pad", "1.3.0");
  const { workspace } = setup({ "node_modules/left-pad": a });
  const redirected = () => Object.defineProperty(new Response(a.archive), "redirected", { value: true });
  await assert.rejects(run(workspace, fakeFetch({ [a.entry.resolved]: redirected })), /was redirected/);
  const elsewhere = () => Object.defineProperty(new Response(a.archive), "url", { value: "https://evil.test/left-pad.tgz" });
  await assert.rejects(run(workspace, fakeFetch({ [a.entry.resolved]: elsewhere })), /different URL/);
});

test("node_modules is claimed atomically: if it appears after the early check, nothing is written", async () => {
  const a = locked("left-pad", "1.3.0");
  const { workspace: seeded, fetch } = setup({ "node_modules/left-pad": a });
  const workspace = fakeWorkspace(Object.fromEntries(seeded.files));
  workspace.directories.add("/workspace/node_modules"); // appears "meanwhile": only mkdir can notice
  const real = workspace.fs.promises.lstat;
  let first = true;
  workspace.fs.promises.lstat = async (path) => {
    if (path === "/workspace/node_modules" && first) {
      first = false; // the early existence check sees nothing
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return real(path);
  };
  await assert.rejects(run(workspace, fetch), /appeared while installing/);
  assert.deepEqual([...workspace.files.keys()], ["/workspace/package-lock.json"]);
});

test("one package cannot overwrite a file another locked package owns", async () => {
  const inner = locked("b", "1.0.0", { "index.js": "verified b" });
  const outer = locked("a", "1.0.0", {}, {});
  const hostile = packageTarball({ "package.json": "{}", "node_modules/b/package.json": "hostile", "node_modules/b/index.js": "hostile" });
  const poisoned = { archive: hostile, entry: { ...outer.entry, integrity: sri(hostile) } };
  const { workspace, fetch } = setup({ "node_modules/a": poisoned, "node_modules/a/node_modules/b": inner });
  await assert.rejects(run(workspace, fetch), /duplicate or colliding/);
  assert.deepEqual([...workspace.files.keys()], ["/workspace/package-lock.json"]);
});

test("unpacking is serialized within the remaining budget, so the total cap holds before memory is spent", async () => {
  const sizes = [3000, 3000, 3000];
  const items = Object.fromEntries(sizes.map((size, index) => [`node_modules/p${index}`, locked(`p${index}`, "1.0.0", { "big.bin": "x".repeat(size) })]));
  const saved = { ...LIMITS };
  try {
    LIMITS.totalUnpackedBytes = 3 * 4096 + 2048; // room for two archives, not three
    const { workspace, fetch } = setup(items);
    await assert.rejects(run(workspace, fetch), /total size or entry cap/);
    const optional = Object.fromEntries(sizes.map((size, index) => [`node_modules/q${index}`, locked(`q${index}`, "1.0.0", { "big.bin": "x".repeat(size) }, { optional: true })]));
    const second = setup(optional);
    await assert.rejects(run(second.workspace, second.fetch), /total size or entry cap/, "the total cap is fatal even for optional packages");
  } finally {
    Object.assign(LIMITS, saved);
  }
});

test("a lockfile over its cap is refused by size before it is read, and a symlinked destination is refused", async () => {
  const a = locked("left-pad", "1.3.0");
  const { workspace, fetch } = setup({ "node_modules/left-pad": a });
  let read = false;
  const readFile = workspace.fs.promises.readFile;
  workspace.fs.promises.readFile = async (...args) => ((read = true), readFile(...args));
  const saved = LIMITS.lockfileBytes;
  LIMITS.lockfileBytes = 10;
  try {
    await assert.rejects(run(workspace, fetch), /larger than 10 bytes/);
    assert.equal(read, false, "the oversized lockfile was never read");
  } finally {
    LIMITS.lockfileBytes = saved;
  }
  const linked = fakeWorkspace({ "/workspace/package-lock.json": lockfile({ "node_modules/left-pad": a.entry }) }, { symlinks: ["/workspace/sub"] });
  linked.directories.add("/workspace/sub");
  linked.files.set("/workspace/sub/package-lock.json", linked.files.get("/workspace/package-lock.json"));
  await assert.rejects(run(linked, fetch, { dir: "sub" }), /symbolic link/);
});

test("a response that cannot be streamed is refused rather than read whole", async () => {
  const a = locked("left-pad", "1.3.0");
  const { workspace } = setup({ "node_modules/left-pad": a });
  const whole = { ok: true, status: 200, headers: new Headers(), redirected: false, url: "", arrayBuffer: async () => a.archive.buffer };
  await assert.rejects(run(workspace, async () => whole), /no readable stream/);
  const huge = () => new Response(new ReadableStream({ pull: (controller) => controller.enqueue(new Uint8Array(1024 * 1024)) }));
  const saved = LIMITS.tarballBytes;
  LIMITS.tarballBytes = 3 * 1024 * 1024;
  try {
    await assert.rejects(run(workspace, fakeFetch({ [a.entry.resolved]: huge })), /larger than/);
  } finally {
    LIMITS.tarballBytes = saved;
  }
});
