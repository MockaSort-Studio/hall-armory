import { crc32 as zlibCrc32 } from "node:zlib";
import yauzl from "yauzl";

// In-memory artifact archive inspection on top of yauzl (container parsing, bounds of each entry's data, size
// validation while inflating). Around it this module is strict: plain relative names only, no links or special files,
// no duplicates, no ZIP64, no encryption, bounded entry count and entry size, and a CRC-32 check, which yauzl leaves
// to the caller. Only the one selected entry is ever decompressed; nothing touches the filesystem.

export class ArchiveError extends Error {
  state: "malformed" | "oversized";
  constructor(state: "malformed" | "oversized", message: string) {
    super(message);
    this.name = "ArchiveError";
    this.state = state;
  }
}

export type ArchiveLimits = { maxEntries: number; maxEntryBytes: number };
export type ArchiveEntry = { path: string; directory: boolean; compressedSize: number; size: number };

const UNIX = 3, S_IFMT = 0o170000, S_IFREG = 0o100000, S_IFDIR = 0o040000, ZIP64_EXTRA = 0x0001;
const malformed = (message: string) => new ArchiveError("malformed", message);

// zlib.crc32 arrived in Node 22.2; the guest runner accepts any Node 22, so 22.0 and 22.1 use the table-free loop.
function crc32(bytes: Uint8Array) {
  if (typeof zlibCrc32 === "function") return zlibCrc32(bytes) >>> 0;
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

// Only plain relative names: no absolute paths, drive letters, backslashes, empty, `.` or `..` segments, or controls.
function checkName(entry: any) {
  const name = entry.fileName;
  if (typeof name !== "string" || !name || name.length > 1024) throw malformed("archive entry name is empty or too long");
  if (!(entry.generalPurposeBitFlag & 0x800) && /[^\u0000-\u007f]/.test(name)) throw malformed("archive entry name is neither ASCII nor flagged UTF-8");
  if (/[\u0000-\u001f\u007f-\u009f\\\ufffd\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/.test(name)) throw malformed(`archive entry name has unsafe characters: ${JSON.stringify(name)}`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw malformed(`archive entry has an absolute path: ${JSON.stringify(name)}`);
  const segments = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    throw malformed(`archive entry path escapes or is not normalized: ${JSON.stringify(name)}`);
  return name;
}

function checkEntry(entry: any): ArchiveEntry {
  const path = checkName(entry);
  if (entry.generalPurposeBitFlag & 0x41) throw malformed(`archive entry is encrypted: ${JSON.stringify(path)}`);
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw malformed(`archive entry uses unsupported compression method ${entry.compressionMethod}`);
  if ((entry.extraFields ?? []).some((field) => field.id === ZIP64_EXTRA)) throw malformed("ZIP64 archive entries are not supported");
  const directory = path.endsWith("/");
  const external = entry.externalFileAttributes >>> 0;
  if (entry.versionMadeBy >> 8 === UNIX) {
    const type = (external >>> 16) & S_IFMT;
    if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) throw malformed(`archive entry is a link or special file: ${JSON.stringify(path)}`);
    if (type === S_IFDIR && !directory) throw malformed(`archive directory entry is named like a file: ${JSON.stringify(path)}`);
    if (type === S_IFREG && directory) throw malformed(`archive file entry is named like a directory: ${JSON.stringify(path)}`);
  }
  if (external & 0x10 && !directory) throw malformed(`archive directory entry is named like a file: ${JSON.stringify(path)}`);
  if (directory && entry.uncompressedSize !== 0) throw malformed(`archive directory entry has content: ${JSON.stringify(path)}`);
  return { path, directory, compressedSize: entry.compressedSize, size: entry.uncompressedSize };
}

const toBuffer = (bytes: Uint8Array) => Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function open(bytes: Uint8Array): Promise<any> {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(toBuffer(bytes), { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, zipfile) =>
      error ? reject(malformed(`archive is not a valid ZIP file: ${error.message}`)) : resolve(zipfile)));
}

// Walks every central-directory entry (metadata only), validating each, and keeps the raw entry `wanted` if present.
async function scan(bytes: Uint8Array, limits: ArchiveLimits, wanted?: string) {
  const zipfile = await open(bytes);
  if (zipfile.entryCount > limits.maxEntries) {
    zipfile.close();
    throw new ArchiveError("oversized", `archive has ${zipfile.entryCount} entries; the limit is ${limits.maxEntries}`);
  }
  return new Promise<{ zipfile: any; entries: ArchiveEntry[]; selected?: any }>((resolve, reject) => {
    const entries: ArchiveEntry[] = [];
    const names = new Set<string>();
    let selected;
    const fail = (error) => (zipfile.close(), reject(error instanceof ArchiveError ? error : malformed(`archive is not a valid ZIP file: ${error?.message ?? error}`)));
    zipfile.on("error", fail);
    zipfile.on("entry", (raw) => {
      try {
        const entry = checkEntry(raw);
        if (names.has(entry.path)) throw malformed(`archive has a duplicate entry: ${JSON.stringify(entry.path)}`);
        names.add(entry.path);
        entries.push(entry);
        if (entry.path === wanted && !entry.directory) selected = raw;
        zipfile.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zipfile.on("end", () => resolve({ zipfile, entries, selected }));
    zipfile.readEntry();
  });
}

export async function listArchive(bytes: Uint8Array, limits: ArchiveLimits): Promise<ArchiveEntry[]> {
  const { zipfile, entries } = await scan(bytes, limits);
  zipfile.close();
  return entries;
}

// Decompresses exactly one selected file entry into memory, bounded by `maxEntryBytes`, and verifies its CRC-32.
export async function readArchiveEntry(bytes: Uint8Array, path: string, limits: ArchiveLimits): Promise<Uint8Array | undefined> {
  const { zipfile, selected } = await scan(bytes, limits, path);
  if (!selected) return (zipfile.close(), undefined);
  if (selected.uncompressedSize > limits.maxEntryBytes) {
    zipfile.close();
    throw new ArchiveError("oversized", `archive entry ${JSON.stringify(path)} is ${selected.uncompressedSize} bytes; the limit is ${limits.maxEntryBytes}`);
  }
  try {
    const content = await new Promise<Buffer>((resolve, reject) =>
      zipfile.openReadStream(selected, (error, stream) => {
        if (error) return reject(malformed(`entry ${JSON.stringify(path)} cannot be read: ${error.message}`));
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > limits.maxEntryBytes) return stream.destroy(new ArchiveError("oversized", `archive entry ${JSON.stringify(path)} exceeds ${limits.maxEntryBytes} bytes`));
          chunks.push(chunk);
        });
        stream.on("error", (streamError) => reject(streamError instanceof ArchiveError ? streamError : malformed(`entry ${JSON.stringify(path)} cannot be decompressed: ${streamError.message}`)));
        stream.on("end", () => resolve(Buffer.concat(chunks, total)));
      }));
    if (content.byteLength !== selected.uncompressedSize) throw malformed(`entry ${JSON.stringify(path)} does not decompress to its declared size`);
    if (crc32(content) !== selected.crc32 >>> 0) throw malformed(`entry ${JSON.stringify(path)} fails its CRC-32 check`);
    return content;
  } finally {
    zipfile.close();
  }
}
