// 茶茶改设置之后，让界面跟上；以及替茶茶读写只存在本机的界面偏好。只在主窗口里运行（App.svelte）。
// 契约见 docs/agent-checkup-handoff.md §3、§4：
// - 后端写完启动项 / CFG / 下载等设置后发 `settings_changed { scopes }`，这里重读对应的存储；
//   后端还没发这个事件时，看到这些写工具成功结束也照样重读一次。
// - 界面偏好（配色、缩放、动效、声音、对话习惯…）只存在本机 localStorage，后端读写不到：
//   后端发 `ui_request { requestId, action, patch?, dryRun? }`，这里按白名单校验、应用，再用 `ui-response` 回执。
import { call, onBridgeEvent, type BridgeEvent } from '../api/bridge';
import { gameSettings } from './game-settings.svelte';
import { downloads } from './downloads.svelte';
import { prefs } from './prefs.svelte';
import { sfx } from '../sound/sfx.svelte';
import { theme, setLook, setMode, setTone, setVeil, WALLPAPER_PRESETS, applyWallpaperPreset } from '../theme/theme.svelte';
import { ZOOMS, display, setZoom, setReduceMotion } from '../theme/display.svelte';
import { carousel, CAROUSEL_INTERVALS, setCarouselOn, setCarouselInterval, setCarouselShuffle, setCarouselFollow } from '../theme/carousel.svelte';
import { uiFont, setFont } from '../theme/font.svelte';
import { setAgentWindowPref } from '../agent/window.svelte';

// ---------------- 设置变了：各处重读 ----------------

export const SCOPES = ['game-settings', 'download-settings', 'launcher-behavior', 'pi-settings', 'ui-prefs'] as const;
export type SettingsScope = (typeof SCOPES)[number];

/** 每个范围被外部改过几次。页面里自己读设置的组件（例如「启动器」一节）盯着它重读 */
export const settingsEpoch = $state<Record<SettingsScope, number>>(Object.fromEntries(SCOPES.map((s) => [s, 0])) as Record<SettingsScope, number>);

/** 后端还没发 settings_changed 时的兜底：这些写工具成功结束就当对应设置变了 */
const TOOL_SCOPES: Record<string, SettingsScope[]> = {
  game_settings_update: ['game-settings'],
  game_settings_import: ['game-settings'],
  launcher_settings_update: ['download-settings', 'launcher-behavior', 'pi-settings', 'ui-prefs'],
};

let queued = new Set<SettingsScope>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** 事件和工具结束常常前后脚到，合并成一次重读 */
function changed(scopes: readonly string[]) {
  for (const s of scopes) if ((SCOPES as readonly string[]).includes(s)) queued.add(s as SettingsScope);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const list = queued;
    queued = new Set();
    for (const s of list) {
      settingsEpoch[s]++;
      // 正在编辑还没保存的启动项不会被冲掉：load() 在有未保存改动时直接返回
      if (s === 'game-settings') void gameSettings.load();
      else if (s === 'download-settings') void downloads.loadLimits();
    }
  }, 120);
}

// ---------------- 界面偏好：白名单 ----------------

type Value = string | number | boolean;
interface Pref { label: string; group: string; values?: readonly Value[]; range?: { min: number; max: number; step: number }; note?: string; get(): Value; set(v: Value): void | Promise<void>; available?(): boolean }

