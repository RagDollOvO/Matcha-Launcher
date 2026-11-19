import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PlatformError } from '../core.mjs';
import { directory, stamp, writeJson } from '../mods/files.mjs';

const fail = (code, message) => { throw new PlatformError(code, message); };
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const labels = { 'dll-intake': '已导入的 DLL 整理暂存', 'dll-sources': '已导入的 DLL 下载副本',
  'workshop-preview': '工坊预览（内存）', 'discover-images': '发现页列表（内存）' };
async function inventory(dir) {
  await directory(dir); const files = [];
  async function visit(folder) {
    for (const name of await fs.readdir(folder)) {
      const file = path.join(folder, name), s = await fs.lstat(file);
      if (s.isSymbolicLink() || !s.isDirectory() && (!s.isFile() || s.nlink !== 1)) throw Error('非独立暂存文件');
      if (s.isDirectory()) await visit(file);
      else files.push([path.relative(dir,file),stamp(s),s.size]);
    }
  }
  await visit(dir); return files.sort((a,b)=>a[0].localeCompare(b[0]));
}
// Receipts are outside the staging tree. Older drafts and unknown files have no deletion authority.
export class SettingsCache {
  constructor(service) { this.service = service; this.base = service.dataDir; this.receipts = path.join(this.base,'completed-cache'); }
  bases(kind){return this.service.storage?.cfg?this.service.storage.downloadRoots(kind):[path.join(this.base,kind)]}
  async parent(kind,id){
    for(const p of this.bases(kind))if(await fs.lstat(path.join(p,id)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e}))return p;
    return this.bases(kind)[0];
  }
  async record(kind,id,allow) {
    if (!uuid.test(id)) return;
    const parent = await this.parent(kind,id); await directory(parent);
    const files = await inventory(path.join(parent,id));
    if (!files.length || !files.every(([name]) => allow(name.split(path.sep).join('/')))) return;
    await fs.mkdir(this.receipts,{recursive:true}); await directory(this.receipts);
    await writeJson(path.join(this.receipts,kind+'_'+id+'.json'),files);
  }
  async imported({record}) {
    const original = new Set(record.files.map(f=>'original/'+f.path));
    const prepared = new Set(record.candidate.files.map(f=>'prepared/'+record.candidate.id+'/'+f.path));
    await this.record('dll-intake',record.id,n => n==='state.json'||original.has(n)||prepared.has(n));
    const parent = path.dirname(record.source);
    if (!this.bases('dll-sources').includes(path.dirname(parent)) || !uuid.test(path.basename(parent))) return;
    const source = JSON.parse(await fs.readFile(path.join(parent,'source.json'),'utf8'));
    if (source.file === record.source && !source.image)
      await this.record('dll-sources',path.basename(parent),n=>n==='source.json'||n===path.basename(record.source));
  }
  async run(ids, clear=false) {
    if (!Array.isArray(ids) || ids.some(id=>!Object.hasOwn(labels,id))) fail('cache_id','请选择清单中的缓存。');
    const counts = new Map(), add = (id,n) => counts.set(id,(counts.get(id)??0)+n);
    const s=this.service;
    const maps={'workshop-preview':[s.workshop.previews], 'discover-images':[s.bilibili.cache,s.gamemaps.cache]};
    for (const [id,list] of Object.entries(maps)) if(ids.includes(id)) for(const m of list) {
      for(const [key,v] of m) { add(id,Buffer.byteLength(JSON.stringify(v))+Buffer.byteLength(key)); if(clear)m.delete(key); }
    }
    const names=await directory(this.receipts).then(()=>fs.readdir(this.receipts)).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
    for(const name of names) {
      const match=/^(dll-intake|dll-sources)_([0-9a-f-]+)\.json$/.exec(name);
      if(!match || !ids.includes(match[1]) || !uuid.test(match[2])) continue;
      const [,kind,id]=match, parent=await this.parent(kind,id), dir=path.join(parent,id), receipt=path.join(this.receipts,name);
      if(kind==='dll-intake' && [...s.dllImportPlans.values()].some(p=>p.intakeId===id && Date.now()-p.at<900000)) continue;
      // Include only a complete, unchanged, exclusively-owned imported copy.
      const files=await directory(parent).then(()=>inventory(dir)).catch(()=>null);
      if(!files || !(await fs.lstat(receipt)).isFile() || JSON.stringify(files)!==JSON.stringify(JSON.parse(await fs.readFile(receipt,'utf8'))))continue;
      if(clear) {
        // Claim the single completed item first; never descend into a replacement at its old path.
        const claimed=path.join(parent,'.cleaning-'+id+'-'+randomUUID());
        await fs.rename(dir,claimed);
        try {
          if(JSON.stringify(await inventory(claimed))!==JSON.stringify(files)){
            await fs.rename(claimed,dir);continue;
          }
          // Remove only the confirmed files; new/unrecognized content makes rmdir stop.
          for(const [name,identity] of files){
            const file=path.join(claimed,name);
            if(stamp(await fs.lstat(file))!==identity)fail('cache_changed','清理期间暂存内容已变化，请重新查看。');
            await fs.unlink(file);
          }
          async function empty(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){
            if(entry.isDirectory()&&!entry.isSymbolicLink())await empty(path.join(folder,entry.name));
          }await fs.rmdir(folder);}
          await empty(claimed);
        }catch(e){
          if(await fs.lstat(claimed).catch(()=>null))await fs.rename(claimed,dir);
          throw e;
        }
        await fs.unlink(receipt);
      }
      add(kind,files.reduce((n,f)=>n+f[2],0));
    }
    const items=[...counts].map(([id,bytes])=>({id,label:labels[id],bytes})),totalBytes=items.reduce((n,i)=>n+i.bytes,0);
    return clear ? {cleared:items.map(i=>i.id),freedBytes:totalBytes} : {items,totalBytes};
  }
  status(){return this.run(Object.keys(labels));}
}

export async function checkUpdate(current, repository, fetch) {
  if (!repository) fail('update_source_missing','尚未配置 Matcha 的 GitHub 发布仓库。');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split('/')[1].startsWith('.'))
    fail('update_source_invalid','发布仓库请使用 GitHub 的 所有者/仓库名。');
  const response=await fetch('https://api.github.com/repos/'+repository+'/releases/latest',{
    headers:{accept:'application/vnd.github+json','user-agent':'Matcha/'+current},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok){ await response.body?.cancel(); fail('update_http',response.status===404?'仓库尚无可访问的正式发行版。':'GitHub 检查更新失败（HTTP '+response.status+'），请稍后再试。'); }
  const r=await response.json(), version=v=>/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);
  const a=version(current), b=version(r.tag_name);
  if(!a || !b || r.draft || r.prerelease) fail('update_format','正式发布标签请使用 v主版本.次版本.修订号。');
  let newer=false;
  for(let i=1;i<=3;i++)if(a[i]!==b[i]){newer=BigInt(b[i])>BigInt(a[i]);break;}
  return {current, latest:b.slice(1).join('.'),hasUpdate:newer,url:'https://github.com/'+repository+'/releases/tag/'+encodeURIComponent(r.tag_name),
    notes:typeof r.body==='string'?r.body.slice(0,16000):'', publishedAt:r.published_at, checkedAt:new Date().toISOString()};
}
