import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dirs, layout, profiles, tree, sum, volume, below, same, transfer, missing } from './storage-files.mjs';
import { exists, fail, stamp, writeJson } from '../mods/files.mjs';
import { legacyArchiveImported } from '../mods/browser-downloads.mjs';
import { regular, identity } from '../mods/vpk.mjs';
import { gameFolder, isFolder } from '../legacy-names.mjs';
const keys = ['imported-downloads', 'browser-cache', 'relink-deployed'], labels = ['已导入的下载压缩包', '浏览器磁盘缓存', '可改用硬链接的副本'];
const fileId = /^\d+-\d+$/, uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const system = () => path.parse(process.env.SystemRoot || process.env.LOCALAPPDATA || process.cwd()).root;
const recommended = root => root && path.isAbsolute(root) && !same(system(), path.parse(root).root)
  ? process.env.MATCHA_CHANNEL === 'beta' ? path.join(root,'left4dead2','.matcha-beta-data') : gameFolder(path.join(root,'left4dead2'),'data')
  : null;
const cachedReceipt = unit => Array.isArray(unit?.cacheReceipt);
const safeName = n => typeof n === 'string' && n !== '.' && n !== '..' && n.length > 0 && path.basename(n) === n && !/[\\/:*?"<>|]/.test(n);
const cacheKeys = ['native-libraries', 'platforms/cache', 'dll-sources', 'dll-intake'];
export class Storage {
  constructor(s, native) { this.oldImports = new Map(); this.s = s; this.native = native; this.base = path.resolve(s.dataDir); this.file = path.join(this.base, 'storage.json'); this.log = path.join(this.base, 'storage-transfer.json'); }
  save() {
    const snapshot = structuredClone(this.cfg);
    const write = (this.saves ?? Promise.resolve()).then(async () => {
      await dirs(this.base, true);
      await writeJson(this.file, snapshot);
    });
    this.saves = write.catch(() => {});
    return write;
  }
  notify() { this.s.emit('event', { type: 'storage_changed' }); }
  async claim(root) {
    if (same(root, this.base)) {
      await dirs(root, true);
      return;
    }
    await dirs(root, true);
    const mark = path.join(root, '.matcha-storage.json');
    if (await exists(mark)) {
      await regular(mark);
      if ((await missing(mark, {})).owner !== 'Matcha storage v1')
        fail('storage_conflict', '该目录已有其他存储标记。');
    }
    else {
      for (const n of ['cache', 'downloads', 'profiles'])
        if (await exists(path.join(root, n)))
          fail('storage_conflict', '此位置已有同名目录，请选择空目录：' + n);
      await fs.writeFile(mark, JSON.stringify({ owner: 'Matcha storage v1' }), { flag: 'wx' });
    }
    await dirs(path.join(root, 'cache'), true);
  }
  get paths() { return layout(this.base, this.cfg.root); }
  get roots() { return [...new Set([this.cfg.root, ...this.cfg.pending])]; }
  downloadRoots(kind) { return this.roots.map(r => layout(this.base, r)[kind]); }
  bind() {
    const s = this.s, p = this.paths, cache = same(this.base, this.cfg.root) ? this.base : path.join(this.cfg.root, 'cache');
    const all = this.roots.map(r => layout(this.base, r));
    s.pluginOverlays.stagingRoots = all.flatMap(l => [l['dll-intake'], l['dll-sources']]);
    s.dllIntake.legacyBases = all.slice(1).map(l => l['dll-intake']);
    s.dllIntake.locations = new Map();
    s.nativeLibraries.cache.legacyBases = all.slice(1).map(l => l['native-libraries']);
    s.platformLifecycle.legacyCaches = all.slice(1).map(l => l['platforms/cache']);
    s.dllIntake.base = p['dll-intake'];
    s.dllSources.base = p['dll-sources'];
    s.nativeLibraries.cache.base = p['native-libraries'];
    s.settingsCache.base = cache;
    s.platformLifecycle.cacheDir = cache;
    s.platformLifecycle.releases.clear();
    s.gamemaps.downloadRoots = () => this.downloadRoots('gamemaps');
  }
  async load() {
    const game = await this.s.root().catch(() => this.s.settings.gameRoot || '');
    const def = recommended(game) && await exists(path.join(game, 'left4dead2')) ? recommended(game) : this.base;
    this.cfg = await missing(this.file, { root: def, custom: false, pending: [], deleteArchivesAfterImport: true, profileRoot: this.base });
    if (!Array.isArray(this.cfg.pending) || ![this.cfg.root, ...this.cfg.pending, this.cfg.profileRoot].every(r => typeof r === 'string' && path.isAbsolute(r)))
      fail('storage_invalid', '存储配置需要检查。');
    if (this.cfg.move?.state === 'moving') {
      this.cfg.move.state = 'failed';
      this.cfg.move.error = '上次搬家中断，点「搬过去」继续。';
    }
    if (!this.cfg.custom && !this.cfg.move && !same(this.cfg.root, def)) {
      this.cfg.pending.unshift(this.cfg.root);
      this.cfg.root = def;
    }
    this.cfg.pending = [...new Set([...this.cfg.pending, this.base])].filter(p => !same(p, this.cfg.root));
    await this.claim(this.cfg.root);
    this.bind();
    if (!this.cfg.move && (!same(this.cfg.profileRoot, this.cfg.root) || this.cfg.profileJob)) {
      try {
        await this.switchProfiles();
      }
      catch (e) {
        this.profileError = '浏览器资料尚未搬完：' + e.message + '。关闭其他 Matcha 后重新打开即可继续。';
      }
    }
    await this.save();
    this.broadcast();
  }
  async switchProfiles() {
    const c = this.cfg, job = c.profileJob ?? { from: c.profileRoot, to: c.root, index: 0, tag: randomUUID() };
    if (!/^[a-f0-9-]{36}$/.test(job.tag) || !same(job.to, c.root))
      fail('storage_conflict', '浏览器资料搬家记录需要检查。');
    c.profileJob = job;
    await this.save();
    const old = profiles(this.base, job.from), next = profiles(this.base, job.to), log = path.join(this.base, 'storage-profile-transfer.json');
    for (; job.index < old.length; job.index++) {
      const i = job.index, park = old[i] + '.matcha-moving-' + job.tag;
      if (await exists(old[i])) {
        await dirs(old[i]);
        if (await exists(park) || await exists(next[i]))
          fail('storage_conflict', '目标已有浏览器资料，保留原资料：' + next[i]);
        // Claim the entire closed profile before a cross-volume copy. An open WebView keeps its original tree intact.
        await fs.rename(old[i], park);
      }
      if (await exists(park) || (await missing(log, null))?.from === park)
        await transfer(park, next[i], log);
      await this.save();
    }
    c.profileRoot = job.to;
    delete c.profileJob;
  }
  broadcast() { this.s.emit('event', { type: 'storage_layout', browser: this.paths.browser, gamemaps: this.paths.gamemaps, profiles: this.profileError ? [] : profiles(this.base, this.cfg.profileRoot), blocked: !!this.cfg.move }); }
  async gameChanged() {
    if (this.cfg.custom || this.cfg.move)
      return;
    const game = await this.s.root();
    const root = recommended(game) && await exists(path.join(game, 'left4dead2')) ? recommended(game) : this.base;
    if (same(root, this.cfg.root))
      return;
    await this.claim(root);
    this.cfg.pending = [...new Set([this.cfg.root, ...this.cfg.pending])].filter(p => !same(p, root));
    this.cfg.root = root;
    this.bind();
    await this.save();
    this.broadcast();
    this.notify();
  }
  async browserRows() { return await missing(path.join(this.base, 'browser/downloads.json'), []); }
  async patchBrowser(id, oldPath, patch) {
    if (this.native)
      return this.native('patch', { rowId: id, oldPath, patch });
    const f = path.join(this.base, 'browser/downloads.json'), rows = await this.browserRows(), r = rows.find(r => r.id === id);
    if (r && r.path === oldPath) {
      Object.assign(r, patch);
      await writeJson(f, rows);
    }
  }
  async archiveFile(folder, file) {
    if (typeof file !== 'string' || !below(folder, file) || !file.toLowerCase().endsWith('.zip'))
      return null;
    await dirs(path.dirname(file));
    return regular(file).catch(e => { if (e.code === 'ENOENT')
      return null; throw e; });
  }
  async importedArchives() {
    const result = [];
    for (const row of await this.browserRows()) {
      if (row.cleanupPending && !row.cleaned && typeof row.path === 'string' && !await exists(row.path)) {
        await this.patchBrowser(row.id, row.path, { cleaned: true, cleanupPending: false });
        continue;
      }
      if (!fileId.test(row.id) || row.state !== 'done' || row.cleaned || typeof row.path !== 'string')
        continue;
      const folder = this.downloadRoots('browser').map(d => path.join(d, row.id)).find(d => same(d, path.dirname(row.path)));
      if (!folder || !await exists(row.path))
        continue;
      const st = await this.archiveFile(folder, row.path);
      if (!st)
        continue;
      const sig = stamp(st);
      let verified = sig === row.archiveStamp;
      if (!verified && !row.archiveStamp && !row.selectionStamp) {
        const ids = new Set(Object.entries(this.s.settings.modOrigins ?? {}).filter(([, o]) => o?.downloadId === row.id).map(([id]) => id));
        if (ids.size) {
          const key = row.path + '|' + sig;
          if (this.oldImports.has(key))
            verified = true;
          else {
            const root = await this.s.root();
            if (root)
              verified = await legacyArchiveImported(row.path, path.join(root, 'left4dead2', 'addons'), ids).catch(() => false);
            if (verified && stamp(await regular(row.path)) === sig) {
              this.oldImports.set(key, true);
              if (this.oldImports.size > 500)
                this.oldImports.delete(this.oldImports.keys().next().value);
            }
            else
              verified = false;
          }
        }
      }
      if (verified)
        result.push({ file: row.path, st, prepare: () => this.patchBrowser(row.id, row.path, { archiveStamp: sig, cleanupPending: true }), mark: () => this.patchBrowser(row.id, row.path, { cleaned: true, cleanupPending: false }) });
    }
    for (const base of this.downloadRoots('gamemaps')) {
      if (!await exists(base))
        continue;
      await dirs(base);
      for (const id of await fs.readdir(base)) {
        if (!uuid.test(id))
          continue;
        const folder = path.join(base, id);
        await dirs(folder);
        const f = path.join(folder, 'receipt.json'), r = await missing(f, null);
        if (!r || r.cleaned || typeof r.download?.path !== 'string' || !below(folder, r.download.path))
          continue;
        if (!await exists(r.download.path)) {
          if (r.cleanupPending) {
            r.cleaned = true;
            delete r.cleanupPending;
            await writeJson(f, r);
          }
          continue;
        }
        const st = await this.archiveFile(folder, r.download.path);
        if (!st)
          continue;
        const complete = r.archiveStamp === stamp(st) || (!r.archiveStamp && r.identity === identity(st) && this.s.tasks.records.get(id)?.state === 'done'
          && r.files?.length && r.files.every(n => r.imported?.[n]));
        if (complete)
          result.push({ file: r.download.path, st, prepare: async () => { r.cleanupPending = true; await writeJson(f, r); }, mark: async () => { r.cleaned = true; delete r.cleanupPending; await writeJson(f, r); const task = this.s.tasks.records.get(id); if (task) {
              task.archiveCleaned = true;
              this.s.tasks.publish(task);
              await this.s.tasks.save();
            } } });
      }
    }
    return result;
  }
  async discard(item) { await item.prepare(); if (stamp(await regular(item.file)) !== stamp(item.st))
    fail('storage_changed', '下载文件已变化。'); await fs.unlink(item.file); await item.mark(); return item.st.nlink === 1 ? item.st.size : 0; }
  async browserImported(row) {
    await this.patchBrowser(row.id, row.path, { archiveStamp: row.importStamp });
    if (this.cfg.deleteArchivesAfterImport) {
      const st = await regular(row.path);
      if (stamp(st) !== row.importStamp)
        fail('storage_changed', '导入期间压缩包已变化。');
      await this.discard({ file: row.path, st, prepare: () => this.patchBrowser(row.id, row.path, { cleanupPending: true }), mark: () => this.patchBrowser(row.id, row.path, { cleaned: true, cleanupPending: false }) });
    }
  }
  async browserCache() {
    const rows = [];
    for (const p of profiles(this.base, this.cfg.profileRoot)) {
      for (const part of ['Cache', 'Code Cache', 'Service Worker/CacheStorage', 'Service Worker/ScriptCache']) {
        for (const sub of ['EBWebView/Default', 'Default']) {
          const t = path.join(p, sub, part);
          if (await exists(t))
            rows.push(...(await tree(t)).files);
        }
      }
    }
    return { bytes: sum(rows), files: rows.length };
  }
  async pending(root) {
    const l = layout(this.base, root);
    let n = 0;
    for (const p of Object.values(l))
      n += sum((await tree(p)).files);
    return n;
  }
  async status() {
    if (!this.worker)
      return this.scanStatus();
    if (!this.meter || this.meter.move !== this.cfg.move || Date.now() - this.meter.at > 3000) {
      this.meter = { move: this.cfg.move, at: Date.now(), result: this.scanStatus() };
    }
    return { ...await this.meter.result, move: this.cfg.move };
  }
  async scanStatus() {
    const c = this.cfg, game = this.s.settings.gameRoot || await this.s.root().catch(() => ''), p = this.paths, loc = c.root;
    let pend = 0, pendingPath;
    for (const r of c.pending) {
      const n = await this.pending(r);
      if (n && !pendingPath)
        pendingPath = r;
      pend += n;
    }
    const sumPaths = async (ps) => { let n = 0; for (const f of new Set(ps))
      n += sum((await tree(f)).files); return n; };
    const usage = [], push = (id, bytes, where, path, extras = {}) => usage.push({ id, bytes, where, path, ...extras });
    const g = game && path.join(game, 'left4dead2');
    if (g && await exists(g)) {
      push('library', await sumPaths([gameFolder(g, 'library')]), 'game', gameFolder(g, 'library'));
      const d = await this.s.modManager.library.deployments(game);
      push('deployed', d.reduce((a, b) => a + b.bytes, 0), 'game', path.join(g, 'addons'), { mode: d.some(x => !x.linked) ? 'copy' : 'link', reclaimableBytes: d.filter(x => x.reclaimable).reduce((a, b) => a + b.bytes, 0) });
      push('trash', await sumPaths([gameFolder(g, 'trash')]), 'game', gameFolder(g, 'trash'));
    }
    const archives = await this.importedArchives();
    push('downloads', await sumPaths([...this.downloadRoots('browser'), ...this.downloadRoots('gamemaps')]), 'storage', same(loc, this.base) ? loc : path.join(loc, 'downloads'), { reclaimableBytes: archives.reduce((a, x) => a + (x.st.nlink === 1 ? x.st.size : 0), 0) });
    const cache = await this.browserCache();
    push('browser-cache', cache.bytes, 'storage', profiles(this.base, c.profileRoot)[0], { reclaimableBytes: cache.bytes });
    push('components', await sumPaths(this.roots.flatMap(r => cacheKeys.map(k => layout(this.base, r)[k]))), 'storage', path.dirname(p['native-libraries']));
    push('app-data', sum((await tree(this.base, { skip: [...Object.values(layout(this.base, this.base)), ...profiles(this.base, this.base)] })).files), 'appdata', this.base);
    const rec = recommended(game);
    return { location: { path: loc, displayPath: await fs.realpath(loc).catch(e=>{if(e.code!=='ENOENT')throw e;}), custom: c.custom, volume: await volume(loc), pendingBytes: pend, pendingPath: pendingPath || c.move?.from },
      profileError: this.profileError, suggestions: rec ? [{ path: rec, label: '游戏所在盘', volume: await volume(rec) }] : [], gameVolume: game ? await volume(game) : undefined, usage, deleteArchivesAfterImport: c.deleteArchivesAfterImport, move: c.move, scannedAt: new Date().toISOString() };
  }
  async clean(kinds, apply, confirmation) {
    if (!Array.isArray(kinds) || !kinds.length || kinds.some(k => !keys.includes(k)))
      fail('invalid_argument', '请选择有效的清理项目。');
    if (apply)
      this.s.confirm(confirmation);
    const items = [];
    let freedBytes = 0;
    for (const kind of new Set(kinds)) {
      let bytes = 0, files = 0;
      if (kind === 'imported-downloads') {
        for (const x of await this.importedArchives()) {
          bytes += x.st.nlink === 1 ? x.st.size : 0;
          files++;
          if (apply)
            freedBytes += await this.discard(x);
        }
      }
      if (kind === 'browser-cache') {
        const before = await this.browserCache();
        ({ bytes, files } = before);
        if (apply && bytes) {
          if (!this.native)
            fail('desktop_required', '请在桌面应用中清理浏览器缓存。');
          await this.native('clear-cache', {});
          freedBytes += Math.max(0, bytes - (await this.browserCache()).bytes);
        }
      }
      if (kind === 'relink-deployed') {
        const r = await this.s.requireRoot(), m = this.s.modManager;
        const run = async (c) => {
          for (const d of await m.library.deployments(r, !apply))
            if (d.reclaimable) {
              bytes += d.bytes;
              files++;
              if (apply) {
                const deployed = await m.library.deploy(c, d.id, true, p => m.idle(p));
                const f = await m.library.resolve(r, d.id), t = path.join(c.content, 'addons', deployed);
                const [a, b] = await Promise.all([regular(f), regular(t)]);
                if (a.dev === b.dev && a.ino === b.ino)
                  freedBytes += d.bytes;
              }
            }
        };
        if (apply)
          await m.mutation(r, confirmation, run);
        else
          await run();
      }
      items.push({ kind, label: labels[keys.indexOf(kind)], bytes, files });
    }
    if (apply)
      this.notify();
    return apply ? { freedBytes } : { items, totalBytes: items.reduce((a, i) => a + i.bytes, 0) };
  }
  busy() { return this.s.piBusy || this.s.tasks.live.size || [...this.s.tasks.records.values()].some(r => ['queued', 'running', 'verifying'].includes(r.state)) || this.s.modManager.writers.size || this.s.modManager.readers.size || this.s.storageOps > 0; }
  async start(dest) {
    if (this.profileError)
      fail('storage_profile_pending', this.profileError);
    if (this.worker || this.busy())
      fail('storage_busy', '有下载、导入或解包正在运行。');
    if (typeof dest !== 'string' || !path.isAbsolute(dest) || dest.includes('\0') || dest.split(/[\\/]/).some(n => n === '..') ||
      process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(dest) || /[:*?"<>|]/.test(dest.slice(2))))
      fail('invalid_path', '请选择本机磁盘上的绝对路径。');
    dest = path.resolve(dest);
    const c = this.cfg, old = c.root;
    // A Windows folder picker can return the physical AppData path for our virtual one.
    for (const logical of new Set([this.base, ...this.roots])) {
      const physical = await fs.realpath(logical).catch(e => { if (e.code !== 'ENOENT') throw e; });
      if (!physical || same(physical, logical)) continue;
      if (same(physical, dest)) { dest = logical; break; }
      if (below(physical, dest) || below(dest, physical)) fail('invalid_path', '所选目录与现有存储目录重叠。');
    }
    if (c.move && !same(c.move.to, dest))
      fail('storage_busy', '请先继续上次搬家。');
    const game = await this.s.root().catch(() => this.s.settings.gameRoot || ''), protectedRoots = [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean);
    if (same(dest, path.parse(dest).root) || protectedRoots.some(p => same(p, dest) || below(p, dest)) ||
      !same(dest, this.base) && (below(this.base, dest) || below(dest, this.base)) ||
      game && (same(dest, game) || below(dest, game) || below(game, dest) && !(same(path.dirname(dest), path.join(game, 'left4dead2')) && (isFolder(dest, 'data') || recommended(game) && same(dest, recommended(game))))) ||
      this.roots.some(p => !same(p, dest) && (below(p, dest) || below(dest, p))))
      fail('invalid_path', '此目录与系统、游戏或现有存储目录重叠。');
    if (this.native)
      await this.native('freeze', {});
    const before = structuredClone(c);
    try {
      if (this.busy())
        fail('storage_busy', '有任务正在处理文件。');
      await this.claim(dest);
      const probe = path.join(dest, '.matcha-write-' + randomUUID());
      await fs.writeFile(probe, '', { flag: 'wx' });
      await fs.unlink(probe);
      c.pending = [...new Set([old, ...c.pending])].filter(p => !same(p, dest));
      c.root = dest;
      c.custom = c.custom || !same(dest, old);
      c.move = { from: c.move?.from || c.pending[0] || old, to: dest, state: 'moving', doneBytes: 0, totalBytes: 0 };
      await this.save();
      this.broadcast();
      this.notify();
      this.worker = this.migrate().catch(async (e) => { c.move ??= { from: old, to: dest, doneBytes: 0, totalBytes: 0 }; c.move.state = 'failed'; c.move.error = e.message; await this.save(); this.notify(); }).finally(() => { this.worker = null; });
      return { status: 'started' };
    }
    catch (e) {
      this.cfg = before;
      if (this.native && !before.move)
        await this.native('thaw', {});
      throw e;
    }
  }
  async migrate() {
    const c = this.cfg, m = c.move;
    for (const from of c.pending)
      m.totalBytes += await this.pending(from);
    const tick = n => { m.doneBytes += n; if (Date.now() - (this.lastEvent || 0) > 500) {
      this.lastEvent = Date.now();
      this.notify();
    } };
    for (const from of [...c.pending]) {
      if (!same(from, this.base) && (!await exists(from) || (await missing(path.join(await dirs(from), '.matcha-storage.json'), {})).owner !== 'Matcha storage v1'))
        fail('storage_conflict', '原存储盘已断开或缺少标记：' + from);
      const old = layout(this.base, from), next = this.paths;
      for (const k of Object.keys(old)) {
        const dir = old[k], to = next[k];
        const names = await exists(dir) ? await fs.readdir(await dirs(dir)) : [];
        if (c.unit?.kind === k && same(c.unit.root, from) && !names.includes(c.unit.name))
          names.unshift(c.unit.name);
        // Complete the journaled unit before starting another one.
        if (c.unit?.kind === k && same(c.unit.root, from))
          names.sort((a, b) => Number(b === c.unit.name) - Number(a === c.unit.name));
        for (const n of names) {
          if (!safeName(n))
            fail('unsafe_path', '存储条目名无效。');
          const src = path.join(dir, n), dst = path.join(to, n);
          if (!c.unit) {
            c.unit = { kind: k, root: from, name: n };
            if ((k === 'dll-intake' || k === 'dll-sources') && uuid.test(n)) {
              const receipt = await missing(path.join(this.s.settingsCache.receipts, k + '_' + n + '.json'), null);
              if (receipt) {
                const t = await tree(src, { strict: true }), rows = t.files.map(f => [f.r, f.stamp, f.size]).sort((a, b) => a[0].localeCompare(b[0]));
                if (JSON.stringify(rows) === JSON.stringify(receipt))
                  c.unit.cacheReceipt = receipt;
              }
            }
            if (k === 'gamemaps' && uuid.test(n)) {
              const r = await missing(path.join(src, 'receipt.json'), null);
              if (typeof r?.download?.path === 'string' && below(src, r.download.path) && await exists(r.download.path)) {
                const stat = await regular(r.download.path);
                c.unit.downloadOwned = r.downloadStamp ? stamp(stat) === r.downloadStamp : identity(stat) === r.identity;
                c.unit.archiveOwned = r.archiveStamp === stamp(stat);
              }
            }
            if (k === 'browser') {
              const row = (await this.browserRows()).find(r => r.id === n && typeof r.path === 'string' && same(path.dirname(r.path), src));
              if (row && await exists(row.path)) {
                const sig = stamp(await regular(row.path));
                c.unit.archiveOwned = row.archiveStamp === sig;
                c.unit.selectionOwned = row.selectionStamp === sig;
              }
            }
            await this.save();
          }
          else if (c.unit.kind !== k || !same(c.unit.root, from) || c.unit.name !== n)
            fail('storage_conflict', '上次搬家条目需要先恢复。');
          const proof = await exists(src) || await exists(this.log) ? await transfer(src, dst, this.log, tick) : null;
          await this.remap(k, n, src, dst, old, next, proof);
          delete c.unit;
          await this.save();
        }
      }
      c.pending = c.pending.filter(r => !same(r, from));
      await this.save();
    }
    this.bind();
    delete c.move;
    await this.save();
    this.broadcast();
    if (this.native)
      await this.native('thaw', {});
    this.notify();
  }
  async remap(k, n, src, dst, old, next, proof) {
    // Never mint a cleanup receipt for a different file that appeared mid-move.
    const initial = new Map(proof?.files.map(f => [f.r, f.stamp]));
    const rebased = (rel, before) => initial.get(rel) === before ? proof?.published?.[rel] ?? before : before;
    const replace = (v, a = src, b = dst) => typeof v === 'string' && (same(a, v) || below(a, v)) ? path.join(b, path.relative(a, v)) : v;
    if (k === 'browser') {
      const row = (await this.browserRows()).find(r => r.id === n && typeof r.path === 'string' && below(src, r.path));
      if (row) {
        const file = replace(row.path), patch = { path: file };
        if (await exists(file)) {
          const sig = stamp(await regular(file));
          if (row.archiveStamp)
            patch.archiveStamp = this.cfg.unit.archiveOwned && rebased(path.relative(src,row.path),row.archiveStamp) === sig ? sig : null;
          if (row.selectionStamp)
            patch.selectionStamp = this.cfg.unit.selectionOwned && rebased(path.relative(src,row.path),row.selectionStamp) === sig ? sig : null;
        }
        await this.patchBrowser(n, row.path, patch);
      }
    }
    if (k === 'gamemaps') {
      const f = path.join(dst, 'receipt.json'), r = await missing(f, null);
      if (r && typeof r.download?.path === 'string' && below(src, r.download.path)) {
        const newFile = replace(r.download.path);
        r.download.path = newFile;
        if (await exists(newFile) && this.cfg.unit.downloadOwned && rebased(path.relative(dst,newFile), r.downloadStamp ?? r.identity.split(':').slice(0,4).join(':')) === stamp(await regular(newFile))) {
          const st = await regular(newFile);
          r.identity = identity(st);
          r.downloadStamp = stamp(st);
          if (r.archiveStamp)
            r.archiveStamp = this.cfg.unit.archiveOwned ? stamp(st) : null;
        }
        if (r.result?.dir)
          r.result.dir = replace(r.result.dir);
        r.files = r.files.map(v => replace(v));
        r.imported = Object.fromEntries(Object.entries(r.imported).map(([p, v]) => [replace(p), v]));
        await writeJson(f, r);
      }
    }
    if (k === 'dll-intake' || k === 'dll-sources') {
      const f = path.join(dst, k === 'dll-intake' ? 'state.json' : 'source.json'), r = await missing(f, null);
      const expected = new Map((this.cfg.unit.cacheReceipt ?? []).map(([rel,sig])=>[rel,rebased(rel,sig)]));
      if (r) {
        const before = JSON.stringify(r);
        if (typeof r.source === 'string' && path.isAbsolute(r.source))
          for (const key of Object.keys(old)) {
            if (below(old[key], r.source)) { r.source = replace(r.source, old[key], next[key]); break; }
          }
        if (r.file)
          r.file = replace(r.file);
        if (r.image?.path)
          r.image.path = replace(r.image.path);
        if (r.preparedDirectory)
          r.preparedDirectory = replace(r.preparedDirectory);
        if (r.candidate?.directory)
          r.candidate.directory = replace(r.candidate.directory);
        if (JSON.stringify(r) !== before) {
          const rel=path.relative(dst,f), trusted=expected.get(rel)===stamp(await regular(f));
          await writeJson(f,r);
          if(trusted)expected.set(rel,stamp(await regular(f)));
        }
      }
      if (cachedReceipt(this.cfg.unit)) {
        const now = await tree(dst, { strict: true });
        if (expected.size===now.files.length && now.files.every(f=>expected.get(f.r)===f.stamp)) {
          const rows = now.files.map(f => [f.r, f.stamp, f.size]).sort((a, b) => a[0].localeCompare(b[0]));
          await writeJson(path.join(this.s.settingsCache.receipts, k + '_' + n + '.json'), rows);
        }
      }
    }
    let changed = false;
    for (const t of this.s.tasks.records.values()) {
      if (t.dir && below(src, t.dir) || t.dir && same(src, t.dir)) {
        t.dir = replace(t.dir);
        changed = true;
      }
    }
    if (changed)
      await this.s.tasks.save();
  }
}
