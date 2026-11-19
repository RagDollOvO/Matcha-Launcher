// 壁纸轮播：主壁纸 + 几张图，主页按间隔淡入淡出地换（淡入淡出在 Backdrop.svelte）。
// - 图片导入时压到屏幕大小存进 IndexedDB，同时算好缩略图、氛围底（预模糊小图）和种子色，切换时只读不算。
// - 只在主页、窗口可见、游戏没运行时计时；动态壁纸时不轮播。
// - 「配色跟着换」默认关：界面一直用主壁纸的配色；开了以后整套 --md-* 跟着当前那张图变，氛围底也换。
// - 助手窗口不播图，只跟着主窗口换配色和氛围底（通过 localStorage 的 storage 事件）。
// - 桌面版只记图片路径（不复制进 C 盘），启动时用 wallpaper_images 让桌面壳再放行一次；文件被移走时标「找不到」并跳过。
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { theme, setWallpaper, setSlideSeed, onMainWallpaper, seedFrom, makeAmbient, WALLPAPER_PRESETS } from './theme.svelte';
import { wallpaperStore } from './wallpaper-store';
import { slideStore, type SlideRecord } from './carousel-store';

export const CAROUSEL_INTERVALS = [
  { s: 30, label: '30 秒' },
  { s: 60, label: '1 分钟' },
  { s: 300, label: '5 分钟' },
  { s: 900, label: '15 分钟' },
  { s: 0, label: '每次打开' },
] as const;
/** 主图之外最多几张（每张压缩后约 0.3–1 MB） */
export const MAX_SLIDES = 30;

interface Upcoming { at: string; seed: string | null }
interface CarouselPrefs {
  on: boolean;
  /** 秒；0 = 每次打开换一张 */
  interval: number;
  shuffle: boolean;
  follow: boolean;
  /** 主页正在显示的那张：'' 是主壁纸 */
  at: string;
  seed: string | null;
  /** 下一张，提前定好：「每次打开」时启动就能用对的配色，不闪 */
  next: Upcoming | null;
}
const KEY = 'matcha.carousel';
const DEFAULTS: CarouselPrefs = { on: false, interval: 60, shuffle: false, follow: false, at: '', seed: null, next: null };

function readPrefs(raw: string | null): CarouselPrefs {
  try { return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }; } catch { return { ...DEFAULTS }; }
}
const saved = (() => { try { return readPrefs(localStorage.getItem(KEY)); } catch { return { ...DEFAULTS }; } })();
const mainWindow = typeof location === 'undefined' || new URLSearchParams(location.search).get('view') !== 'agent';
/** 「每次打开」：主窗口启动时直接用上次定好的下一张 */
const start: Upcoming = mainWindow && saved.interval === 0 && saved.next ? saved.next : { at: saved.at, seed: saved.seed };

export interface SlideMeta {
  id: string; thumb: string; seed: string; preset: string | null;
  /** 存在本机的字节数（桌面版只有缩略图和氛围底） */
  bytes: number;
  /** 桌面版：原图路径 */
  path?: string;
  /** 原图找不到了（移走、删掉、盘没接上），轮播时跳过 */
  missing: boolean;
}
/** 桌面版能选的图片格式（和桌面壳 wallpaper_images 一致） */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'jfif'];
const desktop = isTauri();

export const carousel = $state({
  on: saved.on,
  interval: saved.interval,
  shuffle: saved.shuffle,
  follow: saved.follow,
  slides: [] as SlideMeta[],
  loaded: false,
  /** 正在导入：做完几张 / 一共几张 */
  importing: null as null | { done: number; total: number },
  at: start.at,
  /** 当前那张的原图地址；'' 表示主壁纸或者还在读 */
  image: '',
  /** 「配色跟着换」时当前那张的氛围底；空串时用主壁纸的 */
  ambient: '',
});

// 当前那张自己的氛围底和种子色（不管跟不跟配色都留着，开关一切就能用上）
let cur = { image: '', ambient: '', seed: null as string | null };
if (saved.on && saved.follow && start.at && !theme.videoFile) setSlideSeed(start.seed);

/** 轮播在不在起作用 */
export function carouselActive() {
  return carousel.on && !theme.videoFile && (!carousel.loaded || carousel.slides.length > 0);
}
/** 主页该显示的图；轮播到某张但还没读好时为空串 */
export function homeImage() {
  return carouselActive() && carousel.at ? carousel.image : theme.wallpaper;
}
/** 主页有没有照片（读图那一小会儿也算，免得闪默认渐变） */
export function homeHasPhoto() {
  return !!theme.wallpaper || (carouselActive() && !!carousel.at);
}

