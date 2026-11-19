// 主题引擎：从壁纸取色（Material Color Utilities）→ 派生 M3 配色 → 写成 --md-* CSS 变量。
// 旧组件读的 --bg / --fg / --accent 等在 app.css 里映射到这些变量，换壁纸整套跟着变。
// 「氛围底」做法：壁纸换上时预先模糊一份小图，非主页页面用它当底，运行时不做实时模糊。
import { Hct, MaterialDynamicColors, SchemeTonalSpot, SchemeVibrant, hexFromArgb, argbFromHex, sourceColorFromImageBytes, type DynamicScheme } from '@material/material-color-utilities';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { wallpaperStore, videoStore } from './wallpaper-store';
import { initFont } from './font.svelte';

export type ThemeMode = 'system' | 'light' | 'dark';
export type WindowLook = 'matcha-dark' | 'matcha-light' | 'wallpaper';
/** 鲜艳：M3 Vibrant，饱和度高，配二次元壁纸更亮；柔和：M3 Tonal Spot，偏素 */
export type ThemeTone = 'vivid' | 'soft';

interface ThemePrefs {
  look: WindowLook;
  wallpaperRevision: number;
  mode: ThemeMode;
  tone: ThemeTone;
  /** 非主页页面上，壁纸上方那层底色的浓度（0.2–0.85），越高越素、字越清楚 */
  veil: number;
  /** 上次从壁纸取到的种子色，下次启动先用它，免得闪一下默认色 */
  seed: string | null;
  /** 当前壁纸来自哪个内置预设；玩家自己导入的图为 null */
  preset: string | null;
  /** 动态壁纸：桌面版记本机视频路径（不复制，省 C 盘）；浏览器预览存进 IndexedDB 时为 LOCAL_VIDEO */
  video: string | null;
}

/** 内置外观预设：宣传片里那三张原创壁纸（promo-video/assets/gen 程序画的），配「随壁纸取色 + 深色」 */
export const WALLPAPER_PRESETS = [
  { id: 'matcha', name: '抹茶山林', file: '/wallpapers/matcha.jpg', thumb: '/wallpapers/matcha-thumb.jpg', mode: 'dark' },
  { id: 'dusk', name: '黄昏小城', file: '/wallpapers/dusk.jpg', thumb: '/wallpapers/dusk-thumb.jpg', mode: 'dark' },
  { id: 'night', name: '月夜都市', file: '/wallpapers/night.jpg', thumb: '/wallpapers/night-thumb.jpg', mode: 'dark' },
] as const satisfies readonly { id: string; name: string; file: string; thumb: string; mode: ThemeMode }[];
export type WallpaperPresetId = (typeof WALLPAPER_PRESETS)[number]['id'];

const KEY = 'flare.theme';
/** 没有壁纸时的种子色：Matcha 图标上的薄荷绿 */
export const DEFAULT_SEED = '#4B816D';

function readPrefs(raw: string | null): ThemePrefs {
  const defaults: ThemePrefs = { look: 'matcha-dark', mode: 'system', tone: 'vivid', veil: 0.55, seed: null, wallpaperRevision: 0, preset: null, video: null };
  if (!raw) return defaults;
  try {
    const saved = JSON.parse(raw);
    const p = { ...defaults, ...saved };
    if (!['matcha-dark', 'matcha-light', 'wallpaper'].includes(saved?.look)) {
      // Preserve existing wallpaper, system mode and custom palette settings on upgrade.
      p.look = p.seed || p.mode === 'system' || p.tone !== 'vivid' || p.veil !== 0.55
        ? 'wallpaper' : p.mode === 'light' ? 'matcha-light' : 'matcha-dark';
    }
    return p;
  } catch { return defaults; }
}

function loadPrefs() {
  try { return readPrefs(localStorage.getItem(KEY)); } catch { return readPrefs(null); }
}
const prefs = loadPrefs();
let wallpaperRevision = prefs.wallpaperRevision;
let videoRef: string | null = prefs.video;
let savedSeed = prefs.seed;
let loadedRevision: number | undefined;
let generation = 0;
let started = false;

