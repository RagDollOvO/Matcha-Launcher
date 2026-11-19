// External installers own their files. Matcha records evidence under its data directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectPe } from '../core.mjs';
import { writeJson } from '../mods/files.mjs';
import { platformPath, relativePath, fail, skeetoCoreVersion } from './files.mjs';
import lockfile from 'proper-lockfile';
import { switchRecipe, readSwitch, applySwitch, verifiedVdf } from './pack-switch.mjs';

const key = p => p.replaceAll('\\', '/').toLowerCase();
const rootKey = p => key(path.resolve(p));
const grantScope=d=>d?.switching ? JSON.stringify([d.switching,d.files,d.source]) : '';
const str = (s, n) => typeof s === 'string' && s.trim() && s.length <= n && !/[\x00-\x08\x0b-\x1f]/.test(s);
function definition(raw, builtin) {
  if (raw?.id === builtin.id) return builtin;
  if (!raw || typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(raw.id) || !str(raw.name, 80) || !str(raw.source, 1500) ||
      !str(raw.launch, 300) || !str(raw.maintenance, 800) || !Array.isArray(raw.files) || !raw.files.length || raw.files.length > 24)
    fail('pack_invalid', '请填写平台 ID、名称、来源、启动方式、维护说明及关键文件。');
  const files = raw.files.map(f => {
    if (!f || !['entry', 'module', 'asset'].includes(f.role) || !/^[a-f0-9]{64}$/i.test(f.sha256)) fail('pack_invalid', '每个关键文件需要角色及发行包原件的 SHA-256。');
    return { path: relativePath(f.path), role: f.role, sha256: f.sha256.toLowerCase() };
  });
  if (!files.some(f => f.role === 'entry') || new Set(files.map(f => key(f.path))).size !== files.length) fail('pack_invalid', '请标出启动入口，并去掉重复路径。');
  if ((raw.enable || raw.disable) && !(str(raw.enable, 500) && str(raw.disable, 500))) fail('pack_invalid', '作者的启用与停用说明需成对提供。');
  const switching=switchRecipe(raw.switching,raw.id,files);
  return { id: raw.id, name: raw.name, source: raw.source, launch: raw.launch, maintenance: raw.maintenance, ...(switching && {switching}),
    ...(raw.enable && { enable: raw.enable, disable: raw.disable }), files };
}
export class PackRegister {
  constructor(dataDir, platforms) {
    this.file = path.join(dataDir, 'external-packs.json');
    this.modules = pid => platforms.getModules(pid);
    const a = platforms.adapter('skeeto');
    this.builtin = { id: a.id, name: a.name, author: a.source.author, source: a.source.repo, launch: '由玩家从 Steam 启动', maintenance: '使用作者发行包中的 Setup 维护或卸载。',
      switching:{kind:'park-entry',path:a.loader.file},
      files: [{ path: a.loader.file, role: 'entry', exports: a.loader.exports }, { path: a.detect.core, role: 'module', exports: a.detect.exports }] };
    this.cache = new Map(); this.plans = new Map();
  }
  async load() {
    try { const records = JSON.parse(await fs.readFile(this.file, 'utf8')); if (!Array.isArray(records)) throw new Error('外部整包记录格式异常'); return records; }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }
  async witness(root, f) {
    try {
      const file = await platformPath(root, f.path);
      if (!file) return {state:'missing'};
      const s = await fs.stat(file, { bigint: true });
      if (s.size > 256n * 1024n * 1024n) return {state:'unchecked'};
      const stamp = [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, f.sha256 ?? f.exports.join(',')].join(':');
      const cached = this.cache.get(file);
      if (cached?.stamp === stamp) return cached.evidence;
      let match;
      if (f.exports) {
        const pe = await inspectPe(file).catch(e => { if (e.code === 'invalid_pe') return null; throw e; });
        match = pe?.dll && pe.architecture === 'x86' && f.exports.every(x => pe.exports.includes(x));
      } else {
        const h = await fs.open(file, 'r'); const digest = createHash('sha256');
        try { for await (const part of h.createReadStream({ autoClose: false })) digest.update(part); } finally { await h.close(); }
        match = digest.digest('hex') === f.sha256;
      }
      const state = match ? 'match' : 'different';
      if (this.cache.size > 2048) this.cache.clear();
      const version = match && f === this.builtin.files[1] ? await skeetoCoreVersion(file).catch(()=>null) : null;
      const evidence = {state,...(version && {version})};
      this.cache.set(file, { stamp, evidence }); return evidence;
    } catch { return {state:'unchecked'}; }
  }
  async list(root, inspection, proposal, saved) {
    if (!root || !inspection) return [];
    const own = (saved ?? await this.load()).filter(r => r.root === rootKey(root));
    const defs = new Map([[this.builtin.id, this.builtin], ...own.map(r => [r.definition.id, definition(r.definition, this.builtin)])]);
    if (proposal) defs.set(proposal.id, proposal);
    const exe = path.join(root, 'left4dead2.exe');
    const proc = inspection.processes?.find(p => p.path && rootKey(p.path) === rootKey(exe));
    let observed;
    const rows = [];
    for (const d of defs.values()) {
      const sw=await readSwitch(root,d.switching);
      const files = await Promise.all(d.files.map(async f => {
        const parked=sw?.enabled===false && sw.rel && d.switching.path===f.path;
        return {path:f.path,role:f.role,...await this.witness(root,parked?{...f,path:sw.rel}:f),...(parked && {parked:true})};
      }));
      const state = files.every(f => f.state === 'missing') ? 'absent' : files.some(f => f.state === 'different') ? 'occupied' :
        files.some(f => f.state === 'unchecked') ? 'unchecked' : files.every(f => f.state === 'match') ? 'installed' : 'partial';
      if(d.switching?.kind==='park-entry' && d.id!==this.builtin.id && sw?.enabled!=null && state==='installed' &&
          !await verifiedVdf(sw.active??sw.parked,files).catch(()=>false))sw.reason='VDF 指向的 DLL 与已登记模块不符';
      const modules = files.filter(f => f.role === 'module');
      const modulePaths = (modules.length ? modules : files.filter(f => f.role === 'entry' && /\.dll$/i.test(f.path))).map(f => rootKey(path.join(root, f.path)));
      let runtime = proc ? 'unknown' : 'offline';
      if (proc && modulePaths.length && state === 'installed') {
        observed ??= await this.modules(proc.pid).catch(() => ({}));
        if (observed.path && rootKey(observed.path) === rootKey(exe) && Array.isArray(observed.modules)) {
          const mapped = new Set(observed.modules.map(rootKey));
          for (const f of files) if (/\.dll$/i.test(f.path)) f.mapped = mapped.has(rootKey(path.join(root, f.path)));
          runtime = modulePaths.every(p => mapped.has(p)) ? 'loaded' : 'not-seen';
        }
      }
      rows.push({ ...d, files, version:files.find(f=>f.version)?.version, state, runtime, conflicts: [],
        ...(sw && {control:{enabled:sw.enabled,reason:sw.reason??(state!=='installed'?'请先核对模组文件':''),pending:!!sw.pending}}),
        lastCheck: own.find(r => r.definition.id === d.id)?.lastCheck ?? null });
    }
    for (const a of rows) for (const b of rows) {
      if (a === b) continue;
      for (const f of a.files) if (b.files.some(g => (f.role === 'entry' || g.role === 'entry') && key(f.path) === key(g.path)))
        a.conflicts.push({ path: f.path, other: b.name, present: f.state !== 'missing' && !f.parked });
      if(a.switching?.kind==='ini-flag' && key(a.switching.path)===key(b.switching?.path??''))a.conflicts.push({path:a.switching.path,other:b.name,present:true});
    }
    return rows;
  }
  async setEnabled(root,id,enabled,inspect) {
    if(typeof enabled!=='boolean'||typeof id!=='string')fail('invalid_argument','需要模组 ID 和明确的启停状态。');
    const unlock=await lockfile.lock(root,{realpath:false,lockfilePath:path.join(root,'.matcha-dll-switch.lock')});
    try {
      const check=async()=>{
        const inspection=await inspect();
        if(!Array.isArray(inspection.processes)||inspection.processes.length)fail('game_running','请退出游戏和 Bridge 后再切换。');
        const row=(await this.list(root,inspection)).find(p=>p.id===id);
        if(!row?.control || row.control.enabled===null || row.control.reason || row.conflicts.length || row.state!=='installed')
          fail('switch_blocked',row?.conflicts.length?'入口归属重叠，请先核对。':row?.control?.reason || '尚未登记可用的启停方式。');
        return row;
      };
      const before=await check();
      await applySwitch(root,before.switching,enabled,async()=>{
        const row=await check();if(JSON.stringify(row.switching)!==JSON.stringify(before.switching)||row.control.enabled!==before.control.enabled)
          fail('switch_stale','启停方式或状态发生变化，请刷新后再试。');
      });
      const after=(await this.list(root,await inspect())).find(p=>p.id===id);
      if(after?.control?.enabled!==enabled || after.control.reason || after.control.pending)fail('switch_stale','文件状态已变化，请刷新核对。');
      return after;
    }finally{await unlock();}
  }
  async preview(root, inspection, raw) {
    const saved = await this.load();
    const previous = saved.find(r => r.root === rootKey(root) && r.definition.id === raw?.id);
    const d = definition(previous ? {...previous.definition,...raw} : raw, this.builtin);
    if(previous?.definition.switching && grantScope(previous.definition)!==grantScope(d)){
      const prior=await readSwitch(root,previous.definition.switching);
      if(prior?.enabled!==true || prior.pending)fail('switch_stale','请先恢复原入口，再修改启停方式。');
    }
    const row = (await this.list(root, inspection, d, saved)).find(r => r.id === d.id);
    if (!row) fail('pack_no_game', '请先选择有效游戏目录。');
    const now = Date.now(); for (const [id, p] of this.plans) if (p.until < now) this.plans.delete(id);
    const planId = randomUUID();
    this.plans.set(planId, { until: now + 600000, root: rootKey(root), d, row, before: saved.find(r => r.root === rootKey(root) && r.definition.id === d.id) });
    return { planId, root, row };
  }
  review(root, planId) {
    const p = this.plans.get(planId);
    if (!p || p.root !== rootKey(root) || p.until < Date.now()) fail('pack_stale', '请重新核对本次记录。');
    return { root, row: p.row, newSwitch: p.d.id!==this.builtin.id && !!p.d.switching && grantScope(p.d)!==grantScope(p.before?.definition) };
  }
  async save(root, inspection, planId, confirmation) {
    const p = this.plans.get(planId); this.plans.delete(planId);
    if (confirmation?.approved !== true || !['user','full-access'].includes(confirmation.source)) fail('confirmation_required', '保存记录需要确认。');
    if (!p || p.root !== rootKey(root) || p.until < Date.now()) fail('pack_stale', '请重新核对本次记录。');
    if(p.d.switching && p.d.id!==this.builtin.id && grantScope(p.d)!==grantScope(p.before?.definition)){
      if(confirmation.source!=='user')fail('confirmation_required','请核对首次登记的启停方式。');
      if(p.row.control?.enabled===null || p.row.control?.reason || p.row.conflicts.length)fail('switch_blocked','现场与启停方式不符，请先核对入口。');
    }
    const saved = await this.load(), old = saved.find(r => r.root === p.root && r.definition.id === p.d.id);
    const row = (await this.list(root, inspection, p.d, saved)).find(r => r.id === p.d.id);
    if (JSON.stringify(p.before) !== JSON.stringify(old) || JSON.stringify(row) !== JSON.stringify(p.row)) fail('pack_stale', '记录或现场状态已改变，请重新核对。');
    const lastCheck = { at: new Date().toISOString(), state: row.state, runtime: row.runtime };
    await writeJson(this.file, [...saved.filter(r => r !== old), { root: p.root, definition: p.d, lastCheck }]);
    return { ...row, lastCheck };
  }
}
