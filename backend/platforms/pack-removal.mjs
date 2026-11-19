import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { directory, writeJson } from '../mods/files.mjs';
import { addonKey, readAddonList } from '../mods/addonlist.mjs';
import { fail, platformPath, relativePath, readBytes } from './files.mjs';
import { approved } from './transactions.mjs';
import { readSwitch } from './pack-switch.mjs';

const key = p => p.replaceAll('\\', '/').toLowerCase();
const stamp = s => [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const gone = e => { if (e.code !== 'ENOENT') throw e; return null; };
async function folder(root, rel) {
  let dir = await directory(root);
  for (const part of relativePath(rel).split('/')) {
    dir = await directory(path.join(dir, part)).catch(gone);
    if (!dir) return null;
  }
  return dir;
}
const sdkFiles = ['skeeto_setting.ini','skeeto_setting.ini.before-key-cleanup.bak','skeeto.ini','skeeto_install.txt',
  'skeeto_ws_show_changelog.txt','skeeto_ws_changelog_shown.txt','skeeto_apply_update.bat','Skeeto_更新日志.txt',
  'Skeeto_使用说明.txt','Skeeto_指令速查.txt','Skeeto_常见问题与解决办法_FAQ_and_Troubleshooting.txt','skeeto_bootstrap_probe.log',
  '安装 Install Skeeto.bat','卸载 Uninstall Skeeto.bat','start_skeeto.bat','start_skeeto_with_update.bat','left4dead2_skeeto.exe'];
const genericOwned = (id, rel) => rel.startsWith('left4dead2/addons/'+id+'/') && id !== 'workshop' ||
  rel === 'left4dead2/addons/'+id+'.vdf' || rel === 'bin/neko/plugins/'+id+'.dll';

// An uninstall accepts only a short-lived, server-owned inventory. Registered hashes
// are lookup evidence, not permission to erase arbitrary game files or run a script.
export class PackRemoval {
  constructor(service) { this.s = service; this.plans = new Map(); }
  async idle(root) {
    const g = await this.s.core.inspectGame(root);
    if (!Array.isArray(g.processes) || g.processes.length) fail('game_running','请退出游戏和测试进程，再卸载平台。');
    return g;
  }
  async scan(root,id) {
    const s=this.s, reg=s.packRegister, inspection=await this.idle(root);
    const records=await reg.load(), mine=records.find(r=>r.root===key(path.resolve(root)) && r.definition.id===id);
    if(id!==reg.builtin.id && !mine) fail('pack_missing','当前游戏没有这个平台的登记。');
    const rows=await reg.list(root,inspection,undefined,records), row=rows.find(p=>p.id===id);
    if(!row) fail('pack_missing','未找到平台。');
    const files=new Map(), dirs=[], retained=[], blocked=[], shared=new Set(rows.filter(p=>p.id!==id && (p.lastCheck || p.files.some(f=>f.state==='match'))).flatMap(p=>[...p.files.map(f=>key(f.path)),...(p.switching?[key(p.switching.path)]:[])]));
    const add=async(rel,reason)=>{
      if(shared.has(key(rel))) {blocked.push(rel+'（其他平台也使用）');return;}
      const file=await platformPath(root,rel); if(!file)return;
      const st=await fs.lstat(file,{bigint:true});
      files.set(key(rel),{path:rel,reason,bytes:Number(st.size),stamp:stamp(st)});
    };
    const visit=async(rel,declaredOnly=false)=>{
      const dir=await folder(root,rel);if(!dir)return;
      for(const e of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        const child=rel+'/'+e.name;
        if(e.isSymbolicLink() || !e.isFile()&&!e.isDirectory())fail('unsafe_path','平台目录含链接或特殊文件：'+child);
        if(e.isDirectory())await visit(child,declaredOnly);
        else if(!declaredOnly)await add(child,'平台专属目录（含配置和自定义资源）');
        else if(!files.has(key(child)))blocked.push(child+'（未列入发行文件清单）');
      }
      dirs.push(rel);
    };
    const builtin=id===reg.builtin.id;
    const legacy=builtin ? await s.platformLifecycle?.find(root,id) : null;
    if(legacy?.pending)fail('platform_recovery_required','先在平台维护中恢复上次中断的操作。');
    const ledger=legacy?.status==='installed' ? await s.platformLifecycle.build(root,id,'uninstall') : null;
    const managed=new Set((ledger ? legacy.files : []).map(f=>key(f.path)));
    for(const r of managed)if(shared.has(r))blocked.push(r+'（安装账本与其他平台重叠）');
    const sw=await readSwitch(root,row.switching);
    if(sw?.pending)fail('switch_stale','请先完成中断的入口切换。');
    if(row.switching?.kind==='park-entry' && !sw?.rel){
      const r=row.switching.path, dir=await folder(root,path.posix.dirname(r));
      if(dir && (await fs.readdir(dir)).some(n=>key(n).startsWith(key(path.posix.basename(r))+'.matcha-off-')))blocked.push(r+'（暂存入口有冲突）');
    }
    for(const f of row.files){
      const r=f.parked ? sw?.rel : f.path;
      if(!r || managed.has(key(f.path)) || f.state==='missing')continue;
      if(f.state!=='match'){
        if(builtin && f.state==='different' && key(f.path)==='bin/wininet.dll')retained.push(f.path+'（非本平台代理）');
        else blocked.push(f.path+'（归属待核对）');
        continue;
      }
      if(!builtin && !genericOwned(id,key(f.path)))blocked.push(f.path+'（须按作者安装清单核对所有权）');
      else await add(r,f.parked?'停用时暂存的入口':'已核验的发行文件');
    }
    if(row.switching?.kind==='ini-flag' && await platformPath(root,row.switching.path)){
      if(sw?.enabled==null)blocked.push(row.switching.path+'（配置与登记的开关键不符）');
      else await add(row.switching.path,'已登记的专属开关配置');
    }
    if(builtin){
      for(const r of ['Skeeto','bin/skeeto','left4dead2/skeeto','skeeto_update'])await visit(r);
      for(const r of sdkFiles)await add(r,'Skeeto 专属文件');
      for(const [r,re] of [['VERSION.txt',/^\uFEFF?Skeeto\b/im],['SKEETO_WORKSHOP.txt',/^SkeetoWorkshopPackage=1\r?$/m],['Setup_安装 维护 卸载.bat',/Skeeto[\\/]Maintain\.ps1/i],['start_necola_with_update.bat',/Skeeto/i]]){
        const f=await platformPath(root,r);if(!f)continue;
        if((await fs.stat(f)).size<=512*1024 && re.test((await readBytes(f,512*1024)).toString('utf8')))await add(r,'作者维护文件');else retained.push(r+'（归属不符）');
      }
      for(const r of ['bin/neko/plugins/skeeto.dll','necola.dll']){
        const state=(await reg.witness(root,{...reg.builtin.files[1],path:r})).state;
        if(state==='match')await add(r,'已核验的旧入口');else if(state!=='missing')retained.push(r+'（非已识别核心）');
      }
      // Author transaction archives can contain originals belonging to another platform.
      const backup='skeeto_migrate_backup';
      if(await folder(root,backup)){
        if(await platformPath(root,backup+'/active.json'))blocked.push(backup+'（先完成作者工具中未结束的安装事务）');
        else retained.push(backup+'（安装前的恢复备份）');
      }
      for(const name of (await fs.readdir(root)).sort()){
        if(!/skeeto/i.test(name) || files.has(key(name)) || managed.has(key(name)) || dirs.some(d=>key(d)===key(name)) ||
           [...retained,...blocked].some(r=>key(r).startsWith(key(name)+'（')))continue;
        if(/\.(zip|7z|rar)$/i.test(name))retained.push(name+'（个人安装包归档）');
        else blocked.push(name+'（请核对未识别文件）');
      }
    }
    if(!builtin){
      // A named directory alone is not proof of ownership of its contents.
      const rel='left4dead2/addons/'+id;
      if(id!=='workshop' && row.files.some(f=>key(f.path).startsWith(rel+'/')))await visit(rel,true);
      if(row.switching?.kind==='ini-flag')await visit(path.posix.dirname(row.switching.path),true);
    }
    for(const k of managed)files.delete(k); // The existing ledger restores originals itself.
    const mods=builtin && s.modManager ? (await s.modManager.scan(root)).mods.filter(m=>m.kind==='platform-package' && m.platformId===id) : [];
    for(const m of mods)if(!m.fileCount || m.warning)blocked.push(m.file+'（更新包身份待核对）');
    const packages=mods.length ? (await s.modTrash.prepare(root,mods.map(m=>m.id))).records.map(r=>({id:r.modId,files:r.files,category:r.categoryId,profiles:r.profileIds,meta:r.meta})) : [];
    const listFile=mods.length && await platformPath(root,'left4dead2/addonlist.txt');
    const list=listFile ? await readAddonList(listFile) : null;
    const addonKeys=mods.map(m=>m.storage==='library'?m.deploymentFile:m.file).filter(f=>f && list?.values.has(addonKey(f)));
    const cleanupDirs=[...new Set(dirs)].sort((a,b)=>b.length-a.length || a.localeCompare(b));
    return {id,name:row.name,root,registration:mine??null,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),dirs:cleanupDirs,
      packages,addonKeys,legacy:ledger ? s.platformLifecycle.view(ledger,'uninstall',{}) : null,retained,blocked};
  }
  view(p) {return {id:p.id,name:p.name,root:p.root,files:p.files.map(f=>({path:f.path,reason:f.reason})),folders:p.dirs,
    packages:p.packages.map(m=>({id:m.id,files:m.files.map(f=>f.file)})),addonKeys:p.addonKeys,legacyFiles:p.legacy?.files??[],registered:!!p.registration,retained:p.retained,blocked:p.blocked};}
  async preview(root,id){
    const plan=await this.scan(root,id), planId=randomUUID();this.plans.set(planId,{at:Date.now(),plan});
    if(this.plans.size>20)this.plans.delete(this.plans.keys().next().value);
    return {...this.view(plan),planId};
  }
  async apply(root,planId,confirmation){
    approved(confirmation);
    const entry=this.plans.get(planId);this.plans.delete(planId);
    if(!entry || entry.plan.root!==root || Date.now()-entry.at>600000)fail('pack_stale','请重新预览卸载清单。');
    const s=this.s, p=entry.plan, reg=s.packRegister;
    const unlock=await lockfile.lock(root,{realpath:false,lockfilePath:path.join(root,'.matcha-dll-switch.lock')});
    try{
      const now=await this.scan(root,p.id);
      if(JSON.stringify(now)!==JSON.stringify(p))fail('pack_stale','文件或登记已变化，请重新预览卸载。');
      if(p.blocked.length)fail('pack_conflict','请先核对：'+p.blocked.join('、'));
      if(p.legacy){
        const {planId:legacyId,...view}=await s.platformLifecycle.preview(root,p.id,'uninstall');
        if(JSON.stringify(view)!==JSON.stringify(p.legacy))fail('pack_stale','安装账本已变化。');
        await s.platformLifecycle.execute(root,p.id,'uninstall',legacyId,{},confirmation);
      }
      if(p.packages.length){
        const {trashed}=await s.modTrash.delete(root,p.packages.map(m=>m.id),confirmation,{expectedFiles:p.packages.map(m=>m.files),removeAddonKeys:p.addonKeys});
        await s.modTrash.purge(root,trashed.map(r=>r.trashId),confirmation);
      }
      let checked=0;
      for(const f of p.files){
        if(Date.now()-checked>500){await this.idle(root);checked=Date.now();}
        const file=await platformPath(root,f.path);
        if(!file || stamp(await fs.lstat(file,{bigint:true}))!==f.stamp)fail('pack_stale','文件刚有变化，登记已保留，请重新预览：'+f.path);
        await fs.unlink(file);
      }
      for(const rel of p.dirs){const dir=await folder(root,rel);if(dir)await fs.rmdir(dir);}
      const after=await this.scan(root,p.id);
      if(after.files.length || after.packages.length || after.legacy || after.dirs.length || after.blocked.length)fail('pack_residue','仍有平台文件，登记已保留，请重新检查。');
      const records=await reg.load();
      const current=records.find(r=>r.root===key(path.resolve(root)) && r.definition.id===p.id);
      if(JSON.stringify(current??null)!==JSON.stringify(p.registration))fail('pack_stale','平台登记已变化，请重新核对。');
      if(p.registration)await writeJson(reg.file,records.filter(r=>!(r.root===p.registration.root && r.definition.id===p.id)));
      return {status:'uninstalled',id:p.id,removedFiles:p.files.length,removedPackages:p.packages.map(m=>m.id),retained:p.retained,
        ...(p.id===reg.builtin.id && {workshop:'如仍订阅该平台的工坊更新包，请在 Steam 取消订阅，以免再次下载。'})};
    }finally{await unlock();}
  }
}