export const theme = $state({
  look: prefs.look,
  mode: prefs.mode,
  tone: prefs.tone,
  veil: prefs.veil,
  seed: prefs.seed ?? DEFAULT_SEED,
  /** 当前壁纸对应的内置预设 id；自己导入的图为 null */
  preset: prefs.preset as string | null,
  /** 正在换的预设 id（下载 + 取色要一小会儿） */
  applying: '' as string,
  /** 当前是否深色（system 时跟随系统） */
  dark: true,
  /** 原图 blob URL；空串表示用默认背景 */
  wallpaper: '',
  /** 预模糊的小图 blob URL */
  ambient: '',
  /** 动态壁纸的播放地址；空串表示静态图。wallpaper 这时是它的封面帧 */
  video: '',
  /** 动态壁纸来源：本机路径，或 LOCAL_VIDEO */
  videoFile: prefs.video ?? '',
  /** 视频找不到或播放不了时的说明，主页先显示封面 */
  videoError: '',
  busy: false,
});

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'surface', 'surfaceDim', 'surfaceBright', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
  'onSurface', 'onSurfaceVariant', 'outline', 'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'inversePrimary', 'scrim', 'shadow',
] as const;
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const mdc = new MaterialDynamicColors();

/** 壁纸轮播开了「配色跟着换」时，主页正在显示那张图的种子色；null 时用主壁纸的 theme.seed */
let slideSeed: string | null = null;
export function setSlideSeed(seed: string | null) {
  if (slideSeed === seed) return;
  slideSeed = seed;
  if (started) apply();
}
/** 主壁纸换了 / 移除了：轮播回到第一张 */
const mainListeners = new Set<() => void>();
export function onMainWallpaper(fn: () => void) { mainListeners.add(fn); return () => mainListeners.delete(fn); }
function mainChanged() { slideSeed = null; for (const fn of mainListeners) fn(); }

function apply() {
  const fixed = theme.look !== 'wallpaper';
  theme.dark = fixed ? theme.look === 'matcha-dark' : theme.mode === 'system' ? (media?.matches ?? true) : theme.mode === 'dark';
  const hct = Hct.fromInt(argbFromHex(fixed ? DEFAULT_SEED : slideSeed ?? theme.seed));
  const scheme: DynamicScheme = fixed || theme.tone === 'vivid' ? new SchemeVibrant(hct, theme.dark, 0) : new SchemeTonalSpot(hct, theme.dark, 0);
  const root = document.documentElement;
  for (const role of ROLES) {
    const dc = (mdc as unknown as Record<string, () => { getArgb(s: DynamicScheme): number }>)[role]?.();
    if (dc) root.style.setProperty(`--md-${kebab(role)}`, hexFromArgb(dc.getArgb(scheme)));
  }
  root.style.setProperty('--veil', String(fixed ? 0.55 : theme.veil));
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.dataset.theme = theme.dark ? 'dark' : 'light';
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ look: theme.look, mode: theme.mode, tone: theme.tone, veil: theme.veil, seed: savedSeed, wallpaperRevision, preset: theme.preset, video: videoRef } satisfies ThemePrefs)); } catch { /* 本次会话有效 */ }
}

/** 缩到 320px 再模糊，存成一张小 JPEG。CSS 拉伸显示，本来就糊，看不出分辨率低。 */
export async function makeAmbient(bmp: ImageBitmap): Promise<Blob> {
  const k = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const g = c.getContext('2d')!;
  g.filter = 'blur(12px) saturate(1.25)';
  // 画得比画布大一圈，避免模糊把透明边缘吸进来变暗
  const pad = 30;
  g.drawImage(bmp, -pad, -pad, w + pad * 2, h + pad * 2);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
}