const bool = [true, false] as const;
const P = (p: Pref) => p;
/** 加过轮播图、也没在用动态壁纸时，轮播的几项才给茶茶看 */
const canCarousel = () => carousel.slides.length > 0 && !theme.videoFile;
/** 键名是给茶茶看的稳定标识，改名要同步交接单 */
export const UI_PREFS: Record<string, Pref> = {
  look: P({ label: '配色', group: '外观', values: ['matcha-dark', 'matcha-light', 'wallpaper'], note: 'matcha-dark 墨绿深色 / matcha-light 薄荷浅色 / wallpaper 随壁纸取色（玩家导入过壁纸才有这一项）', get: () => theme.look, set: (v) => setLook(v as typeof theme.look) }),
  wallpaperPreset: P({ label: '预设外观', group: '外观', values: WALLPAPER_PRESETS.map((p) => p.id), note: WALLPAPER_PRESETS.map((p) => `${p.id} ${p.name}`).join(' / ') + '（换内置壁纸，配随壁纸取色和深色）', get: () => (theme.look === 'wallpaper' && theme.preset) || '', set: (v) => applyWallpaperPreset(v as string) }),
  wallpaperMode: P({ label: '随壁纸时的明暗', group: '外观', values: ['system', 'light', 'dark'], get: () => theme.mode, set: (v) => setMode(v as typeof theme.mode) }),
  wallpaperTone: P({ label: '随壁纸时的取色', group: '外观', values: ['vivid', 'soft'], note: 'vivid 鲜明 / soft 柔和', get: () => theme.tone, set: (v) => setTone(v as typeof theme.tone) }),
  veil: P({ label: '氛围底浓度', group: '外观', range: { min: 0.2, max: 0.85, step: 0.05 }, get: () => theme.veil, set: (v) => setVeil(v as number) }),
  wallpaperCarousel: P({ label: '壁纸轮播', group: '外观', values: bool, note: '主页在主图和轮播图之间按间隔淡入淡出地换（轮播图只能玩家自己在设置里加）', get: () => carousel.on, set: (v) => setCarouselOn(v as boolean), available: canCarousel }),
  carouselInterval: P({ label: '轮播间隔', group: '外观', values: CAROUSEL_INTERVALS.map((o) => o.s), note: '秒；0 = 每次打开启动器换一张', get: () => carousel.interval, set: (v) => setCarouselInterval(v as number), available: canCarousel }),
  carouselShuffle: P({ label: '轮播随机顺序', group: '外观', values: bool, get: () => carousel.shuffle, set: (v) => setCarouselShuffle(v as boolean), available: canCarousel }),
  carouselFollow: P({ label: '轮播时配色跟着换', group: '外观', values: bool, note: 'true 时整个界面颜色跟着当前那张图变；只在 look=wallpaper 时生效', get: () => carousel.follow, set: (v) => setCarouselFollow(v as boolean), available: canCarousel }),
  zoom: P({ label: '界面缩放', group: '外观', values: ZOOMS, get: () => prefs.zoom, set: (v) => setZoom(v as number), available: () => display.zoomSupported !== false }),
  reduceMotion: P({ label: '减弱动效', group: '外观', values: bool, get: () => prefs.reduceMotion, set: (v) => setReduceMotion(v as boolean) }),
  font: P({ label: '界面字体', group: '外观', values: ['maiyuan', 'system', 'custom'], note: 'maiyuan 麦圆 / system 系统字体 / custom 玩家导入的字体（没导入过不能选）', get: () => uiFont.mode, set: (v) => setFont(v as typeof uiFont.mode) }),
  soundMuted: P({ label: '静音', group: '声音', values: bool, get: () => sfx.settings.muted, set: (v) => { sfx.settings.muted = v as boolean; } }),
  soundVolume: P({ label: '音量', group: '声音', range: { min: 0, max: 1, step: 0.05 }, get: () => sfx.settings.volume, set: (v) => { sfx.settings.volume = v as number; } }),
  soundUi: P({ label: '界面音效', group: '声音', values: bool, get: () => sfx.settings.ui, set: (v) => { sfx.settings.ui = v as boolean; } }),
  soundAmbient: P({ label: '背景音乐', group: '声音', values: bool, get: () => sfx.settings.ambient, set: (v) => { sfx.settings.ambient = v as boolean; } }),
  busySend: P({ label: '茶茶忙时发的消息', group: '对话', values: ['followUp', 'steer'], note: 'followUp 等这轮结束再发 / steer 插话打断', get: () => prefs.busySend, set: (v) => { prefs.busySend = v as typeof prefs.busySend; } }),
  thinking: P({ label: '思考过程', group: '对话', values: ['auto', 'expanded', 'collapsed', 'hidden'], get: () => prefs.thinking, set: (v) => { prefs.thinking = v as typeof prefs.thinking; } }),
  replySound: P({ label: '回复完成提示音', group: '对话', values: bool, get: () => prefs.replySound, set: (v) => { prefs.replySound = v as boolean; } }),
  autoTitle: P({ label: '用第一句话给会话命名', group: '对话', values: bool, get: () => prefs.autoTitle, set: (v) => { prefs.autoTitle = v as boolean; } }),
  showUsage: P({ label: '输入框旁显示用量', group: '对话', values: bool, get: () => prefs.showUsage, set: (v) => { prefs.showUsage = v as boolean; } }),
  enterSends: P({ label: 'Enter 发送', group: '对话', values: bool, note: 'false 时改成 Ctrl+Enter 发送', get: () => prefs.enterSends, set: (v) => { prefs.enterSends = v as boolean; } }),
  agentWindow: P({ label: '茶茶用独立窗口', group: '启动器', values: bool, note: 'false 时在主窗口里分栏', get: () => prefs.agentWindow, set: (v) => setAgentWindowPref(v as boolean) }),
  afterLaunch: P({ label: '启动游戏后', group: '启动器', values: ['keep', 'minimize'], get: () => prefs.afterLaunch, set: (v) => { prefs.afterLaunch = v as typeof prefs.afterLaunch; } }),
  likePrompt: P({ label: '下载完成后提醒点赞', group: '下载', values: bool, get: () => prefs.likePrompt, set: (v) => { prefs.likePrompt = v as boolean; } }),
  systemNotify: P({ label: '后台时发系统通知', group: '下载', values: bool, get: () => prefs.systemNotify, set: (v) => { prefs.systemNotify = v as boolean; } }),
};

