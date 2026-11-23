import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {directory, fail, exists} from './files.mjs';
import {regular, assertVpkUnchanged} from './vpk.mjs';
import {packSource, packModFolder} from './pack.mjs';
import {isPreviewableSound} from './audio.mjs';

const uuid=/^[a-f0-9-]{36}$/i;
const rootOf=s=>path.join(s.dataDir,'favorite-files');
const contained=(parent,child)=>{const r=path.relative(parent,child);return !r||!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
export function favoritePath(service,ref){
  if(!ref?.vaultKey || !uuid.test(ref.vaultKey)||!ref.vaultName||path.basename(ref.vaultName)!==ref.vaultName||!ref.vaultName.toLowerCase().endsWith('.vpk'))fail('favorite_source_missing','这条旧收藏只有记录。请重新选择原 VPK 或素材文件夹。');
  return path.join(rootOf(service),ref.vaultKey,ref.vaultName);
}
async function eraseVersion(service,key){
  if(!uuid.test(key))return;
  if(!await exists(rootOf(service)))return;
  const dir=path.join(await directory(rootOf(service)),key);
  if(!await exists(dir))return;
  await directory(dir);
  // Owned versions are flat: a VPK, its volumes, and optional cover. Never follow links or remove foreign directories.
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    if(!e.isFile()||!(/\.(?:vpk|jpg)$/i.test(e.name)))fail('unsafe_path','收藏副本目录出现其他文件，请检查：'+dir);
  }
  for(const name of await fs.readdir(dir))await fs.unlink(path.join(dir,name));
  await fs.rmdir(dir);
}
function retained(s){
  const keys=new Set(Object.values(s.favoriteRefs??{}).map(r=>r.vaultKey).filter(Boolean));
  for(const row of s.favoriteTrash??[])if(row.ref.vaultKey)keys.add(row.ref.vaultKey);
  for(const e of s.modHistory?.entries??[])for(const c of e.changes??[])if(c.type==='favoriteRefs')for(const r of [c.before,c.after])if(r?.vaultKey)keys.add(r.vaultKey);
  return keys;
}
export async function cleanFavoriteVersions(service,old,next){
  const keep=retained(next);
  for(const key of retained(old))if(!keep.has(key))await eraseVersion(service,key);
}
export async function captureFavorite(service,ref,source=ref.absolutePath){
  const base=rootOf(service);
  if(ref.referenceKind==='folder' && contained(await fs.realpath(source),path.resolve(base)))fail('invalid_argument','请选择单个素材文件夹，收藏库位于当前选择范围内。');
  await fs.mkdir(service.dataDir,{recursive:true});await directory(base,true);
  const key=randomUUID(), dir=path.join(base,key);await fs.mkdir(dir);
  try{
    let name;
    if(ref.referenceKind==='folder'){
      const input=await packSource(source);
      const result=await packModFolder({...input,exportDir:dir},{taskId:randomUUID(),signal:new AbortController().signal,progress(){},commit:fn=>fn()});
      name=path.basename(result.output);
    }else{
      const vpk=await service.modManager.cached(source);
      const workshop=/^library:workshop:([0-9]+)$/.exec(ref.library?.modId??'')?.[1];
      const vaultName=file=>ref.importPrefix && path.basename(file).startsWith(ref.importPrefix)?path.basename(file).slice(ref.importPrefix.length):workshop && /^mod\.(vpk|jpg)$/i.test(path.basename(file))?workshop+path.extname(file):path.basename(file);
      for(const f of vpk.files)await fs.copyFile(f.file,path.join(dir,vaultName(f.file)),fs.constants.COPYFILE_EXCL);
      const cover=await service.modManager.sidecar(source);
      if(cover)await fs.copyFile(cover.file,path.join(dir,vaultName(cover.file)),fs.constants.COPYFILE_EXCL);
      await assertVpkUnchanged(vpk);name=vaultName(source);
    }
    const file=path.join(dir,name), v=await service.modManager.cached(file);
    const {missingSource,sourceError,recapture,importPrefix,...rest}=ref;
    return {...rest,vaultKey:key,vaultName:name,dirs:v.dirs,sizeMB:v.sizeMB,soundCount:v.resources.filter(p=>isPreviewableSound(p,true)).length,
      hasThumbnail:!!v.thumbnail||!!await service.modManager.sidecar(file),updatedAt:new Date().toISOString()};
  }catch(e){await eraseVersion(service,key);throw e;}
}
export async function prepareFavorites(service,next){
  let refs=next.favoriteRefs??{},changed=false;
  const set=(id,r)=>{if(!changed){refs={...refs};changed=true;}refs[id]=r;};
  try{
    for(const [id,m] of Object.entries(next.modMeta??{})){
      if(!m.favorite||refs[id]||service.settings.modMeta[id]?.favorite)continue;
      const root=await service.requireRoot(), file=await service.modManager.resolve(root,id), v=await service.modManager.cached(file);
      if(Object.values(refs).some(r=>path.basename(r.vaultName??r.file).toLowerCase()===path.basename(file).toLowerCase()))
        fail('favorite_duplicate','收藏夹已有同名文件，请从收藏入口选择替换或取消。');
      set(id,{id,title:v.title,file:path.basename(file),author:v.author,absolutePath:file,referenceKind:'vpk',library:{gameRoot:root,modId:id}});
    }
    for(const [id,r] of Object.entries(refs)){
      if(r.recapture || (!r.vaultKey && !r.missingSource))set(id,await captureFavorite(service,r));
    }
    return changed?{...next,favoriteRefs:refs}:next;
  }catch(e){await cleanFavoriteVersions(service,{favoriteRefs:refs},service.settings);throw e;}
}
// Preserve legacy collection IDs. Recover bytes from their original location or the matching Matcha trash record.
export async function migrateFavorites(service){
  const s=service.settings, refs={...s.favoriteRefs};
  const legacyMods=Object.entries(s.modMeta??{}).filter(([id,m])=>m.favorite&&!refs[id]);
  if(!legacyMods.length&&!Object.values(refs).some(r=>!r.vaultKey&&!r.missingSource))return;
  const root=await service.root();
  const hasGame=root && await exists(path.join(root,'left4dead2'));
  const linkedMods=hasGame?(await service.modManager.scan(root,{conflicts:false})).mods:[];
  if(legacyMods.length){
    const fallback=(id)=>({id,title:id,file:path.basename(id),author:'',dirs:[],sizeMB:0,updatedAt:'',hasThumbnail:false,absolutePath:'',referenceKind:'vpk',library:{gameRoot:root,modId:id}});
    for(const [id] of legacyMods)refs[id]=fallback(id);
  }
  if(legacyMods.length && hasGame){
    for(const [id] of legacyMods){const m=linkedMods.find(m=>m.id===id);if(m)refs[id]={...refs[id],title:m.title,file:m.file,author:m.author,absolutePath:m.absolutePath,referenceKind:'vpk',library:{gameRoot:root,modId:id,version:m.packageVersion}};}
  }
  let trash;
  for(const [id,r] of Object.entries(refs)){
    if(r.vaultKey||r.missingSource)continue;
    try{
    let source=r.absolutePath;
    if((!source || !await exists(source)) && r.library?.gameRoot && hasGame && path.relative(root,r.library.gameRoot)===''){
      trash??=await service.modTrash.list(root);const record=trash.find(t=>t.modId===r.library.modId && t.state==='trashed');
      if(record)source=await service.modTrash.savedFile(root,record,record.file);
    }
    if(source && await exists(source)){
      const live=linkedMods.find(m=>r.library?.modId===m.id && path.relative(m.absolutePath,source)==='');
      refs[id]=await captureFavorite(service,{...r,...(r.library&&{library:live ? {...r.library,version:live.packageVersion}:undefined})},source);
    }
    else refs[id]={...r,missingSource:true};
    }catch(e){refs[id]={...r,missingSource:true,sourceError:e.message};}
  }
  await service.save({...s,favoriteRefs:refs});
}
export async function exportFavoriteVpk(service,ref,ctx,dest){
  const src=favoritePath(service,ref), name=path.basename(src,'.vpk');await regular(src);await directory(dest);
  return ctx.commit(async()=>{for(let i=1;i<=10000;i++){const out=path.join(dest,name+(i===1?'':' ('+i+')')+'.vpk');
    try{await fs.copyFile(src,out,fs.constants.COPYFILE_EXCL);return {output:out,fileCount:(await service.modManager.cached(src)).fileCount};}catch(e){if(e.code!=='EEXIST')throw e;}
  }fail('file_exists','同名输出过多。');});
}