export function seedFrom(bmp: ImageBitmap) {
  // Sample the whole composition without quantizing millions of full-size pixels.
  const scale = Math.min(1, 128 / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return hexFromArgb(sourceColorFromImageBytes(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
}

async function prepare(blob: Blob, extractSeed: boolean) {
  const bmp = await createImageBitmap(blob);
  try {
    const seed = extractSeed ? seedFrom(bmp) : null;
    const ambient = await makeAmbient(bmp);
    return { wallpaper: URL.createObjectURL(blob), ambient: URL.createObjectURL(ambient), seed };
  } finally { bmp.close(); }
}

type Preview = Awaited<ReturnType<typeof prepare>>;
function release(p: { wallpaper: string; ambient: string }) {
  for (const url of [p.wallpaper, p.ambient]) if (url) URL.revokeObjectURL(url);
}
const dropUrl = (url: string) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); };
function show(p?: Preview, video = '') {
  release(theme);
  dropUrl(theme.video);
  theme.wallpaper = p?.wallpaper ?? '';
  theme.ambient = p?.ambient ?? '';
  theme.video = video;
}

// ---------------- 动态壁纸 ----------------
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'm4v', 'mov'];
/** 浏览器预览拿不到本机路径，视频本体存进 IndexedDB */
export const LOCAL_VIDEO = 'indexeddb';
/** 只有主窗口播视频；助手窗口只用氛围底 */
const mainWindow = typeof location === 'undefined' || new URLSearchParams(location.search).get('view') !== 'agent';
const failText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** 桌面版：让桌面壳放行这个视频文件（重启后也要再放行一次），返回播放地址 */
async function videoUrl(ref: string) {
  if (ref === LOCAL_VIDEO) {
    const blob = await videoStore.load();
    if (!blob) throw new Error('视频壁纸已经不在了');
    return URL.createObjectURL(blob);
  }
  if (!isTauri()) throw new Error('本机视频要在桌面版里播放');
  await invoke('wallpaper_video', { path: ref });
  return convertFileSrc(ref);
}

/** 从视频开头 10%（最多 3 秒）取一帧当封面：配色、氛围底、缩略图都用它，运行时不做实时模糊 */
async function videoPoster(url: string): Promise<Blob> {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto';
  const wait = (event: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('视频读取超时')), 20000);
    v.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(timer); reject(new Error('这个视频播放不了，请换成 MP4（H.264）或 WebM')); }, { once: true });
  });
  try {
    const loaded = wait('loadeddata');
    v.src = url;
    await loaded;
    if (!v.videoWidth || !v.videoHeight) throw new Error('这个文件里没有画面');
    const at = Number.isFinite(v.duration) && v.duration > 0 ? Math.min(v.duration * 0.1, 3) : 0;
    if (at > 0.05) { const seeked = wait('seeked'); v.currentTime = at; await seeked; }
    const k = Math.min(1, 1920 / Math.max(v.videoWidth, v.videoHeight));
    const c = new OffscreenCanvas(Math.max(1, Math.round(v.videoWidth * k)), Math.max(1, Math.round(v.videoHeight * k)));
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  } finally { v.removeAttribute('src'); v.load(); }
}

async function restoreWallpaper() {
  if (loadedRevision === wallpaperRevision) return;
  const job = ++generation;
  try {
    const blob = await wallpaperStore.load();
    if (job !== generation) return;
    const p = blob ? await prepare(blob, !savedSeed) : undefined;
    // 视频找不到（比如移动了、所在的盘没接上）时保留记录，主页先显示封面
    let video = '';
    if (p && videoRef && mainWindow) {
      try { video = await videoUrl(videoRef); theme.videoError = ''; }
      catch (e) { theme.videoError = failText(e); console.warn('动态壁纸读取失败，先显示封面', e); }
    }
    if (job !== generation) { if (p) release(p); dropUrl(video); return; }
    show(p, video);
    theme.videoFile = videoRef ?? '';
    const replaced = loadedRevision !== undefined;
    loadedRevision = wallpaperRevision;
    if (p?.seed) { theme.seed = savedSeed = p.seed; save(); }
    // 另一个窗口换了主壁纸
    if (replaced) mainChanged();
    apply();
  } catch (e) {
    console.warn('壁纸读取失败，改用默认背景', e);
  }
}

export function initTheme() {
  if (started) return;
  started = true;
  initFont();
  apply();
  media?.addEventListener('change', () => { if (theme.look === 'wallpaper' && theme.mode === 'system') apply(); });
  // Both WebViews use the same origin. Only the window making a choice writes it.
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    const p = readPrefs(e.newValue);
    const reload = p.wallpaperRevision !== wallpaperRevision;
    Object.assign(theme, { look: p.look, mode: p.mode, tone: p.tone, veil: p.veil, seed: p.seed ?? DEFAULT_SEED, preset: p.preset });
    savedSeed = p.seed; wallpaperRevision = p.wallpaperRevision; videoRef = p.video;
    apply();
    if (reload) void restoreWallpaper();
  });
  void restoreWallpaper();
}