const frames = () => ['', ...carousel.slides.filter((s) => !s.missing).map((s) => s.id)];
const seedOf = (id: string) => (id ? carousel.slides.find((s) => s.id === id)?.seed ?? null : null);

let bag: string[] = [];
let upcoming: Upcoming | null = null;
function pick(from = carousel.at): string {
  const all = frames();
  if (all.length < 2) return all[0];
  if (!carousel.shuffle) return all[(all.indexOf(from) + 1) % all.length];
  // 随机：一轮里每张都出现一次再洗牌，不会连着两次同一张
  bag = bag.filter((id) => id !== from && all.includes(id));
  if (!bag.length) {
    bag = all.filter((id) => id !== from);
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  }
  return bag[0];
}

function persist() {
  if (!mainWindow) return;
  upcoming = carousel.slides.length ? (() => { const at = pick(); return { at, seed: seedOf(at) }; })() : null;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      on: carousel.on, interval: carousel.interval, shuffle: carousel.shuffle, follow: carousel.follow,
      at: carousel.at, seed: cur.seed, next: upcoming,
    } satisfies CarouselPrefs));
  } catch { /* 本次会话有效 */ }
}

/** 把「当前那张」落到配色和氛围底上 */
function sync() {
  const follow = carousel.on && carousel.follow && !!carousel.at && !theme.videoFile;
  carousel.ambient = follow ? cur.ambient : '';
  setSlideSeed(follow ? cur.seed : null);
}

/** 等图解码好；窗口不出帧（藏在托盘、被遮住）时 decode() 会一直等，最多等 1.5 秒。读不了返回 false */
export const decoded = (img: HTMLImageElement) =>
  Promise.race([img.decode().then(() => true, () => img.complete && img.naturalWidth > 0), new Promise<boolean>((r) => setTimeout(() => r(true), 1500))]);

const later = (urls: string[]) => setTimeout(() => urls.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)), 4000);

const imageUrl = (rec: SlideRecord) => (rec.path ? convertFileSrc(rec.path) : rec.image ? URL.createObjectURL(rec.image) : '');
async function imageBlob(rec: SlideRecord) {
  if (rec.image) return rec.image;
  const res = await fetch(convertFileSrc(rec.path!));
  if (!res.ok) throw new Error('原图找不到了，可能被移动或删除');
  return res.blob();
}
function markMissing(id: string) {
  const s = carousel.slides.find((x) => x.id === id);
  if (s) s.missing = true;
}

let job = 0;
/** 换到某一张。主窗口先在后台把原图解码好，再交给 Backdrop 淡入，切换时不卡 */
async function show(id: string) {
  const my = ++job;
  let next = { image: '', ambient: '', seed: null as string | null };
  if (id) {
    const rec = await slideStore.get(id).catch(() => undefined);
    if (my !== job) return;
    if (!rec) { dropMeta(id); id = ''; }
    else {
      next = { image: mainWindow ? imageUrl(rec) : '', ambient: URL.createObjectURL(rec.ambient), seed: rec.seed };
      if (next.image) {
        const img = new Image();
        img.src = next.image;
        // 原图被移走了：标「找不到」，这次不换
        if (!(await decoded(img))) { markMissing(id); later([next.image, next.ambient]); if (my === job) persist(); return; }
      }
      if (my !== job) { later([next.image, next.ambient]); return; }
    }
  }
  later([cur.image, cur.ambient]);
  cur = next;
  bag = bag.filter((x) => x !== id);
  carousel.at = id;
  carousel.image = next.image;
  sync();
  persist();
}

