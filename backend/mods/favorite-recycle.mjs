import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fail, stamp} from './files.mjs';

const inside=(p,parent)=>{const rel=path.relative(parent,p);return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));};
export async function previewRecycleSources(service,ids,projectRoot){
  if(!Array.isArray(ids)||!ids.length||ids.length>256)fail('invalid_argument','请选择要放入系统回收站的外部原件。');
  const items=new Map(), desktop=await service.getDesktop(), gameRoot=await service.root();
  const protectedTrees=[service.dataDir,projectRoot,gameRoot,process.env.SystemRoot,process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean);
  for(const id of new Set(ids)){
    const ref=service.settings.favoriteRefs?.[id];
    if(!ref||!id.startsWith('favorite-file:'))fail('favorite_missing','此项由 Matcha 库或回收站管理。');
    const file=ref.absolutePath;
    const absolute=await fs.realpath(file).catch(e=>{if(e.code==='ENOENT')fail('path_missing','原件已移动或已在回收站：'+file);throw e;});
    if(path.relative(file,absolute)!=='' || !path.isAbsolute(file) || protectedTrees.some(p=>inside(file,p)||inside(p,file)) || [desktop,os.homedir()].some(p=>inside(p,file)) || !path.basename(file))fail('protected_path','请选择独立的外部原件，游戏、启动器和系统目录受保护。');
    const stat=await fs.lstat(file), folder=ref.referenceKind==='folder';
    if(stat.isSymbolicLink()||!(folder?stat.isDirectory():stat.isFile()))fail('file_changed','收藏来源类型已变化。');
    const files= !folder && /_dir\.vpk$/i.test(file) ? (await service.modManager.cached(file)).files.map(x=>x.file) : [file];
    for(const source of files)items.set(source,{file:source,stamp:stamp(await fs.lstat(source)),folder});
  }
  const plan=[...items.values()];
  if(plan.some(a=>a.folder && plan.some(b=>a!==b && inside(b.file,a.file))))fail('invalid_argument','同时选中了文件夹和其中的文件，请只选择外层文件夹。');
  return plan;
}
export async function recycleSources(plan,executable){
  if(process.platform!=='win32')fail('unsupported_platform','系统回收站需要 Windows。');
  let done=0;
  for(const item of plan){
    try {
      if(stamp(await fs.lstat(item.file))!==item.stamp)fail('file_changed','原件已变化，请重新确认。');
      await promisify(execFile)(executable,[item.file],{windowsHide:true});
      done++;
    } catch(e){fail('recycle_failed',`已回收 ${done}/${plan.length} 项；请检查 ${item.file}：${e.stderr?.trim()||e.message}`);}
  }
  return {done};
}
