import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { buildLaunchArgv } from './launch-argv.mjs';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const invalid = (field, message) => { throw Object.assign(new Error(`${field}：${message}`), { code: 'game_settings_invalid', details: { field } }); };
export const defaultGameSettings = () => ({ display: { mode: 'default', width: null, height: null, refreshHz: null }, fpsMax: null,
  novid: true, console: false, lowViolence: false, consoleLog: false, highPriority: false, extraArgs: '', autoexec: { enabled: false, values: {}, extra: '' } });
const forbiddenArgs = new Set(['+connect', '-insecure', '-secure', '-game', '-defaultgamedir', '-applaunch']);
export function extraTokens(text) {
  if (typeof text !== 'string' || /["'\r\n\x00-\x08\x0b-\x1f\x7f;]/.test(text)) invalid('extraArgs', '请使用空白分隔的参数，去掉引号、控制字符和分号。');
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) if (forbiddenArgs.has(token.toLowerCase().split('=')[0])) invalid('extraArgs', '连接目标、游戏路径和安全模式由启动流程管理。');
  if (tokens.length && !/^[+-][a-z_]/i.test(tokens[0])) invalid('extraArgs', '每组参数需要以 - 或 + 参数名开头。');
  return tokens;
}
export function validateGameSettings(value) {
  if (!object(value)) invalid('settings', '需要完整的游戏设置对象。');
  if (!object(value.display) || !['default', 'fullscreen', 'windowed', 'noborder'].includes(value.display.mode)) invalid('display.mode', '请选择有效窗口模式。');
  for (const k of ['width', 'height']) if (value.display[k] !== null && (!Number.isInteger(value.display[k]) || value.display[k] < 320 || value.display[k] > 7680)) invalid(`display.${k}`, '请输入 320–7680 的整数或留空。');
  const refreshHz = value.display.refreshHz ?? null, consoleLog = value.consoleLog === undefined ? false : value.consoleLog;
  if (refreshHz !== null && (!Number.isInteger(refreshHz) || refreshHz < 24 || refreshHz > 1000)) invalid('display.refreshHz', '刷新率请输入 24–1000 Hz 的整数或留空。');
  if (typeof consoleLog !== 'boolean') invalid('consoleLog', '控制台日志开关需要布尔值。');
  const lowViolence = value.lowViolence === undefined ? false : value.lowViolence;
  if (typeof lowViolence !== 'boolean') invalid('lowViolence', '低血腥度开关需要布尔值。');
  if (value.fpsMax !== null && (!Number.isInteger(value.fpsMax) || value.fpsMax < 0 || value.fpsMax > 1000)) invalid('fpsMax', '请输入 0–1000 的整数或留空。');
  for (const k of ['novid', 'console', 'highPriority']) if (typeof value[k] !== 'boolean') invalid(k, '需要布尔值。');
  extraTokens(value.extraArgs);
  if (!object(value.autoexec) || typeof value.autoexec.enabled !== 'boolean') invalid('autoexec.enabled', '需要布尔值。');
  if (!object(value.autoexec.values)) invalid('autoexec.values', '需要变量名称与值的对象。');
  for (const [key, val] of Object.entries(value.autoexec.values)) {
    if (!/^[a-z_0-9]+$/.test(key)) invalid('autoexec.values', '变量名仅支持小写字母、数字和下划线。');
    if (typeof val !== 'string' || /["\x00-\x1f\x7f]/.test(val)) invalid(`autoexec.values.${key}`, '值需要文本，请去掉引号和控制字符。');
  }
  if (typeof value.autoexec.extra !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.autoexec.extra)) invalid('autoexec.extra', '请输入逐行命令。');
  for (const line of value.autoexec.extra.split(/\r\n|\r|\n/)) {
    if (/^\s*\/\/\s*(>>>|<<<)\s*(?:Matcha|Flare)/.test(line)) invalid('autoexec.extra', 'Matcha 分段标记由启动器生成。');
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (!quoted && line.slice(i, i + 2) === '//') break;
      if (line[i] === '"') quoted = !quoted;
    }
    if (quoted) invalid('autoexec.extra', '每行的双引号需要成对。');
  }
  // Normalize to the public fields only; reply-only fields never enter storage.
  return { display: { mode: value.display.mode, width: value.display.width, height: value.display.height, refreshHz }, fpsMax: value.fpsMax,
    novid: value.novid, console: value.console, lowViolence, consoleLog, highPriority: value.highPriority, extraArgs: value.extraArgs,
    autoexec: { enabled: value.autoexec.enabled, values: { ...value.autoexec.values }, extra: value.autoexec.extra } };
}

/** Whole argument groups are deduplicated; their values (e.g. equal W/H) stay intact. */
export function gameLaunchArgs(base, value) {
  const v = validateGameSettings(value);
  return buildLaunchArgv(base, v, extraTokens(v.extraArgs));
}

// 旧版写的是 Flare，读的时候两种都认，新写一律 Matcha
const START = '// >>> Matcha（启动器管理这一段，其他内容保持原样）';
const END = '// <<< Matcha';
const NAMES = ['Matcha', 'Flare'];
// Records only the separator we add to a user file lacking a final newline.
const ADDED_EOL = ' [separator-added]';
export function patchAutoexec(bytes, config) {
  // An unmanaged file stays untouched when management is off, regardless of encoding.
  if (!config.enabled && !NAMES.some(n => bytes.includes(Buffer.from(n)) || bytes.includes(Buffer.from(n, 'utf16le')) || bytes.includes(Buffer.from(n, 'utf16le').swap16()))) return bytes;
  if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff || bytes.includes(0)) invalid('autoexec', '现有文件使用 UTF-16 或包含空字符，请先转换为游戏可用的文本编码；原文件已保留。');
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
  const text = bytes.toString('latin1'); // One character per byte; preserve all outside bytes, including legacy encodings.
  const markers = [];
  const lines = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  for (const match of text.matchAll(lines)) {
    if (!match[0]) continue;
    const offset = match.index === 0 ? bom : 0, line = match[0].slice(offset).replace(/[\r\n]+$/, '');
    if (/^\s*\/\/\s*(>>>|<<<)\s*(?:Matcha|Flare)/.test(line)) markers.push({ start: match.index + offset, end: match.index + match[0].length, open: line.includes('>>>'), separator: line.endsWith(ADDED_EOL) });
  }
  if (markers.length && (markers.length !== 2 || !markers[0].open || markers[1].open)) invalid('autoexec', 'Matcha 标记缺失、重复或顺序异常，请核对原文件。');
  const eol = text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : '\r\n';
  let start = markers[0]?.start ?? bytes.length, end = markers[1]?.end ?? bytes.length;
  const added = markers.length ? markers[0].separator : bytes.length > bom && !/[\r\n]$/.test(text);
  if (!config.enabled) {
    if (!markers.length) return bytes;
    if (added && start > 0) start -= text.slice(0, start).endsWith('\r\n') ? 2 : 1;
    return Buffer.concat([bytes.subarray(0, start), bytes.subarray(end)]);
  }
  const content = Object.entries(config.values).filter(([, v]) => v !== '').map(([key, v]) => `${key} "${v}"`);
  content.push(...config.extra.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean));
  const block = `${!markers.length && added ? eol : ''}${START}${added ? ADDED_EOL : ''}${eol}${content.join(eol)}${content.length ? eol : ''}${END}${eol}`;
  return Buffer.concat([bytes.subarray(0, start), Buffer.from(block), bytes.subarray(end)]);
}

