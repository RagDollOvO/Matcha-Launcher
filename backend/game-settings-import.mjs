// 把玩家已有的参数导入 Matcha：Steam 库里给 L4D2 填的启动选项拆进 Matcha 启动项；
// autoexec.cfg 里 Matcha 管理段以外的设置接管进管理段（原文件先整份备份）。
// 预览 → 玩家确认 → 按 planId 应用。设置页和茶茶共用这一份。Steam 里的启动选项只读、不改。
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { launchSpec } from './launch.mjs';
import { extraTokens, patchAutoexec, validateGameSettings } from './game-settings.mjs';
import { autoexecState, steamLaunchOptions, TEXT_LIMIT } from './game-config.mjs';
import { parseKeyValues, windowsSteamRoots } from './core.mjs';
import { launchChanges } from './game-settings-describe.mjs';

const PLAN_TTL = 10 * 60 * 1000;
const STEAM_ID64_BASE = 76561197960265728n;
const fail = (code, message, details) => { throw Object.assign(new Error(message), { code, ...(details !== undefined ? { details } : {}) }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = buf => createHash('sha256').update(buf).digest('hex');

// ---------------- 启动选项 ----------------

const FLAGS = { '-novid': 'novid', '-console': 'console', '-lv': 'lowViolence', '-condebug': 'consoleLog', '-high': 'highPriority' };
const WINDOWED = new Set(['-windowed', '-sw', '-window', '-win', '-startwindowed']);
const FULLSCREEN = new Set(['-fullscreen', '-full']);
const MANAGED = new Set(['+connect', '-secure', '-game', '-defaultgamedir', '-applaunch']);
const int = (s, min, max) => /^\d+$/.test(s ?? '') && +s >= min && +s <= max ? +s : null;

/** 按引号切分；返回 { tokens, prefix }，prefix 是 %command% 前面的包装命令（Windows 下 Matcha 不用） */
function tokenize(text) {
  const tokens = [];
  for (const m of text.matchAll(/"([^"]*)"|(\S+)/g)) tokens.push(m[1] !== undefined ? { value: m[1], quoted: true } : { value: m[2], quoted: false });
  const at = tokens.findIndex(t => t.value.toLowerCase() === '%command%');
  return at < 0 ? { tokens, prefix: '' } : { tokens: tokens.slice(at + 1), prefix: tokens.slice(0, at).map(t => t.value).join(' ') };
}

/**
 * 把一段 Steam 启动选项拆成 Matcha 的启动项。
 * 认得的（窗口模式、分辨率、刷新率、帧率上限、几个开关）进对应字段，其余整组进自定义启动项；
 * 启动流程自己管的（+connect、-game 等）和带引号/分号的组跳过并说明原因。
 */
export function parseLaunchOptions(text) {
  const { tokens, prefix } = tokenize(String(text ?? ''));
  const skipped = prefix ? [{ text: `${prefix} %command%`, reason: '%command% 前面的包装命令只对 Steam 启动有效' }] : [];
  const groups = [];
  for (const t of tokens) {
    if (!t.quoted && /^[+-][a-z_]/i.test(t.value) || !groups.length) groups.push([t]);
    else groups.at(-1).push(t);
  }
  const patch = {}, display = {}, extra = [];
  let mode = null, noborder = false, width = null, height = null, refresh = null;
  for (const group of groups) {
    const [head, ...rest] = group, key = head.value.toLowerCase(), raw = group.map(t => t.quoted ? `"${t.value}"` : t.value).join(' ');
    const values = rest.map(t => t.value);
    if (key === '-steam') continue; // Matcha 自己会加
    if (MANAGED.has(key.split('=')[0])) { skipped.push({ text: raw, reason: '连接目标、游戏路径和安全模式由启动流程管理' }); continue; }
    if (FLAGS[key] && !values.length) { patch[FLAGS[key]] = true; continue; }
    if (FULLSCREEN.has(key) && !values.length) { mode = 'fullscreen'; continue; }
    if (WINDOWED.has(key) && !values.length) { mode ??= 'windowed'; if (mode === 'fullscreen') mode = 'windowed'; continue; }
    if (key === '-noborder' && !values.length) { noborder = true; continue; }
    if ((key === '-w' || key === '-width') && values.length === 1 && int(values[0], 320, 7680) !== null) { width = { value: +values[0], raw }; continue; }
    if ((key === '-h' || key === '-height') && values.length === 1 && int(values[0], 320, 7680) !== null) { height = { value: +values[0], raw }; continue; }
    if ((key === '-refresh' || key === '-freq') && values.length === 1 && int(values[0], 24, 1000) !== null) { refresh = { value: +values[0], raw }; continue; }
    if (key === '+fps_max' && values.length === 1 && int(values[0], 0, 1000) !== null) { patch.fpsMax = +values[0]; continue; }
    if (group.some(t => t.quoted && /\s/.test(t.value)) || /[;\x00-\x1f\x7f]/.test(raw)) { skipped.push({ text: raw, reason: '含空格引号或分号，Matcha 的自定义启动项放不下，请手动处理' }); continue; }
    const plain = group.map(t => t.value).join(' ');
    try { extraTokens(plain); extra.push(plain); }
    catch { skipped.push({ text: raw, reason: '不是 - 或 + 开头的参数' }); }
  }
  if (noborder) mode = 'noborder';
  if (mode) display.mode = mode;
  if (width && height) { display.width = width.value; display.height = height.value; }
  else for (const half of [width, height]) if (half) extra.push(half.raw); // Matcha 要求宽高成对，单个原样保留
  if (refresh) {
    if (mode === 'fullscreen') display.refreshHz = refresh.value;
    else extra.push(refresh.raw); // 只在全屏时由 Matcha 写，其余情况原样保留
  }
  if (Object.keys(display).length) patch.display = display;
  return { patch, extra, skipped };
}

const groupKey = g => g.split(/\s+/)[0].toLowerCase();
function splitGroups(text) {
  const groups = [];
  for (const token of String(text ?? '').trim().split(/\s+/).filter(Boolean)) {
    if (/^[+-][a-z_]/i.test(token) || !groups.length) groups.push(token); else groups[groups.length - 1] += ` ${token}`;
  }
  return groups;
}
/** Matcha 已有的自定义启动项保留；同名参数用导入的值 */
export function mergeExtraArgs(current, imported) {
  const keys = new Set(imported.map(groupKey));
  return [...splitGroups(current).filter(g => !keys.has(groupKey(g))), ...imported].join(' ');
}

/** Steam 最近登录的账号（loginusers.vdf 的 MostRecent），换成 userdata 里的账号号 */
async function recentAccounts(roots) {
  const ids = [];
  for (const root of roots) {
    try {
      const db = parseKeyValues(await fs.readFile(path.join(root, 'config', 'loginusers.vdf'), 'utf8'));
      const users = db.users ?? db.Users ?? {};
      const list = Object.entries(users).filter(([id]) => /^\d{17}$/.test(id))
        .map(([id, u]) => ({ id: String(BigInt(id) - STEAM_ID64_BASE), recent: String(u?.MostRecent ?? u?.mostrecent) === '1', at: Number(u?.Timestamp ?? u?.timestamp ?? 0) }))
        .sort((a, b) => Number(b.recent) - Number(a.recent) || b.at - a.at);
      ids.push(...list.map(u => u.id));
    } catch { /* 没有就不排序 */ }
  }
  return ids;
}

/** 各账号的启动选项，同一账号只留一份（Steam 路径大小写不同会重复） */
export async function steamCandidates(gameRoot, options = {}) {
  const steam = await steamLaunchOptions(gameRoot, options);
  const roots = options.roots ?? await windowsSteamRoots().catch(() => []);
  const order = await recentAccounts(roots);
  const seen = new Map();
  for (const e of steam.entries) {
    const text = e.text.trim();
    if (!seen.has(e.accountId) || (!seen.get(e.accountId).text && text)) seen.set(e.accountId, { accountId: e.accountId, text, source: e.source });
  }
  const rank = id => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  const candidates = [...seen.values()].sort((a, b) => rank(a.accountId) - rank(b.accountId))
    .map((c, i) => ({ ...c, recent: rank(c.accountId) === 0 && i === 0 && order.length > 0 }));
  return { candidates, ...(steam.reason ? { reason: steam.reason } : {}) };
}

// ---------------- autoexec.cfg ----------------

const MARKER = /^\s*\/\/\s*(>>>|<<<)\s*(?:Matcha|Flare)/;
function quotesPaired(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (!quoted && line.slice(i, i + 2) === '//') break;
    if (line[i] === '"') quoted = !quoted;
  }
  return !quoted;
}

/** 读 autoexec.cfg 原始字节并按文本解开；UTF-8 不行时按 GBK（中文 Windows 记事本旧默认） */
async function readAutoexec(file) {
  const bytes = await fs.readFile(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (!bytes) return null;
  if (bytes.length > TEXT_LIMIT) return { bytes, unreadable: `文件超过 ${TEXT_LIMIT / 1024} KiB，请手动整理` };
  if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff || bytes.includes(0)) return { bytes, unreadable: '文件是 UTF-16 或包含空字符，游戏读不了，请先转成普通文本' };
  const body = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? bytes.subarray(3) : bytes;
  let text, encoding = 'utf-8';
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); }
  catch { text = new TextDecoder('gbk').decode(body); encoding = 'gbk'; }
  return { bytes, text, encoding };
}

