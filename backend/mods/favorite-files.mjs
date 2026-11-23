import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, directory } from './files.mjs';
import { planFavoriteCollection } from './favorite-collections.mjs';
import { regular } from './vpk.mjs';

const pathKey = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);

export const logicalName = r => (r.library?.modId.startsWith('library:workshop:') ? r.library.modId.slice('library:workshop:'.length)+'.vpk' : path.basename(r.file)+(r.referenceKind==='folder'?'.vpk':'')).normalize('NFKC').toLowerCase();

// Preview is read-only. A replacement reuses the shelf ID so collection memberships survive.
export async function bookmarkFiles(settings,mods,manager,{paths,collectionId,repairId},root=settings.gameRoot) {
  if(!Array.isArray(paths)||!paths.length||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p))) fail('invalid_argument','请选择 VPK 或素材文件夹的完整路径。');
  const group=collectionId && settings.favoriteCollections?.find(c=>c.id===collectionId);
  if(collectionId && !group) fail('collection_missing','目标合集已移除，请重新选择。');
  const refs={...settings.favoriteRefs}, meta={...settings.modMeta};
  const repair=repairId && refs[repairId];
  if(repairId && (!repair?.missingSource || paths.length!==1)) fail('favorite_changed','收藏状态已变化，请刷新后重新选择。');
  const installed=new Map(mods.filter(m=>m.absolutePath).map(m=>[pathKey(m.absolutePath),m]));
  const seen=new Set(), ids=new Set(), duplicates=[], lines=[], skipped=[], stamps=[];
  for(const raw of paths){
    const file=path.resolve(raw),key=pathKey(file);
    if(seen.has(key))continue;seen.add(key);
    try{
      const known=installed.get(key),stat=await fs.lstat(file), name=path.basename(file);
      let entry={file:name,absolutePath:file,referenceKind:'folder',title:name,author:'',dirs:[],sizeMB:0,hasThumbnail:false,updatedAt:stat.mtime.toISOString()};
      let stamp=[stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs];
      if(stat.isDirectory())await directory(file);
      else{
        await regular(file);
        if(!/\.vpk$/i.test(name)||/_\d{3}\.vpk$/i.test(name)&&await fs.access(file.replace(/_\d{3}\.vpk$/i,'_dir.vpk')).then(()=>true,()=>false))fail('invalid_argument','请选择 VPK 主文件或素材文件夹。');
        const v=await manager.cached(file);
        stamp=v.files.map(f=>f.identity);
        entry={...entry,referenceKind:'vpk',title:known?.title??v.title,author:known?.author??v.author,dirs:v.dirs,sizeMB:v.sizeMB,soundCount:v.soundCount,
          ...(known && {library:{gameRoot:root,modId:known.id,version:known.packageVersion}})};
      }
      const matches=Object.values(refs).filter(r=>logicalName(r)===logicalName(entry));
      const exact=Object.values(refs).find(r=>r.absolutePath && pathKey(r.absolutePath)===key);
      if(!exact && !repair && matches.length>1)fail('favorite_duplicate','已有多条同名的旧收藏，请先在收藏夹中选定要保留的版本。');
      const linked=known && Object.values(refs).find(r=>r.library?.modId===known.id && r.library.gameRoot && root && pathKey(r.library.gameRoot)===pathKey(root));
      const same=exact??linked??matches[0];
      if(linked && entry.library){
        entry.library.alternatives=linked.library.alternatives;
        const prefix=/^matcha-fav-[a-f0-9-]{36}-/i.exec(name)?.[0];
        if(prefix && name.slice(prefix.length).toLowerCase()===linked.vaultName?.toLowerCase()){
          entry.file=name.slice(prefix.length);entry.importPrefix=prefix;
        }
      }
      if(repair && same && same.id!==repair.id)fail('favorite_duplicate','所选文件已属于另一条收藏，请选择原文件。');
      const old=repair||same, id=old?.id??(known && !refs[known.id]?known.id:'favorite-file:'+randomUUID());
      if(old && !repair){duplicates.push({name:old.title,file:entry.file,previous:old.absolutePath,incoming:file});lines.push('替换收藏「'+old.title+'」：'+old.absolutePath+' → '+file);}
      else lines.push(entry.title+'\n'+file);
      stamps.push([file,stamp,old?.vaultKey??null,old?.missingSource??false]);
      refs[id]={...entry,id,title:repair?repair.title:entry.title,recapture:true};
      if(known && id===known.id)meta[id]={...meta[id],favorite:true};
      else if(meta[id]?.favorite){const {favorite,...rest}=meta[id];meta[id]=rest;}
      ids.add(id);
    }catch(e){skipped.push(path.basename(file)+'：'+(e.code==='ENOENT'?'文件已移动或删除。':e.message));}
  }
  if(!ids.size)fail('bookmark_failed',skipped.join('\n')||'请选择 VPK 或素材文件夹。');
  const favoriteCollections=group?settings.favoriteCollections.map(c=>c.id===group.id?{...c,modIds:[...new Set([...c.modIds,...ids])]}:c):settings.favoriteCollections;
  return {next:{...settings,modMeta:meta,favoriteRefs:refs,favoriteCollections},ids:[...ids],count:ids.size,duplicates,skipped,lines,
    label:duplicates.length?'替换收藏副本':'收藏到「'+(group?.name??'收藏夹')+'」',expected:{group:group?.id??null,stamps,lines,skipped}};
}

export async function collectionPlan(settings,mods,manager,edit,root){
  let next=settings,book;
  const input=edit.modIds??[];
  const fromLibrary=input.filter(id=>['create','add'].includes(edit.action) && (!settings.favoriteRefs?.[id] || edit.fromLibraryIds?.includes(id)));
  if(fromLibrary.length){
    const paths=fromLibrary.map(id=>mods.find(m=>m.id===id)?.absolutePath??fail('mod_missing','所选 Mod 已移除，请刷新。'));
    book=await bookmarkFiles(settings,mods,manager,{paths},root);
    if(book.skipped.length)fail('bookmark_failed',book.skipped.join('\n'));
    next=book.next;
    edit={...edit,modIds:[...new Set([...input.filter(id=>!fromLibrary.includes(id)),...book.ids])]};
  }
  const plan=planFavoriteCollection(next,edit,mods);
  const before=settings.favoriteCollections?.find(c=>c.id===edit.collectionId)??null;
  return {...plan,lines:[...(book?.lines??[]),...plan.lines],duplicates:book?.duplicates??[],expected:{before,files:book?.expected??null,lines:plan.lines}};
}
