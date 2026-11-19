import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { directory, fail, safeResourcePath, stamp } from './files.mjs';
import { regular, identity } from './vpk.mjs';

const indexVpk = name => /\.vpk$/i.test(name) && !/_\d{3}\.vpk$/i.test(name);
const MAX_BYTES = 8 * 1024 ** 3;

const creatorSites = new Map(Object.entries({
  bilibili: ['bilibili.com'], afdian: ['afdian.com', 'afdian.net', 'ifdian.net'],
  steam: ['steamcommunity.com'], gamemaps: ['gamemaps.com'],
}));
const label = value => typeof value === 'string' ? [...value.trim()].slice(0, 200).join('') : '';
/** Keep the closest two distinct sites. Old records simply omit the optional field. */
export function creatorFields(raw) {
  const creators = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const sites = creatorSites.get(item?.source);
    if (!sites || typeof item.url !== 'string' || creators.some(c => c.source === item.source)) continue;
    let u; try { u = new URL(item.url); } catch { continue; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !sites.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) continue;
    if (typeof item.title !== 'string') continue;
    const author = label(item.author);
    creators.push({ source: item.source, url: u.href, title: label(item.title), ...(author ? { author } : {}) });
    if (creators.length === 2) break;
  }
  return creators.length ? { creators } : {};
}

/** Only completed, native-received downloads can enter this import path. */
export async function browserDownload(dataDir, id, roots) {
  if (typeof id !== 'string' || !/^\d+-\d+$/.test(id)) fail('invalid_argument', '下载记录标识无效。');
  const base = path.join(dataDir, 'browser');
  const records = JSON.parse(await fs.readFile(path.join(base, 'downloads.json'), 'utf8'));
  const row = records.find(d => d.id === id);
  if (!row || row.state !== 'done') fail('download_incomplete', '请等待文件下载完成。');
  if(row.cleaned)fail('download_cleaned','这个压缩包已在导入后清理，请从来源页重新下载。');
  const dir=(roots??[path.join(base,'downloads')]).find(r=>typeof row.path==='string' && path.relative(path.join(r,id),path.dirname(row.path))==='');
  if(!dir)fail('unsafe_path','下载目录与记录不符。');
  for(let d=path.join(dir,id);path.dirname(d)!==d;d=path.dirname(d))await directory(d);
  const folder=path.join(dir,id);
  if (typeof row.path !== 'string' || path.dirname(path.resolve(row.path)).toLowerCase() !== path.resolve(folder).toLowerCase()) fail('unsafe_path', '下载记录路径需要检查。');
  await regular(row.path);
  return row;
}
async function zipEntries(file, visit, signal) {
  signal?.throwIfAborted();
  const zip = await yauzl.openPromise(file, { strictFileNames: true, autoClose: true, validateEntrySizes: true });
  let count = 0, bytes = 0;
  const seen = new Set();
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      if (++count > 4096) fail('archive_limit', '压缩包文件超过 4096 项，请先在文件夹中整理后导入。');
      const name = entry.fileName;
      safeResourcePath(name.replace(/\/$/, ''));
      if (name.endsWith('/')) continue;
      if (seen.has(name.toLowerCase())) fail('archive_duplicate', '压缩包包含重复文件名，请先整理。');
      seen.add(name.toLowerCase());
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) fail('unsafe_path', '压缩包含链接文件，请先整理后导入。');
      if (!/\.vpk$/i.test(name)) continue;
      if (entry.isEncrypted()) fail('archive_encrypted', '这是加密 ZIP，请使用作者提供的密码解压，再导入 VPK。');
      bytes += entry.uncompressedSize;
      if (bytes > MAX_BYTES) fail('archive_limit', 'VPK 解压大小超过 8 GiB，请在文件夹中解压后导入。');
      await visit(zip, entry);
    }
  } finally { zip.close(); }
}
export async function listBrowserArchive(dataDir, id, roots) {
  const row = await browserDownload(dataDir, id, roots);
  return listVpkArchive(row.path);
}
export async function listVpkArchive(file, signal) {
  await regular(file);
  if (!/\.zip$/i.test(file)) fail('invalid_argument', '请选择 ZIP 压缩包。');
  const items = [];
  await zipEntries(file, async (_, e) => { if (indexVpk(e.fileName)) items.push({ name: e.fileName, size: e.uncompressedSize }); }, signal);
  return { items };
}
export async function browserImportFiles(dataDir, id, selected, roots) {
  const row = await browserDownload(dataDir, id, roots);
  return { row:{...row,importStamp:stamp(await regular(row.path))}, files: await archiveImportFiles(row.path, selected) };
}
/** The caller establishes ownership of file; browser and GameMaps records stay separate. */
export async function archiveImportFiles(file, selected, signal) {
  await regular(file); signal?.throwIfAborted();
  if (/\.vpk$/i.test(file)) return [file];
  if (!/\.zip$/i.test(file)) fail('archive_format', '请先解压这个文件，再导入其中的 VPK。');
  if (!Array.isArray(selected) || !selected.length || selected.some(n => typeof n !== 'string' || !indexVpk(n))) fail('invalid_argument', '请勾选要导入的 VPK。');
  const before = identity(await regular(file));
  const listing = await listVpkArchive(file, signal);
  const wanted = new Set(selected);
  if ([...wanted].some(n => !listing.items.some(i => i.name === n))) fail('archive_changed', '压缩包内容已变化，请重新选择。');
  const stage = path.join(path.dirname(file), `unpacked-${randomUUID()}`);
  await directory(stage, true);
  const matches = name => wanted.has(name) || [...wanted].some(n => /_dir\.vpk$/i.test(n)
    && name.startsWith(n.slice(0, -8)) && /^_\d{3}\.vpk$/i.test(name.slice(n.length - 8)));
  const manifest=[];
  await zipEntries(file, async (zip, entry) => {
    if (!matches(entry.fileName)) return;
    const target = path.join(stage, ...safeResourcePath(entry.fileName));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(target, { flags: 'wx' }), { signal });
    manifest.push([entry.fileName,stamp(await regular(target))]);
  }, signal);
  if (identity(await regular(file)) !== before) fail('file_changed', '解压期间文件发生变化，请重新下载。');
  await fs.writeFile(path.join(stage,'.matcha-extracted.json'),JSON.stringify(manifest),{flag:'wx'});
  return [...wanted].map(n => path.join(stage, ...safeResourcePath(n)));
}

