// 茶茶体检用的只读检查：Steam 库里填的启动选项、游戏 cfg 目录里的文件、autoexec.cfg 的 Matcha 管理段。
// 只读文件，不改任何东西；写入仍然只走 game-settings 的管理段（见 docs/agent-checkup-handoff.md）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseKeyValues, windowsSteamRoots } from './core.mjs';

export const TEXT_LIMIT = 64 * 1024;
const VDF_LIMIT = 32 * 1024 * 1024;
const LIST_LIMIT = 200;
const CFG_EXT = new Set(['.cfg', '.txt', '.rc']);
const missing = e => e.code === 'ENOENT' || e.code === 'ENOTDIR';
const fail = (code, message, details) => { throw Object.assign(new Error(message), { code, ...(details !== undefined ? { details } : {}) }); };

/** <游戏目录>/left4dead2/cfg；路径上任一段是链接或不是目录时返回 null 并说明原因 */
async function cfgDir(root) {
  let dir = path.resolve(root);
  for (const part of ['', 'left4dead2', 'cfg']) {
    if (part) dir = path.join(dir, part);
    const stat = await fs.lstat(dir).catch(e => { if (missing(e)) return null; throw e; });
    if (!stat) return { dir, reason: `${part || '游戏目录'} 不存在` };
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { dir, reason: `${part || '游戏目录'} 不是普通目录` };
  }
  return { dir };
}

/** 读一个文本文件：超过上限截断；UTF-16 / 含空字符的只给说明 */
async function readText(file) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, TEXT_LIMIT);
    const buffer = Buffer.alloc(length);
    if (length) await handle.read(buffer, 0, length, 0);
    if (buffer[0] === 0xff && buffer[1] === 0xfe || buffer[0] === 0xfe && buffer[1] === 0xff || buffer.includes(0)) {
      return { text: '', bytes: size, truncated: false, unreadable: '文件是 UTF-16 或包含空字符，游戏可能读不了，请转成普通文本' };
    }
    const body = buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? buffer.subarray(3) : buffer;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); }
    catch { text = body.toString('latin1'); } // 旧编码按字节原样给出
    return { text, bytes: size, truncated: size > TEXT_LIMIT };
  } finally { await handle.close(); }
}

const START = /^\s*\/\/\s*>>>\s*(?:Matcha|Flare)/, END = /^\s*\/\/\s*<<<\s*(?:Matcha|Flare)/;
/** autoexec.cfg 里由 Matcha 写入的那一段 */
export function managedBlock(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const start = lines.findIndex(l => START.test(l)), end = lines.findIndex(l => END.test(l));
  if (start < 0 && end < 0) return { present: false, text: '' };
  if (start < 0 || end < start) return { present: true, text: '', broken: '标记缺失或顺序异常' };
  return { present: true, text: lines.slice(start + 1, end).join('\n') };
}

