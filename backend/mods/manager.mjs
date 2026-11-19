import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PlatformError, errorRecord, inspectGame } from '../core.mjs';
import { readVpk, readResource, regular, identity } from './vpk.mjs';
import { readAddonList, updateAddonList, addonKey } from './addonlist.mjs';
import { ModLibrary, libraryWorkshopId, deployName } from './library.mjs';
import { gameFolder } from '../legacy-names.mjs';
import { cacheModThumbnail } from './thumbnails.mjs';
import { directory } from './files.mjs';
import { detectPlatformPackage } from '../platforms/packages.mjs';
export { directory } from './files.mjs';

const fail = (code, message) => { throw new PlatformError(code, message); };
const exists = p => fs.lstat(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
function compareResources(items) {
  const byPath = new Map(), pairs = new Map();
  for (const m of items) for (const resource of m.resources ?? []) {
    const owners = byPath.get(resource) ?? [];
    for (const other of owners) {
      const key = JSON.stringify([other, m.id]);
      let pair = pairs.get(key);
      if (!pair) { pair = { id: key, a: other, b: m.id, paths: [], pathCount: 0 }; pairs.set(key, pair); }
      pair.pathCount++;
      if (pair.paths.length < 200) pair.paths.push(resource);
    }
    owners.push(m.id); byPath.set(resource, owners);
  }
  return [...pairs.values()];
}

export class ModManager {
  constructor(options = {}) {
    this.inspectGame = options.inspectGame ?? inspectGame; this.cache = new Map(); this.library = new ModLibrary(); this.readers = new Map(); this.writers = new Set();
    this.workshopThumbnail = options.workshopThumbnail; this.thumbnailPending = new Map();
    this.displayNames = options.displayNames ?? (() => ({}));
  }
  async reading(root, fn) {
    const key = path.resolve(root).toLowerCase();
    if (this.writers.has(key)) fail('operation_in_progress', 'Mod 文件正在修改，请稍后重试。');
    this.readers.set(key, (this.readers.get(key) ?? 0) + 1);
    try { return await fn(); } finally { const n = this.readers.get(key) - 1; if (n) this.readers.set(key, n); else this.readers.delete(key); }
  }
  async cached(file) {
    const prior = this.cache.get(file);
    if (prior) {
      const valid = await Promise.all(prior.files.map(async f => identity(await regular(f.file).catch(() => ({}))) === f.identity));
      if (valid.every(Boolean)) return prior;
    }
    const value = await readVpk(file); this.cache.set(file, value); return value;
  }
  async sidecar(file) {
    const wanted = path.basename(file).replace(/\.vpk$/i, '.jpg').toLowerCase();
    const name = (await fs.readdir(path.dirname(file))).find(n => n.toLowerCase() === wanted);
    if (!name) return null;
    const absolutePath = path.join(path.dirname(file), name), stat = await regular(absolutePath);
    return { file: absolutePath, stat };
  }
  async resolve(gameRoot, id) {
    if (typeof id === 'string' && id.startsWith('library:')) return this.library.resolve(gameRoot, id);
    if (typeof id !== 'string' || !/^(?:workshop\/)?[^/\\:<>"|?*\x00-\x1f]+\.vpk$/i.test(id)) fail('invalid_argument', 'Mod ID 无效。');
    const content = await directory(path.join(gameRoot, 'left4dead2'));
    const addons = await directory(path.join(content, 'addons'));
    const folder = id.startsWith('workshop/') ? await directory(path.join(addons, 'workshop')) : addons;
    const name = (await fs.readdir(folder)).find(n => n.toLowerCase() === path.basename(id).toLowerCase());
    if (!name) fail('mod_missing', '选中的 Mod 已移除，请重新扫描。');
    const absolutePath = path.join(folder, name);
    await regular(absolutePath);
    return absolutePath;
  }
  async thumbnail(gameRoot, id) {
    const absolutePath = await this.resolve(gameRoot, id);
    const image = await this.localThumbnail(absolutePath);
    const workshopId = id.startsWith('library:') ? libraryWorkshopId(id)
      : /^(?:workshop\/)?([1-9][0-9]{0,19})\.vpk$/i.exec(id)?.[1];
    if (image.dataUrl || !workshopId || !this.workshopThumbnail) return image;
    const key = absolutePath.toLowerCase();
    if (!this.thumbnailPending.has(key)) {
      const load = async () => {
        const preview = await this.workshopThumbnail(workshopId);
        if (!preview.dataUrl) return { dataUrl: null };
        const body = Buffer.from(preview.dataUrl.split(',')[1], 'base64');
        // A numeric filename is a lookup hint; the provider verifies the Steam app before loading.
        // Fetch outside the file lock, then resolve again so removed Mods stay removed.
        await this.reading(gameRoot, async () => cacheModThumbnail(await this.resolve(gameRoot, id), body));
        return this.localThumbnail(absolutePath);
      };
      this.thumbnailPending.set(key, load().finally(() => this.thumbnailPending.delete(key)));
    }
    return this.thumbnailPending.get(key);
  }
  async localThumbnail(absolutePath, { archived = false } = {}) {
    const sidecar = await this.sidecar(absolutePath);
    const limit = 8 * 1024 * 1024;
    let body = null, dirs = [];
    if (sidecar && sidecar.stat.size <= limit) body = await readResource({ archiveFile: sidecar.file, dataOffset: 0,
      preload: Buffer.alloc(0), length: sidecar.stat.size, size: sidecar.stat.size }, limit);
    if (!body || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
      const vpk = await (archived ? readVpk(absolutePath) : this.cached(absolutePath)).catch(e => { if (e.code === 'invalid_vpk') return null; throw e; });
      dirs = vpk?.dirs ?? [];
      body = vpk?.thumbnail && vpk.thumbnail.size <= limit ? await readResource(vpk.thumbnail, limit) : null;
    }
    const dataUrl = body?.[0] === 0xff && body?.[1] === 0xd8 && body?.[2] === 0xff ? `data:image/jpeg;base64,${body.toString('base64')}` : null;
    return { dataUrl, ...(archived && !dataUrl && { dirs }) };
  }
  async scan(gameRoot) {
    const content = await directory(path.join(gameRoot, 'left4dead2'));
    const addons = path.join(content, 'addons'), items = [], issues = [];
    let document = null;
    try { document = await readAddonList(path.join(content, 'addonlist.txt')); }
    catch (e) { issues.push(errorRecord(e)); }
    const library = await this.library.entries(gameRoot);
    const owned = new Set(library.filter(m => m.deployed).map(m => m.deployment.file.toLowerCase()));
    if (await exists(addons)) {
      await directory(addons);
      for (const sub of ['', 'workshop']) {
        const folder = path.join(addons, sub);
        if (!await exists(folder)) continue;
        try { await directory(folder); } catch (e) { issues.push(errorRecord(e)); continue; }
        const names = await fs.readdir(folder);
        const lower = new Set(names.map(n => n.toLowerCase()));
        for (const name of names.filter(n => /\.vpk$/i.test(n)).sort()) {
          if (!sub && owned.has(name.toLowerCase())) continue;
          // Numbered data shards belong to their _dir index, not separate addons.
          if (/_\d{3}\.vpk$/i.test(name) && lower.has(name.replace(/_\d{3}\.vpk$/i, '_dir.vpk').toLowerCase())) continue;
          const file = (sub ? sub + '/' : '') + name, absolutePath = path.join(folder, name);
          const base = { id: addonKey(file), file, absolutePath, storage: 'addons', source: sub ? 'workshop' : 'local',
            ...(sub && /^\d+\.vpk$/i.test(name) ? { workshopId: name.slice(0, -4) } : {}),
            enabled: document?.values.get(addonKey(file))?.enabled ?? null, categoryId: 'cat-none' };
          try {
            const platformPackage = await detectPlatformPackage(absolutePath, { workshopId: base.workshopId });
            if (platformPackage) { items.push({ ...base, ...platformPackage }); continue; }
            const vpk = await this.cached(absolutePath);
            const sidecar = await this.sidecar(absolutePath);
            items.push({ ...base, title: vpk.title, author: vpk.author, version: vpk.versionLabel, description: vpk.description,
              sizeMB: vpk.sizeMB, fileCount: vpk.fileCount, dirs: vpk.dirs,
              updatedAt: sidecar ? new Date(Math.max(Date.parse(vpk.updatedAt), sidecar.stat.mtimeMs, sidecar.stat.ctimeMs)).toISOString() : vpk.updatedAt,
              hasThumbnail: !!(vpk.thumbnail || sidecar), soundCount: vpk.soundCount, warning: vpk.warning,
              resources: vpk.resources });
          } catch (e) {
            const sidecar = await this.sidecar(absolutePath).catch(() => null);
            items.push({ ...base, title: name, author: '', version: '', description: '', sizeMB: 0, fileCount: 0, dirs: [],
              hasThumbnail: !!sidecar, updatedAt: sidecar?.stat.mtime.toISOString() ?? '', error: e.message });
          }
        }
      }
    }
    for (const m of library) {
      const base = { id: m.id, file: `${path.basename(path.dirname(path.dirname(path.dirname(m.absolutePath))))}/workshop/${m.workshopId}/mod.vpk`, absolutePath: m.absolutePath,
        storage: 'library', source: 'workshop', workshopId: m.workshopId, categoryId: 'cat-none',
        enabled: m.deployed && (document?.values.get(m.deployment.file)?.enabled ?? false), deployed: m.deployed,
        deploymentFile: m.deployment?.file, title: m.title, author: m.author, error: m.deploymentError };
      try {
        const platformPackage = await detectPlatformPackage(m.absolutePath, { workshopId: m.workshopId });
        if (platformPackage) { items.push({ ...base, ...platformPackage }); continue; }
        const v = await this.cached(m.absolutePath);
        const sidecar = await this.sidecar(m.absolutePath);
        items.push({ ...base, title: v.hasTitle ? v.title : m.title, author: v.author || m.author, version: v.versionLabel, description: v.description,
          sizeMB: v.sizeMB, fileCount: v.fileCount, dirs: v.dirs,
          updatedAt: sidecar ? new Date(Math.max(Date.parse(v.updatedAt), sidecar.stat.mtimeMs, sidecar.stat.ctimeMs)).toISOString() : v.updatedAt,
          hasThumbnail: !!(v.thumbnail || sidecar),
          soundCount: v.soundCount, warning: v.warning, resources: v.resources });
      } catch (e) { items.push({ ...base, version: '', description: '', sizeMB: 0, fileCount: 0, dirs: [], updatedAt: '', error: e.message }); }
    }
    const used = new Set(items.map(m => m.absolutePath));
    for (const p of this.cache.keys()) if (!used.has(p)) this.cache.delete(p);
    const names = this.displayNames(gameRoot);
    return { mods: items.map(({ resources, ...m }) => m.kind === 'platform-package' ? m
      : { ...m, sourceTitle: m.title, title: names[m.id] ?? m.title }), conflicts: compareResources(items), issues,
      writable: !!document, addonListPath: path.join(content, 'addonlist.txt') };
  }
  async idle(root) {
    const game = await this.inspectGame(root);
    if (game.processes.length) fail('game_running', '请先退出游戏，再修改 Mod 文件或应用方案。');
    return game;
  }
  async mutation(root, confirmation, fn, { allowTrashRecovery = false, offlineLibrary = false } = {}) {
    if (confirmation?.approved !== true || confirmation.source !== 'user') fail('confirmation_required', '请确认此次 Mod 修改。');
    const writerKey = path.resolve(root).toLowerCase();
    if (this.writers.has(writerKey)) fail('operation_in_progress', '另一项 Mod 修改正在进行。');
    this.writers.add(writerKey);
    try {
    const game = await (offlineLibrary ? this.inspectGame(root) : this.idle(root)), content = await directory(path.join(game.gameRoot, 'left4dead2'));
    if (!offlineLibrary && this.readers.get(path.resolve(game.gameRoot).toLowerCase())) fail('mod_busy', '正在读取 Mod，请等待解包或试听准备完成。');
    const lock = path.join(content, '.matcha-mods.lock');
    const token = randomUUID(); let handle;
    try { handle = await fs.open(lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const old = JSON.parse(await fs.readFile(lock, 'utf8').catch(() => '{}'));
      let alive = true;
      if (old.owner === 'flare-mods' && Number.isSafeInteger(old.pid) && old.pid > 0) {
        try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      }
      if (alive) fail('operation_in_progress', '另一项 Mod 操作尚未结束，请稍后刷新。');
      await regular(lock); await fs.unlink(lock); handle = await fs.open(lock, 'wx');
    }
    try { await handle.writeFile(JSON.stringify({ owner: 'flare-mods', pid: process.pid, token })); await handle.sync(); }
    finally { await handle.close(); }
    try {
      if (!allowTrashRecovery) {
        const trash = gameFolder(content, 'trash');
        if (await exists(trash)) {
          await directory(trash);
          for (const id of await fs.readdir(trash)) if (/^[0-9a-f-]{36}$/.test(id)) {
            const dir = await directory(path.join(trash, id)), record = path.join(dir, 'record.json');
            if (!await exists(record)) continue; // Initial manifest write interrupted before any move.
            await regular(record);
            if (JSON.parse(await fs.readFile(record, 'utf8')).state !== 'trashed') fail('trash_recovery_required', '回收站有未完成的操作，请先还原该条目或继续已开始的永久删除。');
          }
        }
      }
      return await fn({ root: game.gameRoot, content });
    }
    finally {
      const current = JSON.parse(await fs.readFile(lock, 'utf8').catch(() => '{}'));
      if (current.token === token) await fs.unlink(lock);
    }
    } finally { this.writers.delete(writerKey); }
  }
  async writeList(c, changes, removeKeys = []) {
    const file = path.join(c.content, 'addonlist.txt'), document = await readAddonList(file);
    const result = updateAddonList(document, changes, removeKeys);
    if (document.original?.equals(result)) return { changed: false, backup: null };
    const backups = await directory(gameFolder(c.content, 'backups'), true);
    const stamp = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
    let backup = null;
    if (document.original) {
      backup = path.join(backups, `addonlist-${stamp}.txt`);
      await fs.writeFile(backup, document.original, { flag: 'wx' });
    }
    const temp = path.join(c.content, `.addonlist-${stamp}.tmp`);
    try {
      const h = await fs.open(temp, 'wx');
      try { await h.writeFile(result); await h.sync(); } finally { await h.close(); }
      await this.idle(c.root);
      let current;
      if (await exists(file)) { await regular(file); current = await fs.readFile(file); }
      if (document.original ? !current?.equals(document.original) : !!current) fail('external_change', 'addonlist.txt 刚被其他程序修改，请刷新后重新应用。');
      await fs.rename(temp, file);
      return { changed: true, backup };
    } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  async apply({ gameRoot, enabledIds, confirmation }) {
    return this.mutation(gameRoot, confirmation, async c => {
      if (!Array.isArray(enabledIds) || enabledIds.some(id => typeof id !== 'string')) fail('invalid_argument', '需要 Mod ID 列表。');
      const inventory = await this.scan(c.root), enabled = new Set(enabledIds), known = new Set(inventory.mods.map(m => m.id));
      if (enabledIds.some(id => !known.has(id))) fail('mod_missing', '方案内有已移除的 Mod，请刷新并更新方案。');
      if (inventory.mods.some(m => enabled.has(m.id) && m.error)) fail('invalid_vpk', '请先修复或在方案中停用解析失败的 VPK。');
      const applicable = inventory.mods.filter(m => m.kind !== 'platform-package');
      const result = await this.applySelection(c, applicable, enabled);
      return { status: 'applied', enabledCount: applicable.filter(m => enabled.has(m.id)).length, ...result };
    });
  }
  async applySelection(c, mods, enabled) {
    mods = mods.filter(m => m.kind !== 'platform-package');
    const managed = mods.filter(m => m.storage === 'library');
    for (const m of managed) await this.library.checkDeployment(c, m.id);
    // Register disabled before publishing any new readable package.
    const prepared = managed.length ? await this.writeList(c, managed.map(m => [m.deploymentFile ?? deployName(m.workshopId), false])) : { changed: false, backup: null };
    for (const m of managed) await this.library.deploy(c, m.id, enabled.has(m.id), root => this.idle(root));
    const result = await this.writeList(c, mods.map(m => [m.storage === 'library' ? m.deploymentFile ?? deployName(m.workshopId) : m.file, enabled.has(m.id)]));
    return { changed: prepared.changed || result.changed, backup: prepared.backup ?? result.backup };
  }
  async setEnabled({ gameRoot, modIds, enabled, confirmation }) {
    return this.mutation(gameRoot, confirmation, async c => {
      if (typeof enabled !== 'boolean' || !Array.isArray(modIds) || !modIds.length || modIds.some(id => typeof id !== 'string')) fail('invalid_argument', '需要 Mod ID 列表和布尔启用状态。');
      const { mods } = await this.scan(c.root), selected = new Set(modIds);
      if (modIds.some(id => !mods.some(m => m.id === id))) fail('mod_missing', '选中的 Mod 已移除，请重新扫描。');
      const targets = mods.filter(m => selected.has(m.id));
      if (targets.some(m => m.kind === 'platform-package')) fail('platform_package_readonly', '请到平台页管理 Skeeto；更新包保持现有 addonlist 条目。');
      if (enabled && targets.some(m => m.error)) fail('invalid_vpk', '请先修复解析失败的 VPK。');
      return { status: 'applied', count: targets.length, ...(await this.applySelection(c, targets, new Set(enabled ? modIds : []))) };
    });
  }
  async preview(file) {
    if (typeof file !== 'string' || !/\.vpk$/i.test(file)) fail('invalid_argument', '请选择 .vpk 文件。');
    const vpk = await readVpk(file);
    return { file: vpk.file, name: path.basename(vpk.file), title: vpk.title, sizeMB: vpk.sizeMB, fileCount: vpk.fileCount,
      files: vpk.files.map(f => ({ name: path.basename(f.file), size: f.size })), warning: vpk.warning };
  }
  // Both local copies and freshly packed folders arrive here as complete, private
  // files on the addons volume. Register disabled first and publish the index last.
  async replaceImport(c, addons, files, target) {
    const name = path.basename(target), id = addonKey(name);
    const stat = await regular(target);
    if ((await this.library.entries(c.root)).some(r => r.deployment?.file.toLowerCase() === id) ||
        (stat.size >= 4 && await detectPlatformPackage(target)))
      fail('managed_package', '请在对应的平台或工坊库中更新这个受管 Mod。');
    // Record the old index and exactly the shards it references. Retire stale volumes too.
    let old = [target];
    if (/_dir\.vpk$/i.test(name)) old = (await readVpk(target)).files.map(f => f.file);
    const owned = new Set(old.map(f => path.basename(f).toLowerCase()));
    for (const f of files) {
      const dest = path.join(addons, path.basename(f));
      if (!owned.has(path.basename(f).toLowerCase()) && await exists(dest))
        fail('file_exists', '新分卷与另一份文件重名：' + path.basename(f));
    }
    const backups = await directory(gameFolder(c.content, 'backups'), true);
    const backup = await directory(path.join(backups, 'vpk-' + randomUUID()), true);
    const saved = [], published = [];
    await this.idle(c.root);
    try {
      for (const f of old) {
        await regular(f);
        await fs.rename(f, path.join(backup, path.basename(f))); saved.push(f);
      }
      await this.idle(c.root);
      for (const f of [...files.slice(1), files[0]]) {
        const dest = path.join(addons, path.basename(f)); await fs.link(f, dest); published.push(dest);
      }
    } catch (error) {
      for (const f of published.reverse()) await fs.unlink(f);
      for (const f of saved.reverse()) {
        const copy = path.join(backup, path.basename(f)); await fs.link(copy, f); await fs.unlink(copy);
      }
      throw error;
    }
    this.cache.delete(target);
    return { status:'imported', replaced:true, id, file:target, backup };
  }
  async publishImport(c, addons, files, replaceExisting = false) {
    const name = path.basename(files[0]), published = [];
    await readVpk(files[0]);
    const target = path.join(addons, name);
    if (replaceExisting && await exists(target)) return this.replaceImport(c, addons, files, target);
    for (const file of files) if (await exists(path.join(addons, path.basename(file)))) fail('file_exists', `已有同名文件：${path.basename(file)}。原文件已保留。`);
    const saved = await this.writeList(c, [[name, false]]);
    await this.idle(c.root);
    try {
      for (const file of [...files.slice(1), files[0]]) {
        const target = path.join(addons, path.basename(file));
        await fs.link(file, target); published.push(target);
      }
      return { status: 'imported', id: addonKey(name), file: path.join(addons, name), enabled: false, backup: saved.backup };
    } catch (e) {
      for (const target of published) await fs.unlink(target);
      throw e;
    }
  }
  async importPacked({ gameRoot, file, confirmation, replaceExisting = false }) {
    return this.mutation(gameRoot, confirmation, async c =>
      this.publishImport(c, await directory(path.join(c.content, 'addons'), true), [file], replaceExisting));
  }
  async import({ gameRoot, file, confirmation, ownedDownload = false, replaceExisting = false }) {
    return this.mutation(gameRoot, confirmation, async c => {
      if (typeof file !== 'string' || !/\.vpk$/i.test(file)) fail('invalid_argument', '请选择 .vpk 文件。');
      const vpk = await readVpk(file), addons = await directory(path.join(c.content, 'addons'), true);
      const staging = await directory(path.join(addons, `.matcha-import-${randomUUID()}`), true);
      try {
        for (const item of vpk.files) {
          const dest=path.join(staging,path.basename(item.file));
          if(ownedDownload){
            const before=await regular(item.file);
            if(identity(before)!==item.identity)fail('file_changed','下载文件已变化。');
            try {await fs.link(item.file,dest);
              const after=await regular(dest);
              if(before.dev!==after.dev || before.ino!==after.ino || before.size!==after.size || before.mtimeMs!==after.mtimeMs)fail('file_changed','下载文件已变化。');
              continue;
            }catch(e){if(!['EXDEV','EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS'].includes(e.code))throw e;}
          }
          await fs.copyFile(item.file,dest,fs.constants.COPYFILE_EXCL);
          if (identity(await regular(item.file)) !== item.identity) fail('file_changed', '复制期间来源 VPK 已变化，请重新导入。');
        }
        return await this.publishImport(c, addons, vpk.files.map(item => path.join(staging, path.basename(item.file))), replaceExisting);
      } finally {
        // Only files in this unique operation directory are owned here.
        for (const item of await fs.readdir(staging)) await fs.unlink(path.join(staging, item));
        await fs.rmdir(staging);
      }
    });
  }
}
