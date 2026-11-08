import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ArchiveError, listArchive, readArchiveEntry } from "../src/lib/workflows/artifact-zip.ts";
import { zip, zip64Extra } from "./helpers/zip.mjs";

const limits = { maxEntries: 10, maxEntryBytes: 1024 * 1024 };
const text = (bytes) => Buffer.from(bytes).toString("utf8");

async function rejects(archive, state, pattern, path = "a.txt", bounds = limits) {
  await assert.rejects(readArchiveEntry(archive, path, bounds), (error) => {
    assert.ok(error instanceof ArchiveError, `expected an ArchiveError, got ${error}`);
    assert.equal(error.state, state);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("a valid archive lists its entries and reads one stored or deflated file", async () => {
  const archive = zip([
    { name: "logs/", data: "" },
    { name: "logs/a.txt", data: "first\nsecond" },
    { name: "b.txt", data: "stored", method: 0 },
  ]);
  assert.deepEqual((await listArchive(archive, limits)).map((e) => [e.path, e.directory, e.size]), [["logs/", true, 0], ["logs/a.txt", false, 12], ["b.txt", false, 6]]);
  assert.equal(text(await readArchiveEntry(archive, "logs/a.txt", limits)), "first\nsecond");
  assert.equal(text(await readArchiveEntry(archive, "b.txt", limits)), "stored");
  assert.equal(await readArchiveEntry(archive, "missing.txt", limits), undefined);
  assert.equal(await readArchiveEntry(archive, "logs/", limits), undefined, "a directory is not a readable file");
});

test("only the selected entry is decompressed", async () => {
  // The other entry's data is not a valid deflate stream: reading it would fail, so success proves it was skipped.
  const archive = zip([
    { name: "broken.bin", data: "x".repeat(100), compressed: Buffer.alloc(64, 0xff) },
    { name: "a.txt", data: "ok" },
  ]);
  assert.equal(text(await readArchiveEntry(archive, "a.txt", limits)), "ok");
  await rejects(archive, "malformed", /broken\.bin/, "broken.bin");
});

test("links and special files are rejected by their external attributes", async () => {
  await rejects(zip([{ name: "a.txt", data: "/etc/passwd", external: 0o120777 * 0x10000 }]), "malformed", /link or special/);
  await rejects(zip([{ name: "a.txt", data: "", external: 0o010644 * 0x10000 }]), "malformed", /link or special/);
  await rejects(zip([{ name: "a.txt", data: "", external: 0o020644 * 0x10000 }]), "malformed", /link or special/);
  await rejects(zip([{ name: "a.txt", data: "", external: 0o040755 * 0x10000 }]), "malformed", /directory entry is named like a file/);
  await rejects(zip([{ name: "a.txt", data: "", madeBy: 20, external: 0x10 }]), "malformed", /directory entry is named like a file/);
});

test("ZIP64, encrypted and multi-disk archives are rejected", async () => {
  await rejects(zip([{ name: "a.txt", data: "x", extra: zip64Extra(1) }]), "malformed", /ZIP64/);
  await rejects(zip([{ name: "a.txt", data: "x", flags: 0x801 }]), "malformed");
  await rejects(zip([{ name: "a.txt", data: "x", flags: 0x841 }]), "malformed");
  await rejects(zip([{ name: "a.txt", data: "x" }], { disk: 1 }), "malformed", /not a valid ZIP/);
});

test("traversal, absolute, backslash, control, bidi/zero-width and non-UTF-8 names are rejected", async () => {
  for (const name of ["../evil.txt", "a/../../evil.txt", "/etc/passwd", "C:/evil.txt", "a\\b.txt", "a/./b.txt", "a//b.txt", "a\u0001b.txt", "a\u001b[31m.txt"]) {
    await rejects(zip([{ name, data: "x" }]), "malformed", undefined, name);
  }
  for (const name of ["a\u202etxt.exe", "a\u200b.txt", "a\u2066b.txt", "\ufeffa.txt", "a\u061cb.txt"]) {
    await rejects(zip([{ name, data: "x" }]), "malformed", /unsafe characters/, name);
  }
  await rejects(zip([{ name: Buffer.from([0x61, 0xe9, 0x2e, 0x74]), data: "x", flags: 0 }]), "malformed", /ASCII/);
  await rejects(zip([{ name: Buffer.from([0x61, 0xff, 0x2e, 0x74]), data: "x" }]), "malformed");
});

test("duplicate entries are rejected", async () => {
  await rejects(zip([{ name: "a.txt", data: "one" }, { name: "a.txt", data: "two" }]), "malformed", /duplicate/);
});

test("oversized and bomb entries are bounded before and while inflating", async () => {
  const big = "0".repeat(2 * 1024 * 1024);
  await rejects(zip([{ name: "a.txt", data: big }]), "oversized", /limit/);
  // A small declared size cannot smuggle a large inflated payload.
  await rejects(zip([{ name: "a.txt", data: big, size: 16 }]), "malformed");
  await assert.rejects(listArchive(zip(Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, data: "x" }))), limits), (error) => error.state === "oversized");
});

test("wrong CRC, wrong sizes and truncated archives are malformed", async () => {
  await rejects(zip([{ name: "a.txt", data: "hello", crc: 1 }]), "malformed", /CRC-32/);
  await rejects(zip([{ name: "a.txt", data: "hello", size: 9 }]), "malformed");
  await rejects(zip([{ name: "a.txt", data: "hello", method: 0, size: 3 }]), "malformed");
  const whole = zip([{ name: "a.txt", data: "hello" }]);
  await rejects(zip([{ name: "a.txt", data: "hello" }], { truncate: whole.length - 10 }), "malformed", /not a valid ZIP/);
  await rejects(Buffer.from("not a zip file at all, just text"), "malformed", /not a valid ZIP/);
});
