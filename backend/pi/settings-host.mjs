// 茶茶读写设置的桌面服务一侧：体检时读启动项和 cfg，确认后改启动项、Matcha 管理段、下载、茶茶默认值和界面偏好。
// 写入一律「预览 → 玩家确认 → 按计划应用」，应用前核对设置没在预览后被改过。契约见 docs/agent-checkup-handoff.md。
import { randomUUID } from 'node:crypto';
import { launchSpec } from '../launch.mjs';
import { validateGameSettings } from '../game-settings.mjs';
import { setCvars } from '../cfg-text.mjs';
import { downloadSettings } from '../mods/download-bandwidth.mjs';
import { radarSettings } from '../saved-game-settings.mjs';
import { autoexecState, cfgFiles, readCfgFile, steamLaunchOptions } from '../game-config.mjs';
import { launchChanges } from '../game-settings-describe.mjs';
import { adoptAutoexecText, importHost } from '../game-settings-import.mjs';

const PLAN_TTL = 10 * 60 * 1000;
const fail = (code, message, details) => { throw Object.assign(new Error(message), { code, ...(details !== undefined ? { details } : {}) }); };
const check = signal => { if (signal?.aborted) fail('operation_canceled', '操作已取消。'); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DISPLAY_KEYS = ['mode', 'width', 'height', 'refreshHz'];
const LAUNCH_KEYS = ['display', 'fpsMax', 'novid', 'console', 'lowViolence', 'consoleLog', 'highPriority', 'extraArgs'];
export const SETTINGS_SCOPES = ['game-settings', 'download-settings', 'pi-settings'];
const PI_KEYS = ['defaultThinkingLevel', 'autoCompaction', 'autoRetry'];
const PI_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const PI_LABELS = { defaultThinkingLevel: '默认思考强度', autoCompaction: '自动压缩上下文', autoRetry: '出错自动重试' };
const DOWNLOAD_LABELS = { maxConcurrent: '同时下载数', speedLimit: '下载限速（字节/秒，0 为不限）' };
/** 这些只能玩家自己在界面里改，茶茶只告诉玩家去哪改 */
export const READ_ONLY_SETTINGS = [
  '服务商与 API Key（设置 › 服务商与密钥）',
  '茶茶自己的确认方式（自主 / 每次都问）：只有玩家能改（设置 › 工具与权限）',
  '社区加速：会安装证书，属于系统安全设置（设置 › 社区加速）',
  '游戏目录：切换后茶茶需要重新连接（设置 › 游戏目录）',
  '关闭到托盘、开机自启（设置 › 启动器）',
  '缓存清理、数据重置和存储位置迁移（设置 › 数据与重置 / 存储）',
  '壁纸、导入字体：需要玩家自己选文件（设置 › 外观）',
  'Steam 库里的启动选项：只读；可以用 game_settings_import 导入成 Matcha 启动项（Steam 里的原样保留）',
  '管理段以外的 CFG：不能逐行改；可以用 game_settings_import 整体接管进管理段（先整份备份），之后就能改',
];


/** 合并启动项改动；只收认识的字段 */
function mergeLaunch(current, launch) {
  if (launch === undefined) return current;
  if (!object(launch)) fail('game_settings_invalid', 'launch 需要启动项对象。', { field: 'launch' });
  for (const key of Object.keys(launch)) if (!LAUNCH_KEYS.includes(key)) fail('game_settings_invalid', `不认识的启动项：${key}`, { field: `launch.${key}` });
  if (launch.display !== undefined) {
    if (!object(launch.display)) fail('game_settings_invalid', 'display 需要对象。', { field: 'launch.display' });
    for (const key of Object.keys(launch.display)) if (!DISPLAY_KEYS.includes(key)) fail('game_settings_invalid', `不认识的显示项：${key}`, { field: `launch.display.${key}` });
  }
  return { ...current, ...launch, display: { ...current.display, ...(launch.display ?? {}) }, autoexec: current.autoexec };
}

/** CFG 改动在 Matcha 管理段的完整文本上做：结构化旧值 + 手写部分 */
function cfgText({ values, extra }) {
  const structured = Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => `${k} "${v}"`).join('\n');
  return structured && extra ? `${structured}\n${extra}` : structured || extra;
}


