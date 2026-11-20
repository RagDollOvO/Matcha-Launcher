import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PlatformError } from '../core.mjs';
import { regular } from './vpk.mjs';
import { directory } from './manager.mjs';
import { displayNames, replaceDisplayNames } from './display-names.mjs';
import { gameFolder, folderName } from '../legacy-names.mjs';

const fail = (code, message) => { throw new PlatformError(code, message); };
const exists = p => fs.lstat(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
const sameRoot = (a, b) => !a || path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
// Link/unlink changes ctime, so recovery compares inode, size and mtime instead.
const stamp = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;
const validFile = s => typeof s === 'string' && /^(?:workshop\/)?[^/\\:<>"|?*\x00-\x1f]+\.(?:vpk|jpg)$/i.test(s) && !s.split('/').some(x => x === '.' || x === '..' || /[ .]$/.test(x));
// 独立库里的文件；改名前的回收记录写的是 .flare-library/…，照样认。
const managedFile = s => typeof s === 'string' && /^\.(?:matcha|flare)-library\/workshop\/[1-9][0-9]{0,19}\/(mod\.vpk|mod\.jpg|item\.json)$/.test(s);
const storedFile = s => validFile(s) || managedFile(s);
const validId = s => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);
const ids = value => {
  if (!Array.isArray(value) || !value.length || value.some(x => typeof x !== 'string' || !x)) fail('invalid_argument', '请选择至少一个条目。');
  return [...new Set(value)];
};

/** Same-volume recycle store. Each durable manifest also allows an interrupted move to be restored. */
export class ModTrash {
  constructor(manager, store) { this.manager = manager; this.store = store; }
  async base(root, create = false) {
    const content = await directory(path.join(root, 'left4dead2'));
    const base = gameFolder(content, 'trash');
    if (!create && !await exists(base)) return null;
    return directory(base, create);
  }
  async original(root, file, create = false) {
    if (!storedFile(file)) fail('unsafe_path', '回收记录里的原路径无效。');
    const content = await directory(path.join(root, 'left4dead2'));
    if (managedFile(file)) {
      const parts = file.split('/'); parts[0] = folderName(content, 'library'); let parent = content;
      for (const part of parts.slice(0, -1)) parent = await directory(path.join(parent, part), create);
      return path.join(parent, parts.at(-1));
    }
    const addons = await directory(path.join(content, 'addons'), create);
    if (file.startsWith('workshop/')) await directory(path.join(addons, 'workshop'), create);
    return path.join(addons, file);
  }
  async record(root, trashId) {
    if (!validId(trashId)) fail('invalid_argument', '回收条目 ID 无效。');
    const base = await this.base(root);
    if (!base) fail('trash_missing', '回收条目已移除。');
    const dir = await directory(path.join(base, trashId));
    const file = path.join(dir, 'record.json'); await regular(file);
    const r = JSON.parse(await fs.readFile(file, 'utf8'));
    const expectedId = managedFile(r.file) ? `library:workshop:${r.file.split('/')[2]}` : r.file?.toLowerCase();
    if (r.version !== 1 || r.trashId !== trashId || !storedFile(r.file) || r.modId !== expectedId || !['moving', 'trashed', 'restoring', 'purging'].includes(r.state) || !Array.isArray(r.files) || !r.files.length || r.files[0].file !== r.file || r.files.some(f => !storedFile(f.file) || typeof f.stamp !== 'string') || new Set(r.files.map(f => path.basename(f.file).toLowerCase())).size !== r.files.length || !Array.isArray(r.profileIds)) fail('trash_invalid', `回收记录需要检查：${file}`);
    return r;
  }
  async write(root, r) {
    const base = await this.base(root, true), dir = await directory(path.join(base, r.trashId), true);
    const temp = path.join(dir, `record-${randomUUID()}.tmp`), file = path.join(dir, 'record.json');
    try {
      const h = await fs.open(temp, 'wx');
      try { await h.writeFile(JSON.stringify(r, null, 2)); await h.sync(); } finally { await h.close(); }
      await fs.rename(temp, file);
    } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  async savedFile(root, r, file) {
    const base = await this.base(root), dir = await directory(path.join(base, r.trashId));
    return path.join(dir, path.basename(file));
  }
  async thumbnail(root, trashId) {
    const r = await this.record(root, trashId);
    if (r.state !== 'trashed') return { dataUrl: null };
    return this.manager.localThumbnail(await this.savedFile(root, r, r.file), { archived: true });
  }
  view(r) {
    const { trashId, modId, title, file, sizeBytes, deletedAt, categoryId, profileIds, workshopId, state, files } = r;
    return { trashId, modId, title, file, sizeMB: sizeBytes / 1048576, sizeBytes, deletedAt, categoryId, profileIds, workshopId, state,
      files: files.map(({ file, size }) => ({ file, size })) };
  }
  async list(root) {
    const base = await this.base(root);
    if (!base) return [];
    const result = [];
    for (const id of await fs.readdir(base)) if (validId(id)) {
      const dir = await directory(path.join(base, id));
      if (await exists(path.join(dir, 'record.json'))) result.push(this.view(await this.record(root, id)));
    }
    return result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  async prepare(root, selected) {
    selected = ids(selected);
    const { mods } = await this.manager.scan(root), views = this.store.profileViews(mods);
    const profiles = this.store.settings.profiles.map((p, i) => sameRoot(p.modsGameRoot, root) ? views[i] : p);
    const result = [];
    for (const id of selected) {
      const mod = mods.find(m => m.id === id);
      if (!mod) fail('mod_missing', '选中的 Mod 已移除，请重新扫描。');
      const absolute = await this.original(root, mod.file), folder = path.dirname(absolute);
      // Include every matching shard, even when a damaged index cannot be parsed.
      const prefix = /_dir\.vpk$/i.test(mod.file) ? path.basename(mod.file).slice(0, -8).toLowerCase() : null;
      const names = (await fs.readdir(folder)).filter(n => prefix !== null && n.toLowerCase().startsWith(prefix + '_') && /^\d{3}\.vpk$/i.test(n.slice(prefix.length + 1)));
      const sidecar = await this.manager.sidecar(absolute);
      const paths = [absolute, ...names.map(n => path.join(folder, n)), ...(sidecar ? [sidecar.file] : []), ...(mod.storage === 'library' ? [path.join(folder, 'item.json')] : [])];
      const files = [];
      for (const source of paths) {
        const stat = await regular(source), file = path.relative(path.join(root, 'left4dead2', ...(mod.storage === 'library' ? [] : ['addons'])), source).replaceAll('\\', '/');
        if (!storedFile(file)) fail('unsafe_path', 'Mod 文件路径需要检查。');
        files.push({ file, size: stat.size, stamp: stamp(stat) });
      }
      result.push({ version: 1, trashId: randomUUID(), modId: mod.id, title: mod.title, file: mod.file,
        ...(this.store.settings.modMeta[id]?.favorite && {bookmark:{id,title:mod.title,file:mod.file,author:mod.author,dirs:mod.dirs,sizeMB:mod.sizeMB,updatedAt:mod.updatedAt,hasThumbnail:false,referenceKind:'vpk',absolutePath:absolute,library:{gameRoot:root,modId:id}}}),
        displayName: displayNames(this.store.settings, root)[id],
        sizeBytes: files.reduce((n, f) => n + f.size, 0), deletedAt: new Date().toISOString(),
        categoryId: this.store.settings.assignments[id] ?? 'cat-none',
        profileIds: profiles.filter(p => sameRoot(p.modsGameRoot, root) && p.modIds.includes(id)).map(p => p.id),
        favoriteCollectionIds: (this.store.settings.favoriteCollections ?? []).filter(c => c.modIds.includes(id)).map(c => c.id),
        meta: this.store.settings.modMeta[id], workshopId: mod.workshopId, files, state: 'moving' });
    }
    return { records: result, profiles };
  }
  async preview(root, selected) {
    const { records } = await this.prepare(root, selected);
    return { mods: records.map(r => this.view(r)), sizeBytes: records.reduce((n, r) => n + r.sizeBytes, 0) };
  }
  async removeRecord(root, r) {
    const base = await this.base(root), dir = await directory(path.join(base, r.trashId));
    // Never recursively delete: only manifest-owned files are removed.
    for (const name of await fs.readdir(dir)) {
      if (name === 'record.json') continue;
      if (!/^record-[0-9a-f-]{36}\.tmp$/.test(name)) fail('trash_recovery_required', `回收目录中还有文件，请检查：${dir}`);
      const file = path.join(dir, name); await regular(file); await fs.unlink(file);
    }
    await fs.unlink(path.join(dir, 'record.json'));
    await fs.rmdir(dir);
  }
  async delete(root, selected, confirmation, {expectedFiles,removeAddonKeys=[]}={}) {
    return this.manager.mutation(root, confirmation, async c => {
      const initial = await this.prepare(c.root, selected);
      const verify=records=>{if(expectedFiles && JSON.stringify(records.map(r=>r.files))!==JSON.stringify(expectedFiles))fail('file_changed','更新包清单已变化，请重新预览。');};
      verify(initial.records);
      for (const r of initial.records) if (managedFile(r.file)) await this.manager.library.deploy(c, r.modId, false, root => this.manager.idle(root));
      const { records, profiles } = await this.prepare(c.root, selected), created = [];
      verify(records);
      if(removeAddonKeys.length)await this.manager.writeList(c,[],removeAddonKeys);
      let committed = false;
      try {
        // Persist recovery information before any source file is unlinked.
        for (const r of records) { await this.write(c.root, r); created.push(r); }
        for (const r of records) {
          await this.manager.idle(c.root);
          for (const f of r.files) {
            const source = await this.original(c.root, f.file), target = await this.savedFile(c.root, r, f.file);
            if (stamp(await regular(source)) !== f.stamp) fail('file_changed', '删除期间 Mod 已变化，请刷新后重试。');
            await fs.link(source, target); // Exclusive, same-volume move; index disappears first.
            if (stamp(await regular(source)) !== f.stamp || stamp(await regular(target)) !== f.stamp) fail('file_changed', '移动期间 Mod 已变化，请在回收站还原。');
            await fs.unlink(source);
          }
        }
        const removed = new Set(records.map(r => r.modId)), s = this.store.settings;
        const assignments = { ...s.assignments }, modMeta = { ...s.modMeta };
        const names = { ...displayNames(s, c.root) };
        for (const id of removed) { delete assignments[id]; delete modMeta[id]; delete names[id]; }
        const favoriteRefs={...s.favoriteRefs};
        for (const r of records) if(r.bookmark) favoriteRefs[r.modId]=r.bookmark;
        await this.store.save({ ...s, assignments, modMeta, favoriteRefs, modNames: replaceDisplayNames(s, c.root, names), profiles: profiles.map(p => sameRoot(p.modsGameRoot, c.root) ? {
          ...p, modsInitialized: true, modsGameRoot: c.root, modIds: p.modIds.filter(id => !removed.has(id)),
        } : p) });
        committed = true;
        for (const r of records) { r.state = 'trashed'; await this.write(c.root, r); }
        return { trashed: records.map(r => ({ trashId: r.trashId, modId: r.modId, files: r.files.map(f => f.file) })) };
      } catch (error) {
        // A runtime failure rolls files back; a process interruption leaves manifests for restore.
        if (!committed) {
          try {
            await this.manager.idle(c.root);
            for (const r of created.toReversed()) {
              for (const f of r.files.toReversed()) {
                const source = await this.savedFile(c.root, r, f.file), target = await this.original(c.root, f.file);
                if (!await exists(source)) continue;
                if (await exists(target)) {
                  if (stamp(await regular(target)) !== stamp(await regular(source))) fail('restore_conflict', `原位置已有文件：${f.file}`);
                } else await fs.link(source, target);
                await fs.unlink(source);
              }
              await this.removeRecord(c.root, r);
            }
          } catch (recovery) { fail('trash_recovery_required', `${error.message}；请在回收站还原未完成条目：${recovery.message}`); }
        }
        throw error;
      }
    });
  }
  async restore(root, selected, confirmation) {
    selected = ids(selected);
    return this.manager.mutation(root, confirmation, async c => {
      const restored = [], conflicts = [];
      for (const trashId of selected) {
        const r = await this.record(c.root, trashId);
        if (r.state === 'purging') { conflicts.push({ trashId, reason: '此条目已开始永久删除，请继续永久删除。' }); continue; }
        // Preflight the complete set so a collision in one shard publishes no index.
        try {
          for (const f of r.files) {
            const source = await this.savedFile(c.root, r, f.file), target = await this.original(c.root, f.file, true);
            const inTrash = await exists(source), atOrigin = await exists(target);
            if (inTrash && stamp(await regular(source)) !== f.stamp) fail('file_changed', `回收文件已变化：${f.file}`);
            if (atOrigin && (r.state === 'trashed' || stamp(await regular(target)) !== f.stamp)) fail('restore_conflict', `原位置已有同名文件：${f.file}`);
            if (!inTrash && (!atOrigin || r.state === 'trashed')) fail('trash_file_missing', `回收文件缺失：${f.file}`);
          }
        } catch (e) { conflicts.push({ trashId, reason: e.message }); continue; }
        r.state = 'restoring'; await this.write(c.root, r);
        // Restored profile selections remain drafts until the user applies them.
        if (!managedFile(r.file)) await this.manager.writeList(c, [[r.file, false]]);
        await this.manager.idle(c.root);
        for (const f of [...r.files.slice(1), r.files[0]]) {
          const source = await this.savedFile(c.root, r, f.file), target = await this.original(c.root, f.file, true);
          if (await exists(source)) {
            if (stamp(await regular(source)) !== f.stamp) fail('file_changed', `回收文件已变化：${f.file}`);
            if (!await exists(target)) await fs.link(source, target);
            else if (stamp(await regular(target)) !== f.stamp) fail('restore_conflict', `原位置刚出现同名文件：${f.file}`);
            await fs.unlink(source);
          }
        }
        const s = this.store.settings;
        const profiles = this.store.profileViews((await this.manager.scan(c.root)).mods);
        const favoriteRefs={...s.favoriteRefs}, meta={...r.meta,...s.modMeta[r.modId]};
        if(r.bookmark){
          if(favoriteRefs[r.modId]) {meta.favorite=true; delete favoriteRefs[r.modId];}
          else delete meta.favorite;
        }
        await this.store.save({ ...s,
          ...(typeof r.displayName === 'string' ? { modNames: replaceDisplayNames(s, c.root, { [r.modId]: r.displayName, ...displayNames(s, c.root) }) } : {}),
          assignments: { ...s.assignments, [r.modId]: s.categories.some(x => x.id === r.categoryId) ? r.categoryId : 'cat-none' },
          favoriteRefs, modMeta: { ...s.modMeta, ...(Object.keys(meta).length ? { [r.modId]:meta } : {}) },
          favoriteCollections: (s.favoriteCollections ?? []).map(c => !r.bookmark && r.meta?.favorite && r.favoriteCollectionIds?.includes(c.id) && !c.modIds.includes(r.modId) ? { ...c, modIds: [...c.modIds, r.modId] } : c),
          profiles: s.profiles.map((p, i) => r.profileIds.includes(p.id) && sameRoot(p.modsGameRoot, c.root) ? {
            ...p, modsInitialized: true, modsGameRoot: c.root, modIds: [...new Set([...profiles[i].modIds, r.modId])],
          } : p),
        });
        await this.removeRecord(c.root, r);
        restored.push(r.modId);
      }
      return { restored, conflicts };
    }, { allowTrashRecovery: true });
  }
  async purge(root, selected, confirmation) {
    return this.manager.mutation(root, confirmation, async c => {
      const chosen = selected === 'all' ? (await this.list(c.root)).map(r => r.trashId) : ids(selected);
      const records = [];
      for (const trashId of chosen) {
        const r = await this.record(c.root, trashId);
        if (!['trashed', 'purging'].includes(r.state)) fail('trash_recovery_required', '请先还原未完成的回收条目，再重新删除。');
        records.push(r);
      }
      const purged = [];
      for (const r of records) {
        await this.manager.idle(c.root);
        r.state = 'purging'; await this.write(c.root, r);
        for (const f of r.files) {
          const file = await this.savedFile(c.root, r, f.file);
          if (await exists(file)) { await regular(file); await fs.unlink(file); }
        }
        await this.removeRecord(c.root, r); purged.push(r.trashId);
      }
      return { purged };
    }, { allowTrashRecovery: true });
  }
}
