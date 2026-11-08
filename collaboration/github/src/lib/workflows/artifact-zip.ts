import { crc32 as zlibCrc32, inflateRawSync } from "node:zlib";

// A fail-closed, in-memory reader for the narrow ZIP subset GitHub Actions artifacts use: one disk, no ZIP64, no
// encryption, stored or deflated entries. Decompression is Node's zlib; this module only validates the container and
// never touches the filesystem. Anything outside that subset is rejected as malformed rather than guessed at.

export class ArchiveError extends Error {
  state: "malformed" | "oversized";
  constructor(state: "malformed" | "oversized", message: string) {
    super(message);
    this.state = state;
    this.name = "ArchiveError";
  }
}

export type ArchiveLimits = { maxEntries: number; maxEntryBytes: number };
export type ArchiveEntry = { path: string; directory: boolean; compressedSize: number; size: number };
type RawEntry = ArchiveEntry & { method: number; crc: number; localOffset: number; dataStart: number };

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50, ZIP64_LOCATOR = 0x07064b50;
const UNIX = 3, S_IFMT = 0o170000, S_IFREG = 0o100000, S_IFDIR = 0o040000;
const malformed = (message: string) => new ArchiveError("malformed", message);

function crc32(bytes: Uint8Array) {
  if (typeof zlibCrc32 === "function") return zlibCrc32(bytes) >>> 0;
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function view(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > bytes.byteLength) throw malformed("archive structure points outside the archive");
  };
  return {
    u16: (offset: number) => (need(offset, 2), data.getUint16(offset, true)),
    u32: (offset: number) => (need(offset, 4), data.getUint32(offset, true)),
    slice: (offset: number, length: number) => (need(offset, length), bytes.subarray(offset, offset + length)),
  };
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const { u32, u16 } = view(bytes);
  if (bytes.byteLength < 22) throw malformed("archive is too short to be a ZIP file");
  const lowest = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let at = bytes.byteLength - 22; at >= lowest; at--) {
    if (u32(at) === EOCD && at + 22 + u16(at + 20) === bytes.byteLength) return at;
  }
  throw malformed("archive has no end-of-central-directory record");
}

// Only plain relative names: no absolute paths, drive letters, backslashes, empty, `.` or `..` segments, or controls.
function safeName(raw: Uint8Array, utf8: boolean) {
  if (!utf8 && raw.some((byte) => byte >= 0x80)) throw malformed("archive entry name is not ASCII or flagged UTF-8");
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw malformed("archive entry name is not valid UTF-8");
  }
  if (!name || name.length > 1024) throw malformed("archive entry name is empty or too long");
  if (/[\u0000-\u001f\u007f-\u009f\\]/.test(name)) throw malformed(`archive entry name has unsafe characters: ${JSON.stringify(name)}`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw malformed(`archive entry has an absolute path: ${JSON.stringify(name)}`);
  const segments = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    throw malformed(`archive entry path escapes or is not normalized: ${JSON.stringify(name)}`);
  return name;
}

function entryType(madeBy: number, external: number, name: string) {
  const directory = name.endsWith("/");
  if (madeBy >> 8 === UNIX) {
    const type = (external >>> 16) & S_IFMT;
    if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) throw malformed(`archive entry is a link or special file: ${JSON.stringify(name)}`);
    if ((type === S_IFDIR) !== directory && type !== 0) throw malformed(`archive entry type disagrees with its name: ${JSON.stringify(name)}`);
  }
  if (external & 0x10 && !directory) throw malformed(`archive directory entry is named like a file: ${JSON.stringify(name)}`);
  return directory;
}

