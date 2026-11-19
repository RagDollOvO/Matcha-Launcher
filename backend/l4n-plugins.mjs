import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectPe, errorRecord } from './core.mjs';
import { regular, identity } from './mods/vpk.mjs';
import { directory } from './mods/files.mjs';
import { PlatformTransactions, approved, gameFile, sameRoot } from './platforms/transactions.mjs';
import { digest } from './platforms/releases.mjs';
import { fail, platformPath, readBytes, relativePath } from './platforms/files.mjs';
import { dllLoadStatus } from './dll-status.mjs';
import { folderName } from './legacy-names.mjs';

const ledgerId = 'l4n-plugins';
const activeFolder = 'bin/neko/plugins';
// Filename-derived identity stays stable across updates; encode it portably.
const idFor = file => `l4n.${Buffer.from(file.toLowerCase()).toString('hex')}`;
const key = file => path.resolve(file).replace(/^\\\\\?\\/, '').toLowerCase();
const progress = { progress() {} };
function filename(file) {
  if (typeof file !== 'string' || file !== path.basename(file) || !/\.dll$/i.test(file))
    fail('l4n_plugin_invalid', '请选择 L4N 插件 DLL。');
  if(file.toLowerCase()==='matcharuntime.dll') fail('l4n_plugin_reserved','Matcha Runtime 请在运行环境里管理。');
  relativePath(file);
  return file;
}
const activePath = file => `${activeFolder}/${filename(file)}`;
// 停用的插件放游戏根目录 .matcha-l4n-plugins/disabled（改名前是 .flare-l4n-plugins）。
const parkedPath = (root, file) => `${folderName(root, 'l4nPlugins')}/disabled/${filename(file)}`;