/**
 * 管理段以外的行搬进管理段：按原文件顺序，管理段的位置换成 Matcha 当前的管理段内容。
 * 引号不成对的行留在段外（Matcha 管理段要求每行引号成对）。没启用的草稿接在最后。
 */
export function adoptAutoexecText(text, managed) {
  const lines = text.split(/\r\n|\r|\n/);
  const adopted = [], kept = [];
  let inside = false, placed = false, outside = 0;
  const placeManaged = () => { if (!placed && managed.enabled && managed.text.trim()) adopted.push(...managed.text.split('\n')); placed = true; };
  for (const line of lines) {
    const marker = MARKER.exec(line);
    if (marker) { inside = marker[1] === '>>>'; if (inside) placeManaged(); continue; }
    if (inside) continue;
    if (!line.trim()) { if (adopted.length && adopted.at(-1).trim()) adopted.push(''); continue; }
    if (!quotesPaired(line)) { kept.push(line); continue; }
    adopted.push(line.trim());
    if (!line.trim().startsWith('//')) outside++; // 只数设置行，注释跟着搬但不计数
  }
  placeManaged();
  const draft = !managed.enabled && managed.text.trim() ? managed.text : '';
  if (draft) adopted.push(...draft.split('\n'));
  while (adopted.length && !adopted.at(-1).trim()) adopted.pop();
  return { text: adopted.join('\n'), kept, outside, draftLines: draft ? draft.split('\n').filter(l => l.trim()).length : 0 };
}