function dropMeta(id: string) {
  const i = carousel.slides.findIndex((s) => s.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(carousel.slides[i].thumb);
  carousel.slides.splice(i, 1);
}

// ---------------- 计时 ----------------
let onStage = false;
let left = 0;
/** Backdrop 告诉这里主页是不是正显示着照片（主页、没在放视频、游戏没运行） */
export function setCarouselStage(v: boolean) { onStage = v; }

let switching = false;
async function advance() {
  if (switching) return;
  switching = true;
  try { await show(upcoming?.at && frames().includes(upcoming.at) ? upcoming.at : pick()); }
  finally { switching = false; }
}

/** 主页上手动换下一张（也给开发预览用） */
export function nextSlide() {
  left = carousel.interval;
  return advance();
}

function tick() {
  if (!onStage || !carouselActive() || !carousel.loaded || carousel.interval <= 0 || document.visibilityState !== 'visible') return;
  if (left <= 0 || left > carousel.interval) left = carousel.interval;
  if (--left <= 0) void advance();
}

// ---------------- 导入 ----------------
/** 主页大图压到屏幕大小（物理像素，1920–3840） */
const screenEdge = () => Math.round(Math.min(3840, Math.max(1920, Math.max(screen.width, screen.height) * (devicePixelRatio || 1))));

async function scaled(bmp: ImageBitmap, edge: number, type: string, quality: number) {
  const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const out = await c.convertToBlob({ type, quality });
  // 不支持 WebP 编码时会退回 PNG，改用 JPEG
  return out.type === type ? out : c.convertToBlob({ type: 'image/jpeg', quality });
}

/** path：桌面版的本机原图，只记路径不存图 */
async function prepareSlide(file: Blob, preset: string | null, added: number, path?: string): Promise<SlideRecord> {
  const bmp = await createImageBitmap(file);
  try {
    const seed = seedFrom(bmp);
    const ambient = await makeAmbient(bmp);
    const thumb = await scaled(bmp, 240, 'image/jpeg', 0.82);
    if (path) return { id: crypto.randomUUID(), path, thumb, ambient, seed, preset, added };
    const edge = screenEdge();
    // GIF 原样存（会动）；本来就不大的图也原样存，免得二次压缩
    const keep = file.type === 'image/gif' || (Math.max(bmp.width, bmp.height) <= edge && file.size <= 2.5 * 1024 * 1024);
    const image = keep ? file : await scaled(bmp, edge, 'image/webp', 0.9);
    return { id: crypto.randomUUID(), image, thumb, ambient, seed, preset, added };
  } finally { bmp.close(); }
}

const metaOf = (r: SlideRecord): SlideMeta => ({
  id: r.id, thumb: URL.createObjectURL(r.thumb), seed: r.seed, preset: r.preset, path: r.path, missing: false,
  bytes: (r.image?.size ?? 0) + r.thumb.size + r.ambient.size,
});

export interface ImportResult { added: number; failed: number; skipped: number; missing?: number; duplicate?: number }

/** 逐张导入（一次只解一张图，内存不会冲高）；超过上限的跳过 */
async function importEach(total: number, load: (i: number) => Promise<SlideRecord>): Promise<ImportResult> {
  const count = Math.min(total, Math.max(0, MAX_SLIDES - carousel.slides.length));
  let added = 0, failed = 0;
  if (!count) return { added, failed, skipped: total };
  carousel.importing = { done: 0, total: count };
  const progress = carousel.importing;
  try {
    for (let i = 0; i < count; i++) {
      try {
        const rec = await load(i);
        await slideStore.put(rec);
        carousel.slides.push(metaOf(rec));
        added++;
      } catch (e) { failed++; console.warn('轮播图片导入失败', e); }
      progress.done++;
    }
  } finally { carousel.importing = null; }
  // 原来没有主壁纸（比如移除过）：第一张当主图
  if (added && !theme.wallpaper && !theme.videoFile) await makeMain(carousel.slides[0].id, false);
  persist();
  return { added, failed, skipped: total - count };
}

/** 浏览器预览：加图片文件进轮播（压缩后存进 IndexedDB） */
export function addSlides(files: Blob[], preset: string | null = null) {
  return importEach(files.length, (i) => prepareSlide(files[i], preset, Date.now()));
}

interface Allowed { files: { path: string; size: number }[]; missing: string[] }
/** 桌面版：让桌面壳放行这些图片（文件夹展开第一层），返回能读的和找不到的 */
const allowImages = (paths: string[]) => invoke<Allowed>('wallpaper_images', { paths });

/** 桌面版：加本机图片或文件夹进轮播，只记路径不复制 */
export async function addSlidePaths(paths: string[]): Promise<ImportResult> {
  const { files, missing } = await allowImages(paths);
  const known = new Set(carousel.slides.map((s) => s.path?.toLowerCase()));
  const fresh = files.filter((f) => !known.has(f.path.toLowerCase()));
  const r = await importEach(fresh.length, async (i) => {
    const res = await fetch(convertFileSrc(fresh[i].path));
    if (!res.ok) throw new Error(`读不了（${res.status}）`);
    return prepareSlide(await res.blob(), null, Date.now(), fresh[i].path);
  });
  return { ...r, missing: missing.length, duplicate: files.length - fresh.length };
}

/** 还没加进轮播、也不是主图的内置壁纸 */
export function missingPresets() {
  return WALLPAPER_PRESETS.filter((p) => p.id !== theme.preset && !carousel.slides.some((s) => s.preset === p.id));
}
export async function addPresetSlides() {
  let added = 0, failed = 0;
  for (const p of missingPresets()) {
    try {
      const res = await fetch(p.file);
      if (!res.ok) throw new Error(String(res.status));
      const r = await addSlides([await res.blob()], p.id);
      added += r.added; failed += r.failed;
    } catch (e) { failed++; console.warn('内置壁纸读取失败', e); }
  }
  return { added, failed };
}

export async function removeSlide(id: string) {
  await slideStore.remove(id);
  dropMeta(id);
  if (carousel.at === id) await show('');
  else persist();
}

/**
 * 把一张设成主图（配色、欢迎页、其他页面的氛围底都用主图）。
 * keepOld：原来的主图留在轮播里，占这张的位置；false 时直接丢掉（「移除」主图时用）。
 */
export async function makeMain(id: string, keepOld = true) {
  const rec = await slideStore.get(id);
  if (!rec) { dropMeta(id); return; }
  const old = keepOld ? await wallpaperStore.load() : undefined;
  const oldPreset = theme.preset;
  // 主图要在没开轮播、其他窗口里也能用，所以复制一份进本机存储（和单张壁纸一样）
  await setWallpaper(await imageBlob(rec), rec.preset);
  const i = carousel.slides.findIndex((s) => s.id === id);
  let back: SlideRecord | undefined;
  if (old) {
    try { back = await prepareSlide(old, oldPreset, rec.added); await slideStore.put(back); }
    catch (e) { back = undefined; console.warn('原来的主图没能放回轮播', e); }
  }
  await slideStore.remove(id);
  if (i >= 0) {
    URL.revokeObjectURL(carousel.slides[i].thumb);
    if (back) carousel.slides[i] = metaOf(back); else carousel.slides.splice(i, 1);
  }
  persist();
}

// ---------------- 设置 ----------------
export async function setCarouselOn(on: boolean) {
  carousel.on = on;
  left = carousel.interval;
  if (on && !theme.wallpaper && !theme.videoFile && carousel.slides.length) await makeMain(carousel.slides[0].id, false);
  if (!on && carousel.at) await show('');
  sync();
  persist();
}
export function setCarouselInterval(s: number) {
  carousel.interval = s;
  left = s;
  persist();
}
export function setCarouselShuffle(v: boolean) {
  carousel.shuffle = v;
  bag = [];
  persist();
}
export function setCarouselFollow(v: boolean) {
  carousel.follow = v;
  sync();
  persist();
}

// ---------------- 启动 ----------------
let started = false;
export async function initCarousel() {
  if (started) return;
  started = true;
  onMainWallpaper(() => { if (mainWindow) void show(''); });

  if (!mainWindow) {
    // 助手窗口：跟着主窗口换配色和氛围底
    const mirror = async (p: CarouselPrefs) => {
      Object.assign(carousel, { on: p.on, interval: p.interval, shuffle: p.shuffle, follow: p.follow });
      if (p.on && p.follow && p.at && !theme.videoFile) await show(p.at);
      else if (carousel.at || cur.ambient) await show('');
      else sync();
    };
    window.addEventListener('storage', (e) => { if (e.key === KEY) void mirror(readPrefs(e.newValue)); });
    await mirror(saved);
    return;
  }

  const recs = await slideStore.all().catch((e) => { console.warn('轮播图片读取失败', e); return [] as SlideRecord[]; });
  carousel.slides = recs.map(metaOf);
  // 桌面版：本机原图要桌面壳每次启动再放行一次；找不到的（移走了、盘没接上）标出来，轮播时跳过
  const paths = carousel.slides.flatMap((s) => (s.path ? [s.path] : []));
  if (paths.length) {
    let gone: Set<string>;
    try { gone = new Set((desktop ? (await allowImages(paths)).missing : paths).map((p) => p.toLowerCase())); }
    catch (e) { console.warn('轮播原图放行失败', e); gone = new Set(paths.map((p) => p.toLowerCase())); }
    for (const s of carousel.slides) if (s.path) s.missing = gone.has(s.path.toLowerCase());
  }
  carousel.loaded = true;
  let at = carousel.at;
  if (at && !carousel.slides.some((s) => s.id === at && !s.missing)) at = '';
  // 「每次打开」但还没定过下一张（刚打开这个选项）：这次从上次那张往后挪一张
  if (carousel.on && carousel.interval === 0 && !saved.next && carousel.slides.length) at = pick(saved.at);
  if (carouselActive() && at) await show(at);
  else { carousel.at = ''; sync(); persist(); }
  left = carousel.interval;
  setInterval(tick, 1000);
}