export const autoexecPath = root => path.join(root, 'left4dead2', 'cfg', 'autoexec.cfg');
/** 第一次改动前留的原文件备份。改名前叫 .flare.bak */
export const AUTOEXEC_BACKUP = '.matcha.bak', LEGACY_AUTOEXEC_BACKUP = '.flare.bak';
async function claimLegacyBackup(file) {
  const next = file + AUTOEXEC_BACKUP;
  if (await fs.lstat(next).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) return;
  // Windows 上 rename 会覆盖目标，所以先确认新名字不存在
  await fs.rename(file + LEGACY_AUTOEXEC_BACKUP, next).catch(e => { if (e.code !== 'ENOENT') throw e; });
}
async function safePath(root, create) {
  let dir = path.resolve(root);
  for (const part of ['', 'left4dead2', 'cfg']) {
    if (part) dir = path.join(dir, part);
    let stat = await fs.lstat(dir).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!stat && part === 'cfg' && create) { await fs.mkdir(dir); stat = await fs.lstat(dir); }
    if (!stat) return null;
    if (stat.isSymbolicLink() || !stat.isDirectory()) invalid('autoexec', '配置路径需要普通目录，请检查目录链接。');
  }
  const file = path.join(dir, 'autoexec.cfg');
  const stat = await fs.lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (stat && (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1)) invalid('autoexec', 'autoexec.cfg 需要普通独立文件。');
  return file;
}

/** Called only after a user save or confirmed launch, never during a snapshot. */
export async function writeAutoexec(root, config, assertIdle) {
  if (!await assertIdle()) return { pending: true };
  const file = await safePath(root, config.enabled);
  if (!file) return { pending: false };
  const release = await lockfile.lock(file, { realpath: false, retries: { retries: 4, minTimeout: 30, maxTimeout: 100 } });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const original = await fs.readFile(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    const next = patchAutoexec(original ?? Buffer.alloc(0), config);
    if (next.equals(original ?? Buffer.alloc(0))) return { pending: false };
    if (!await assertIdle()) return { pending: true };
    if (original !== null) {
      // First pre-Matcha copy stays intact across repeated 400 ms autosaves.
      await claimLegacyBackup(file);
      await fs.writeFile(file + AUTOEXEC_BACKUP, original, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    }
    const h = await fs.open(temp, 'wx');
    try { await h.writeFile(next); await h.sync(); } finally { await h.close(); }
    if (!await assertIdle()) return { pending: true };
    await safePath(root, false);
    const current = await fs.readFile(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if ((original === null) !== (current === null) || original && !original.equals(current)) invalid('autoexec', '文件已被其他程序修改，请重新保存。');
    await fs.rename(temp, file);
    return { pending: false };
  } finally {
    try { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    finally { await release(); }
  }
}
