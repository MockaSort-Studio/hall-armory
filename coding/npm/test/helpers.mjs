import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const octal = (value, length) => value.toString(8).padStart(length - 1, "0") + "\0";

// One ustar header (+ data blocks). `type` is the typeflag character.
export function tarEntry(name, data = "", { type = "0", mode = 0o644, linkname = "", prefix = "" } = {}) {
  const body = Buffer.from(data);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(mode, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(["0", "x", "L"].includes(type) ? body.length : 0, 12), 124);
  header.write(octal(0, 12), 136);
  header.fill(0x20, 148, 156);
  header.write(type, 156);
  header.write(linkname, 157, 100);
  header.write("ustar\0", 257);
  header.write("00", 263);
  header.write(prefix, 345, 155);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(octal(sum, 7) + " ", 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, type === "0" || type === "x" || type === "L" ? body : Buffer.alloc(0), pad]);
}

export const paxEntry = (records) => {
  const text = Object.entries(records)
    .map(([key, value]) => {
      const rest = ` ${key}=${value}\n`;
      let length = rest.length + 1;
      while (String(length).length + rest.length !== length) length = String(length).length + rest.length;
      return `${length}${rest}`;
    })
    .join("");
  return tarEntry("PaxHeader", text, { type: "x" });
};

export const tarball = (entries, { end = true } = {}) =>
  gzipSync(Buffer.concat([...entries, ...(end ? [Buffer.alloc(1024)] : [])]));

export const packageTarball = (files, extra = []) =>
  tarball([
    tarEntry("package/", "", { type: "5", mode: 0o755 }),
    ...Object.entries(files).map(([name, data]) => tarEntry(`package/${name}`, data)),
    ...extra,
  ]);

export const sri = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
export const url = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;

export function lockfile(packages, lockfileVersion = 3) {
  const entries = { "": { name: "app", version: "1.0.0" } };
  for (const [key, entry] of Object.entries(packages)) entries[key] = entry;
  return JSON.stringify({ name: "app", lockfileVersion, packages: entries });
}

// A registry entry for a lockfile: the archive and the lock fields that describe it.
export const locked = (name, version, files = { "index.js": `module.exports = "${name}";` }, flags = {}) => {
  const archive = packageTarball({ "package.json": JSON.stringify({ name, version }), ...files });
  return { archive, entry: { version, resolved: url(name, version), integrity: sri(archive), ...flags } };
};

export function fakeFetch(routes) {
  const calls = [];
  const fetch = async (target, init = {}) => {
    calls.push({ url: target, init });
    const route = routes[target] ?? routes["*"];
    if (!route) return new Response("not found", { status: 404 });
    const value = typeof route === "function" ? await route(target, init) : route;
    if (value instanceof Response) return value;
    return new Response(value.body ?? value, { status: value.status ?? 200, headers: value.headers });
  };
  fetch.calls = calls;
  return fetch;
}

// A promise-style filesystem over a Map; enough of node:fs for the suite, with node's error codes.
export function fakeWorkspace(initial = {}, { failWriteAt } = {}) {
  const files = new Map(Object.entries(initial));
  const directories = new Set(["/", "/workspace"]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  let writes = 0;
  const fs = {
    promises: {
      async readFile(path) {
        if (!files.has(path)) throw missing(path);
        return files.get(path);
      },
      async writeFile(path, data, options) {
        if (failWriteAt !== undefined && ++writes === failWriteAt) throw new Error("disk full");
        files.set(path, Buffer.from(data));
        files.modes ??= new Map();
        files.modes.set(path, options?.mode);
      },
      async lstat(path) {
        if (files.has(path)) return { isFile: () => true, isDirectory: () => false };
        if (directories.has(path)) return { isFile: () => false, isDirectory: () => true };
        throw missing(path);
      },
      async mkdir(path) {
        directories.add(path);
      },
      async unlink(path) {
        if (!files.delete(path)) throw missing(path);
      },
      async rmdir(path) {
        directories.delete(path);
      },
    },
  };
  return { fs, dir: "/workspace", files, directories };
}
