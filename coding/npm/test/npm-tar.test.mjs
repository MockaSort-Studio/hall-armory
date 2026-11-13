import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { LIMITS } from "../src/lib/limits.ts";
import { extractTarball } from "../src/lib/tar.ts";
import { packageTarball, paxEntry, tarEntry, tarball } from "./helpers.mjs";

const refused = (entries, pattern, options) => assert.throws(() => extractTarball(tarball(entries, options)), pattern);
const dir = tarEntry("package/", "", { type: "5", mode: 0o755 });

test("regular files and directories are extracted with the first path segment stripped and modes normalized", () => {
  const result = extractTarball(
    tarball([
      dir,
      tarEntry("package/lib/", "", { type: "5" }),
      tarEntry("package/lib/a.js", "a", { mode: 0o755 }),
      tarEntry("package/b.txt", "b", { mode: 0o600 }),
    ]),
  );
  assert.deepEqual(
    result.files.map((file) => [file.path, file.data.toString(), file.mode]),
    [["lib/a.js", "a", 0o755], ["b.txt", "b", 0o644]],
  );
  assert.deepEqual(result.directories, ["lib"]);
});

test("pax and GNU long paths and the ustar prefix are honored", () => {
  const long = `${"d".repeat(120)}/file.js`;
  const result = extractTarball(
    tarball([
      paxEntry({ path: `package/${long}` }),
      tarEntry("PaxPlaceholder", "p"),
      tarEntry("L", `package/gnu/${long}\0`, { type: "L" }),
      tarEntry("ignored", "g"),
      tarEntry("name.js", "u", { prefix: "package/pre" }),
    ]),
  );
  assert.deepEqual(result.files.map((file) => file.path), [long, `gnu/${long}`, "pre/name.js"]);
});

test("links, devices and any other entry type refuse the archive", () => {
  for (const [type, label] of [["2", "symlink"], ["1", "hardlink"], ["3", "char device"], ["4", "block device"], ["6", "fifo"], ["7", "contiguous"]])
    refused([dir, tarEntry("package/x", "", { type, linkname: "/etc/passwd" })], /unsupported entry type/, label);
});

test("unsafe paths refuse the archive", () => {
  for (const name of ["/etc/passwd", "package/../../escape", "package/a/../../../x", "package\\evil", "../x"])
    refused([tarEntry(name, "x")], /unsafe path/, name);
  refused([tarEntry("package/a\u0001b", "x")], /unsafe path/);
  refused([tarEntry("package", "x")], /unsafe path/, "a file that is the root itself");
});

test("duplicate, case-colliding and file/directory colliding entries refuse the archive", () => {
  refused([tarEntry("package/a.js", "1"), tarEntry("package/a.js", "2")], /duplicate or colliding/);
  refused([tarEntry("package/A.js", "1"), tarEntry("package/a.js", "2")], /duplicate or colliding/);
  refused([tarEntry("package/a", "1"), tarEntry("package/a/b", "2")], /collides with a file/);
  refused([tarEntry("package/a/b", "2"), tarEntry("package/a", "1")], /duplicate or colliding/);
});

test("corrupt, truncated and non-gzip archives refuse", () => {
  const good = tarball([tarEntry("package/a.js", "abc")]);
  assert.throws(() => extractTarball(Buffer.from("not gzip")), /not valid gzip/);
  const header = tarEntry("package/a.js", "abc").subarray(0, 512);
  header[0] ^= 0xff; // breaks the checksum
  assert.throws(() => extractTarball(gzipSync(Buffer.concat([header, Buffer.alloc(1536)]))), /corrupt header/);
  const cut = Buffer.concat([tarEntry("package/a.js", "x".repeat(2000)).subarray(0, 700)]);
  assert.throws(() => extractTarball(gzipSync(cut)), /truncated/);
  assert.ok(extractTarball(good).files.length === 1);
});

test("a gzip bomb and an entry flood are refused by their caps", () => {
  const bomb = gzipSync(Buffer.alloc(LIMITS.packageUnpackedBytes + 1024 * 1024));
  assert.ok(bomb.length < 1024 * 1024, "the bomb is small on the wire");
  assert.throws(() => extractTarball(bomb), /unpacks beyond its size cap/);
  const flood = tarball(Array.from({ length: LIMITS.totalEntries + 1 }, (_, index) => tarEntry(`package/f${index}`, "")));
  assert.throws(() => extractTarball(flood), /too many entries/);
});

test("the package fixture helper makes a well-formed archive", () => {
  assert.deepEqual(extractTarball(packageTarball({ "package.json": "{}" })).files.map((file) => file.path), ["package.json"]);
});
