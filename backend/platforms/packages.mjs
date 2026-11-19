import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { regular, identity, crc32Update } from '../mods/vpk.mjs';
import { fail, relativePath } from './files.mjs';

// Bounded ZIP metadata reader: no extraction, executable loading or script execution.
export async function withZip(file, consume, { legacyEncoding = 'utf-8' } = {}) {
  const decodeName = (bytes, flags) => {
    try { return new TextDecoder(flags & 0x800 ? 'utf-8' : legacyEncoding, { fatal: true }).decode(bytes).replaceAll('\\', '/'); }
    catch { fail('invalid_platform_package', 'ZIP 文件名编码与适配描述有差异。'); }
  };
  const before = await regular(file);
  const h = await fs.open(file, 'r');
  try {
    async function at(offset, length) {
      if (offset < 0 || offset + length > before.size) fail('invalid_platform_package', 'ZIP 元数据越界。');
      const b = Buffer.alloc(length); let done = 0;
      while (done < length) {
        const { bytesRead } = await h.read(b, done, length - done, offset + done);
        if (!bytesRead) fail('invalid_platform_package', 'ZIP 元数据被截断。');
        done += bytesRead;
      }
      return b;
    }
    const tail = await at(Math.max(0, before.size - 65557), Math.min(before.size, 65557));
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    if (end < 0) fail('invalid_platform_package', 'ZIP 缺少目录尾记录。');
    const count = tail.readUInt16LE(end + 10), size = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || count > 4096 || size > 2 * 1024 * 1024 || offset + size > before.size - tail.length + end) fail('invalid_platform_package', 'ZIP 目录超出平台包范围。');
    const central = await at(offset, size), entries = new Map();
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) fail('invalid_platform_package', 'ZIP 目录条目无效。');
      const n = central.readUInt16LE(cursor + 28), x = central.readUInt16LE(cursor + 30), c = central.readUInt16LE(cursor + 32);
      if (cursor + 46 + n + x + c > central.length) fail('invalid_platform_package', 'ZIP 目录条目被截断。');
      const raw = decodeName(central.subarray(cursor + 46, cursor + 46 + n), central.readUInt16LE(cursor + 8));
      const name = relativePath(raw.endsWith('/') ? raw.slice(0, -1) : raw).toLowerCase() + (raw.endsWith('/') ? '/' : '');
      if ((central.readUInt32LE(cursor + 38) >>> 16 & 0xf000) === 0xa000) fail('invalid_platform_package', 'ZIP 符号链接需要移除。');
      if (entries.has(name)) fail('invalid_platform_package', 'ZIP 包含重复路径。');
      entries.set(name, { name, flags: central.readUInt16LE(cursor + 8), method: central.readUInt16LE(cursor + 10), crc: central.readUInt32LE(cursor + 16), compressed: central.readUInt32LE(cursor + 20), size: central.readUInt32LE(cursor + 24), offset: central.readUInt32LE(cursor + 42) });
      cursor += 46 + n + x + c;
    }
    if (cursor !== central.length) fail('invalid_platform_package', 'ZIP 目录长度无效。');
    async function read(name, limit = 65536) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.flags & 1 || ![0, 8].includes(e.method) || e.size > limit || e.compressed > limit * 2) fail('invalid_platform_package', 'ZIP 平台标记格式或大小无效。');
      const local = await at(e.offset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== e.flags || local.readUInt16LE(8) !== e.method) fail('invalid_platform_package', 'ZIP 本地头与目录不一致。');
      const n = local.readUInt16LE(26), x = local.readUInt16LE(28);
      const localName = decodeName(await at(e.offset + 30, n), e.flags).toLowerCase();
      if (localName !== name || e.offset + 30 + n + x + e.compressed > offset) fail('invalid_platform_package', 'ZIP 标记路径或数据范围无效。');
      const compressed = await at(e.offset + 30 + n + x, e.compressed);
      const bytes = e.method === 8 ? inflateRawSync(compressed, { maxOutputLength: Math.max(1, limit) }) : compressed;
      if (bytes.length !== e.size || ((crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0) !== e.crc) fail('invalid_platform_package', 'ZIP 标记校验失败。');
      return bytes;
    }
    const result = await consume({ entries, read });
    if (identity(await regular(file)) !== identity(before)) fail('file_changed', 'ZIP 在读取期间发生变化。');
    return result;
  } finally { await h.close(); }
}

async function zipMetadata(file) {
  return withZip(file, async ({ entries, read }) => {
    const markers = [...entries.keys()].filter(n => /(^|\/)skeeto_workshop\.txt$/.test(n) && !n.split('/').some(p => p === '..' || p === '.'));
    if (markers.length !== 1) return null;
    const marker = (await read(markers[0])).toString('utf8').replace(/^\uFEFF/, '');
    if (!/^SkeetoWorkshopPackage=1\r?$/m.test(marker)) return null;
    const prefix = markers[0].slice(0, -'skeeto_workshop.txt'.length), version = (await read(prefix + 'version.txt'))?.toString('utf8');
    return { version: version?.match(/^semver=(\d+\.\d+\.\d+)\r?$/m)?.[1], fileCount: entries.size };
  }, { legacyEncoding: 'gb18030' });
}

export async function detectPlatformPackage(file, { workshopId } = {}) {
  const known = workshopId === '3787239937' || path.basename(file).toLowerCase() === '3787239937.vpk';
  const stat = await regular(file), h = await fs.open(file, 'r');
  let zip;
  try { const b = Buffer.alloc(4); await h.read(b, 0, 4, 0); zip = b.readUInt32LE(0) === 0x04034b50; }
  finally { await h.close(); }
  if (!zip && !known) return null;
  let metadata = null, warning = '';
  try {
    if (zip) metadata = await zipMetadata(file, stat);
    if (!metadata && known) warning = '已识别 Skeeto 工坊条目；更新包标记待检查。';
  } catch (e) {
    if (!known) throw e;
    warning = `Skeeto 更新包待检查：${e.message}`;
  }
  if (!known && !metadata) return null;
  if (identity(await regular(file)) !== identity(stat)) fail('file_changed', '平台更新包在扫描时发生变化。');
  return { kind: 'platform-package', platformId: 'skeeto', title: 'Skeeto 平台更新包', version: metadata?.version ?? '',
    description: '由 Skeeto 平台更新器读取，平台页管理安装与更新。', author: 'regoists', enabled: null,
    sizeMB: stat.size / 1048576, fileCount: metadata?.fileCount ?? 0, dirs: [], soundCount: 0,
    resources: [], hasThumbnail: false, updatedAt: new Date(stat.mtimeMs).toISOString(), warning };
}