const usable = (p: Pref) => p.available?.() ?? true;
/** 没导入过字体 / 壁纸时，不给 custom / wallpaper 选项（文件只能玩家自己选） */
const optionsOf = (key: string, p: Pref) =>
  key === 'font' && !uiFont.name ? p.values?.filter((v) => v !== 'custom')
    : key === 'look' && !theme.wallpaper ? p.values?.filter((v) => v !== 'wallpaper')
      : p.values;

/** 给茶茶看的当前值和可选范围 */
export function uiPrefsView() {
  return Object.entries(UI_PREFS).filter(([, p]) => usable(p)).map(([key, p]) => ({
    key, label: p.label, group: p.group, value: p.get(),
    ...(optionsOf(key, p) ? { options: optionsOf(key, p) } : {}),
    ...(p.range ? { range: p.range } : {}),
    ...(p.note ? { note: p.note } : {}),
  }));
}

class PrefError extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } }

/** 校验整批改动；有一项不行就整批不改 */
function normalize(patch: unknown): { key: string; label: string; from: Value; to: Value }[] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new PrefError('ui_prefs_invalid', 'patch 需要是 { 键: 值 } 对象');
  const out: { key: string; label: string; from: Value; to: Value }[] = [];
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const p = UI_PREFS[key];
    if (!p || !usable(p)) throw new PrefError('ui_prefs_unknown', `没有这个界面偏好：${key}`, { field: key });
    let v = raw as Value;
    if (p.range) {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new PrefError('ui_prefs_invalid', `${p.label} 需要数字`, { field: key });
      v = Math.round(Math.min(p.range.max, Math.max(p.range.min, v)) / p.range.step) * p.range.step;
      v = +v.toFixed(4);
    } else if (!optionsOf(key, p)!.includes(v)) {
      throw new PrefError('ui_prefs_invalid', `${p.label} 只能是：${optionsOf(key, p)!.map(String).join(' / ')}`, { field: key });
    }
    const from = p.get();
    if (from !== v) out.push({ key, label: p.label, from, to: v });
  }
  return out;
}

/** 处理一条 ui_request 并回执；导出给开发预览直接验证 */
export async function answerUiRequest(e: BridgeEvent) {
  const requestId = String(e.requestId ?? '');
  if (!requestId) return;
  const reply = (body: Record<string, unknown>) => call('ui-response', { requestId, ...body }).catch(() => { /* 后端已超时放弃 */ });
  try {
    if (e.action === 'prefs-get') return void reply({ ok: true, value: { prefs: uiPrefsView() } });
    if (e.action !== 'prefs-set') throw new PrefError('ui_request_unknown', `不认识的界面请求：${String(e.action)}`);
    const changes = normalize(e.patch);
    if (!e.dryRun) {
      for (const c of changes) await UI_PREFS[c.key].set(c.to);
      // 缩放在壳没放行时会自己退回，回执用实际值
      for (const c of changes) c.to = UI_PREFS[c.key].get();
      if (changes.length) changed(['ui-prefs']);
    }
    void reply({ ok: true, value: { applied: !e.dryRun, changes, prefs: uiPrefsView() } });
  } catch (err) {
    const x = err instanceof PrefError ? err : new PrefError('ui_request_failed', err instanceof Error ? err.message : String(err));
    void reply({ ok: false, error: { code: x.code, message: x.message, details: x.details } });
  }
}

// ---------------- 接线 ----------------

export function initSettingsSync(): () => void {
  return onBridgeEvent((e) => {
    if (e.type === 'settings_changed') changed(Array.isArray(e.scopes) ? e.scopes : typeof e.scope === 'string' ? [e.scope] : []);
    else if (e.type === 'ui_request') void answerUiRequest(e);
    else if (e.type === 'pi_event' && e.event?.type === 'tool_execution_end' && !e.event.isError) {
      const scopes = TOOL_SCOPES[e.event.toolName as string];
      if (scopes) changed(scopes);
    }
  });
}
