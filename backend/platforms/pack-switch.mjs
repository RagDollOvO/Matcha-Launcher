// Declarative controls for already installed packages. No commands or downloaded code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fail, platformPath, readBytes, relativePath } from './files.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
const held = (why) => ({enabled:null,reason:why});
const parkedCache=new Map();
async function matchesParked(file,digest){
  if(!file)return false;
  const {dev,ino,size,mtimeNs,ctimeNs}=await fs.stat(file,{bigint:true}), stamp=[dev,ino,size,mtimeNs,ctimeNs,digest].join(':');
  if(parkedCache.get(file)===stamp)return true;
  if(hash(await readBytes(file,16*1024*1024))!==digest)return false;
  if(parkedCache.size>256)parkedCache.clear();parkedCache.set(file,stamp);return true;
}
export function switchRecipe(raw, id, files) {
  if (!raw) return undefined;
  const rel = relativePath(raw.path);
  if (raw.kind==='park-entry' && /^left4dead2\/addons\/[a-z0-9_-]+\.vdf$/i.test(rel) &&
      files.filter(f=>f.role==='entry').length===1 && files.some(f=>f.role==='entry' && f.path===rel) && files.some(f=>f.role==='module' && /\.dll$/i.test(f.path))) return {kind:raw.kind,path:rel};
  const parts=rel.split('/');
  if (raw.kind==='ini-flag' && parts.length===3 && parts[0]==='left4dead2' && parts[1]===id && !/^(?:addons|bin|cfg|scripts|resource|maps|materials|models|save|ems|downloads)$/i.test(id) && /^[\w.-]+\.ini$/i.test(parts[2]) &&
      typeof raw.key==='string' && /^(?:[a-z0-9_]{1,40}_)?(?:enable[d]?|disable[d]?|active)$/i.test(raw.key) && [0,1].includes(raw.on) &&
      !files.some(f=>f.path.toLowerCase()===rel.toLowerCase())) return {kind:raw.kind,path:rel,key:raw.key,on:raw.on};
  fail('switch_recipe','请登记单一 addons VDF 入口，或模组专属 INI 中唯一的 0/1 启停键。其他方式保留作者维护入口。');
}
// A parked file carries its original digest in its suffix. It can only go back to its own slot.
async function parking(root,r) {
  const active=await platformPath(root,r.path), dir=path.dirname(path.join(root,r.path));
  const prefix=path.basename(r.path)+'.matcha-off-';
  const names=(await fs.readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(n=>n.toLowerCase().startsWith(prefix.toLowerCase()));
  if(names.length>1)return held('存在多份暂存入口');
  if(!names.length)return active?{enabled:true,active}:held('缺少入口');
  const name=names[0], digest=name.slice(prefix.length);
  if(!/^[a-f0-9]{64}$/.test(digest))return held('暂存入口标记异常');
  const rel=path.posix.join(path.posix.dirname(r.path),name), parked=await platformPath(root,rel);
  if(!await matchesParked(parked,digest))return held('暂存入口与停用时不符');
  if(active){
    const [a,b]=await Promise.all([active,parked].map(p=>fs.stat(p,{bigint:true})));
    if(a.dev!==b.dev || a.ino!==b.ino || !a.ino)return held('启动入口已有其他文件');
    return {enabled:true,active,parked,rel,pending:true};
  }
  return {enabled:false,parked,rel};
}
function flag(bytes,r) {
  const text=bytes.toString('latin1');
  if(text.includes('\0'))return null;
  const found=[...text.matchAll(new RegExp('^([ \\t]*'+r.key+'[ \\t]*=[ \\t]*)([01])(?=[ \\t]*(?:[;#][^\\r\\n]*)?\\r?$)','gmi'))];
  const all=[...text.matchAll(new RegExp('^[ \\t]*'+r.key+'[ \\t]*=','gmi'))];
  if(found.length!==1 || all.length!==1)return null;
  return {offset:found[0].index+found[0][1].length,enabled:Number(found[0][2])===r.on};
}
export async function readSwitch(root,r) {
  if(!r)return null;
  try {
    if(r.kind==='park-entry')return await parking(root,r);
    const f=await platformPath(root,r.path);
    if(!f || (await fs.stat(f)).nlink!==1)return held('找不到独立的作者配置文件');
    return flag(await readBytes(f,512*1024),r) ?? held('配置中没有唯一可识别的启停值');
  } catch { return held('入口或配置无法安全读取'); }
}
export async function verifiedVdf(file,files){
  if(!file)return false;
  const text=(await readBytes(file,32768)).toString('utf8').replace(/^\uFEFF/,'').replace(/^\s*\/\/[^\r\n]*/gm,'');
  const m=/^\s*"?Plugin"?\s*\{\s*"?file"?\s+"([\w./\\-]+)"\s*\}\s*$/i.exec(text);
  if(!m)return false;
  const rel=m[1].replaceAll('\\','/').replace(/\.dll$/i,'');
  if(!/^addons\/(?:[\w-]+\/)*[\w-]+$/i.test(rel))return false;
  return files.some(f=>f.role==='module' && f.state==='match' && f.path.toLowerCase()===('left4dead2/'+rel+'.dll').toLowerCase());
}
export async function applySwitch(root,r,enabled,verify) {
  const s=await readSwitch(root,r);
  if(!s || s.enabled===null)fail('switch_blocked',s?.reason??'缺少启停方式');
  if(s.enabled===enabled && !s.pending)return;
  if(r.kind==='ini-flag'){
    const file=await platformPath(root,r.path), h=await fs.open(file,'r+');
    try{
      const st=await h.stat();if(st.nlink!==1||st.size>512*1024)fail('switch_stale','配置已变化');
      const b=await h.readFile(),f=flag(b,r);
      if(!f || f.enabled!==s.enabled)fail('switch_stale','启停键已变化');
      await verify();
      const now=await fs.lstat(file),v=await readBytes(file,512*1024);
      if(!now.isFile() || now.dev!==st.dev || now.ino!==st.ino || now.nlink!==1 || !b.equals(v))fail('switch_stale','配置已变化');
      await h.write(Buffer.from(String(enabled?r.on:1-r.on)),0,1,f.offset);await h.sync();
    }finally{await h.close();}
    return;
  }
  const source=enabled?s.parked:s.active, original=await fs.lstat(source,{bigint:true}), bytes=await readBytes(source,16*1024*1024);
  const dest=enabled?path.join(root,r.path):source+'.matcha-off-'+hash(bytes);
  await verify();
  if(!s.pending){
    if((await fs.stat(source)).nlink!==1)fail('switch_blocked','入口已与其他文件共享，保持原状。');
    await fs.link(source,dest); // No replacement; after interruption the same-inode pair can finish in either direction.
  }
  const [a,b]=await Promise.all([source,dest].map(p=>fs.lstat(p,{bigint:true})));
  if(!a.isFile()||!b.isFile()||!a.ino||a.dev!==b.dev||a.ino!==b.ino||b.nlink!==2n||original.ino!==a.ino||original.dev!==a.dev||original.size!==a.size||original.mtimeNs!==a.mtimeNs)fail('switch_stale','切换期间入口已变化，文件已保留。');
  await fs.unlink(source);
}
