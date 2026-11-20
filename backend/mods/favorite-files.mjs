import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, directory } from './files.mjs';
import { regular } from './vpk.mjs';

const pathKey = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);

// A dropped file is a bookmark. Never import, pack, deploy or replace a VPK here.
export async function bookmarkFiles(settings, mods, manager, { paths, collectionId }) {
  if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) fail('invalid_argument', '请选择本机 VPK 或素材文件夹的完整路径。');
  const group = collectionId && settings.favoriteCollections?.find(c => c.id === collectionId);
  if (collectionId && !group) fail('collection_missing', '目标合集已移除，请重新选择。');
  const refs = { ...settings.favoriteRefs }, meta = { ...settings.modMeta };
  const installed = new Map(mods.filter(m => m.absolutePath).map(m => [pathKey(m.absolutePath), m]));
  const external = new Map(Object.values(refs).map(m => [pathKey(m.absolutePath), m]));
  const seenPaths = new Set(), ids = [], lines = [], skipped = [];
  for (const raw of paths) {
    const file = path.resolve(raw), key = pathKey(file);
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    try {
      const known = installed.get(key);
      let entry = known;
      if (known) {
        meta[known.id] = { ...meta[known.id], favorite: true };
      } else {
        const stat = await fs.lstat(file), name = path.basename(file);
        const id = external.get(key)?.id ?? 'favorite-file:' + randomUUID();
        if (stat.isDirectory()) {
          await directory(file);
          entry = { id, title:name, file:name, author:'', referenceKind:'folder', absolutePath:file, dirs:[], updatedAt:stat.mtime.toISOString(), sizeMB:0, hasThumbnail:false };
        } else {
          await regular(file);
          if (!/\.vpk$/i.test(name) || /_\d{3}\.vpk$/i.test(name)) fail('invalid_argument', '请选择 VPK 主文件或素材文件夹。');
          const vpk = await manager.cached(file);
          entry = { id, title:vpk.title, file:name, author:vpk.author, referenceKind:'vpk', absolutePath:file, dirs:vpk.dirs, sizeMB:vpk.sizeMB, soundCount:vpk.soundCount,
            updatedAt:vpk.updatedAt, hasThumbnail:!!vpk.thumbnail || !!await manager.sidecar(file) };
        }
        refs[id] = { ...refs[id], ...entry };
      }
      ids.push(entry.id); lines.push(entry.title + '\n' + file);
    } catch(e) { skipped.push(path.basename(file) + '：' + (e.code === 'ENOENT' ? '文件已移动或删除。' : e.message)); }
  }
  if (!ids.length) fail('bookmark_failed', skipped.join('\n') || '请选择 VPK 或素材文件夹。');
  const favoriteCollections = group ? settings.favoriteCollections.map(c => c.id === group.id ? { ...c, modIds:[...new Set([...c.modIds, ...ids])] } : c) : settings.favoriteCollections;
  return { next:{ ...settings, modMeta:meta, favoriteRefs:refs, favoriteCollections }, count:ids.length, skipped, lines,
    label:'收藏到「' + (group?.name ?? '收藏夹') + '」', expected:{ group:group?.name ?? null, lines, skipped } };
}
