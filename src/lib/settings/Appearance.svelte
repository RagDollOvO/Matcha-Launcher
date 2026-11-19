<script lang="ts">
  // 设置页「外观」：窗口配色、壁纸（含随壁纸取色的细调）、字体、缩放、动效。都只存在本机。
  import { onMount } from 'svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import ImageUp from '@lucide/svelte/icons/image-up';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Film from '@lucide/svelte/icons/film';
  import { open } from '@tauri-apps/plugin-dialog';
  import { theme, setWallpaper, setVideoWallpaper, clearWallpaper, setMode, setTone, setVeil, VIDEO_EXTENSIONS, LOCAL_VIDEO, type ThemeMode, type ThemeTone } from '../theme/theme.svelte';
  import { display, probeZoom, setZoom, setReduceMotion, ZOOMS } from '../theme/display.svelte';
  import { prefs } from '../stores/prefs.svelte';
  import { app } from '../stores/app.svelte';
  import { desktop, errorText } from '../api/bridge';
  import Toggle from '../components/Toggle.svelte';
  import WindowLooks from './WindowLooks.svelte';
  import WallpaperCarousel from './WallpaperCarousel.svelte';
  import { carousel, carouselActive, makeMain } from '../theme/carousel.svelte';
  import InterfaceFont from './InterfaceFont.svelte';

  const MODES: { id: ThemeMode; label: string }[] = [{ id: 'system', label: '跟随系统' }, { id: 'light', label: '浅色' }, { id: 'dark', label: '深色' }];
  const TONES: { id: ThemeTone; label: string }[] = [{ id: 'vivid', label: '鲜艳' }, { id: 'soft', label: '柔和' }];
  let wpInput = $state<HTMLInputElement>();
  onMount(probeZoom);

  async function pickWallpaper(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { app.toast('请选择图片文件'); return; }
    try { await setWallpaper(file); app.toast(file.type === 'image/gif' ? '主页壁纸已更新，GIF 会动起来' : '主页壁纸已更新'); }
    catch (err) { app.toast(`这张图片读不了：${errorText(err)}`); }
  }
  // 动态壁纸：桌面版用系统选择窗口拿到本机路径，只记路径不复制（C 盘紧张）；浏览器预览只能读文件本体
  let vidInput = $state<HTMLInputElement>();
  const videoName = $derived(theme.videoFile === LOCAL_VIDEO ? '已导入的视频' : theme.videoFile.split(/[\\/]/).pop() ?? '');
  async function pickVideo() {
    if (!desktop) { vidInput?.click(); return; }
    let path: string | null = null;
    try {
      const picked = await open({ multiple: false, directory: false, title: '选择动态壁纸', filters: [{ name: '视频', extensions: VIDEO_EXTENSIONS }] });
      path = typeof picked === 'string' ? picked : null;
    } catch (err) { app.toast(`打不开选择窗口：${errorText(err)}`); return; }
    if (path) await useVideo(path);
  }
  function pickVideoFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) { app.toast('请选择视频文件'); return; }
    if (file.size > 300 * 1024 * 1024) { app.toast('浏览器预览里视频请小于 300 MB；桌面版不限'); return; }
    void useVideo(file);
  }
  async function useVideo(source: string | File) {
    try { await setVideoWallpaper(source); app.toast('动态壁纸已更新，主页会播放它'); }
    catch (err) { app.toast(`这个视频用不了：${errorText(err)}`); }
  }
  async function removeWallpaper() {
    // 轮播里还有图：移除的只是主图，下一张接上当主图
    try { if (carouselActive() && carousel.slides.length) await makeMain(carousel.slides[0].id, false); else await clearWallpaper(); }
    catch (err) { app.toast(`移除壁纸失败：${errorText(err)}`); }
  }
</script>

