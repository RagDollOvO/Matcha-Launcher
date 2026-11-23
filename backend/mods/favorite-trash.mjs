import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {directory, fail} from './files.mjs';
import {logicalName} from './favorite-files.mjs';
import {cleanFavoriteVersions, favoritePath} from './favorite-vault.mjs';

const prefix='favorite-trash:';
export const isFavoriteTrashId=id=>typeof id==='string' && id.startsWith(prefix);
const sameCopy=(a,b)=>!!a && !!b && a.id===b.id && (a.vaultKey ? a.vaultKey===b.vaultKey : !b.vaultKey && isDeepStrictEqual(a,b));

// Shelf records and the bin share the immutable vault. Moving a favorite changes ownership in one settings write.
export async function makeFavoriteTrashRecord(service,ref,memberships,starred=false){
  const files=[];
  if(ref.vaultKey){
    const dir=path.dirname(favoritePath(service,ref));
    try{
      await directory(dir);
      for(const e of await fs.readdir(dir,{withFileTypes:true})){
        if(!e.isFile() || !/\.(vpk|jpg)$/i.test(e.name))fail('unsafe_path','收藏副本目录中有其他文件：'+dir);
        const stat=await fs.lstat(path.join(dir,e.name));
        if(!stat.isFile())fail('file_changed','收藏副本刚有变化，请重试。');
        files.push({file:e.name,size:stat.size});
      }
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return {trashId:prefix+randomUUID(),deletedAt:new Date().toISOString(),state:'trashed',ref,starred,memberships,files};
}

export function favoriteTrashView(row){
  const {ref,files,memberships,trashId,deletedAt,state}=row;
  const sizeBytes=files.reduce((n,f)=>n+f.size,0);
  return {trashId,modId:ref.id,title:ref.title,file:ref.file,sizeBytes,sizeMB:sizeBytes/1048576,deletedAt,state,
    categoryId:'',profileIds:[],files,favorite:{collections:memberships.map(m=>m.name),dirs:ref.dirs??[],hasThumbnail:!!ref.hasThumbnail && files.length>0,recordOnly:!files.length}};
}
export const favoriteTrashViews=s=>(s.favoriteTrash??[]).map(favoriteTrashView);
export function combinedTrash(s,modRows){
  return [...modRows,...favoriteTrashViews(s)].sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
}

export async function keepRemovedFavorites(service,prev,next){
  const before=prev.favoriteRefs??{},after=next.favoriteRefs??{};
  let bin=next.favoriteTrash??[],changed=false;
  for(const [id,ref] of Object.entries(before)){
    if(Object.hasOwn(after,id))continue;
    const groups=(prev.favoriteCollections??[]).filter(c=>c.modIds.includes(id)).map(c=>({id:c.id,name:c.name,index:c.modIds.indexOf(id)}));
    const row=await makeFavoriteTrashRecord(service,ref,groups,!!prev.modMeta?.[id]?.favorite);
    bin=[...bin,row];changed=true;
  }
  // 茶茶撤销也会放回原副本，和在回收站点还原一样，收掉对应的回收记录。
  const left=bin.filter(row=>row.state==='purging'||before[row.ref.id]||!sameCopy(row.ref,after[row.ref.id]));
  return changed||left.length!==bin.length?{...next,favoriteTrash:left}:next;
}

function restoreFavorites(settings,rows){
  const favoriteRefs={...settings.favoriteRefs},modMeta={...settings.modMeta};
  const done=[],conflicts=[];
  const names=new Set(Object.values(favoriteRefs).map(logicalName));
  for(const row of rows){
    const ref=row.ref,name=logicalName(ref);
    if(row.state==='purging'){conflicts.push({trashId:row.trashId,reason:'此项已开始永久删除，请继续完成删除。'});continue;}
    if(Object.hasOwn(favoriteRefs,ref.id)||names.has(name)){
      conflicts.push({trashId:row.trashId,reason:'收藏夹里已有同名收藏「'+ref.file+'」，原条目仍在回收站。'});continue;
    }
    favoriteRefs[ref.id]=ref;names.add(name);done.push(row);
    if(row.starred)modMeta[ref.id]={...modMeta[ref.id],favorite:true};
  }
  const completed=new Set(done.map(r=>r.trashId));
  const favoriteCollections=settings.favoriteCollections.map(c=>{
    const modIds=[...c.modIds];
    const slots=done.flatMap(row=>row.memberships.filter(m=>m.id===c.id).map(m=>({id:row.ref.id,index:m.index}))).sort((a,b)=>a.index-b.index);
    for(const slot of slots)if(!modIds.includes(slot.id))modIds.splice(slot.index,0,slot.id);
    return slots.length?{...c,modIds}:c;
  });
  return {next:{...settings,favoriteRefs,modMeta,favoriteCollections,favoriteTrash:settings.favoriteTrash.filter(r=>!completed.has(r.trashId))},
    restored:done.map(r=>r.ref.id),conflicts};
}

// Permanent deletion also retires undo snapshots of that exact favorite version; unrelated edits remain available.
function expireUndo(history,rows){
  if(!history)return history;
  return {...history,entries:history.entries.map(e=>{
    let expired=false;
    const changes=e.changes.map(c=>{
      if(c.type!=='favoriteRefs')return c;
      const purged=value=>rows.some(r=>sameCopy(value,r.ref));
      const a=purged(c.before),b=purged(c.after);
      if(!a&&!b)return c;
      expired=true;return {...c,before:a?null:c.before,after:b?null:c.after};
    });
    return expired?{...e,state:e.state==='applied'?'expired':e.state,changes}:e;
  })};
}

// The main Mod bin keeps its original game-root guards. A shelf-only selection never needs a game installation.
export async function changeTrash(service,op,ids,confirmation,root){
  service.confirm(confirmation);
  const gameRoot=async()=>root || await service.requireRoot();
  if(ids==='all' && op==='purge')return service.modTrash.purge(await gameRoot(),'all',confirmation); // legacy library-only caller
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id))fail('invalid_argument','请选择回收站条目。');
  const selected=[...new Set(ids)],shelfIds=new Set(selected.filter(isFavoriteTrashId)),library=selected.filter(id=>!shelfIds.has(id));
  const rows=(service.settings.favoriteTrash??[]).filter(r=>shelfIds.has(r.trashId));
  if(rows.length!==shelfIds.size)fail('trash_missing','回收站内容已变化，请刷新后重新选择。');
  const result=library.length?await service.modTrash[op](await gameRoot(),library,confirmation):op==='restore'?{restored:[],conflicts:[]}:{purged:[]};
  if(!rows.length)return result;
  if(op==='restore'){
    const {next,restored,conflicts}=restoreFavorites(service.settings,rows);
    if(restored.length)await service.save(next);
    return {restored:[...result.restored,...restored],conflicts:[...result.conflicts,...conflicts]};
  }
  const s=service.settings;
  // Keep a retryable row until every exclusively owned file was removed.
  await service.save({...s,...(s.modHistory&&{modHistory:expireUndo(s.modHistory,rows)}),
    favoriteTrash:s.favoriteTrash.map(r=>shelfIds.has(r.trashId)?{...r,state:'purging'}:r)});
  const current=service.settings,next={...current,favoriteTrash:current.favoriteTrash.filter(r=>!shelfIds.has(r.trashId))};
  await cleanFavoriteVersions(service,current,next);
  await service.save(next);
  return {purged:[...result.purged,...shelfIds]};
}