export function setLook(look: WindowLook) {
  if (theme.look === look) return;
  theme.look = look;
  apply(); save();
}

function commit(p: Preview, preset: string | null, video: { ref: string; url: string } | null) {
  ++generation;
  wallpaperRevision = Math.max(Date.now(), wallpaperRevision + 1);
  theme.preset = preset;
  theme.seed = savedSeed = p.seed!;
  show(p, video?.url ?? '');
  videoRef = video?.ref ?? null;
  theme.videoFile = videoRef ?? '';
  theme.videoError = '';
  loadedRevision = wallpaperRevision;
  mainChanged();
  apply();
  save();
}

/** preset：来自内置预设时传它的 id，玩家自己选的图不传。换成静态图会取消动态壁纸 */
export async function setWallpaper(file: Blob, preset: string | null = null) {
  theme.busy = true;
  try {
    const p = await prepare(file, true);
    try { await wallpaperStore.save(file); } catch (e) { release(p); throw e; }
    commit(p, preset, null);
    void videoStore.clear().catch(() => {});
  } finally {
    theme.busy = false;
  }
}

/**
 * 动态壁纸。桌面版传本机视频路径（只记路径，不复制）；浏览器预览传 File（存进 IndexedDB）。
 * 主页播放视频，其他页面和配色用它的封面帧。
 */
export async function setVideoWallpaper(source: string | File) {
  theme.busy = true;
  let url = '';
  try {
    const ref = typeof source === 'string' ? source : LOCAL_VIDEO;
    if (typeof source === 'string') {
      const ext = source.split('.').pop()?.toLowerCase() ?? '';
      if (!VIDEO_EXTENSIONS.includes(ext)) throw new Error('动态壁纸支持 MP4、WebM 视频');
      url = await videoUrl(source);
    } else url = URL.createObjectURL(source);
    const poster = await videoPoster(url);
    const p = await prepare(poster, true);
    try {
      await wallpaperStore.save(poster);
      if (typeof source === 'string') await videoStore.clear().catch(() => {});
      else await videoStore.save(source);
    } catch (e) { release(p); throw e; }
    commit(p, null, { ref, url });
  } catch (e) {
    dropUrl(url);
    throw e;
  } finally {
    theme.busy = false;
  }
}

export async function clearWallpaper() {
  await wallpaperStore.clear();
  void videoStore.clear().catch(() => {});
  ++generation;
  wallpaperRevision = Math.max(Date.now(), wallpaperRevision + 1);
  loadedRevision = wallpaperRevision;
  show();
  videoRef = null;
  theme.videoFile = '';
  theme.videoError = '';
  savedSeed = null;
  theme.preset = null;
  theme.seed = DEFAULT_SEED;
  mainChanged();
  apply();
  save();
}

/** 一键换成内置预设：壁纸 + 随壁纸取色 + 预设的明暗 */
export async function applyWallpaperPreset(id: string) {
  const preset = WALLPAPER_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`没有这个外观预设：${id}`);
  if (theme.applying) return;
  theme.applying = id;
  try {
    if (theme.preset !== id || !theme.wallpaper) {
      const res = await fetch(preset.file);
      if (!res.ok) throw new Error(`预设壁纸读取失败（${res.status}）`);
      await setWallpaper(await res.blob(), id);
    }
    theme.look = 'wallpaper';
    theme.mode = preset.mode;
    apply(); save();
  } finally { theme.applying = ''; }
}

export function setMode(mode: ThemeMode) {
  theme.mode = mode;
  apply();
  save();
}

export function setTone(tone: ThemeTone) {
  theme.tone = tone;
  apply();
  save();
}

export function setVeil(v: number) {
  theme.veil = Math.min(0.85, Math.max(0.2, v));
  document.documentElement.style.setProperty('--veil', String(theme.veil));
  save();
}
