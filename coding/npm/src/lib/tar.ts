import { gunzipSync } from "node:zlib";
import { LIMITS } from "./limits.ts";

export type ExtractedFile = { path: string; data: Uint8Array; mode: number };
export type Extracted = { files: ExtractedFile[]; directories: string[]; bytes: number };

const BLOCK = 512;
const octal = (block: Uint8Array, start: number, length: number, what: string) => {
  if (block[start] & 0x80) throw new Error(`unsupported ${what} encoding in the archive`);
  const text = Buffer.from(block.subarray(start, start + length)).toString("latin1").replace(/\0.*$/s, "").trim();
  if (!/^[0-7]*$/.test(text)) throw new Error(`malformed ${what} in the archive`);
  return text ? parseInt(text, 8) : 0;
};
const cString = (block: Uint8Array, start: number, length: number) =>
  Buffer.from(block.subarray(start, start + length)).toString("utf8").replace(/\0.*$/s, "");

function paxRecords(data: Uint8Array): Record<string, string> {
  const records: Record<string, string> = {};
  const buffer = Buffer.from(data);
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    const length = Number(buffer.subarray(offset, space).toString("latin1"));
    if (space < 0 || !Number.isInteger(length) || length <= space - offset + 1 || offset + length > buffer.length)
      throw new Error("malformed pax header in the archive");
    const record = buffer.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return records;
}

// An archive entry's path with its first segment removed (npm's `package/`), or undefined for the root itself.
// Absolute paths, `..`, backslashes and control characters are refused.
export function entryPath(name: string): string | undefined {
  if (!name || name.length > LIMITS.pathBytes || /[\0-\x1f\x7f\\]/.test(name) || name.startsWith("/"))
    throw new Error("an archive entry has an unsafe path");
  const parts = name.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) throw new Error("an archive entry has an unsafe path");
  parts.shift();
  return parts.length ? parts.join("/") : undefined;
}

// Reads one gzip'd tar into memory. Only regular files and directories are accepted: a link, device or any other
// entry refuses the whole archive. Sizes are bounded before anything is allocated beyond the cap.
export function extractTarball(compressed: Uint8Array): Extracted {
  let tar: Buffer;
  try {
    tar = gunzipSync(compressed, { maxOutputLength: LIMITS.packageUnpackedBytes });
  } catch (error: any) {
    throw new Error(error?.code === "ERR_BUFFER_TOO_LARGE" ? "the archive unpacks beyond its size cap" : "the archive is not valid gzip");
  }
  const files: ExtractedFile[] = [];
  const directories: string[] = [];
  const seen = new Map<string, "file" | "directory">();
  let bytes = 0;
  let offset = 0;
  let pax: Record<string, string> = {};
  let longName: string | undefined;

  const claim = (path: string, kind: "file" | "directory") => {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join("/").toLowerCase();
      if (seen.get(parent) === "file") throw new Error("an archive entry collides with a file");
      seen.set(parent, "directory");
    }
    const key = path.toLowerCase();
    const previous = seen.get(key);
    if (previous && (kind === "file" || previous === "file")) throw new Error("an archive has duplicate or colliding entries");
    seen.set(key, kind);
  };

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (header.every((byte) => byte === 0)) break;
    let sum = 0;
    for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : header[index];
    if (sum !== octal(header, 148, 8, "checksum")) throw new Error("the archive has a corrupt header");
    const type = String.fromCharCode(header[156] || 0x30);
    let size = octal(header, 124, 12, "size");
    if (pax.size !== undefined) size = Number(pax.size);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > tar.length) throw new Error("the archive is truncated");
    const data = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      pax = { ...pax, ...paxRecords(data) };
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      longName = cString(data, 0, data.length);
      continue;
    }
    if (type === "K") continue;
    if (type !== "0" && type !== "5") throw new Error(`the archive has an unsupported entry type (${type})`);
    const prefix = cString(header, 345, 155);
    const base = cString(header, 0, 100);
    const name = pax.path ?? longName ?? (prefix && Buffer.from(header.subarray(257, 262)).toString() === "ustar" ? `${prefix}/${base}` : base);
    pax = {};
    longName = undefined;
    const path = entryPath(name);
    if (type === "5") {
      if (path) {
        claim(path, "directory");
        directories.push(path);
      }
      continue;
    }
    if (!path) throw new Error("an archive entry has an unsafe path");
    claim(path, "file");
    bytes += size;
    files.push({ path, data: Buffer.from(data), mode: octal(header, 100, 8, "mode") & 0o111 ? 0o755 : 0o644 });
    if (files.length + directories.length > LIMITS.totalEntries) throw new Error("the archive has too many entries");
  }
  return { files, directories, bytes };
}
