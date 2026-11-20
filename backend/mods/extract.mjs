import fs from 'node:fs/promises';
import path from 'node:path';
import { readVpk, resourceChunks, assertVpkUnchanged } from './vpk.mjs';
import { directory, exists, fail, safeResourcePath, taskDirectory, removeTaskDirectory } from './files.mjs';

export async function extractMod(manager, request, ctx) {
  const { gameRoot, id, target } = request;
  if (typeof target !== 'string' || !path.isAbsolute(target)) fail('desktop_required', '请指定已存在的输出父目录。');
  await directory(target);
  return manager.reading(gameRoot, async () => {
    const source = request.source ?? await manager.resolve(gameRoot, id), vpk = await readVpk(source, { includeEntries: true });
    if (request.sourceVersion && JSON.stringify(vpk.files.map(f => f.identity)) !== JSON.stringify(request.sourceVersion)) fail('file_changed', '源 Mod 在任务创建后已变化，请重新创建解包任务。');
    const entries = [...vpk.entries.values()], total = entries.reduce((n, e) => n + e.size, 0);
    if (total > 32 * 1024 ** 3) fail('resource_too_large', '解包总量超过 32 GiB。');
    for (const e of entries) safeResourcePath(e.path);
    const stage = await taskDirectory(target, ctx.taskId, 'extract'); let published = false, done = 0;
    try {
      for (const e of entries) {
        ctx.signal.throwIfAborted();
        const parts = safeResourcePath(e.path); let folder = stage;
        if (parts[0] === '.flare-task.json') fail('unsafe_path', '资源名与任务标记冲突。');
        for (const part of parts.slice(0, -1)) folder = await directory(path.join(folder, part), true);
        const file = path.join(folder, parts.at(-1)), h = await fs.open(file, 'wx'); let written = 0;
        try {
          for await (const chunk of resourceChunks(e, ctx.signal)) {
            await h.writeFile(chunk); written += chunk.length; done += chunk.length;
            ctx.progress({ done, total, unit: 'bytes' });
          }
          if (written !== e.size) fail('invalid_vpk', `资源被截断：${e.path}`);
        } finally { await h.close(); }
      }
      await assertVpkUnchanged(vpk);
      let title = (request.title ?? vpk.title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '').slice(0, 80) || 'Mod';
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) title = `Mod_${title}`;
      return await ctx.commit(async () => {
        for (let n = 1; n <= 10000; n++) {
          const dir = path.join(target, title + (n === 1 ? '' : ` (${n})`));
          if (await exists(dir)) continue;
          try { await fs.rename(stage, dir); } catch (e) { if (['EEXIST', 'ENOTEMPTY'].includes(e.code)) continue; throw e; }
          published = true; await fs.unlink(path.join(dir, '.flare-task.json'));
          return { dir, done: total, total, fileCount: entries.length };
        }
        fail('file_exists', '同名目录过多，请更换输出目录。');
      });
    } finally { if (!published) await removeTaskDirectory(stage, ctx.taskId); }
  });
}