<section id="set-look">
  <h2>外观</h2>
  <WindowLooks />

  <h3>壁纸</h3>
  <div class="card">
    <div class="line wp">
      <div class="prev" class:empty={!theme.wallpaper} style={theme.wallpaper ? `background-image:url(${theme.wallpaper})` : ''}></div>
      <div class="lt"><b>主页壁纸{#if theme.videoFile}<span class="soon">动态</span>{/if}</b>
        {#if theme.videoFile && theme.videoError}<span class="sub">{theme.videoError}（{videoName}）· 已显示封面</span>{:else if theme.videoFile}<span class="sub">{videoName} · 游戏运行时暂停</span>{:else if carouselActive() && carousel.slides.length}<span class="sub">轮播主图</span>{/if}</div>
      <div class="row">
        <input type="file" accept="image/*" hidden bind:this={wpInput} onchange={pickWallpaper} />
        <input type="file" accept="video/mp4,video/webm,.m4v,.mov" hidden bind:this={vidInput} onchange={pickVideoFile} />
        {#if theme.wallpaper}<button class="btn ghost" disabled={theme.busy} onclick={removeWallpaper}><RotateCcw size={14} />移除</button>{/if}
        <button class="btn" disabled={theme.busy} onclick={pickVideo}><Film size={14} />{theme.videoFile ? '换视频…' : '视频…'}</button>
        <button class="btn" disabled={theme.busy} onclick={() => wpInput?.click()}>{#if theme.busy}<LoaderCircle size={14} class="spin" />{:else}<ImageUp size={14} />{/if}{theme.wallpaper && !theme.videoFile ? '换图片…' : '图片…'}</button>
      </div>
    </div>
    {#if theme.look === 'wallpaper'}
      <details class="tune">
        <summary class="line"><div class="lt"><b>随壁纸配色</b></div>
          <span class="seed" aria-label="当前配色"><i style="background:var(--md-primary)"></i><i style="background:var(--md-secondary-container)"></i><i style="background:var(--md-tertiary)"></i></span>
          <ChevronRight size={16} class="chev" /></summary>
        <div class="line"><div class="lt"><b>明暗</b></div>
          <div class="seg" role="radiogroup" aria-label="明暗">
            {#each MODES as m (m.id)}<button role="radio" aria-checked={theme.mode === m.id} class:on={theme.mode === m.id} onclick={() => setMode(m.id)}>{m.label}</button>{/each}
          </div></div>
        <div class="line"><div class="lt"><b>配色风格</b></div>
          <div class="seg" role="radiogroup" aria-label="配色风格">
            {#each TONES as t (t.id)}<button role="radio" aria-checked={theme.tone === t.id} class:on={theme.tone === t.id} onclick={() => setTone(t.id)}>{t.label}</button>{/each}
          </div></div>
        <div class="line"><div class="lt"><b>氛围底浓度</b></div>
          <div class="vol"><input type="range" min="0.2" max="0.85" step="0.05" value={theme.veil} oninput={(e) => setVeil(+e.currentTarget.value)} aria-label="氛围底浓度" /><span class="val">{Math.round(theme.veil * 100)}%</span></div></div>
      </details>
    {/if}
  </div>
  <WallpaperCarousel />

  <h3>文字与显示</h3>
  <div class="card">
    <InterfaceFont />
    <div class="line">
      <div class="lt"><b>界面缩放{#if desktop && display.zoomSupported === false}<span class="soon">即将支持</span>{/if}</b>{#if !desktop}<span class="sub">桌面版可用</span>{/if}</div>
      <div class="seg" role="radiogroup" aria-label="界面缩放">
        {#each ZOOMS as z (z)}<button role="radio" aria-checked={prefs.zoom === z} class:on={prefs.zoom === z} disabled={!display.zoomSupported} onclick={() => void setZoom(z)}>{Math.round(z * 100)}%</button>{/each}
      </div>
    </div>
    <div class="line">
      <div class="lt"><b>减弱动效</b><span class="sub">跟随 Windows 的「动画效果」设置自动减弱</span></div>
      <Toggle on={prefs.reduceMotion} label="减弱动效" onchange={() => setReduceMotion(!prefs.reduceMotion)} />
    </div>
  </div>
</section>

<style>
  .wp { gap: 16px; }
  .prev { width: 88px; height: 56px; flex: none; border-radius: 10px; border: 1px solid var(--line); background-size: cover; background-position: center 30%; }
  .prev.empty { background: radial-gradient(70% 90% at 80% 10%, var(--md-tertiary-container), transparent 70%), linear-gradient(160deg, var(--md-primary-container), var(--md-surface-container-high)); }
  .tune { border-top: 1px solid var(--line-soft); }
  .tune summary { cursor: pointer; list-style: none; transition: background var(--dur); }
  .tune summary::-webkit-details-marker { display: none; }
  .tune summary:hover { background: color-mix(in srgb, var(--md-on-surface) 4%, transparent); }
  .tune summary:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
  .tune summary :global(.chev) { flex: none; color: var(--fg-3); transition: transform var(--dur) var(--ease-out); }
  .tune[open] summary :global(.chev) { transform: rotate(90deg); }
  .tune[open] summary { border-bottom: 1px solid var(--line-soft); }
  .seed { display: inline-flex; gap: 4px; flex: none; }
  .seed i { width: 14px; height: 14px; border-radius: 5px; border: 1px solid var(--line-strong); }
</style>
