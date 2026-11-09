import { crc32, deflateRawSync } from "node:zlib";

// Builds ZIP archives byte by byte so tests can produce both valid archives and precisely malformed ones.
// entry: { name, data, method (0|8), flags, madeBy, external, crc, size, compressed, extra }
// options: { disk, comment, truncate }
export function zip(entries, options = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data ?? "");
    const method = entry.method ?? 8;
    const body = entry.compressed ?? (method === 8 ? deflateRawSync(data) : data);
    const crc = entry.crc ?? crc32(data);
    const size = entry.size ?? data.length;
    const flags = entry.flags ?? 0x800;
    const extra = entry.extra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size >>> 0, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.madeBy ?? ((3 << 8) | 20), 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size >>> 0, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE((entry.external ?? (name.at(-1) === 0x2f ? 0o040755 : 0o100644) * 0x10000) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, extra, body);
    centrals.push(central, name, extra);
    offset += local.length + name.length + extra.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment ?? "");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.disk ?? 0, 4);
  end.writeUInt16LE(options.disk ?? 0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  const archive = Buffer.concat([...locals, directory, end, comment]);
  return options.truncate ? archive.subarray(0, options.truncate) : archive;
}

// The ZIP64 extended-information extra field (id 0x0001) with 8-byte sizes.
export function zip64Extra(size) {
  const field = Buffer.alloc(4 + 16);
  field.writeUInt16LE(0x0001, 0);
  field.writeUInt16LE(16, 2);
  field.writeBigUInt64LE(BigInt(size), 4);
  field.writeBigUInt64LE(BigInt(size), 12);
  return field;
}
