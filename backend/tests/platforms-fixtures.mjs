import { deflateRawSync } from 'node:zlib';
import { crc32Update } from '../mods/vpk.mjs';

export function zip(files, { encodeName = name => Buffer.from(name), flags = 0x800 } = {}) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const n = encodeName(name), b = Buffer.from(value), data = deflateRawSync(b), crc = (crc32Update(0xffffffff, b) ^ 0xffffffff) >>> 0;
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8);
    l.writeUInt16LE(flags, 6);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(b.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(flags, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(b.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(l, n, data); central.push(c, n); offset += l.length + n.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
