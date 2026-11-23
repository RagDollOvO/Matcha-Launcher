import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { PlatformError } from '../errors.mjs';
import { parseKeyValues } from '../keyvalues.mjs';

const fail = (message) => { throw new PlatformError('invalid_vpk', message); };
export async function regular(file) {
  const s = await fs.lstat(file);
  if (!s.isFile() || s.isSymbolicLink()) throw new PlatformError('unsafe_path', `需要普通文件：${file}`);
  return s;
}
export const identity = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
async function readAt(file, offset, length) {
  const h = await fs.open(file, 'r');
  try {
    const b = Buffer.alloc(length); let done = 0;
    while (done < length) {
      const { bytesRead } = await h.read(b, done, length - done, offset + done);
      if (!bytesRead) fail('VPK 数据被截断。');
      done += bytesRead;
    }
    return b;
  } finally { await h.close(); }
}
/** Read a bounded resource descriptor, including VPK preload and split archives. */
export async function readResource(entry, limit) {
  if (entry.size > limit) throw new PlatformError('resource_too_large', '资源大小超过预览限制。');
  await regular(entry.archiveFile);
  return Buffer.concat([entry.preload, entry.length ? await readAt(entry.archiveFile, entry.dataOffset, entry.length) : Buffer.alloc(0)]);
}
function resourcePath(raw) {
  const result = raw.replaceAll('\\', '/').toLowerCase();
  if (result.startsWith('/') || result.includes(':') || result.split('/').some(x => !x || x === '.' || x === '..')) fail(`VPK 资源路径无效：${raw}`);
  return result;
}
export function textContent(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('gb18030').decode(b); }
}