// A same-name library file can be reused only when the saved audio/resources really match.
async function samePackage(manager,source,target){
  if(source===target)return true;
  const [a,b]=await Promise.all([manager.cached(source),manager.cached(target)]);
  if(a.files.length!==b.files.length)return false;
  const x=Buffer.allocUnsafe(262144),y=Buffer.allocUnsafe(x.length);
  for(let i=0;i<a.files.length;i++){
    const l=a.files[i],r=b.files[i];if(l.size!==r.size)return false;
    const left=await fs.open(l.file,'r');
    try{const right=await fs.open(r.file,'r');
      try{for(let p=0;p<l.size;){
        const n=Math.min(x.length,l.size-p);
        const [u,v]=await Promise.all([left.read(x,0,n,p),right.read(y,0,n,p)]);
        if(u.bytesRead!==n||v.bytesRead!==n||!x.subarray(0,n).equals(y.subarray(0,n)))return false;p+=n;
      }}finally{await right.close();}
    }finally{await left.close();}
  }
  await assertVpkUnchanged(a);await assertVpkUnchanged(b);return true;
}
export async function importFavoriteCopy(service,id,root,approval){
  const ref=service.settings.favoriteRefs?.[id],source=favoritePath(service,ref),manager=service.modManager;
  const name=path.basename(source).toLowerCase(),prefix='matcha-fav-'+ref.vaultKey+'-';
  const {mods}=await manager.scan(root,{conflicts:false});
  const linked=ref.library?.gameRoot && path.relative(root,ref.library.gameRoot)===''?ref.library.modId:null;
  const candidates=mods.filter(m=>m.id===linked || m.id===name || m.id.replace(/^matcha-fav-[a-f0-9-]{36}-/,'')===name);
  let mod;
  for(const m of candidates)if(!m.error && m.kind!=='platform-package' && await samePackage(manager,source,m.absolutePath)){mod=m;break;}
  if(!mod){
    const result=await manager.import({file:source,gameRoot:root,confirmation:approval,favoritePrefix:candidates.some(m=>m.id===name)?prefix:''});
    mod=(await manager.scan(root,{conflicts:false})).mods.find(m=>m.id===result.id);
    if(!mod||mod.error)fail('favorite_unavailable','已导入文件，请刷新 Mod 库后重试。');
  }
  const library={gameRoot:root,modId:mod.id,version:mod.packageVersion,alternatives:candidates.filter(m=>m.id!==mod.id).map(m=>m.id)};
  await service.save({...service.settings,favoriteRefs:{...service.settings.favoriteRefs,[id]:{...ref,library}}});
  return {id:mod.id};
}
