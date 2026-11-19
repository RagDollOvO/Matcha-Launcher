// Matcha 以前叫 Flare。旧名字只在这里出现：本机数据目录、游戏目录里的 .flare-* 文件夹。
// 启动时把它们改成新名字，并把设置里记着的旧路径一起改掉；改不动（被占用）就先用旧的，下次启动再试。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** 桌面版数据目录（= Tauri identifier）与开发版数据目录 */
export const APP_DATA = { name: 'com.matcha.launcher', legacy: 'com.flare.launcher' };
export const DEV_DATA = { name: 'Matcha', legacy: 'Flare' };
/** 桌面壳改名数据目录后留下的标记：{ from, to } */
export const MARKER = 'legacy-rename.json';

/** 游戏目录里的文件夹。content = left4dead2，root = 游戏根目录 */
export const FOLDERS = {
  data: { name: '.matcha-data', base: 'content' },
  library: { name: '.matcha-library', base: 'content' },
  backups: { name: '.matcha-backups', base: 'content' },
  trash: { name: '.matcha-trash', base: 'content' },
  tests: { name: '.matcha-tests', base: 'root' },
  l4nPlugins: { name: '.matcha-l4n-plugins', base: 'root' },
};
export const legacyName = name => name.replace(/^\.matcha-/, '.flare-');
/** 游戏目录里的单个文件：autoexec.cfg 第一次被改前留的原文件备份 */
export const FILES = [{ from: 'left4dead2/cfg/autoexec.cfg.flare.bak', to: 'left4dead2/cfg/autoexec.cfg.matcha.bak' }];
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const present = p => { try { fs.lstatSync(p); return true; } catch { return false; } };

/** 正在用的文件夹名：新名字；旧文件夹还在、新的还没有时用旧的 */
export function folderName(base, key) {
  const { name } = FOLDERS[key];
  return !present(path.join(base, name)) && isDir(path.join(base, legacyName(name))) ? legacyName(name) : name;
}
/** 正在用的文件夹路径。base 是 left4dead2（content 类）或游戏根目录（root 类） */
export const gameFolder = (base, key) => path.join(base, folderName(base, key));
/** 目录名是不是这个文件夹（新旧名字都算） */
export const isFolder = (dir, key) => [FOLDERS[key].name, legacyName(FOLDERS[key].name)].includes(path.basename(dir).toLowerCase());

/** 当前该用的本机数据目录（不改名）：新目录在就用新的，否则旧的在就用旧的 */
export function currentDataDir(spec, base = process.env.LOCALAPPDATA) {
  if (!base) return null;
  const next = path.join(base, spec.name), old = path.join(base, spec.legacy);
  return !present(next) && isDir(old) ? old : next;
}
/** 开发版用：旧数据目录改成新名字；改不动就先用旧的 */
export function claimDataDir(spec, base = process.env.LOCALAPPDATA) {
  if (!base) return null;
  const next = path.join(base, spec.name), old = path.join(base, spec.legacy);
  if (present(next) || !isDir(old)) return next;
  try { fs.renameSync(old, next); } catch { return old; }
  try { fs.writeFileSync(path.join(next, MARKER), JSON.stringify({ from: old, to: next })); } catch {}
  return next;
}

const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
async function rename(from, to) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(from, to); }
    catch (e) { if (!BUSY.has(e.code) || i >= 4) throw e; await new Promise(r => setTimeout(r, 200)); }
  }
}

/** 以 from 开头（到分隔符或结尾为止）的字符串换成 to 开头；大小写不敏感，正反斜杠都认 */
export function rewritePath(value, pairs) {
  if (typeof value !== 'string') return value;
  for (const [from, to] of pairs) for (const [a, b] of [[from, to], [from.replaceAll('\\', '/'), to.replaceAll('\\', '/')]]) {
    if (value.length < a.length || value.slice(0, a.length).toLowerCase() !== a.toLowerCase()) continue;
    const rest = value.slice(a.length);
    if (!rest || rest[0] === '\\' || rest[0] === '/') return b + rest;
  }
  return value;
}
function rewriteJson(value, pairs) {
  if (typeof value === 'string') return rewritePath(value, pairs);
  if (Array.isArray(value)) return value.map(v => rewriteJson(v, pairs));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [rewritePath(k, pairs), rewriteJson(v, pairs)]));
  return value;
}
async function atomicWrite(file, text) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, text);
  try { await fsp.rename(temp, file); } catch (e) { await fsp.rm(temp, { force: true }); throw e; }
}
const MAX_JSON = 16 * 1024 * 1024;
// WebView 存储、浏览器资料和社区加速组件里没有我们的记录，也不该碰。
const SKIP = new Set(['ebwebview', 'node_modules', 'runtime', 'profiles', 'cache', 'downloads']);
async function* jsonFiles(dir, depth = 0) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 6 && !SKIP.has(e.name.toLowerCase())) yield* jsonFiles(full, depth + 1);
    else if (e.isFile() && /\.json$/i.test(e.name)) yield full;
  }
}

