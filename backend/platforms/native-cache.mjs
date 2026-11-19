import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platformPath, readBytes, fail, relativePath } from './files.mjs';
import { directory } from '../mods/files.mjs';

const exec = promisify(execFile);
const unpack = args => exec(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32/tar.exe') : 'bsdtar',
  args, { windowsHide:true, encoding:'utf8', timeout:120000, maxBuffer:4*1024*1024 });
const l4nOnly=id=>{if(id!=='l4n') fail('renderer_read_only','DXVK 由游戏管理。');};
function downloadInfo(item) {
  if (!item.downloadUrl || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0 || item.sizeBytes > 256*1024**2) return null;
  const u = new URL(item.downloadUrl);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !['github.com','cdn.steamusercontent.com'].includes(u.hostname)) fail('library_source', '组件下载来源需要检查。');
  return { version:item.version, url:u.href, sizeBytes:item.sizeBytes, sha256:item.sha256, source:item.source, ...(item.license ? {license:item.license} : {}) };
}
export class NativeCache {
  constructor(dataDir, vendor, fetch) { this.base=path.join(dataDir,'native-libraries'); this.vendor=vendor; this.fetch=fetch; this.plans=new Map(); this.damaged=new Set(); }
  async locate(id, item) {
    l4nOnly(id);const info=downloadInfo(item);
    const present=async folder => {
      const entry='bin/left4neko.dll';
      return !!await platformPath(folder,entry);
    };
    for(const base of [this.base,...(this.legacyBases??[])]){const root=path.join(base,item.folder),receipt=await platformPath(base,item.folder+'/.matcha-download.json');
    if(receipt && info && !this.damaged.has(root)){
      const record=JSON.parse(await fs.readFile(receipt,'utf8'));
      if(record.sha256===info.sha256 && record.files && await present(root))return {availability:'downloaded', root, info, files:record.files};
    }
    }
    const bundled=path.join(this.vendor,item.folder);
    if (await present(bundled)) return { availability:'bundled',root:bundled,info };
    return { availability:'missing',root:null,info };
  }
  async payload(location,relative) {
    const f=location.root && await platformPath(location.root,relative);
    if(!f && location.files)this.damaged.add(location.root);
    if(!f)fail('library_package_missing','组件文件缺失，请重新下载：'+relative);
    const bytes=await readBytes(f,64*1024**2);
    if(location.files && createHash('sha256').update(bytes).digest('hex')!==location.files[relative]){
      this.damaged.add(location.root);fail('library_digest','缓存文件校验未通过，请重新下载：'+relative);
    }
    return bytes;
  }
  preview(id,item) {
    l4nOnly(id);const info=downloadInfo(item); if(!info) fail('library_source','此组件清单缺少下载地址或完整性资料。');
    const plan={...info, id, target:path.join(this.base,item.folder), planId:randomUUID()};
    this.plans.set(plan.planId,{plan,at:Date.now()}); if(this.plans.size>30)this.plans.delete(this.plans.keys().next().value);
    return plan;
  }
  take(id) {
    const row=this.plans.get(id); this.plans.delete(id);
    if(!row || Date.now()-row.at>900000) fail('library_plan_stale','请重新预览组件下载。'); return row.plan;
  }
  async download(plan,item,ctx) {
    const {id}=plan;l4nOnly(id);const info=downloadInfo(item), target=path.join(this.base,item.folder);
    if (!info || ['version','sha256','sizeBytes','url'].some(k=>plan[k]!==info[k]) || target!==plan.target) fail('library_plan_stale','组件版本或下载资料已变化，请重新预览。');
    if((await this.locate(id,item)).availability==='downloaded')return {sourceId:'native:'+id};
    await directory(this.base,true); const parent=await directory(path.dirname(target),true);
    const stage=await fs.mkdtemp(path.join(parent,'.download-')), archive=path.join(stage,'archive'), out=path.join(stage,'payload');
    try {
      let url=info.url, response;
      for(let hop=0;hop<6;hop++){
        response=await this.fetch(url,{redirect:'manual',signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(180000)])});
        if(![301,302,303,307,308].includes(response.status)) break;
        const loc=response.headers.get('location'); await response.body?.cancel();
        const next=loc && new URL(loc,url);
        if(!next || next.protocol!=='https:' || next.username || next.password || next.port || !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','cdn.steamusercontent.com'].includes(next.hostname)) fail('library_source','组件下载跳转到了未登记的来源。');
        url=next.href;
      }
      if(!response.ok){await response.body?.cancel();fail('library_http','组件下载失败（HTTP '+response.status+'）。');}
      const file=await fs.open(archive,'wx'), hash=createHash('sha256'); let done=0;
      try { for await(const chunk of response.body){ctx.signal.throwIfAborted(); done+=chunk.length; if(done>info.sizeBytes)fail('library_digest','下载大小校验未通过，已丢弃。');
        hash.update(chunk);await file.writeFile(chunk);ctx.progress({done,total:info.sizeBytes,unit:'bytes'});} } finally {await file.close();}
      return await ctx.commit(async()=>{
        if(done!==info.sizeBytes || hash.digest('hex')!==info.sha256)fail('library_digest','下载文件的大小或 SHA-256 校验未通过，已丢弃。');
        // Extraction sees only a digest-pinned archive; reject special entries before writing any payload.
        const names=(await unpack(['-tf',archive])).stdout.trimEnd().split(/\r?\n/);
        for(const n of names)relativePath(n.replace(/\/$/,''));
        if((await unpack(['-tvf',archive])).stdout.trimEnd().split(/\r?\n/).some(line=>!/^[-d]/.test(line)))fail('library_archive','组件压缩包包含链接或特殊文件。');
        await fs.mkdir(out);
        await unpack(['-xf',archive,'-C',out]);
        const files={};
        for(const f of item.files){
          const full=await platformPath(out,f);if(!full)fail('library_archive','组件压缩包缺少 '+f);
          files[f]=createHash('sha256').update(await readBytes(full,64*1024**2)).digest('hex');
        }
        await fs.writeFile(path.join(out,'.matcha-download.json'),JSON.stringify({version:item.version,sha256:info.sha256,files}),{flag:'wx'});
        let previous;
        if(await platformPath(this.base,item.folder+'/.matcha-download.json')){
          previous=path.join(parent,'.previous-'+randomUUID());await fs.rename(target,previous);
        }
        try{await fs.rename(out,target);}catch(e){if(previous)await fs.rename(previous,target);throw e;}
        this.damaged.delete(target);
        return {sourceId:'native:'+id};
      });
    } finally {await fs.rm(stage,{recursive:true,force:true});}
  }
}