const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; // 本地时间，玩家看得懂
};

// ---------------- 预览与应用 ----------------

export function importHost(service) {
  const plans = service.importPlans ??= new Map();
  const cfgOf = ({ values, extra }) => {
    const structured = Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => `${k} "${v}"`).join('\n');
    return structured && extra ? `${structured}\n${extra}` : structured || extra;
  };
  const effective = settings => Object.fromEntries(['modded', 'clean'].map(mode => [mode, launchSpec(mode, undefined, settings).launchOptions]));

  /** params: { accountId?, launch?: boolean, cfg?: boolean }；两项默认都导 */
  async function preview(params = {}) {
    for (const key of Object.keys(params)) if (!['accountId', 'launch', 'cfg'].includes(key)) fail('invalid_argument', `不认识的参数：${key}`, { field: key });
    const root = await service.root(), before = service.gameSettings();
    let next = before;
    const result = { planId: null, launch: null, cfg: null };

    // 启动选项
    const steam = await steamCandidates(root, service.steamRoots ? { roots: service.steamRoots } : {});
    const filled = steam.candidates.filter(c => c.text);
    const chosen = params.accountId !== undefined ? steam.candidates.find(c => c.accountId === String(params.accountId)) : filled[0];
    if (params.accountId !== undefined && !chosen) fail('invalid_argument', '没有这个 Steam 账号的启动选项。', { field: 'accountId' });
    result.launch = { candidates: steam.candidates, accountId: chosen?.accountId ?? null, text: chosen?.text ?? '', ...(steam.reason ? { reason: steam.reason } : {}) };
    if (chosen?.text && params.launch !== false) {
      const parsed = parseLaunchOptions(chosen.text);
      const merged = { ...next, ...parsed.patch, display: { ...next.display, ...(parsed.patch.display ?? {}) }, extraArgs: mergeExtraArgs(next.extraArgs, parsed.extra) };
      if (parsed.patch.display?.mode && parsed.patch.display.mode !== 'fullscreen') merged.display.refreshHz = null;
      next = validateGameSettings(merged);
      Object.assign(result.launch, { changes: launchChanges(before, next), added: parsed.extra, skipped: parsed.skipped });
    }

    // autoexec.cfg
    if (root) {
      const state = await autoexecState(root);
      result.cfg = { path: state.path, exists: state.exists };
      if (state.reason) result.cfg.reason = state.reason;
      else if (state.exists && params.cfg !== false) {
        const file = await readAutoexec(state.path);
        if (file?.unreadable) result.cfg.reason = file.unreadable;
        else if (file) {
          const managed = { enabled: before.autoexec.enabled, text: cfgOf(before.autoexec) };
          const adopt = adoptAutoexecText(file.text, managed);
          if (adopt.outside) {
            next = validateGameSettings({ ...next, autoexec: { enabled: true, values: {}, extra: adopt.text } });
            Object.assign(result.cfg, { lines: adopt.outside, kept: adopt.kept, draftLines: adopt.draftLines, encoding: file.encoding,
              text: adopt.text, hash: sha(file.bytes), backup: `${state.path}.matcha-import-${stamp()}.bak` });
          }
        }
      }
    }
    const launchTouched = !!result.launch?.changes?.length, cfgTouched = !!result.cfg?.lines;
    if (!launchTouched && !cfgTouched) return { ...result, status: 'nothing' };
    for (const [id, p] of plans) if (Date.now() - p.createdAt > PLAN_TTL) plans.delete(id);
    const planId = randomUUID();
    plans.set(planId, { createdAt: Date.now(), base: before, next, root, cfg: cfgTouched ? { path: result.cfg.path, hash: result.cfg.hash, backup: result.cfg.backup, kept: result.cfg.kept } : null });
    return { ...result, planId, effective: { before: effective(before), after: effective(next) } };
  }

  async function apply(planId) {
    const plan = plans.get(planId);
    if (!plan || Date.now() - plan.createdAt > PLAN_TTL) fail('settings_plan_missing', '这次导入的预览已过期，请重新预览。');
    plans.delete(planId);
    if (!same(service.gameSettings(), plan.base)) fail('settings_plan_stale', '启动设置在预览后被改过了，请重新预览。');
    if (plan.root !== await service.root()) fail('settings_plan_stale', '游戏目录在预览后换过了，请重新预览。');
    let backup = null;
    if (plan.cfg) {
      if ((await service.core.inspectGame(plan.root)).processes.length) fail('game_running', '请先退出游戏再导入 CFG。');
      const bytes = await fs.readFile(plan.cfg.path);
      if (sha(bytes) !== plan.cfg.hash) fail('settings_plan_stale', 'autoexec.cfg 在预览后被改过了，请重新预览。');
      await fs.writeFile(plan.cfg.backup, bytes, { flag: 'wx' });
      backup = plan.cfg.backup;
      // 段外只留引号不成对、没法接管的行；其余都在管理段里
      const outside = Buffer.from(plan.cfg.kept.length ? plan.cfg.kept.join('\r\n') + '\r\n' : '');
      const content = patchAutoexec(outside, plan.next.autoexec);
      const temp = `${plan.cfg.path}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, content, { flag: 'wx' });
        if (sha(await fs.readFile(plan.cfg.path)) !== plan.cfg.hash) fail('settings_plan_stale', 'autoexec.cfg 刚被其他程序改过，原文件没动，请重新预览。');
        await fs.rename(temp, plan.cfg.path);
      } finally { await fs.unlink(temp).catch(() => {}); }
    }
    const reply = await service.commitGameSettings(plan.next);
    service.emit('event', { type: 'settings_changed', scopes: ['game-settings'], source: 'import' });
    service.emit('event', { type: 'objects_changed' });
    return { applied: true, ...(backup ? { backup } : {}), settings: reply };
  }

  return { preview, apply };
}
