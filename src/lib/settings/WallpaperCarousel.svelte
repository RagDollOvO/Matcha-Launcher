<script lang="ts">
  // 设置 › 外观 › 壁纸轮播：开关、图片格子（主图 + 轮播图）、切换间隔、随机、配色跟不跟着换。
  // 桌面版只记本机原图路径（不复制进 C 盘），本机只存缩略图和氛围底；浏览器预览存压缩后的图。动态壁纸时不轮播。
  import X from '@lucide/svelte/icons/x';
  import Star from '@lucide/svelte/icons/star';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import ImageOff from '@lucide/svelte/icons/image-off';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { open } from '@tauri-apps/plugin-dialog';
  import Toggle from '../components/Toggle.svelte';
  import { theme } from '../theme/theme.svelte';
  import {
    carousel, CAROUSEL_INTERVALS, MAX_SLIDES, IMAGE_EXTENSIONS, addSlides, addSlidePaths, addPresetSlides, missingPresets, removeSlide, makeMain,
    setCarouselOn, setCarouselInterval, setCarouselShuffle, setCarouselFollow, type ImportResult,
  } from '../theme/carousel.svelte';
  import { app } from '../stores/app.svelte';
  import { desktop, errorText } from '../api/bridge';

  let input = $state<HTMLInputElement>();
  /** 正在处理的那张（设为主图要重新取色，要一小会儿） */
  let working = $state('');
  const video = $derived(!!theme.videoFile);
  const count = $derived(carousel.slides.length + (theme.wallpaper ? 1 : 0));
  const bytes = $derived(carousel.slides.reduce((n, s) => n + s.bytes, 0));
  const linked = $derived(carousel.slides.filter((s) => s.path).length);
  const lost = $derived(carousel.slides.filter((s) => s.missing).length);
  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const room = $derived(MAX_SLIDES - carousel.slides.length);
  const presets = $derived(missingPresets());
  const busy = $derived(!!carousel.importing || !!working || theme.busy);
  const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

  function report(r: Partial<ImportResult> & { other?: number }) {
    const parts: string[] = [];
    if (r.added) parts.push(`加入了 ${r.added} 张`);
    if (r.duplicate) parts.push(`${r.duplicate} 张已经在轮播里`);
    if (r.failed) parts.push(`${r.failed} 张读不了`);
    if (r.missing) parts.push(`${r.missing} 个找不到`);
    if (r.other) parts.push(`${r.other} 个不是图片，跳过了`);
    if (r.skipped) parts.push(`${r.skipped} 张没放下（最多 ${MAX_SLIDES} 张）`);
    app.toast(parts.join('，') || '这里面没有能用的图片');
  }
  // 桌面版：系统选择窗口拿本机路径，只记路径不复制；浏览器预览只能读文件本体
  async function choose(folder: boolean) {
    if (!desktop) { input?.click(); return; }
    let picked: string | string[] | null;
    try {
      picked = folder
        ? await open({ directory: true, multiple: false, title: '选一个放壁纸的文件夹' })
        : await open({ multiple: true, directory: false, title: '选择轮播的图片', filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }] });
    } catch (err) { app.toast(`打不开选择窗口：${errorText(err)}`); return; }
    const paths = picked == null ? [] : Array.isArray(picked) ? picked : [picked];
    if (!paths.length) return;
    try { report(await addSlidePaths(paths)); }
    catch (err) { app.toast(`图片没加进去：${errorText(err)}`); }
  }
  async function pick(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const files = [...(el.files ?? [])];
    el.value = '';
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) { if (files.length) app.toast('请选择图片文件'); return; }
    try { report({ ...(await addSlides(images)), other: files.length - images.length }); }
    catch (err) { app.toast(`图片没加进去：${errorText(err)}`); }
  }
  async function presetsIn() {
    try { report(await addPresetSlides()); }
    catch (err) { app.toast(`内置壁纸没加进去：${errorText(err)}`); }
  }
  async function toMain(id: string) {
    working = id;
    try { await makeMain(id); app.toast('已设为主图，配色从这张取'); }
    catch (err) { app.toast(`没设成：${errorText(err)}`); }
    finally { working = ''; }
  }
  async function drop(id: string) {
    try { await removeSlide(id); }
    catch (err) { app.toast(`移除失败：${errorText(err)}`); }
  }
  async function toggle() {
    try { await setCarouselOn(!carousel.on); }
    catch (err) { app.toast(`没切换成：${errorText(err)}`); }
  }
</script>

