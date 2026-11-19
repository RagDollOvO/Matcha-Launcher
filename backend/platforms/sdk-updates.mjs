import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJson } from '../mods/files.mjs';
import { validUpdateDeclaration } from './sdk-declaration.mjs';
import { githubSource } from '../dll-sources.mjs';
import { fail } from './files.mjs';

const day=86400000, stable=/^v?(\d+\.\d+\.\d+)$/i;
const newer=(a,b)=>a.localeCompare(b,'en',{numeric:true})>0;
const pin=v=>v?.certificateSha256;
export function sdkOrigin(m) {
  if(m.loadKind==='library')return null;
  const d=m.developer, u=d?.updates;
  if(u!==undefined){
    if(!validUpdateDeclaration(u))return null;
    return {type:'github',url:'https://github.com/'+u.repo,version:m.version};
  }
  if(d?.source?.visibility==='public' && typeof d.source.url==='string'){
    try{const u=new URL(d.source.url);u.pathname='/'+u.pathname.split('/').filter(Boolean).slice(0,2).join('/');return {type:'github',url:githubSource(u.href).url,version:m.version};}catch{}
  }
  return null;
}
function target(root,p,overlay){
  if(p.manifest.loadKind==='library')return null;
  const declared=sdkOrigin(p.manifest), source=['github','workshop'].includes(overlay?.source?.type)?overlay.source:declared;
  if(!source)return null;
  let url=source.url;if(source.type==='github')url=githubSource(url).url;
  const mask=declared?.url?.toLowerCase()===url.toLowerCase()? p.manifest.developer?.updates?.asset || '*.zip':'*.zip';
  const key=JSON.stringify([root.toLowerCase(),p.manifest.id,p.manifest.version,pin(p.verification)||'',url,mask,source.type==='workshop'?source.version:'',overlay?.publisher??null]);
  return {key,id:p.manifest.id,version:p.manifest.version,verification:p.verification,source:{...source,url},publisher:overlay?.publisher,mask};
}
const assetMatch=(s,mask)=>new RegExp('^'+mask.split('*').map(v=>v.replace(/[.+]/g,'\\$&')).join('.*')+'$','i').test(s);
const notes=text=>String(text??'').replace(/<[^>]{1,300}>/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[#> \t]+/gm,'').trim().slice(0,1200);
export class SdkUpdates {
  constructor(dataDir,sources,notify){this.sources=sources;this.notify=notify;this.file=path.join(dataDir,'sdk-updates.json');this.rows={};this.ready=null;this.active=null;this.write=Promise.resolve();this.abort=new AbortController();}
  load(){return this.ready??=fs.readFile(this.file,'utf8').then(s=>{const r=JSON.parse(s);if(r.schema!==1||!r.rows)throw Error('SDK 更新缓存格式需要检查');this.rows=r.rows;this.backoff=r.backoff;}).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  save(){const op=this.write.then(async()=>{await fs.mkdir(path.dirname(this.file),{recursive:true});await writeJson(this.file,{schema:1,rows:this.rows,backoff:this.backoff});});this.write=op.catch(()=>{});return op;}
  targets(root,inventory,overlays){return inventory.map(p=>target(root,p,overlays[p.manifest.id])).filter(Boolean);}
  async check(targets,force=false){
    await this.load();
    if(this.active){await this.active; if(!force)return; }
    const run=async()=>{
      const now=Date.now(), checkedAt=new Date(now).toISOString(), requests=new Map();let changed=false,error;
      for(const t of targets){
        const old=this.rows[t.key];
        if(!force && old?.next>now)continue;
        if(t.source.type==='github' && this.backoff>now){error=Error('GitHub 访问频率已达上限，请稍后再查。');continue;}
        try {
          let query=requests.get(t.source.url);
          if(!query){
            if(t.source.type==='workshop')query=this.sources.inspect({...t.source,refresh:true},this.abort.signal);
            else {const {owner,repo}=githubSource(t.source.url);query=this.sources.json('https://api.github.com/repos/'+owner+'/'+repo+'/releases/latest',true,this.abort.signal);}
            requests.set(t.source.url,query);
          }
          const r=await query;let offer=null;
          if(t.source.type==='workshop'){
            const v=r.source?.version;
            if(t.publisher && JSON.stringify(r.publisher)!==JSON.stringify(t.publisher))fail('source_changed','工坊发布者已变化，请让茶茶核对。');
            if(Date.parse(v)>Date.parse(t.source.version)){
              const a=r.assets.filter(a=>a.kind==='binary');offer={tag:v,asset:a.length===1?a[0]:null,update:{version:v,url:t.source.url,publishedAt:v,notes:notes(r.release?.notes),sizeBytes:a[0]?.size,signer:'unknown',checkedAt}};
            }
          }else{
            const version=r&&!r.draft&&!r.prerelease&&stable.exec(r.tag_name)?.[1];
            if(version&&newer(version,t.version)){
              const files=(r.assets??[]).filter(a=>a.state==='uploaded'&&assetMatch(a.name,t.mask));
              const a=files.length===1?files[0]:null;
              const hint=/^matcha-signer:(unsigned|[0-9a-f]{64})$/i.exec(a?.label??'')?.[1].toLowerCase();
              const signer=hint==='unsigned'?'unsigned':hint&&pin(t.verification)&&hint!==pin(t.verification)?'changed':'unknown';
              offer={tag:r.tag_name,asset:a?{id:String(a.id),name:a.name,size:a.size,digest:a.digest??null}:null,update:{version,publishedAt:r.published_at,url:t.source.url+'/releases/tag/'+encodeURIComponent(r.tag_name),notes:notes(r.body),sizeBytes:a?.size??null,signer,checkedAt}};
            }
          }
          if(offer && offer.asset && old?.offer?.tag===offer.tag && old.offer.asset?.id===offer.asset.id && old.offer.asset?.digest===offer.asset.digest && old.offer.actualSigner){
            offer.actualSigner=old.offer.actualSigner;offer.update.signer=offer.actualSigner;
          }
          this.rows[t.key]={checkedAt,next:now+day,offer};changed=true;
        }catch(e){
          if(this.abort.signal.aborted)throw e;
          if(e.code==='source_rate_limited')this.backoff=Math.max(now+60000,Number(e.details?.resetAt)*1000 || now+3600000);
          this.rows[t.key]={...old,next:this.backoff>now?this.backoff:now+3600000,error:e.message}; error=e;changed=true;
        }
      }
      if(changed){await this.save();this.notify();}
      if(force&&error)throw error;
      return {checkedAt,updates:targets.filter(t=>this.rows[t.key]?.offer).length};
    };
    const job=run();this.active=job;try{return await job;}finally{if(this.active===job)this.active=null;}
  }
  async actual(t,signer,assetId){
    const offer=this.rows[t.key]?.offer;if(!offer||offer.asset?.id!==assetId)return;
    offer.actualSigner=signer;offer.update.signer=signer;await this.save();this.notify();
  }
  async close(){this.abort.abort();await this.active?.catch(()=>{});await this.write;}
}
