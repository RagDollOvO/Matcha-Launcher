import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PlatformTransactions, approved, gameFile, sameRoot } from './platforms/transactions.mjs';
import { platformPath, readBytes, fail } from './platforms/files.mjs';
import { localL4n, localRender } from './local-render.mjs';
import { NativeCache } from './platforms/native-cache.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
const loaders = new Set(['left4dead2.exe', 'bin/left4neko.dll',
  'left4dead2/bin/game_shader_generic_neko.dll', 'left4dead2/bin/game_shader_generic_neko']);
const ctx = { progress() {} };

/** Desktop package adapter only. L4N retains its own launcher and settings. */
export class NativeLibraries {
  constructor({ dataDir, inspectGame, distRoot, vendorRoot = path.join(project, 'vendor'), fetch = globalThis.fetch }) {
    this.store = new PlatformTransactions({ dataDir, inspectGame });
    this.dist = distRoot; this.vendor = vendorRoot; this.plans = new Map();
    this.cache = new NativeCache(dataDir, vendorRoot, fetch);
  }
  async catalog() {
    const file = await platformPath(this.vendor, 'native-libraries.json');
    if (!file) fail('library_package_missing', '随包组件缺失，请使用完整的 Matcha 便携目录。');
    const c = JSON.parse((await readBytes(file)).toString('utf8'));
    if (c.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(c.l4n?.version) ||
      c.l4n.folder !== `l4n/${c.l4n.version}` || !Array.isArray(c.l4n.files) || c.l4n.files.some(f=>['d3d9.dll','dxvk_d3d9.dll','dxvk.conf','dxvk.dll'].includes(path.win32.basename(f).toLowerCase())))
      fail('library_package_invalid', '组件来源记录需要检查。');
    return c;
  }
  async snapshot(root, inspection) {
    const c = await this.catalog();
    const {availability,info}=await this.cache.locate('l4n',c.l4n);
    const l4n={id:'l4n',name:'L4N',availableVersion:c.l4n.version,source:c.l4n.source,sourceKind:c.l4n.sourceKind,
      installed:false,enabled:false,version:null,pending:false,features:c.l4n.features,availability,download:availability==='missing'?info:null};
    const dxvk={id:'dxvk',name:'DXVK',installed:false,enabled:false,version:null,entries:[],readOnly:true,pending:false};
    const base={packaged:availability==='bundled',runtimeUpdateAvailable:false,l4n,dxvk};
    if (!root || !inspection) return base;
    const state=await this.store.read(root,'l4n'), local=await localL4n(root);
    Object.assign(l4n,local,{unmanaged:local.installed && state?.status!=='installed',pending:!!state?.pending});
    if(state?.status==='installed' && !local.installed && !state.enabled) Object.assign(l4n,{installed:true,enabled:false,version:state.version});
    if(l4n.version && !l4n.unmanaged && c.l4n.version.localeCompare(l4n.version,'en',{numeric:true})>0) l4n.download=info;
    dxvk.entries=await localRender(root);
    dxvk.installed=dxvk.entries.some(e=>e.kind==='dxvk');
    dxvk.version=dxvk.entries.find(e=>e.kind==='dxvk'&&e.route==='default')?.version??null;
    dxvk.pending=!!(await this.store.read(root,'dxvk'))?.pending;
    return base;
  }
  async build(root, id, enabled) {
    if(id!=='l4n') fail('renderer_read_only','渲染入口由游戏管理，Matcha 仅读取本机版本。');
    if(typeof enabled!=='boolean') fail('library_invalid','请选择 L4N 启停状态。');
    const game=await this.store.idle(root); root=game.gameRoot;
    const prior = await this.store.read(root, id);
    if (prior?.pending) fail('platform_recovery_required', '请先恢复这项组件的在途操作。');
    const previous = prior ?? { schema: 1, id, storeId: randomUUID(), gameRoot: root, status: 'uninstalled', revision: null, files: [], createdDirs: [], enabled: false };
    const next = structuredClone(previous), changes = [];
    delete next.pending;
    const c = await this.catalog();
    const change = async (relative, data, { track = true } = {}) => {
      const current = await gameFile(root, relative);
      const old = previous.files.find(f => f.path.toLowerCase() === relative.toLowerCase());
      if (old && current.hash !== old.hash) fail('library_external_change', `已安装文件有外部修改，请保留并检查：${relative}`);
      let record = next.files.find(f => f.path.toLowerCase() === relative.toLowerCase());
      if (track && !record) { record = { path: relative }; next.files.push(record); }
      if (record) record.hash = hash(data);
      if (current.hash !== hash(data) || track && !old) changes.push({ path: relative, before: current.hash, data });
    };
    if (id === 'l4n') {
      if (!prior) {
        const exe = await gameFile(root, 'left4dead2.exe');
        if (exe.data?.includes(Buffer.from('left4neko.dll'))) fail('l4n_unmanaged', '此目录已有独立安装的 L4N。请先保存配置并还原 Steam 原版 EXE，再由 Matcha 接管，以便总开关恢复原入口。');
      }
      const install = previous.status !== 'installed' || enabled && previous.version !== c.l4n.version;
      if (previous.status !== 'installed' && !enabled) fail('library_not_installed', '请先安装 L4N，再切换总开关。');
      if (enabled) {
        const payload = await this.cache.locate(id,c.l4n);
        if(!payload.root) fail('library_package_missing','请先下载 L4N 整包。');
        for (const relative of c.l4n.files) {
          if (!install && !loaders.has(relative)) continue;
          if (relative === 'left4dead2/neko/config.vdf' && await platformPath(root, relative)) continue;
          await change(relative,await this.cache.payload(payload,relative));
        }
      } else {
        for (const f of previous.files.filter(f => loaders.has(f.path)))
          await change(f.path, f.original === null ? null : await this.store.stored(previous.storeId, f.backup, f.original));
      }
      next.version = enabled ? c.l4n.version : previous.version;
    }
    next.status = 'installed'; next.enabled = enabled;
    return { previous, next, changes };
  }
  view(built) {
    return { id: built.next.id, enabled: built.next.enabled, version: built.next.version,
      files: built.changes.map(f => ({ path: f.path, action: f.data === null ? 'restore/remove' : f.before === null ? 'create' : 'replace', bytes: f.data?.length ?? 0, before: f.before, after: hash(f.data) })) };
  }
  async preview(root, id, enabled) {
    const built = await this.build(root, id, enabled), view = this.view(built), planId = randomUUID();
    this.plans.set(planId, { root: built.previous.gameRoot, id, enabled, view, revision: built.previous.revision, at: Date.now() });
    if (this.plans.size > 30) this.plans.delete(this.plans.keys().next().value);
    return { ...view, planId };
  }
  async apply(root, planId, confirmation) {
    approved(confirmation);
    return this.store.lock(async () => {
      const plan = this.plans.get(planId);
      if (!plan || Date.now() - plan.at > 15 * 60 * 1000 || !sameRoot(root, plan.root)) fail('library_plan_stale', '请重新预览组件操作。');
      const built = await this.build(root, plan.id, plan.enabled);
      if (built.previous.revision !== plan.revision || JSON.stringify(this.view(built)) !== JSON.stringify(plan.view)) fail('library_plan_stale', '预览后文件有变化，请重新确认。');
      const result = await this.store.apply(built.previous, built.next, built.changes, ctx);
      this.plans.delete(planId); return result;
    });
  }
  async recover(root, id, confirmation) {
    if (!['l4n', 'dxvk', 'flare-runtime'].includes(id)) fail('library_invalid', '组件名称无效。');
    const { view } = await this.store.recovery(root, id);
    return this.store.recover(root, confirmation, view, id);
  }
}
