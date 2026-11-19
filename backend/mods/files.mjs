import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PlatformError } from '../core.mjs';

export const fail = (code, message) => { throw new PlatformError(code, message); };
export const exists = p => fs.lstat(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
export const stamp = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;
export async function directory(p, create = false) {
  if (create) await fs.mkdir(p).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const s = await fs.lstat(p);
  if (!s.isDirectory() || s.isSymbolicLink()) fail('unsafe_path', `需要真实目录：${p}`);
  return p;
}
export async function writeJson(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const h = await fs.open(temp, 'wx');
    try { await h.writeFile(JSON.stringify(data, null, 2)); await h.sync(); } finally { await h.close(); }
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export function safeResourcePath(raw) {
  if (typeof raw !== 'string' || raw.length > 2000 || raw.includes('\\')) fail('unsafe_path', '资源路径无效。');
  const parts = raw.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]|[ .]$/.test(p) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p))) fail('unsafe_path', `资源路径无法安全写入 Windows：${raw}`);
  return parts;
}
export async function taskDirectory(parent, id, kind) {
  if (!/^[0-9a-f-]{36}$/.test(id) || !['extract', 'download', 'pack'].includes(kind)) fail('invalid_argument', '任务目录标识无效。');
  await directory(parent);
  const dir = path.join(parent, `.flare-${kind}-${id}`);
  if (await exists(dir)) await removeTaskDirectory(dir, id);
  await fs.mkdir(dir);
  await writeJson(path.join(dir, '.flare-task.json'), { id });
  return dir;
}
export async function removeTaskDirectory(dir, id) {
  await directory(dir);
  const marker = path.join(dir, '.flare-task.json');
  const stat = await fs.lstat(marker);
  if (!stat.isFile() || stat.isSymbolicLink() || JSON.parse(await fs.readFile(marker, 'utf8')).id !== id) fail('unsafe_path', `任务目录需要检查：${dir}`);
  async function remove(p) {
    const s = await fs.lstat(p);
    if (s.isDirectory() && !s.isSymbolicLink()) {
      for (const name of await fs.readdir(p)) await remove(path.join(p, name));
      await fs.rmdir(p);
    } else await fs.unlink(p);
  }
  // Only this uniquely named, marked task directory is owned by this operation.
  for (const name of await fs.readdir(dir)) if (name !== '.flare-task.json') await remove(path.join(dir, name));
  await fs.unlink(marker); await fs.rmdir(dir);
}
