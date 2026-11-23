import fs from 'node:fs/promises';
import path from 'node:path';
import { PlatformError } from '../errors.mjs';
import { safeResourcePath } from '../mods/files.mjs';

export const fail = (code, message) => { throw new PlatformError(code, message); };
export const relativePath = value => {
  if (typeof value !== 'string') fail('unsafe_path', '平台文件路径无效。');
  const normalized = value.replaceAll('\\', '/');
  safeResourcePath(normalized);
  return normalized;
};
// Check every component, including junctions, before any manifest-directed read.
export async function platformPath(root, relative) {
  const parts = relativePath(relative).split('/');
  let file = path.resolve(root);
  for (const [i, part] of ['', ...parts].entries()) {
    if (part) file = path.join(file, part);
    let stat;
    try { stat = await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    if (stat.isSymbolicLink() || (i < parts.length ? !stat.isDirectory() : !stat.isFile())) fail('unsafe_path', `平台路径需要普通文件和真实目录：${relative}`);
  }
  return file;
}
export async function readBytes(file, limit = 1024 * 1024) {
  const h = await fs.open(file, 'r');
  try {
    const s = await h.stat();
    if (!s.isFile() || s.size > limit) fail('platform_file_too_large', '平台文件超过读取上限。');
    const bytes = Buffer.alloc(s.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await h.read(bytes, count, bytes.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== s.size) fail('file_changed', '平台文件在读取时发生变化，请刷新。');
    return bytes.subarray(0, count);
  } finally { await h.close(); }
}
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}
export const readText = async file => decodeText(await readBytes(file));
export const skeetoCoreVersion = async file => (await readBytes(file,64*1024*1024)).toString('latin1').match(/SkeetoInstalledSemver=(\d+\.\d+\.\d+)\x00/)?.[1] ?? null;