/** Manage whole L4N SDK DLLs without loading them in the launcher. */
export class L4nPlugins {
  constructor({ dataDir, inspectGame, beforeWrite }) {
    this.store = new PlatformTransactions({ dataDir, inspectGame, beforeWrite });
    this.plans = new Map();
  }
  async state(root) {
    const state = await this.store.read(root, ledgerId);
    if (!state) return null;
    if (!Array.isArray(state.plugins)) fail('l4n_plugin_ledger_invalid', 'L4N 子插件记录需要检查。');
    const seen = new Set();
    for (const p of state.plugins) {
      filename(p.file);
      if (p.id !== idFor(p.file) || typeof p.enabled !== 'boolean' || seen.has(p.id))
        fail('l4n_plugin_ledger_invalid', 'L4N 子插件身份或开关记录需要检查。');
      seen.add(p.id);
    }
    return state;
  }
  async validate(file) {
    const before = identity(await regular(file));
    filename(path.basename(file));
    const pe = await inspectPe(file);
    if (!pe.dll || pe.architecture !== 'x86' || !pe.exports.includes('GetL4NPluginInstance'))
      fail('l4n_plugin_invalid', '请选择导出 GetL4NPluginInstance 的 Windows x86 L4N 插件。');
    const bytes = await readBytes(file, 64 * 1024 * 1024);
    if (identity(await regular(file)) !== before) fail('file_changed', '插件文件已变化，请重新预览。');
    return bytes;
  }
  async entries(root, state) {
    const plugins = [...(state?.plugins ?? [])].map(p => ({ ...p, managed: true })), issues = [];
    // Check all ancestors before enumerating a plugin directory.
    await platformPath(root, `${activeFolder}/.flare-directory-check`);
    let files = [];
    try { files = await fs.readdir(await directory(path.join(root, activeFolder)), { withFileTypes: true }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const file of files.filter(f => /\.dll$/i.test(f.name))) {
      if (file.name.toLowerCase()==='matcharuntime.dll' || plugins.some(p => p.id === idFor(file.name))) continue;
      try {
        filename(file.name);
        const selected = await platformPath(root, activePath(file.name));
        const pe = await inspectPe(selected);
        if (!pe.dll || pe.architecture !== 'x86' || !pe.exports.includes('GetL4NPluginInstance')) continue;
        plugins.push({ id: idFor(file.name), file: file.name, enabled: true, managed: false });
      } catch (e) { issues.push({ ...errorRecord(e), file: file.name }); }
    }
    return { plugins: plugins.sort((a, b) => a.id.localeCompare(b.id)), issues };
  }
  async snapshot(root, { inspection, runtime, host } = {}) {
    if (!root) return { hostEnabled: false, pending: false, plugins: [], issues: [] };
    inspection ??= await this.store.inspectGame(root);
    root = inspection.gameRoot;
    const state = await this.state(root), inventory = await this.entries(root, state);
    let hostEnabled = host?.enabled;
    if (hostEnabled === undefined) {
      const entry = await platformPath(root, 'left4dead2.exe');
      hostEnabled = !!await platformPath(root, 'bin/left4neko.dll') && !!entry &&
        (await readBytes(entry, 64 * 1024 * 1024)).includes(Buffer.from('left4neko.dll'));
    }
    const running = inspection.processes.some(p => p.path && key(p.path) === key(path.join(root, 'left4dead2.exe')));
    const external = runtime?.externalModules;
    const observed = running && external?.observed === true;
    const loaded = new Set((observed ? external.l4nPlugins ?? [] : []).map(key));
    const plugins = [];
    for (const p of inventory.plugins) {
      const active = await platformPath(root, activePath(p.file)), parked = await platformPath(root, parkedPath(root, p.file));
      const error = active && parked ? { code: 'l4n_plugin_conflict', message: '加载目录和停用目录同时存在此 DLL，请保留文件并核对。' }
        : !(p.enabled ? active : parked) ? { code: 'l4n_plugin_missing', message: '插件文件位置与开关记录有差异，请核对原文件。' } : undefined;
      const current = loaded.has(key(path.join(root, activePath(p.file)))) ? { state: 'loaded', mapped: true } : undefined;
      const status = dllLoadStatus({ host: 'l4n', loadKind: 'library', enabled: p.enabled, running,
        hostEnabled: observed ? external.l4nLoaded : hostEnabled, connected: observed, observed: current, error });
      plugins.push({ ...p, canRollback:!!p.previousBinary, name: path.basename(p.file, path.extname(p.file)), host: 'l4n', loadKind: 'l4n-sdk',
        version: null, installed: true, entry: activePath(p.file), parkedPath: parkedPath(root, p.file),
        runtimeState: current?.state ?? 'unobserved', loadStatus: status, ...(error ? { error: error.message } : {}) });
    }
    return { hostEnabled, pending: state?.pending === true, plugins, issues: inventory.issues };
  }
  async build(root, request) {
    const inspection = await this.store.idle(root); root = inspection.gameRoot;
    const prior = await this.state(root);
    if (prior?.pending) fail('platform_recovery_required', '请先恢复上次未完成的 L4N 子插件操作。');
    const previous = prior ?? { schema: 1, id: ledgerId, storeId: randomUUID(), gameRoot: root,
      status: 'installed', revision: null, files: [], createdDirs: [], plugins: [], enabled: true };
    const next = structuredClone(previous), changes = [];
    delete next.pending;
    let selected;
    const change = async (relative, data) => {
      const current = await gameFile(root, relative), old = previous.files.find(f => f.path.toLowerCase() === relative.toLowerCase());
      if (old && old.hash !== current.hash) fail('l4n_plugin_external_change', `文件有外部修改，已保留：${relative}`);
      let tracked = next.files.find(f => f.path.toLowerCase() === relative.toLowerCase());
      if (!tracked) { tracked = { path: relative }; next.files.push(tracked); }
      tracked.hash = data === null ? null : digest(data);
      if (!old || current.hash !== tracked.hash) changes.push({ path: relative, before: current.hash, data });
    };
    if (request.operation === 'import') {
      if (typeof request.file !== 'string') fail('l4n_plugin_invalid', '请选择 L4N 插件文件。');
      const file = filename(path.basename(request.file)), id = idFor(file);
      if (previous.plugins.some(p => p.id === id) || await platformPath(root, activePath(file)) || await platformPath(root, parkedPath(root, file)))
        fail('l4n_plugin_exists', '同名 L4N 插件已存在，请先核对现有文件。');
      const bytes = await this.validate(path.resolve(request.file));
      selected = { id, file, enabled: false }; next.plugins.push(selected);
      await change(parkedPath(root, file), bytes);
    } else if (request.operation === 'set-enabled' && typeof request.enabled === 'boolean') {
      const inventory = await this.entries(root, previous);
      const found = inventory.plugins.find(p => p.id === request.pluginId);
      if (!found) fail('l4n_plugin_missing', '请刷新 L4N 子插件列表。');
      const from = found.enabled ? activePath(found.file) : parkedPath(root, found.file);
      const to = found.enabled ? parkedPath(root, found.file) : activePath(found.file);
      const source = await platformPath(root, from);
      if (!source) fail('l4n_plugin_missing', `请核对插件文件：${from}`);
      if (await platformPath(root, to)) fail('l4n_plugin_conflict', `目标位置已有文件，已保留：${to}`);
      const bytes = await this.validate(source);
      selected = { ...previous.plugins.find(p=>p.id===found.id), id: found.id, file: found.file, enabled: request.enabled };
      const index = next.plugins.findIndex(p => p.id === found.id);
      if (index < 0) next.plugins.push(selected); else next.plugins[index] = selected;
      // Persist an unmanaged DLL's original bytes even for an unchanged switch.
      await change(from, found.enabled === request.enabled ? bytes : null);
      if (found.enabled !== request.enabled) await change(to, bytes);
    } else if(['update','rollback','uninstall'].includes(request.operation)) {
      selected=next.plugins.find(p=>p.id===request.pluginId);
      if(!selected)fail('l4n_plugin_unowned','请选择已由 Matcha 管理的子插件。');
      const file=selected.enabled?activePath(selected.file):parkedPath(root, selected.file);
      const other=selected.enabled?parkedPath(root, selected.file):activePath(selected.file);
      const current=await gameFile(root,file);
      if(!current.data || await platformPath(root,other) || !previous.files.some(f=>f.path===file&&f.hash===current.hash))
        fail('l4n_plugin_external_change','现有 DLL 与记录有变化，请先核对。');
      let replacement=null;
      if(request.operation==='update') {
        if(typeof request.file!=='string'||!path.isAbsolute(request.file)||idFor(filename(path.basename(request.file)))!==selected.id)
          fail('l4n_plugin_invalid','请选择同名的新版 L4N 子插件。');
        replacement=await this.validate(request.file);
      } else if(request.operation==='rollback'){
        const old=selected.previousBinary;
        if(!old||!/^transactions\/[0-9a-f-]{36}\/\d+-before\.bin$/.test(old.file))fail('backup_missing','这个子插件还没有版本备份。');
        replacement=await this.store.stored(previous.storeId,old.file,old.hash);
      } else next.plugins=next.plugins.filter(p=>p.id!==selected.id);
      if(replacement && digest(replacement)===current.hash)fail('l4n_plugin_unchanged','选中的 DLL 与当前文件相同。');
      await change(file,replacement);
    } else fail('l4n_plugin_invalid', '请选择有效的子插件操作。');
    return { previous, next, changes, selected, operation: request.operation };
  }
  view(built) {
    return { operation: built.operation, plugin: built.selected, applies: 'next-launch',
      files: built.changes.map(f => ({ path: f.path, action: f.data === null ? 'remove' : f.before === null ? 'create' : 'replace',
        bytes: f.data?.length ?? 0, before: f.before, after: f.data === null ? null : digest(f.data) })) };
  }
  async preview(root, request) {
    const built = await this.build(root, request), view = this.view(built), planId = randomUUID();
    this.plans.set(planId, { root: built.previous.gameRoot, request: { ...request }, view, revision: built.previous.revision, at: Date.now() });
    if (this.plans.size > 30) this.plans.delete(this.plans.keys().next().value);
    return { ...view, planId };
  }
  async apply(root, planId, confirmation) {
    approved(confirmation);
    return this.store.lock(async () => {
      const plan = this.plans.get(planId);
      if (!plan || Date.now() - plan.at > 15 * 60 * 1000 || !sameRoot(root, plan.root))
        fail('l4n_plugin_plan_stale', '请重新预览 L4N 子插件操作。');
      const built = await this.build(root, plan.request);
      if (built.previous.revision !== plan.revision || JSON.stringify(this.view(built)) !== JSON.stringify(plan.view))
        fail('l4n_plugin_plan_stale', '预览后的文件或开关已有变化，请重新确认。');
      const ctx={...progress,recordBackup:(_path,backup)=>{
        if(['update','rollback'].includes(built.operation))built.selected.previousBinary=backup;
      }};
      const result = await this.store.apply(built.previous, built.next, built.changes, ctx);
      this.plans.delete(planId);
      return { ...result, pluginId: built.selected.id, enabled: built.selected.enabled, applies: 'next-launch' };
    });
  }
  async recover(root, confirmation) {
    approved(confirmation);
    const { view } = await this.store.recovery(root, ledgerId);
    return this.store.recover(root, confirmation, view, ledgerId);
  }
}
