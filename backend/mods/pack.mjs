import fs from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { directory, exists, fail, safeResourcePath, taskDirectory, removeTaskDirectory } from './files.mjs';
import { identity } from './vpk.mjs';

// A loose resource folder can also be dropped directly, e.g. materials/foo.vmt.
const resourceRoots = new Set('materials models sound scripts maps missions particles resource scenes media cfg expressions'.split(' '));
const ignore = new Set(['.git', '.svn', '.hg', '.ds_store', 'thumbs.db', 'desktop.ini']);
const maxPackage = 0x7fffffff; // single, embedded Source 1 VPK
const changed = () => fail('file_changed', '打包素材已变化，请重新拖入文件夹。');
const within = (parent, child) => { const rel = path.relative(parent, child); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); };

export async function packSource(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('invalid_argument', '请选择素材文件夹的完整路径。');
  const source = await fs.realpath(await directory(path.resolve(file)));
  const base = path.basename(source);
  if (!base) fail('invalid_argument', '请选择单个 Mod 的素材文件夹。');
  const name = base + '.vpk';
  safeResourcePath(name);
  if (name.length > 255) fail('invalid_argument', '文件夹名称太长，请缩短后再打包。');
  return {kind:'folder',file:source,name,prefix:resourceRoots.has(base.toLowerCase())?base.toLowerCase():'',sourceStamp:identity(await fs.lstat(source))};
}
export async function folderSource(file, gameRoot, replaceExisting = false) {
  const input=await packSource(file), {name}=input;
  const content=await fs.realpath(await directory(path.join(gameRoot,'left4dead2')));
  if(within(input.file,path.join(content,'addons'))) fail('invalid_argument','请选择单个 Mod 的素材文件夹。');
  const targetExists = await exists(path.join(content, 'addons', name));
  if (!replaceExisting && targetExists) fail('file_exists', `已有同名文件：${name}。请重新查看替换提示，或给素材文件夹换名。`);
  return {...input,targetExists};
}

async function inventory(input, signal) {
  const files = [], dirs = [], names = new Set();
  let payload = 0;
  function add(item) {
    const key = item.name.toLowerCase();
    if (names.has(key)) fail('invalid_argument', `资源路径重复：${item.name}`);
    names.add(key); files.push(item); payload += item.size;
    if (files.length > 250000 || payload > maxPackage) fail('resource_too_large', '单包上限为 2 GiB、25 万个资源，请分成多个素材文件夹。');
  }
  async function walk(folder, prefix) {
    signal.throwIfAborted();
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !within(input.file, await fs.realpath(folder))) fail('unsafe_path', `请移出目录链接：${folder}`);
    dirs.push({ folder, stamp: identity(stat) });
    for (const name of (await fs.readdir(folder)).sort()) {
      signal.throwIfAborted();
      if (ignore.has(name.toLowerCase())) continue;
      const disk = path.join(folder, name), rel = prefix ? prefix + '/' + name : name;
      safeResourcePath(rel);
      const s = await fs.lstat(disk);
      if (s.isSymbolicLink()) fail('unsafe_path', `请移出文件或目录链接：${rel}`);
      if (s.isDirectory()) await walk(disk, rel);
      else if (!s.isFile()) fail('unsafe_path', `需要普通资源文件：${rel}`);
      else if (/\.vpk$/i.test(name)) fail('nested_vpk', `文件夹里已有 ${rel}，请直接拖入现成的 VPK。`);
      else add({ name: rel, disk, size: s.size, stamp: identity(s) });
    }
  }
  await walk(input.file, input.prefix);
  if (!files.length) fail('empty_folder', '这个文件夹里没有可打包的文件。');
  if (!names.has('addoninfo.txt')) {
    const data = Buffer.from(`"AddonInfo"\r\n{\r\n\t"addonSteamAppID" "550"\r\n\t"addontitle" "${path.basename(input.file)}"\r\n}\r\n`);
    add({ name: 'addoninfo.txt', data, size: data.length });
  }
  return { files, dirs, payload };
}