<div class="card">
  <div class="line">
    <div class="lt"><b>壁纸轮播{#if carousel.on && !video && count > 1}<span class="w">{count} 张</span>{/if}</b>{#if video}<span class="sub">使用动态壁纸期间暂停轮播</span>{/if}</div>
    <Toggle on={carousel.on && !video} disabled={video} label="壁纸轮播" onchange={() => void toggle()} />
  </div>

  {#if carousel.on && !video}
    <div class="reel">
      <input type="file" accept="image/*" multiple hidden bind:this={input} onchange={pick} />
      <ul class="tiles" aria-label="轮播的图片">
        {#if theme.wallpaper}
          <li class="tile main" title="主图：配色、欢迎页和其他页面的氛围底都用它">
            <span class="pic" style="background-image:url({theme.wallpaper})"></span>
            <span class="tag">主图</span>
          </li>
        {/if}
        {#each carousel.slides as s (s.id)}
          <li class="tile" class:working={working === s.id} class:lost={s.missing} title={s.missing ? `找不到原图，轮播时跳过：${s.path}` : s.path ? fileName(s.path) : undefined}>
            <img class="pic" src={s.thumb} alt="" draggable="false" />
            {#if s.missing}<span class="gone"><ImageOff size={13} />找不到</span>{/if}
            {#if working === s.id}<span class="busy"><LoaderCircle size={16} class="spin" /></span>{/if}
            <span class="acts">
              <button type="button" title="设为主图（配色从它取）" aria-label="设为主图" disabled={busy || s.missing} onclick={() => void toMain(s.id)}><Star size={13} strokeWidth={2.2} /></button>
              <button type="button" title="移出轮播" aria-label="移出轮播" disabled={busy} onclick={() => void drop(s.id)}><X size={14} strokeWidth={2.4} /></button>
            </span>
          </li>
        {/each}
        {#if carousel.importing}
          <li class="tile wait"><LoaderCircle size={16} class="spin" /><span>{carousel.importing.done}/{carousel.importing.total}</span></li>
        {/if}
        {#if room > 0}
          <li><button type="button" class="tile add" disabled={busy} onclick={() => void choose(false)}><ImagePlus size={18} strokeWidth={1.8} /><span>添加图片</span></button></li>
          {#if desktop}<li><button type="button" class="tile add" disabled={busy} title="把一个文件夹里的图片都加进来（只看第一层）" onclick={() => void choose(true)}><FolderOpen size={18} strokeWidth={1.8} /><span>整个文件夹</span></button></li>{/if}
        {/if}
      </ul>
      <div class="foot">
        <span>{#if !carousel.slides.length}再加一张图就能轮播了，可以一次选多张{:else if linked}图片直接读原文件，不复制；本机只存缩略图，占用 {size(bytes)}{#if lost}。{lost} 张找不到原图，轮播时跳过{/if}{:else}轮播图占用 {size(bytes)}，压缩后存在本机{/if}</span>
        {#if presets.length && room > 0}<button type="button" class="link" disabled={busy} onclick={() => void presetsIn()}><Sparkles size={13} />加入内置壁纸（{presets.length} 张）</button>{/if}
      </div>
    </div>

    <div class="line">
      <div class="lt"><b>切换间隔</b><span class="sub">只在主页上计时</span></div>
      <div class="seg" role="radiogroup" aria-label="切换间隔">
        {#each CAROUSEL_INTERVALS as o (o.s)}<button role="radio" aria-checked={carousel.interval === o.s} class:on={carousel.interval === o.s} onclick={() => setCarouselInterval(o.s)}>{o.label}</button>{/each}
      </div>
    </div>
    <div class="line">
      <div class="lt"><b>随机顺序</b></div>
      <Toggle on={carousel.shuffle} label="随机顺序" onchange={() => setCarouselShuffle(!carousel.shuffle)} />
    </div>
    <div class="line">
      <div class="lt"><b>配色跟着换</b>{#if theme.look !== 'wallpaper'}<span class="sub">需要「随壁纸」配色</span>{/if}</div>
      <Toggle on={carousel.follow} disabled={theme.look !== 'wallpaper'} label="配色跟着换" onchange={() => setCarouselFollow(!carousel.follow)} />
    </div>
  {/if}
</div>

<style>
  .reel { padding: 14px 18px 14px; border-top: 1px solid var(--line-soft); }
  .reel + .line { border-top: 1px solid var(--line-soft); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
  .tile { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden;
    outline: 1px solid var(--line); outline-offset: -1px; background: color-mix(in srgb, var(--md-on-surface) 5%, transparent); }
  .pic { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; background-size: cover; background-position: center 30%; user-select: none; }
  .main { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tag { position: absolute; left: 6px; bottom: 6px; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; line-height: 1.5;
    color: var(--md-on-primary); background: var(--md-primary); }

  /* 每张图右上角：设为主图、移出。悬停或键盘聚焦时出现 */
  .acts { position: absolute; top: 5px; right: 5px; display: flex; gap: 4px; opacity: 0; transition: opacity var(--dur); }
  .tile:hover .acts, .tile:focus-within .acts { opacity: 1; }
  .acts button { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 8px; color: #fff; background: rgb(0 0 0 / .55);
    transition: background var(--dur), transform 120ms var(--ease-out); }
  .acts button:hover:not(:disabled) { background: rgb(0 0 0 / .75); }
  .acts button:active:not(:disabled) { transform: scale(0.92); }
  .acts button:disabled { opacity: .5; cursor: default; }
  .acts button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
  .busy { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; background: rgb(0 0 0 / .4); }
  /* 原图找不到：缩略图压暗，左下角标一下 */
  .lost .pic { filter: grayscale(1) brightness(.55); }
  .gone { position: absolute; left: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 6px;
    font-size: 11px; line-height: 1.5; color: #fff; background: rgb(0 0 0 / .6); }

  .wait, .add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 12px; color: var(--fg-3); }
  .wait { font-family: var(--font-mono); font-size: 11.5px; }
  .add { outline: 1px dashed var(--line-strong); cursor: pointer; transition: background var(--dur), color var(--dur), outline-color var(--dur); }
  .add:hover:not(:disabled) { color: var(--fg); background: var(--hover); outline-color: var(--fg-3); }
  .add:active:not(:disabled) { transform: scale(0.97); }
  .add:disabled { opacity: .5; cursor: default; }
  .add:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 1px; }

  .foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 14px; margin-top: 12px; font-size: 12px; color: var(--fg-3); }
  .foot .link:disabled { opacity: .5; cursor: default; }
</style>