/** Read only the directory tree and addoninfo. Never extract or execute content. */
export async function readVpk(file, { includeEntries = false, includeResourceSignatures = false } = {}) {
  file = path.resolve(file);
  const first = await regular(file), header = await readAt(file, 0, 12);
  if (header.readUInt32LE(0) !== 0x55aa1234) fail('文件缺少 VPK 标识。');
  const version = header.readUInt32LE(4), treeSize = header.readUInt32LE(8);
  if (![1, 2].includes(version)) fail(`暂未支持 VPK 版本 ${version}。`);
  const headerSize = version === 1 ? 12 : 28;
  if (!treeSize || treeSize > 64 * 1024 * 1024 || headerSize + treeSize > first.size) fail('VPK 目录树大小异常。');
  const extra = version === 2 ? await readAt(file, 12, 16) : null;
  const dataSize = extra ? extra.readUInt32LE(0) : first.size - headerSize - treeSize;
  if (extra && headerSize + treeSize + [0, 4, 8, 12].reduce((n, o) => n + extra.readUInt32LE(o), 0) > first.size) fail('VPK v2 区段被截断。');
  const tree = await readAt(file, headerSize, treeSize), entries = new Map(), archives = new Map();
  let cursor = 0;
  const check = n => { if (cursor + n > tree.length) fail('VPK 目录条目被截断。'); };
  function str() {
    const end = tree.indexOf(0, cursor);
    if (end < 0 || end - cursor > 4096) fail('VPK 目录字符串无效。');
    const s = tree.toString('utf8', cursor, end); cursor = end + 1; return s;
  }
  for (let ext; (ext = str()) !== '';) {
    for (let dir; (dir = str()) !== '';) {
      for (let name; (name = str()) !== '';) {
        check(18);
        const crc = tree.readUInt32LE(cursor), preloadSize = tree.readUInt16LE(cursor + 4), archive = tree.readUInt16LE(cursor + 6);
        const offset = tree.readUInt32LE(cursor + 8), length = tree.readUInt32LE(cursor + 12);
        if (tree.readUInt16LE(cursor + 16) !== 0xffff) fail('VPK 条目终止标记无效。');
        cursor += 18; check(preloadSize);
        const preload = tree.subarray(cursor, cursor + preloadSize); cursor += preloadSize;
        const originalPath = `${dir === ' ' ? '' : dir + '/'}${name}${ext === ' ' ? '' : '.' + ext}`.replaceAll('\\', '/');
        const key = resourcePath(originalPath);
        if (entries.has(key)) fail(`VPK 包含重复资源：${key}`);
        let archiveFile = file, dataOffset = headerSize + treeSize + offset;
        if (length && archive !== 0x7fff) {
          if (archive > 0x7fff || !/_dir\.vpk$/i.test(file)) fail('分卷 VPK 需要选择 *_dir.vpk 索引文件。');
          archiveFile = file.replace(/_dir\.vpk$/i, `_${String(archive).padStart(3, '0')}.vpk`); dataOffset = offset;
          archives.set(archiveFile, Math.max(archives.get(archiveFile) ?? 0, offset + length));
        } else if (length && offset + length > dataSize) fail(`VPK 内嵌数据越界：${key}`);
        entries.set(key, { path: originalPath, crc, size: preloadSize + length, preload, length, archiveFile, dataOffset });
        if (entries.size > 250000) fail('VPK 条目数超过 250,000。');
      }
    }
  }
  const files = [{ file, identity: identity(first), size: first.size }];
  let updatedMs = Math.max(first.mtimeMs, first.ctimeMs);
  for (const [archiveFile, required] of archives) {
    let s;
    try { s = await regular(archiveFile); } catch (e) { if (e.code === 'ENOENT') fail(`缺少 VPK 分卷：${path.basename(archiveFile)}`); throw e; }
    if (s.size < required) fail(`VPK 分卷被截断：${path.basename(archiveFile)}`);
    updatedMs = Math.max(updatedMs, s.mtimeMs, s.ctimeMs);
    files.push({ file: archiveFile, identity: identity(s), size: s.size });
  }
  let metadata = {}, warning = '';
  const info = entries.get('addoninfo.txt');
  if (info) {
    try {
      if (info.size > 256 * 1024) fail('addoninfo.txt 超过 256 KiB。');
      const body = Buffer.concat([info.preload, info.length ? await readAt(info.archiveFile, info.dataOffset, info.length) : Buffer.alloc(0)]);
      const parsed = parseKeyValues(textContent(body));
      const root = Object.entries(parsed).find(([k]) => k.toLowerCase() === 'addoninfo')?.[1];
      if (!root || typeof root !== 'object') fail('addoninfo.txt 缺少 AddonInfo。');
      metadata = Object.fromEntries(Object.entries(root).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.toLowerCase(), v]));
    } catch (e) { warning = `addoninfo.txt：${e.message}`; }
  } else warning = '包内未提供 addoninfo.txt，名称使用文件名。';
  if (identity(await regular(file)) !== identity(first)) throw new PlatformError('file_changed', '扫描期间 VPK 已变化，请刷新。');
  // Retain only the tiny JPEG descriptor; copy preload so it does not retain the tree.
  const image = entries.get('addonimage.jpg');
  const thumbnail = image ? { ...image, preload: Buffer.from(image.preload) } : null;
  const resources = [...entries.keys()].filter(p => !/^addoninfo\.txt$|^addonimage\.(jpg|jpeg|png|vtf|vmt)$/i.test(p));
  // The VPK directory records the full resource size (including preload) and CRC32.
  const resourceSignatures = includeResourceSignatures ? new Map(resources.map(p => {
    const { size, crc } = entries.get(p);
    return [p, size + ':' + crc];
  })) : undefined;
  return { file, version, files, resources, thumbnail, ...(includeEntries ? { entries } : {}),
    ...(resourceSignatures && { resourceSignatures }),
    soundCount: resources.filter(p => /^sound\/.+\.(wav|mp3)$/.test(p)).length,
    fileCount: entries.size, sizeMB: files.reduce((n, f) => n + f.size, 0) / 1048576,
    dirs: [...new Set(resources.map(p => p.includes('/') ? p.split('/').slice(0, -1).slice(0, 2).join('/') : '(根目录)'))].sort(),
    title: metadata.addontitle || path.basename(file, '.vpk'), hasTitle: !!metadata.addontitle, author: metadata.addonauthor || '', versionLabel: metadata.addonversion || '',
    description: metadata.addondescription || '', warning, updatedAt: new Date(updatedMs).toISOString() };
}

export async function* resourceChunks(entry, signal) {
  signal?.throwIfAborted(); await regular(entry.archiveFile);
  yield entry.preload;
  if (entry.length) {
    for await (const chunk of createReadStream(entry.archiveFile, { start: entry.dataOffset, end: entry.dataOffset + entry.length - 1, highWaterMark: 256 * 1024, signal })) yield chunk;
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let n = 0; n < 8; n++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32Update(crc, bytes) { for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return crc >>> 0; }
export async function assertVpkUnchanged(vpk) {
  for (const f of vpk.files) if (identity(await regular(f.file)) !== f.identity) throw new PlatformError('file_changed', '操作期间 VPK 已变化，请重新执行。');
}
export async function verifyVpk(vpk, signal, progress = () => {}) {
  let done = 0; const total = [...vpk.entries.values()].reduce((n, e) => n + e.size, 0);
  if (total > 32 * 1024 ** 3) throw new PlatformError('resource_too_large', '包内资源总量超过 32 GiB。');
  for (const e of vpk.entries.values()) {
    let crc = 0xffffffff, bytes = 0;
    for await (const chunk of resourceChunks(e, signal)) { crc = crc32Update(crc, chunk); bytes += chunk.length; done += chunk.length; progress({ state: 'verifying', done, total, unit: 'bytes' }); }
    if (bytes !== e.size || ((crc ^ 0xffffffff) >>> 0) !== e.crc) fail(`资源校验失败：${e.path}`);
  }
  await assertVpkUnchanged(vpk);
}