export function settingsHost(service) {
  const plans = service.settingsPlans ??= new Map();
  const emitChanged = scopes => {
    service.emit('event', { type: 'settings_changed', scopes, source: 'agent' });
    if (scopes.includes('game-settings')) service.emit('event', { type: 'objects_changed' });
  };
  const keep = plan => {
    for (const [id, p] of plans) if (Date.now() - p.createdAt > PLAN_TTL) plans.delete(id);
    const planId = randomUUID(); plans.set(planId, { ...plan, createdAt: Date.now() }); return planId;
  };
  const take = (planId, kind) => {
    const plan = plans.get(planId);
    if (!plan || plan.kind !== kind || Date.now() - plan.createdAt > PLAN_TTL) fail('settings_plan_missing', '这次改动的预览已过期，请重新预览。');
    plans.delete(planId);
    return plan;
  };
  const effective = settings => Object.fromEntries(['modded', 'clean'].map(mode => [mode, launchSpec(mode, undefined, settings).launchOptions]));

  async function inspectConfig(params = {}) {
    const root = await service.root(), settings = service.gameSettings();
    const { autoexec, ...launchSettings } = settings;
    const steam = await steamLaunchOptions(root);
    const launch = { mode: service.launchMode, route: launchSpec(service.launchMode, undefined, settings).route ?? 'game-exe', settings: launchSettings,
      effective: effective(settings), steamLaunchOptions: steam.entries.length ? steam.entries : null,
      ...(steam.reason ? { steamLaunchOptionsReason: steam.reason } : {}), ...(steam.problems ? { steamLaunchOptionsProblems: steam.problems } : {}),
      note: 'Matcha 两种启动方式都直接启动游戏 exe，Steam 库里的启动选项不会叠加，玩家从 Steam 里启动时才生效。Matcha 启动项只用于 L4N 平台启动；纯净对抗只用官方默认参数。-heapsize、-processheap 在 L4N 平台启动时有用（L4N 解除了 -heapsize 的 512 MB 上限），不要建议删。' };
    const managed = { enabled: autoexec.enabled, text: cfgText(autoexec) };
    if (!root) return { game: null, launch, cfg: null, managedDraft: managed, reason: '还没选择游戏目录' };
    const listing = await cfgFiles(root);
    const cfg = { dir: listing.dir, autoexec: await autoexecState(root), files: listing.files,
      ...(listing.reason ? { reason: listing.reason } : {}), ...(listing.omitted ? { omitted: listing.omitted } : {}) };
    if (params.file !== undefined) cfg.file = await readCfgFile(root, params.file);
    const outside = cfg.autoexec.text && !cfg.autoexec.truncated ? adoptAutoexecText(cfg.autoexec.text, managed).outside : 0;
    const steamText = (steam.entries.find(e => e.text.trim())?.text ?? '').trim();
    const importable = steamText || outside ? { steamLaunchOptions: steamText || null, autoexecLinesOutsideManaged: outside,
      hint: '玩家已有的参数还没进 Matcha：用 game_settings_import 预览并导入（玩家确认后才写）。' } : null;
    return { game: { root }, launch, cfg, inGameSettings: { name: '抹茶模组设置', radar: await radarSettings(root) }, managedDraft: managed, importable, checkedAt: new Date().toISOString() };
  }

  async function previewGame(params = {}) {
    for (const key of Object.keys(params)) if (!['launch', 'cvars', 'extra', 'cfgEnabled'].includes(key)) fail('game_settings_invalid', `不认识的参数：${key}`, { field: key });
    const before = service.gameSettings();
    let next = mergeLaunch(before, params.launch);
    const cfgChanges = [];
    let cfgReplaced = null;
    if (params.cvars !== undefined || params.extra !== undefined) {
      let text = cfgText(before.autoexec);
      if (params.extra !== undefined) {
        if (typeof params.extra !== 'string' || params.extra.length > 16000) fail('game_settings_invalid', 'extra 需要不超过 16000 字的逐行命令。', { field: 'extra' });
        cfgReplaced = { beforeLines: text ? text.split('\n').length : 0, afterLines: params.extra ? params.extra.split(/\r\n|\r|\n/).length : 0 };
        text = params.extra.replace(/\r\n|\r/g, '\n');
      }
      if (params.cvars !== undefined) {
        try { const r = setCvars(text, params.cvars); text = r.text; cfgChanges.push(...r.changes); }
        catch (e) { if (e.code === 'cfg_invalid') e.code = 'game_settings_invalid'; throw e; }
      }
      // 和页面同一个规则：管理段有内容就写进游戏，清空就撤掉
      next = { ...next, autoexec: { enabled: !!text.trim(), values: {}, extra: text } };
    }
    if (params.cfgEnabled !== undefined) {
      if (typeof params.cfgEnabled !== 'boolean') fail('game_settings_invalid', 'cfgEnabled 需要布尔值。', { field: 'cfgEnabled' });
      next = { ...next, autoexec: { ...next.autoexec, enabled: params.cfgEnabled } };
    }
    next = validateGameSettings(next);
    const after = { effective: effective(next) }; // 参数组合不合法时在这里报错，什么都不保存
    const changes = launchChanges(before, next);
    const cfgTouched = !same(cfgText(before.autoexec), cfgText(next.autoexec));
    if (!changes.length && !cfgTouched) return { planId: null, changes: [], cfgChanges: [], status: 'unchanged' };
    const planId = keep({ kind: 'game', base: before, next });
    return { planId, changes, cfgChanges, cfgReplaced, cfgText: cfgTouched ? cfgText(next.autoexec) : undefined,
      effective: { before: effective(before), after: after.effective },
      autoexec: { enabled: next.autoexec.enabled, path: (await service.gameSettingsReply()).autoexecPath ?? null } };
  }

  async function applyGame(planId, confirmation, signal) {
    service.confirm(confirmation);
    const plan = take(planId, 'game');
    check(signal);
    if (!same(service.gameSettings(), plan.base)) fail('settings_plan_stale', '启动设置在预览后被改过了，请重新预览。');
    const reply = await service.commitGameSettings(plan.next);
    emitChanged(['game-settings']);
    return { applied: true, ...reply };
  }

  async function uiPrefs() {
    try { return await service.uiRequest('prefs-get'); }
    catch (e) { return { unavailable: e.message }; }
  }

  async function inspectLauncher() {
    return { downloads: { ...service.tasks.settings }, pi: await service.piFiles.settings(), ui: await uiPrefs(),
      readOnly: READ_ONLY_SETTINGS, checkedAt: new Date().toISOString() };
  }

  async function previewLauncher({ section, patch } = {}) {
    if (!object(patch)) fail('invalid_argument', 'patch 需要 { 字段: 值 } 对象。', { field: 'patch' });
    if (section === 'downloads') {
      const before = { ...service.tasks.settings }, next = downloadSettings(patch, before);
      const changes = Object.keys(next).filter(k => next[k] !== before[k]).map(k => ({ key: k, label: DOWNLOAD_LABELS[k] ?? k, from: before[k], to: next[k] }));
      return changes.length ? { planId: keep({ kind: 'launcher', section, base: before, patch }), section, changes } : { planId: null, section, changes, status: 'unchanged' };
    }
    if (section === 'pi') {
      for (const [k, v] of Object.entries(patch)) {
        if (!PI_KEYS.includes(k)) fail('invalid_argument', `茶茶只能改这些默认值：${PI_KEYS.join('、')}`, { field: `patch.${k}` });
        if (k === 'defaultThinkingLevel' ? !PI_LEVELS.includes(v) : typeof v !== 'boolean') fail('invalid_argument', `${PI_LABELS[k]} 的值不对。`, { field: `patch.${k}` });
      }
      const before = await service.piFiles.settings();
      const changes = Object.entries(patch).filter(([k, v]) => before[k] !== v).map(([k, v]) => ({ key: k, label: PI_LABELS[k], from: before[k] ?? null, to: v }));
      return changes.length ? { planId: keep({ kind: 'launcher', section, base: before, patch }), section, changes, appliesAt: 'next-connect' } : { planId: null, section, changes, status: 'unchanged' };
    }
    if (section === 'ui') {
      const result = await service.uiRequest('prefs-set', { patch, dryRun: true });
      return result.changes.length ? { planId: keep({ kind: 'launcher', section, patch }), section, changes: result.changes } : { planId: null, section, changes: [], status: 'unchanged' };
    }
    fail('invalid_argument', 'section 只能是 downloads、pi 或 ui。', { field: 'section' });
  }

  async function applyLauncher(planId, confirmation, signal) {
    service.confirm(confirmation);
    const plan = take(planId, 'launcher');
    check(signal);
    if (plan.section === 'downloads') {
      if (!same({ ...service.tasks.settings }, plan.base)) fail('settings_plan_stale', '下载设置在预览后被改过了，请重新预览。');
      const value = await service.tasks.setSettings(plan.patch);
      emitChanged(['download-settings']);
      return { applied: true, section: 'downloads', value };
    }
    if (plan.section === 'pi') {
      if (!same(await service.piFiles.settings(), plan.base)) fail('settings_plan_stale', '茶茶的默认值在预览后被改过了，请重新预览。');
      const value = await service.piFiles.saveSettings(plan.patch);
      emitChanged(['pi-settings']);
      return { applied: true, section: 'pi', value, appliesAt: 'next-connect' };
    }
    const value = await service.uiRequest('prefs-set', { patch: plan.patch });
    return { applied: true, section: 'ui', ...value };
  }

  const importer = importHost(service);
  return async (operation, params = {}, confirmation, signal) => {
    await service.ready; check(signal);
    switch (operation) {
      case 'settings-import-preview': return service.serial(() => importer.preview(params));
      case 'settings-import-apply': return service.serial(async () => { service.confirm(confirmation); check(signal); return importer.apply(params.planId); });
      case 'settings-config-inspect': return inspectConfig(params);
      case 'settings-game-preview': return service.serial(() => previewGame(params));
      case 'settings-game-apply': return service.serial(() => applyGame(params.planId, confirmation, signal));
      case 'settings-launcher-inspect': return inspectLauncher();
      case 'settings-launcher-preview': return previewLauncher(params);
      // 界面偏好要等主窗口回执，不占服务的串行队列
      case 'settings-launcher-apply': return plans.get(params.planId)?.section === 'ui'
        ? applyLauncher(params.planId, confirmation, signal)
        : service.serial(() => applyLauncher(params.planId, confirmation, signal));
      default: fail('COMMAND_SCOPE', '未知的设置操作。');
    }
  };
}