function centralEntries(bytes: Uint8Array, limits: ArchiveLimits): RawEntry[] {
  const { u16, u32, slice } = view(bytes);
  const end = findEndOfCentralDirectory(bytes);
  if (end >= 20 && u32(end - 20) === ZIP64_LOCATOR) throw malformed("ZIP64 archives are not supported");
  const [disk, centralDisk, onDisk, total, size, offset] = [u16(end + 4), u16(end + 6), u16(end + 8), u16(end + 10), u32(end + 12), u32(end + 16)];
  if (disk !== 0 || centralDisk !== 0 || onDisk !== total) throw malformed("multi-disk archives are not supported");
  if (total === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw malformed("ZIP64 archives are not supported");
  if (total > limits.maxEntries) throw new ArchiveError("oversized", `archive has ${total} entries; the limit is ${limits.maxEntries}`);
  if (offset + size !== end) throw malformed("central directory does not end at its end record");

  const entries: RawEntry[] = [];
  const names = new Set<string>();
  let at = offset;
  for (let index = 0; index < total; index++) {
    if (u32(at) !== CENTRAL) throw malformed("central directory entry has a bad signature");
    const madeBy = u16(at + 4), flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16);
    const compressedSize = u32(at + 20), uncompressed = u32(at + 24);
    const nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32);
    const startDisk = u16(at + 34), external = u32(at + 38), localOffset = u32(at + 42);
    if (flags & 0x41) throw malformed("encrypted archive entries are not supported");
    if (method !== 0 && method !== 8) throw malformed(`archive entry uses unsupported compression method ${method}`);
    if (startDisk !== 0 || compressedSize === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff)
      throw malformed("ZIP64 or multi-disk archive entries are not supported");
    const path = safeName(slice(at + 46, nameLength), (flags & 0x800) !== 0);
    if (names.has(path)) throw malformed(`archive has a duplicate entry: ${JSON.stringify(path)}`);
    names.add(path);
    const directory = entryType(madeBy, external, path);
    if (directory && uncompressed !== 0) throw malformed(`archive directory entry has content: ${JSON.stringify(path)}`);

    if (u32(localOffset) !== LOCAL) throw malformed(`local header of ${JSON.stringify(path)} has a bad signature`);
    const localFlags = u16(localOffset + 6), localMethod = u16(localOffset + 8);
    const localNameLength = u16(localOffset + 26), localExtraLength = u16(localOffset + 28);
    if (localMethod !== method || (localFlags & 0x41) || ((localFlags ^ flags) & 0x808))
      throw malformed(`local header of ${JSON.stringify(path)} disagrees with the central directory`);
    const localName = slice(localOffset + 30, localNameLength);
    if (Buffer.compare(Buffer.from(localName), Buffer.from(slice(at + 46, nameLength))) !== 0)
      throw malformed(`local header name of ${JSON.stringify(path)} disagrees with the central directory`);
    if (!(flags & 0x8) && (u32(localOffset + 14) !== crc || u32(localOffset + 18) !== compressedSize || u32(localOffset + 22) !== uncompressed))
      throw malformed(`local header sizes of ${JSON.stringify(path)} disagree with the central directory`);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > offset) throw malformed(`data of ${JSON.stringify(path)} overlaps the central directory`);
    entries.push({ path, directory, compressedSize, size: uncompressed, method, crc, localOffset, dataStart });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== end) throw malformed("central directory size disagrees with its entries");

  // Overlapping entries are how ZIP bombs multiply data: every byte belongs to at most one entry.
  const ranges = entries.map((e) => [e.localOffset, e.dataStart + e.compressedSize]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) throw malformed("archive entries overlap");
  return entries;
}

export function listArchive(bytes: Uint8Array, limits: ArchiveLimits): ArchiveEntry[] {
  return centralEntries(bytes, limits).map(({ path, directory, compressedSize, size }) => ({ path, directory, compressedSize, size }));
}

// Decompresses exactly one selected file entry, bounded by `maxEntryBytes`, and verifies its size and CRC-32.
export function readArchiveEntry(bytes: Uint8Array, path: string, limits: ArchiveLimits): Uint8Array | undefined {
  const entry = centralEntries(bytes, limits).find((candidate) => candidate.path === path && !candidate.directory);
  if (!entry) return undefined;
  if (entry.size > limits.maxEntryBytes)
    throw new ArchiveError("oversized", `archive entry ${JSON.stringify(path)} is ${entry.size} bytes; the limit is ${limits.maxEntryBytes}`);
  const data = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let content: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) throw malformed(`stored entry ${JSON.stringify(path)} has inconsistent sizes`);
    content = data;
  } else {
    try {
      content = entry.size === 0 ? new Uint8Array() : inflateRawSync(data, { maxOutputLength: entry.size });
    } catch {
      throw malformed(`entry ${JSON.stringify(path)} does not decompress to its declared size`);
    }
  }
  if (content.byteLength !== entry.size) throw malformed(`entry ${JSON.stringify(path)} does not decompress to its declared size`);
  if (crc32(content) !== entry.crc) throw malformed(`entry ${JSON.stringify(path)} fails its CRC-32 check`);
  return content;
}