// Retire only the files created by this extraction, after all selected imports committed.
export async function releaseExtracted(archive,files){
  if(!/\.zip$/i.test(archive)||!files.length)return;
  const parent=path.dirname(archive), first=path.relative(parent,files[0]).split(path.sep)[0];
  if(!/^unpacked-[0-9a-f-]{36}$/.test(first))return;
  const root=path.join(parent,first), marker=path.join(root,'.matcha-extracted.json');
  if(!await fs.lstat(marker).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e}))return;
  await directory(root);await regular(marker);const list=JSON.parse(await fs.readFile(marker,'utf8')),folders=new Set();
  for(const [name,sig] of list){const parts=safeResourcePath(name);let d=root;
    for(const n of parts.slice(0,-1)){d=path.join(d,n);await directory(d);folders.add(d)}
    const f=path.join(root,...parts);let st;try{st=await regular(f)}catch(e){if(e.code==='ENOENT')continue;throw e}
    if(stamp(st)!==sig) return;
    await fs.unlink(f);
  }
  await fs.unlink(marker);
  for(const d of [...folders].sort((a,b)=>b.length-a.length).concat(root))await fs.rmdir(d).catch(e=>{if(e.code!=='ENOTEMPTY'&&e.code!=='EEXIST')throw e});
}

// Pre-receipt releases saved provenance per imported Mod. Recover a positive receipt
// only if every VPK (including split shards) matches the installed, attributed set.
export async function legacyArchiveImported(archive,addons,ids){
  if(!ids.size)return false;
  const matched=new Set(),seen=new Set(),mismatch=new Error('mismatch');
  try{
    await directory(addons);const names=new Map((await fs.readdir(addons)).map(n=>[n.toLowerCase(),n]));
    await zipEntries(archive,async(zip,entry)=>{
      const key=path.basename(entry.fileName).toLowerCase(),name=names.get(key);
      if(!name||seen.has(key))throw mismatch;seen.add(key);
      if(indexVpk(key)){if(!ids.has(key))throw mismatch;matched.add(key);}
      else if(!ids.has(key.replace(/_\d{3}\.vpk$/,'_dir.vpk')))throw mismatch;
      const f=path.join(addons,name),before=await regular(f);
      if(before.size!==entry.uncompressedSize)throw mismatch;
      const h=await fs.open(f,'r');try{
        let pos=0;for await(const bytes of await zip.openReadStreamPromise(entry)){
          const buffer=Buffer.allocUnsafe(bytes.length);const {bytesRead}=await h.read(buffer,0,buffer.length,pos);
          if(bytesRead!==bytes.length||!buffer.equals(bytes))throw mismatch;pos+=bytesRead;
        }if(pos!==before.size||stamp(before)!==stamp(await regular(f)))throw mismatch;
      }finally{await h.close()}
    });return matched.size>0;
  }catch(e){if(e===mismatch||e.code==='ENOENT'||e.code==='unsafe_path')return false;throw e}
}