/**
 * 数据目录里记着的旧路径换成新路径：各个 .json 记录、茶茶对话的工作目录（会话头）、内置浏览器的下载记录。
 * 下载记录在桌面版由桌面壳持有，要经 patchBrowser 改（不能直接写文件，否则会被桌面壳的内存副本覆盖）。
 */
export async function rewriteReferences(dataDir, pairs, { patchBrowser } = {}) {
  const downloads = path.join(dataDir, 'browser', 'downloads.json'), changed = [];
  for await (const file of jsonFiles(dataDir)) {
    if (patchBrowser && path.resolve(file).toLowerCase() === path.resolve(downloads).toLowerCase()) continue;
    if (path.basename(file) === MARKER) continue;
    try {
      if ((await fsp.stat(file)).size > MAX_JSON) continue;
      const raw = await fsp.readFile(file, 'utf8'), data = JSON.parse(raw), next = rewriteJson(data, pairs);
      const text = JSON.stringify(next, null, /\n\s/.test(raw) ? 2 : undefined);
      if (text !== JSON.stringify(data, null, /\n\s/.test(raw) ? 2 : undefined)) { await atomicWrite(file, text + (raw.endsWith('\n') ? '\n' : '')); changed.push(file); }
    } catch (e) { if (!(e instanceof SyntaxError) && e.code !== 'ENOENT') throw e; }
  }
  // 茶茶按会话头里的工作目录找「上次的对话」，只改第一行。
  const sessions = path.join(dataDir, 'pi', 'sessions');
  for (const name of await fsp.readdir(sessions).catch(() => [])) if (name.endsWith('.jsonl')) {
    const file = path.join(sessions, name), raw = await fsp.readFile(file, 'utf8'), end = raw.indexOf('\n');
    const head = end < 0 ? raw : raw.slice(0, end);
    let header; try { header = JSON.parse(head); } catch { continue; }
    if (header?.type !== 'session' || typeof header.cwd !== 'string') continue;
    const cwd = rewritePath(header.cwd, pairs);
    if (cwd !== header.cwd) { await atomicWrite(file, JSON.stringify({ ...header, cwd }) + (end < 0 ? '' : raw.slice(end))); changed.push(file); }
  }
  if (patchBrowser) {
    let rows = [];
    try { rows = JSON.parse(await fsp.readFile(downloads, 'utf8')); } catch {}
    for (const row of Array.isArray(rows) ? rows : []) {
      const next = rewritePath(row?.path, pairs);
      if (typeof row?.path === 'string' && next !== row.path && row.state !== 'downloading') { await patchBrowser(row.id, row.path, { path: next }); changed.push(`${downloads}#${row.id}`); }
    }
  }
  return changed;
}

/**
 * 启动或换游戏目录时调用：
 * 1. 桌面壳/开发版刚把数据目录改了名 → 数据目录里的旧路径改成新路径；
 * 2. 游戏目录里的 .flare-* 文件夹改成 .matcha-*，记着它们的路径一起改。
 * 返回改过的文件夹和没改成的文件夹（没改成的继续用旧名字）。
 */
export async function migrateLegacyNames({ dataDir, gameRoot, patchBrowser }) {
  const pairs = [], renamed = [], failed = [], marker = path.join(dataDir, MARKER);
  let moved = null;
  try { moved = JSON.parse(await fsp.readFile(marker, 'utf8')); } catch {}
  if (typeof moved?.from === 'string' && typeof moved?.to === 'string' && path.isAbsolute(moved.from)) pairs.push([moved.from, dataDir]);
  if (gameRoot && path.isAbsolute(gameRoot) && isDir(path.join(gameRoot, 'left4dead2'))) {
    for (const { name, base } of Object.values(FOLDERS)) {
      const dir = base === 'root' ? gameRoot : path.join(gameRoot, 'left4dead2');
      const old = path.join(dir, legacyName(name)), next = path.join(dir, name);
      if (!isDir(old) || present(next)) continue;
      try { await rename(old, next); renamed.push({ from: old, to: next }); pairs.push([old, next], [legacyName(name), name]); }
      catch (e) { failed.push({ folder: old, code: e.code, message: e.message }); }
    }
  }
  if (gameRoot && path.isAbsolute(gameRoot)) for (const f of FILES) {
    const old = path.join(gameRoot, f.from), next = path.join(gameRoot, f.to);
    if (!present(old) || present(next)) continue;
    try { await rename(old, next); renamed.push({ from: old, to: next }); }
    catch (e) { failed.push({ folder: old, code: e.code, message: e.message }); }
  }
  const changed = pairs.length ? await rewriteReferences(dataDir, pairs, { patchBrowser }) : [];
  if (moved) await fsp.rm(marker, { force: true });
  return { dataDir: moved ? { from: moved.from, to: dataDir } : null, renamed, failed, changed };
}
