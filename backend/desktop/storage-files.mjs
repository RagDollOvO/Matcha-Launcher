import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory, exists, fail, stamp, writeJson } from '../mods/files.mjs';
export const same = (a, b) => path.relative(a, b) === '';
export const below = (a, b) => { const d = path.relative(a, b); return !!d && d !== '..' && !d.startsWith('..' + path.sep) && !path.isAbsolute(d); };
export const missing = async (p, otherwise) => { try {
  const s = await fs.lstat(p);
  if (!s.isFile() || s.isSymbolicLink())
    fail('unsafe_path', '需要普通记录文件：' + p);
  return await fs.readFile(p, 'utf8').then(JSON.parse);
}
catch (e) {
  if (e.code === 'ENOENT')
    return otherwise;
  throw e;
} };
export async function dirs(p, create = false) {
  const parent = path.dirname(p);
  if (parent !== p)
    await dirs(parent, create);
  return directory(p, create && parent !== p && !await exists(p));
}
export function layout(base, root) {
  const legacy = same(base, root), cache = legacy ? root : path.join(root, 'cache');
  return { browser: path.join(root, ...(legacy ? ['browser', 'downloads'] : ['downloads', 'browser'])),
    gamemaps: path.join(root, ...(legacy ? ['gamemaps', 'downloads'] : ['downloads', 'gamemaps'])),
    'native-libraries': path.join(cache, 'native-libraries'), 'platforms/cache': path.join(cache, 'platforms', 'cache'),
    'dll-sources': path.join(cache, 'dll-sources'), 'dll-intake': path.join(cache, 'dll-intake') };
}
export function profiles(base, root) {
  return same(base, root) ? [path.join(base, 'browser/profile'), path.join(base, 'browser/steam-profile'), path.join(base, 'gamemaps/profile')] :
    ['browser', 'steam', 'gamemaps'].map(k => path.join(root, 'profiles', k));
}
export const sum = rows => rows.reduce((s, x) => s + x.size, 0);
export async function tree(root, { skip = [], strict = false } = {}) {
  const files = [], folders = [];
  if (!await exists(root))
    return { files, folders };
  await dirs(path.dirname(root));
  async function walk(p, r) {
    if (skip.includes(p))
      return;
    let s;
    try {
      s = await fs.lstat(p);
    }
    catch (e) {
      if (!strict && e.code === 'ENOENT')
        return;
      throw e;
    }
    if (s.isSymbolicLink() || !s.isDirectory() && !s.isFile()) {
      if (strict)
        fail('unsafe_path', '存储目录包含链接或特殊文件：' + p);
      return;
    }
    if (s.isFile()) {
      files.push({ r, size: s.size, stamp: stamp(s) });
      return;
    }
    folders.push(r);
    let children;
    try {
      children = await fs.readdir(p);
    }
    catch (e) {
      if (!strict && e.code === 'ENOENT')
        return;
      throw e;
    }
    for (const n of children)
      await walk(path.join(p, n), path.join(r, n));
  }
  await walk(root, '');
  return { files, folders };
}
export async function volume(p) {
  let f = p;
  while (!await exists(f) && path.dirname(f) !== f)
    f = path.dirname(f);
  const s = await fs.statfs(f), root = path.parse(p).root;
  return { root, system: same(root, path.parse(process.env.SystemRoot || process.env.LOCALAPPDATA || p).root), freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
}
// Publish only to an absent destination. The journal records the original file identities
// before moving; after interruption it permits finishing only this exact unit.
export async function transfer(from, to, log, progress = () => { }) {
  let j = await missing(log, null);
  await dirs(path.dirname(from));
  await dirs(path.dirname(to), true);
  if (!j) {
    if (await exists(to))
      fail('storage_conflict', '目标已有同名内容，保留两边文件：' + to);
    const { files, folders } = await tree(from, { strict: true });
    const [source,destination]=await Promise.all([fs.stat(from,{bigint:true}),fs.stat(path.dirname(to),{bigint:true})]);
    j = { from, to, files, folders, tmp: '.matcha-moving-' + randomUUID(), phase: source.dev===destination.dev?'rename':'copy' };
    await writeJson(log, j);
  }
  if (!same(j.from, from) || !same(j.to, to) || !/^\.matcha-moving-[a-f0-9-]{36}$/.test(j.tmp))
    fail('storage_conflict', '上次搬家路径需要检查。');
  for (const r of [...j.folders, ...j.files.map(f => f.r)])
    if (r && (!below(from, path.resolve(from, r)) || !below(to, path.resolve(to, r))))
      fail('unsafe_path', '搬家记录越界。');
  const tmp = path.join(path.dirname(to), j.tmp), size = sum(j.files);
  const check = async (root, original, subset = false) => {
    const got = await tree(root, { strict: true }), dirsSet = new Set(j.folders), map = new Map(j.files.map(f => [f.r, f]));
    if ((!subset && (got.files.length !== j.files.length || got.folders.length !== j.folders.length)) || got.folders.some(r => !dirsSet.has(r)) ||
      got.files.some(f => !map.has(f.r) || f.size !== map.get(f.r).size || original && f.stamp !== map.get(f.r).stamp))
      fail('storage_changed', '搬家期间文件已变化：' + root);
    return got;
  };
  if (j.phase === 'rename') {
    if (await exists(from)) {
      await check(from, true);
      if (await exists(to))
        fail('storage_conflict', '目标已存在：' + to);
      try {
        await fs.rename(from, to);
      }
      catch (e) {
        if (e.code !== 'EXDEV')
          throw e;
        j.phase = 'copy';
        await writeJson(log, j);
      }
    }
    if (j.phase === 'rename') {
      await check(to, true);
      await fs.unlink(log);
      progress(size);
      return j;
    }
  }
  if (j.phase === 'copy') {
    if (await exists(to))
      fail('storage_conflict', '目标已存在：' + to);
    await check(from, true);
    for (const r of j.folders)
      await dirs(path.join(tmp, r), true);
    for (const f of j.files) {
      const file = path.join(from, f.r), t = path.join(tmp, f.r);
      if (await exists(t)) {
        const s = await fs.lstat(t);
        if (!s.isFile() || s.nlink !== 1)
          fail('unsafe_path', '搬家暂存文件异常：' + t);
        await fs.unlink(t);
      }
      await fs.copyFile(file, t, fs.constants.COPYFILE_EXCL);
      const st = await fs.stat(file);
      await fs.utimes(t, st.atime, st.mtime);
      if (stamp(st) !== f.stamp || (await fs.stat(t)).size !== f.size)
        fail('storage_changed', '复制校验失败：' + file);
      progress(f.size);
    }
    const staged = await check(tmp, false);
    j.published = Object.fromEntries(staged.files.map(f => [f.r, f.stamp]));
    j.phase = 'publish';
    await writeJson(log, j);
  }
  if (j.phase === 'publish') {
    if (await exists(tmp)) {
      if (await exists(to))
        fail('storage_conflict', '目标已存在：' + to);
      await fs.rename(tmp, to);
    }
    await check(to, false);
    j.phase = 'remove';
    await writeJson(log, j);
  }
  if (j.phase !== 'remove')
    fail('storage_conflict', '搬家进度记录无效。');
  const published = await check(to, false);
  if (published.files.some(f => j.published?.[f.r] !== f.stamp))
    fail('storage_changed', '目标副本已变化，保留来源：' + from);
  if (await exists(from)) {
    const left = await check(from, true, true);
    for (const f of left.files) {
      const src = path.join(from, f.r);
      if (stamp(await fs.lstat(src)) !== f.stamp)
        fail('storage_changed', '来源已变化：' + src);
      await fs.unlink(src);
    }
    for (const r of left.folders.reverse())
      await fs.rmdir(path.join(from, r));
  }
  await fs.unlink(log);
  return j;
}