/** cfg 目录顶层的 .cfg / .txt / .rc（不递归） */
export async function cfgFiles(root) {
  const { dir, reason } = await cfgDir(root);
  if (reason) return { dir, files: [], reason };
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || !CFG_EXT.has(path.extname(e.name).toLowerCase())) continue;
    const stat = await fs.lstat(path.join(dir, e.name)).catch(() => null);
    if (stat?.isFile()) files.push({ name: e.name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return { dir, files: files.slice(0, LIST_LIMIT), ...(files.length > LIST_LIMIT ? { omitted: files.length - LIST_LIMIT } : {}) };
}

/** 读 cfg 目录里的单个文件；只收文件名，拒绝路径、链接和非文本扩展名 */
export async function readCfgFile(root, name) {
  if (typeof name !== 'string' || !name || name.length > 128 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || name === '.' || name === '..') {
    fail('cfg_file_invalid', '请只给 cfg 目录里的文件名，例如 autoexec.cfg。', { field: 'file' });
  }
  if (!CFG_EXT.has(path.extname(name).toLowerCase())) fail('cfg_file_invalid', '只读取 .cfg、.txt 和 .rc 文件。', { field: 'file' });
  const { dir, reason } = await cfgDir(root);
  if (reason) fail('cfg_dir_missing', `cfg 目录读不了：${reason}`);
  const file = path.join(dir, name);
  const stat = await fs.lstat(file).catch(e => { if (missing(e)) return null; throw e; });
  if (!stat) fail('cfg_file_missing', `cfg 目录里没有 ${name}。`, { field: 'file' });
  if (stat.isSymbolicLink() || !stat.isFile()) fail('cfg_file_invalid', `${name} 不是普通文件。`, { field: 'file' });
  return { name, modifiedAt: stat.mtime.toISOString(), ...await readText(file) };
}

/** autoexec.cfg 全文和其中的 Matcha 管理段 */
export async function autoexecState(root) {
  const { dir, reason } = await cfgDir(root);
  const file = path.join(dir, 'autoexec.cfg');
  if (reason) return { path: file, exists: false, reason };
  const stat = await fs.lstat(file).catch(e => { if (missing(e)) return null; throw e; });
  let backup;
  for (const name of [`${file}.matcha.bak`, `${file}.flare.bak`]) if (!backup) backup = await fs.lstat(name).then(s => s.isFile() ? name : undefined, () => undefined);
  if (!stat) return { path: file, exists: false, ...(backup ? { backup } : {}) };
  if (stat.isSymbolicLink() || !stat.isFile()) return { path: file, exists: true, reason: 'autoexec.cfg 不是普通文件' };
  const read = await readText(file);
  return { path: file, exists: true, ...read, managed: managedBlock(read.text), ...(backup ? { backup } : {}) };
}

const pick = (obj, key) => {
  if (!obj || typeof obj !== 'object') return undefined;
  const hit = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
  return hit === undefined ? undefined : obj[hit];
};

/**
 * Steam 库里给 L4D2 填的启动选项：<Steam>/userdata/<账号>/config/localconfig.vdf → apps/550/LaunchOptions。
 * 多个账号都列出来。只读；Steam 运行时这里的内容可能还没写回文件。
 */
export async function steamLaunchOptions(gameRoot, { roots } = {}) {
  // 注册表和游戏目录推出来的 Steam 目录大小写可能不同，按不分大小写去重
  const found = new Map(), add = dir => { const key = path.resolve(dir).toLowerCase(); if (!found.has(key)) found.set(key, dir); };
  for (const dir of roots ?? await windowsSteamRoots().catch(() => [])) add(dir);
  if (gameRoot) {
    const common = path.dirname(gameRoot), apps = path.dirname(common);
    if (path.basename(common).toLowerCase() === 'common' && path.basename(apps).toLowerCase() === 'steamapps') add(path.dirname(apps));
  }
  const dirs = [...found.values()];
  const entries = [], problems = [];
  for (const root of dirs) {
    const userdata = path.join(root, 'userdata');
    const accounts = await fs.readdir(userdata, { withFileTypes: true }).catch(e => { if (missing(e)) return []; throw e; });
    for (const account of accounts) {
      if (!account.isDirectory() || !/^\d+$/.test(account.name) || account.name === '0') continue;
      const source = path.join(userdata, account.name, 'config', 'localconfig.vdf');
      try {
        const stat = await fs.stat(source);
        if (stat.size > VDF_LIMIT) { problems.push(`${source} 太大，跳过`); continue; }
        const db = parseKeyValues(await fs.readFile(source, 'utf8'));
        const apps = pick(pick(pick(pick(pick(db, 'UserLocalConfigStore'), 'Software'), 'Valve'), 'Steam'), 'apps');
        const options = pick(pick(apps, '550'), 'LaunchOptions');
        entries.push({ accountId: account.name, text: typeof options === 'string' ? options : '', source });
      } catch (e) {
        if (missing(e)) continue;
        problems.push(`${source}：${e.message}`);
      }
    }
  }
  if (!dirs.length) return { entries, reason: '没找到 Steam 安装目录' };
  if (!entries.length) return { entries, reason: problems[0] ?? 'Steam 里还没有账号的本地配置' };
  return { entries, ...(problems.length ? { problems } : {}) };
}
