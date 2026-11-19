import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory, writeJson } from '../mods/files.mjs';
import { fail, relativePath, platformPath, readBytes } from './files.mjs';
import { digest } from './releases.mjs';

export const approved = confirmation => { if (confirmation?.approved !== true || confirmation.source !== 'user') fail('confirmation_required', '请先检查计划并确认此次平台操作。'); };
export const sameRoot = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
export async function gameFile(root, relative) {
  const file = await platformPath(root, relative);
  const data = file ? await readBytes(file, 64 * 1024 * 1024) : null;
  return { data, hash: data === null ? null : digest(data) };
}
async function durable(file, data) {
  const h = await fs.open(file, 'wx'); try { await h.writeFile(data); await h.sync(); } finally { await h.close(); }
}
export class PlatformTransactions {
  constructor({ dataDir, inspectGame, beforeWrite }) { this.base = path.join(dataDir, 'platforms/installs'); this.inspectGame = inspectGame; this.beforeWrite = beforeWrite; }
  folder(id) { if (!uuid(id)) fail('platform_ledger_invalid', '安装账本标识无效。'); return path.join(this.base, id); }
  async idle(root) { const game = await this.inspectGame(root); if (game.processes.length) fail('game_running', '请先退出游戏，再修改平台文件。'); return game; }
  async read(root, id = 'skeeto', { includeInactive = false } = {}) {
    try { await directory(this.base); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const found = [];
    for (const key of await fs.readdir(this.base)) {
      if (!uuid(key)) continue;
      const folder = await directory(this.folder(key));
      const file = await platformPath(folder, 'state.json'); if (!file) continue;
      const s = JSON.parse((await readBytes(file)).toString('utf8'));
      if (s.schema !== 1 || s.storeId !== key || typeof s.gameRoot !== 'string' || !Array.isArray(s.files) || !Array.isArray(s.createdDirs)) fail('platform_ledger_invalid', '平台安装账本需要检查。');
      if (s.id !== id || !sameRoot(s.gameRoot, root)) continue;
      const pending = !!await platformPath(folder, 'active.json');
      if (s.status === 'installed' || pending || includeInactive) found.push({ ...s, pending });
    }
    if (found.filter(s => s.status === 'installed' || s.pending).length > 1) fail('platform_ledger_invalid', '此游戏存在多份活动安装账本。');
    return found.find(s => s.status === 'installed' || s.pending) ?? found.at(-1) ?? null;
  }
  async stored(storeId, relative, expected) {
    const file = await platformPath(this.folder(storeId), relative);
    if (!file) fail('platform_backup_missing', '平台恢复备份缺失。');
    const bytes = await readBytes(file, 64 * 1024 * 1024);
    if (digest(bytes) !== expected) fail('platform_backup_changed', '平台恢复备份与账本有差异。');
    return bytes;
  }
  async lock(fn) {
    await fs.mkdir(this.base, { recursive: true }); await directory(this.base);
    const file = path.join(this.base, 'operation.lock'), token = randomUUID();
    let h;
    try { h = await fs.open(file, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const existing = await platformPath(this.base, 'operation.lock');
      const old = JSON.parse((await readBytes(existing)).toString('utf8'));
      let dead = false;
      if (old.owner === 'flare-platforms' && Number.isSafeInteger(old.pid) && old.pid > 0) { try { process.kill(old.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; } }
      if (!dead) fail('operation_in_progress', '另一项平台操作正在进行。');
      await fs.unlink(file); h = await fs.open(file, 'wx');
    }
    try { await h.writeFile(JSON.stringify({ owner: 'flare-platforms', pid: process.pid, token })); await h.sync(); } finally { await h.close(); }
    try { return await fn(); } finally { const current = JSON.parse(await fs.readFile(file, 'utf8')); if (current.token === token) await fs.unlink(file); }
  }
  async replace(root, entry, data, journal, folder, index) {
    relativePath(entry.path);
    const target = path.join(root, entry.path);
    // Parent directories are journaled before creation, so recovery can remove only empty owned directories.
    let parent = root;
    for (const part of entry.path.split('/').slice(0, -1)) {
      parent = path.join(parent, part);
      try { await directory(parent); }
      catch (e) {
        if (e.code !== 'ENOENT') throw e;
        const relative = path.relative(root, parent).replaceAll('\\', '/');
        if (!journal.createdDirs.includes(relative)) { journal.createdDirs.push(relative); await writeJson(path.join(folder, 'journal.json'), journal); }
        await fs.mkdir(parent);
      }
    }
    const temp = `${target}.flare-${journal.id}-${index}.tmp`;
    if (data === null) { if (await platformPath(root, entry.path)) await fs.unlink(target); return; }
    try { await durable(temp, data); await fs.rename(temp, target); }
    finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  async prune(root, dirs) {
    if (dirs.length) await this.idle(root);
    for (const relative of [...new Set(dirs)].sort((a, b) => b.length - a.length)) {
      relativePath(relative);
      await platformPath(root, `${relative}/.flare-directory-check`);
      try { await directory(path.join(root, relative)); await fs.rmdir(path.join(root, relative)); }
      catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
    }
  }
  async rollback(journal, folder) {
    await this.idle(journal.gameRoot);
    // Preflight all files before restoring any, retaining external edits for the user.
    for (const e of journal.entries) {
      const current = await gameFile(journal.gameRoot, e.path);
      if (![e.before, e.after].includes(current.hash)) fail('platform_recovery_required', `操作后文件又有修改，保留现场：${e.path}`);
      if (e.before !== null) await this.stored(journal.storeId, `${journal.relative}/${e.backup}`, e.before);
    }
    for (let i = journal.entries.length - 1; i >= 0; i--) {
      const e = journal.entries[i]; await this.idle(journal.gameRoot);
      const current = await gameFile(journal.gameRoot, e.path);
      if (![e.before, e.after].includes(current.hash)) fail('platform_recovery_required', `恢复期间文件有修改：${e.path}`);
      if (current.hash !== e.before) await this.replace(journal.gameRoot, e, e.before === null ? null : await this.stored(journal.storeId, `${journal.relative}/${e.backup}`, e.before), journal, folder, i);
      const tempRelative = `${e.path}.flare-${journal.id}-${i}.tmp`;
      const temp = await platformPath(journal.gameRoot, tempRelative);
      if (temp) { const b = await readBytes(temp, 64 * 1024 * 1024); if (![e.before, e.after].includes(digest(b))) fail('platform_recovery_required', '暂存文件发生外部修改。'); await fs.unlink(temp); }
    }
    await this.prune(journal.gameRoot, journal.createdDirs);
    await writeJson(path.join(this.folder(journal.storeId), 'state.json'), journal.previous);
    journal.status = 'rolled-back'; await writeJson(path.join(folder, 'journal.json'), journal);
    await fs.unlink(path.join(this.folder(journal.storeId), 'active.json'));
  }
  // Caller owns the cross-process lock and checks its preview revision before entry.
  async apply(previous, next, changes, ctx) {
    const root = previous.gameRoot, store = this.folder(previous.storeId);
    await this.idle(root);
    await fs.mkdir(store, { recursive: true }); await directory(store);
    if (await platformPath(store, 'active.json')) fail('platform_recovery_required', '请先恢复上次中断的平台操作。');
    if (!await platformPath(store, 'state.json')) await writeJson(path.join(store, 'state.json'), previous);
    const txId = randomUUID(), relative = `transactions/${txId}`, folder = path.join(store, relative);
    await fs.mkdir(folder, { recursive: true }); await directory(folder);
    const journal = { schema: 1, id: txId, storeId: previous.storeId, gameRoot: root, relative, status: 'prepared', previous, next, createdDirs: [], entries: [] };
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i], current = await gameFile(root, change.path);
      if (current.hash !== change.before) fail('platform_plan_stale', `预览后文件发生变化：${change.path}`);
      const backup = `${i}-before.bin`;
      if (current.data !== null) await durable(path.join(folder, backup), current.data);
      if (current.data !== null) ctx.recordBackup?.(change.path, {file:relative+'/'+backup,hash:current.hash});
      const entry = { path: change.path, before: current.hash, after: change.data === null ? null : digest(change.data), backup };
      journal.entries.push(entry);
      const tracked = next.files.find(f => f.path === change.path);
      if (tracked && tracked.original === undefined) { tracked.original = current.hash; tracked.backup = current.hash === null ? null : `${relative}/${backup}`; }
    }
    next.revision = randomUUID();
    await writeJson(path.join(folder, 'journal.json'), journal);
    await writeJson(path.join(store, 'active.json'), { transactionId: txId });
    try {
      for (let i = 0; i < changes.length; i++) {
        await this.idle(root); await this.beforeWrite?.(i, changes[i]);
        if ((await gameFile(root, changes[i].path)).hash !== changes[i].before) fail('platform_plan_stale', '写入前文件已变化，请重新预览。');
        if (journal.entries[i].before !== journal.entries[i].after) await this.replace(root, journal.entries[i], changes[i].data, journal, folder, i);
        ctx.progress({ state: 'verifying', done: i + 1, total: changes.length, unit: 'files' });
      }
      for (const e of journal.entries) if ((await gameFile(root, e.path)).hash !== e.after) fail('platform_write_failed', `写入后核对失败：${e.path}`);
      next.createdDirs = [...new Set([...previous.createdDirs, ...journal.createdDirs])];
      if (next.status === 'uninstalled') await this.prune(root, next.createdDirs);
      await writeJson(path.join(store, 'state.json'), next);
      journal.status = 'committed'; await writeJson(path.join(folder, 'journal.json'), journal);
      await fs.unlink(path.join(store, 'active.json'));
      return { status: next.status, enabled: next.enabled, version: next.version, ledger: path.join(store, 'state.json') };
    } catch (e) {
      // A completed ledger commit is a stable outcome; the recovery command only clears its pointer.
      if (journal.status === 'committed') fail('platform_recovery_required', '操作已提交，恢复命令将清理在途记录。');
      try { await this.rollback(journal, folder); }
      catch (recovery) { fail('platform_recovery_required', `${e.message}；恢复待处理：${recovery.message}`); }
      throw e;
    }
  }
  async recovery(root, id = 'skeeto') {
    await this.idle(root); const state = await this.read(root, id);
    if (!state?.pending) fail('platform_recovery_empty', '当前没有待恢复的平台操作。');
    const store = this.folder(state.storeId), active = JSON.parse((await readBytes(await platformPath(store, 'active.json'))).toString('utf8'));
    if (!uuid(active.transactionId)) fail('platform_ledger_invalid', '在途事务标识无效。');
    const relative = `transactions/${active.transactionId}`, folder = path.join(store, relative);
    const journal = JSON.parse((await readBytes(await platformPath(store, `${relative}/journal.json`))).toString('utf8'));
    if (journal.schema !== 1 || journal.id !== active.transactionId || journal.storeId !== state.storeId || !sameRoot(journal.gameRoot, root) || journal.relative !== relative || !Array.isArray(journal.entries)) fail('platform_ledger_invalid', '恢复事务与所选游戏有差异。');
    const files = [];
    for (const entry of journal.entries) {
      const current = await gameFile(root, entry.path);
      if (![entry.before, entry.after].includes(current.hash)) fail('platform_recovery_required', `请先检查外部修改：${entry.path}`);
      if (entry.before !== null) await this.stored(state.storeId, `${relative}/${entry.backup}`, entry.before);
      files.push({ path: entry.path, before: current.hash, after: journal.status === 'committed' ? entry.after : entry.before });
    }
    return { journal, folder, view: { transactionId: journal.id, status: journal.status, files } };
  }
  async recover(root, confirmation, expected, id = 'skeeto') {
    approved(confirmation);
    return this.lock(async () => {
      const { journal, folder, view } = await this.recovery(root, id);
      if (JSON.stringify(view) !== JSON.stringify(expected)) fail('platform_plan_stale', '恢复现场有变化，请重新预览。');
      if (journal.status === 'committed') { await fs.unlink(path.join(this.folder(journal.storeId), 'active.json')); return { status: 'committed' }; }
      await this.rollback(journal, folder); return { status: 'rolled-back' };
    });
  }
}