// Directory strings use the VPK single-space sentinel for root / no extension.
// Record CRCs are filled while streaming; only the tree and one I/O buffer live in memory.
function layout(files, payload) {
  const groups = new Map(), chunks = [], end = Buffer.from([0]); let offset = 0;
  for (const f of files) {
    const ext = path.posix.extname(f.name), parent = path.posix.dirname(f.name);
    const group = ext.slice(1) || ' ', dir = parent === '.' ? ' ' : parent;
    if (!groups.has(group)) groups.set(group, new Map());
    const dirs = groups.get(group);
    if (!dirs.has(dir)) dirs.set(dir, []);
    f.record = Buffer.alloc(18);
    f.record.writeUInt16LE(0x7fff, 6); f.record.writeUInt32LE(offset, 8);
    f.record.writeUInt32LE(f.size, 12); f.record.writeUInt16LE(0xffff, 16);
    dirs.get(dir).push(Buffer.from(path.posix.basename(f.name, ext) + '\0'), f.record);
    offset += f.size;
  }
  for (const [ext, dirs] of groups) {
    chunks.push(Buffer.from(ext + '\0'));
    for (const [dir, entries] of dirs) {
      chunks.push(Buffer.from(dir + '\0'));
      for (const entry of entries) chunks.push(entry);
      chunks.push(end);
    }
    chunks.push(end);
  }
  chunks.push(end);
  const size = chunks.reduce((n, b) => n + b.length, 0);
  if (size > 64 * 1024 ** 2 || size + 12 + payload > maxPackage) fail('resource_too_large', '目录树或素材超出单个 VPK 容量，请拆分文件夹。');
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x55aa1234); header.writeUInt32LE(1, 4); header.writeUInt32LE(size, 8);
  return { chunks, size, header };
}

async function writeAt(handle, data, pos) {
  for (let n = 0; n < data.length;) {
    const { bytesWritten } = await handle.write(data, n, data.length - n, pos + n);
    if (!bytesWritten) fail('write_failed', 'VPK 写入中断，请检查磁盘空间。');
    n += bytesWritten;
  }
}

async function writePackage(target, input, { files, dirs, payload }, ctx) {
  const tree = layout(files, payload), start = 12 + tree.size, buf = Buffer.allocUnsafe(512 * 1024);
  const out = await fs.open(target, 'wx');
  let done = 0;
  try {
    ctx.progress({ done, total: payload, unit: 'bytes' });
    for (const f of files) {
      ctx.signal.throwIfAborted();
      let crc = 0;
      if (f.data) {
        await writeAt(out, f.data, start + done); crc = crc32(f.data); done += f.size;
      } else {
        if (!within(input.file, await fs.realpath(f.disk))) changed();
        const src = await fs.open(f.disk, 'r');
        try {
          if (identity(await src.stat()) !== f.stamp) changed();
          for (let n = 0; n < f.size;) {
            ctx.signal.throwIfAborted();
            const { bytesRead } = await src.read(buf, 0, Math.min(buf.length, f.size - n), n);
            if (!bytesRead) changed();
            const part = buf.subarray(0, bytesRead);
            await writeAt(out, part, start + done); crc = crc32(part, crc); n += bytesRead; done += bytesRead;
            ctx.progress({ done, total: payload, unit: 'bytes' });
          }
          if (identity(await src.stat()) !== f.stamp) changed();
        } finally { await src.close(); }
      }
      f.record.writeUInt32LE(crc);
    }
    for (const d of dirs) if (identity(await fs.lstat(d.folder)) !== d.stamp) changed();
    await writeAt(out, Buffer.concat([tree.header, ...tree.chunks], start), 0);
    await out.sync();
  } finally { await out.close(); }
}

export async function packModFolder(request, ctx, publish) {
  const input = request.exportDir ? await packSource(request.file) : await folderSource(request.file, request.gameRoot, request.replaceExisting === true);
  const parent = request.exportDir ? await fs.realpath(await directory(request.exportDir)) : path.join(request.gameRoot,'left4dead2');
  if(request.exportDir && within(input.file,parent)) fail('invalid_argument','请选择桌面以外的素材目录，或桌面中的单个素材文件夹。');
  if (input.sourceStamp !== request.sourceStamp) changed();
  const items = await inventory(input, ctx.signal);
  const stage = await taskDirectory(parent, ctx.taskId, 'pack');
  try {
    const file = path.join(stage, input.name);
    await writePackage(file, input, items, ctx);
    const result = await ctx.commit(async () => {
      if (!request.exportDir) return publish(file);
      const stem=path.basename(input.name,'.vpk');
      for(let n=1;n<=10000;n++){
        const output=path.join(parent,stem+(n===1?'':' ('+n+')')+'.vpk');
        try { await fs.link(file,output); return {output}; }
        catch(e){if(e.code!=='EEXIST')throw e;}
      }
      fail('file_exists','同名 VPK 过多，请更换素材文件夹名称。');
    });
    return { ...result, fileCount: items.files.length, done: items.payload, total: items.payload };
  } finally { await removeTaskDirectory(stage, ctx.taskId); }
}
