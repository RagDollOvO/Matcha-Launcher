import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export const sameSession = (a, b) => !!a && !!b && (process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

export async function sessionPath(sessionDir, file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('SESSION_SCOPE', '会话需要使用绝对路径。');
  const root = path.resolve(sessionDir), full = path.resolve(file), relative = path.relative(root, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(full) !== '.jsonl') fail('SESSION_SCOPE', '请选择会话目录内的 JSONL 文件。');
  // Reject junctions/symlinks at every component, including the selected file.
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) fail('SESSION_SCOPE', '会话路径包含链接，请选择原始会话文件。');
  }
  const realRoot = await fs.realpath(root), realFile = await fs.realpath(full);
  const tail = path.relative(realRoot, realFile);
  if (!tail || tail.startsWith('..') || path.isAbsolute(tail) || !(await fs.stat(full)).isFile()) fail('SESSION_SCOPE', '请选择会话目录内的文件。');
  return full;
}

async function describe(file, current) {
  const stat = await fs.stat(file);
  let header, name, firstMessage, messageCount = 0;
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      // Count entries without decoding images/tool payloads. Only metadata and the
      // first user message are parsed; memory usage stays independent of file size.
      if (!header) {
        try { header = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { return null; }
        if (header?.type !== 'session' || typeof header.id !== 'string') return null;
      } else if (/^\s*\{\s*"type"\s*:\s*"session_info"/.test(line)) {
        try { name = JSON.parse(line).name?.trim() || undefined; } catch { /* partial final write */ }
      } else if (/^\s*\{\s*"type"\s*:\s*"message"/.test(line)) {
        // Incomplete trailing writes are ignored until the next listing.
        if (!line.trimEnd().endsWith('}')) continue;
        messageCount++;
        if (firstMessage === undefined && /"message"\s*:\s*\{\s*"role"\s*:\s*"user"/.test(line)) {
          try {
            const content = JSON.parse(line).message.content;
            const text = typeof content === 'string' ? content : (content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
            firstMessage = Array.from(text).slice(0, 80).join('');
          } catch { /* partial final write */ }
        }
      }
    }
  } finally { lines.close(); lines.input.destroy(); }
  if (!header) return null;
  const date = new Date(header.timestamp);
  return { path: file, id: header.id, name, firstMessage, messageCount,
    createdAt: Number.isNaN(date.getTime()) ? stat.birthtime.toISOString() : date.toISOString(),
    updatedAt: stat.mtime.toISOString(), current: sameSession(file, current) };
}

export async function listSessions(sessionDir, current) {
  const sessions = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === '.trash') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const info = await describe(await sessionPath(sessionDir, file), current);
          if (info) sessions.push(info);
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }
  }
  await walk(sessionDir);
  return { sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}

export async function trashSession(sessionDir, file, current) {
  const full = await sessionPath(sessionDir, file);
  if (sameSession(full, current)) fail('session_current', '请先切换会话，再删除此会话。');
  const trash = path.join(sessionDir, '.trash');
  await fs.mkdir(trash, { recursive: true });
  if ((await fs.lstat(trash)).isSymbolicLink()) fail('SESSION_SCOPE', '会话回收目录需要使用原始目录。');
  await fs.rename(full, path.join(trash, `${Date.now()}-${randomUUID()}-${path.basename(full)}`));
  return { status: 'deleted' };
}
