import fs from 'node:fs/promises';
import path from 'node:path';
import { PlatformError } from './errors.mjs';

const fail = (code, message, details) => { throw new PlatformError(code, message, details); };

export async function regularFile(file) {
  const stat = await fs.lstat(file).catch((e) => { if (e.code === 'ENOENT') fail('file_missing', 'Required file is missing', { file }); throw e; });
  if (!stat.isFile() || stat.isSymbolicLink()) fail('unsafe_path', 'Expected a regular file', { file });
  return stat;
}

/** Read PE metadata only. This never maps or executes the DLL. */
export async function inspectPe(file) {
  await regularFile(file); const b = await fs.readFile(file);
  const check = (offset, bytes) => { if (!Number.isSafeInteger(offset) || offset < 0 || bytes < 0 || offset + bytes > b.length) fail('invalid_pe', 'PE data is truncated or malformed', { file, offset }); };
  const u16 = (o) => { check(o, 2); return b.readUInt16LE(o); };
  const u32 = (o) => { check(o, 4); return b.readUInt32LE(o); };
  check(0, 64); if (u16(0) !== 0x5a4d) fail('invalid_pe', 'Expected an MZ executable', { file });
  const pe = u32(0x3c); check(pe, 24);
  if (u32(pe) !== 0x4550) fail('invalid_pe', 'Expected a PE executable', { file });
  const machine = u16(pe + 4), sections = u16(pe + 6), optSize = u16(pe + 20), opt = pe + 24;
  check(opt, optSize); const magic = u16(opt);
  if (![0x10b, 0x20b].includes(magic)) fail('invalid_pe', 'Unsupported PE optional header', { file });
  const architecture = machine === 0x14c ? 'x86' : machine === 0x8664 ? 'x64' : `machine-${machine.toString(16)}`;
  const countOffset = magic === 0x10b ? 92 : 108, dataOffset = magic === 0x10b ? 96 : 112;
  if (optSize < dataOffset) fail('invalid_pe', 'PE optional header is incomplete', { file });
  const sectionStart = opt + optSize; check(sectionStart, sections * 40);
  const maps = [];
  for (let i = 0; i < sections; i++) {
    const s = sectionStart + i * 40;
    maps.push({ va: u32(s + 12), size: Math.max(u32(s + 8), u32(s + 16)), raw: u32(s + 20), rawSize: u32(s + 16) });
  }
  const rvaOffset = (rva, length = 1) => {
    const entry = maps.find((s) => rva >= s.va && rva - s.va + length <= s.rawSize);
    if (entry) { const result = entry.raw + rva - entry.va; check(result, length); return result; }
    const headerSize = u32(opt + 60);
    if (rva < headerSize && rva + length <= headerSize) { check(rva, length); return rva; }
    fail('invalid_pe', 'PE RVA is outside file-backed data', { file, rva });
  };
  const exports = [];
  if (u32(opt + countOffset) > 0) {
    if (optSize < dataOffset + 8) fail('invalid_pe', 'PE export directory is missing', { file });
    const rva = u32(opt + dataOffset), size = u32(opt + dataOffset + 4);
    if (rva && size) {
      const exp = rvaOffset(rva, 40), count = u32(exp + 24);
      if (count > 65536) fail('invalid_pe', 'PE export table is too large', { file });
      const names = count ? rvaOffset(u32(exp + 32), count * 4) : 0;
      for (let i = 0; i < count; i++) {
        const name = rvaOffset(u32(names + i * 4));
        const end = b.indexOf(0, name);
        if (end < name || end - name > 1024) fail('invalid_pe', 'PE export name is invalid', { file });
        exports.push(b.toString('ascii', name, end));
      }
    }
  }
  return { file: path.resolve(file), architecture, dll: !!(u16(pe + 22) & 0x2000), exports: exports.sort() };
}
