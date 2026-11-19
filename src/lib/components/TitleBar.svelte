<script lang="ts">
  // 顶栏 = 标题栏 + 主导航（参考 PCL：导航直接放在标题栏里）。
  // 左：标志 + 一组导航胶囊；中间空白可拖动窗口；右：助手、设置、音效、窗口按钮。
  import { desktop, windowAction } from '../api/bridge';
  import Minus from '@lucide/svelte/icons/minus';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import Volume from '@lucide/svelte/icons/volume-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import House from '@lucide/svelte/icons/house';
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import Compass from '@lucide/svelte/icons/compass';
  import Download from '@lucide/svelte/icons/download';
  import Plug from '@lucide/svelte/icons/plug';
  import Server from '@lucide/svelte/icons/server';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Cog from '@lucide/svelte/icons/settings';
  import Toggle from './Toggle.svelte';
  import FriendServers from './FriendServers.svelte';
  import { app } from '../stores/app.svelte';
  import { theme } from '../theme/theme.svelte';
  import { downloads } from '../stores/downloads.svelte';
  import { left } from '../stores/transfer.svelte';
  import { reduceMotion } from '../motion';
  import { sfx } from '../sound/sfx.svelte';
  import type { Route } from '../types';

  let soundOpen = $state(false);
  const s = sfx.settings;
  function toggleSound(key: 'muted' | 'ui' | 'ambient') {
    s[key] = !s[key];
    sfx.play((key === 'muted' ? !s.muted : s[key]) ? 'menuOn' : 'menuOff');
  }

  type Item = { id: Route; label: string; title?: string; icon: typeof House; match?: Route[] };
  const items: Item[] = [
    { id: 'home', label: '主页', icon: House },
    { id: 'mods', label: 'Mod', icon: Puzzle },
    { id: 'workshop', label: '发现', title: '发现 · 创意工坊、B站、GameMaps 与网页', icon: Compass, match: ['workshop', 'bilibili', 'gamemaps', 'browser'] },
    { id: 'downloads', label: '下载', icon: Download },
    { id: 'plugins', label: 'DLL 模组', icon: Plug },
    { id: 'servers', label: '服务器', icon: Server },
  ];

  const conflictCount = $derived(app.ready ? app.activeConflicts(app.activeProfile).length : 0);
  // 「发现」记住上次停在创意工坊还是网页
  let lastDiscover: Route = 'workshop';
  $effect(() => { if (app.route === 'workshop' || app.route === 'bilibili' || app.route === 'gamemaps' || app.route === 'browser') lastDiscover = app.route; });
  const isOn = (it: Item) => (it.match ?? [it.id]).includes(app.route);
  function go(it: Item) {
    if (isOn(it)) return;
    app.route = it.id === 'workshop' ? lastDiscover : it.id;
  }

  // 下载完成：图标弹一下
  let dlIcon = $state<HTMLSpanElement>();
  let lastPulse = downloads.pulse;
  $effect(() => {
    const p = downloads.pulse;
    if (p === lastPulse) return;
    lastPulse = p;
    if (dlIcon && !reduceMotion()) dlIcon.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  });
  const R = 7, C = 2 * Math.PI * R;
  const ring = $derived(downloads.overall ?? 0);
  const busyTitle = $derived(downloads.busy ? `下载 · ${downloads.busy} 个进行中${downloads.overall !== null ? ` · ${Math.floor(downloads.overall * 100)}%` : ''}${downloads.eta !== null && !downloads.waiting ? ` · ${left(downloads.eta)}` : ''}` : downloads.unseen ? `下载 · ${downloads.unseen} 个新完成` : '下载');
</script>

<svelte:window onclick={() => (soundOpen = false)} />

<!-- Tauri 无边框窗口：data-tauri-drag-region 让空白处可以拖动窗口 -->
<header class:photo={app.route === 'home' && !!theme.wallpaper} data-tauri-drag-region>
  <div class="side left" data-tauri-drag-region>
  <button class="logo" title="Matcha · 主页" aria-label="Matcha 主页" data-sfx="tab" onclick={() => (app.route = 'home')}>
    <img src="/matcha.png" alt="" width="32" height="32" draggable="false" />
  </button>
  <span class="word" data-tauri-drag-region>Matcha</span>
  {#if app.game?.running}
    <span class="run"><i class="live"></i>游戏运行中</span>
  {/if}
  </div>

  <nav class="tabs" aria-label="主导航">
    {#each items as it (it.id)}
      {@const on = isOn(it)}
      {#if it.id === 'downloads'}
        <button class:on class="tab dl" class:busy={downloads.busy > 0} data-rail="downloads" data-sfx="tab" onclick={() => go(it)} title={busyTitle} aria-label={busyTitle} aria-current={on ? 'page' : undefined}>
          <span class="ic" bind:this={dlIcon}>
            {#if downloads.busy}
              <svg class="ring" viewBox="0 0 18 18" aria-hidden="true">
                <circle cx="9" cy="9" r={R} class="track" />
                <circle cx="9" cy="9" r={R} class="fill" class:indet={downloads.overall === null} stroke-dasharray={C} stroke-dashoffset={downloads.overall === null ? C * 0.75 : C * (1 - ring)} />
              </svg>
            {:else}<Download size={16} strokeWidth={1.8} />{/if}
          </span>
          {it.label}{#if downloads.busy}<i class="count mono">{downloads.busy}</i>{:else if downloads.unseen}<i class="dot"></i>{/if}
        </button>
      {:else}
        <button class:on class="tab" data-sfx="tab" onclick={() => go(it)} title={it.title ?? it.label} aria-current={on ? 'page' : undefined}>
          <it.icon size={16} strokeWidth={1.8} />{it.label}
          {#if it.id === 'mods' && conflictCount}<i class="badge" title="当前方案有 {conflictCount} 处冲突"></i>{/if}
          {#if it.id === 'plugins' && app.dllUpdates.length}<i class="dot" title="{app.dllUpdates.length} 项可以更新"></i>{/if}
        </button>
      {/if}
    {/each}
  </nav>

  <div class="side right" data-tauri-drag-region>
  <div class="tools">
    {#if app.ready && app.capabilities.servers}<FriendServers bind:open={app.friendsOpen} />{/if}
    <button class="tb" class:on={app.agentOpen} title="茶茶（Ctrl+K）" aria-label="茶茶" data-sfx={app.agentOpen ? 'close' : 'open'} onclick={() => (app.agentOpen = !app.agentOpen)}><Sparkles size={15} /></button>
    <button class="tb" class:on={app.route === 'settings'} title="设置" aria-label="设置" data-sfx="tab" onclick={() => (app.route = 'settings')}><Cog size={15} /></button>
    <div class="sound">
      <button class="tb" aria-label="音效" title="音效" data-sfx={soundOpen ? 'close' : 'open'} onclick={(e) => { e.stopPropagation(); soundOpen = !soundOpen; }}>
        {#if s.muted}<VolumeX size={15} />{:else}<Volume size={15} />{/if}
      </button>
      {#if soundOpen}
        <div class="pop fade-in" role="dialog" aria-label="音效设置" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
          <div class="row">
            <span>音量</span>
            <input type="range" min="0" max="1" step="0.05" bind:value={s.volume} aria-label="音量" />
            <span class="mono v">{Math.round(s.volume * 100)}</span>
          </div>
          <div class="row"><span>静音</span><Toggle silent on={s.muted} onchange={() => toggleSound('muted')} label="静音" /></div>
          <div class="row"><span>界面音效</span><Toggle silent on={s.ui} onchange={() => toggleSound('ui')} label="界面音效" /></div>
          <div class="row"><span>背景音乐</span><Toggle silent on={s.ambient} onchange={() => toggleSound('ambient')} label="背景音乐" /></div>
        </div>
      {/if}
    </div>
  </div>

  <div class="win">
    <button aria-label="最小化" disabled={!desktop} data-sfx="none" onclick={() => windowAction('minimize')}><Minus size={14} /></button>
    <button aria-label="最大化" disabled={!desktop} data-sfx="none" onclick={() => windowAction('maximize')}><Square size={12} /></button>
    <button class="close" title="收起到系统托盘" aria-label="收起到系统托盘" disabled={!desktop} data-sfx="none" onclick={() => windowAction('close')}><X size={14} /></button>
  </div>
  </div>
</header>

<style>
  /* 三栏：左（标志）· 中（导航，永远居中）· 右（工具 + 窗口按钮），左右两栏等宽，视觉重心落在正中 */
  header {
    --bar-ink: var(--fg);
    --bar-halo: color-mix(in srgb, var(--md-surface) 90%, transparent);
    height: 46px;
    flex: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 0 0 0 6px;
    position: relative;
    z-index: 20;
  }
  header.photo { --bar-ink: white; --bar-halo: rgb(0 0 0 / .8); }
  .side { display: flex; align-items: center; gap: 8px; min-width: 0; height: 100%; }
  .side.right { justify-content: flex-end; gap: 6px; }
  .word { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; color: var(--bar-ink); white-space: nowrap; text-shadow: 0 1px 3px var(--bar-halo); }

  .logo { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 11px; transition: transform 240ms var(--ease-out); }
  .logo img { width: 30px; height: 30px; filter: drop-shadow(0 4px 10px rgb(0 0 0 / .22)); }
  .logo:hover { transform: rotate(-6deg) scale(1.05); }

  /* 导航：一条浮起来的胶囊，选中项是 M3 的色块 */
  .tabs {
    display: flex; align-items: center; gap: 2px; padding: 4px; flex: none;
    border-radius: 16px; background: color-mix(in srgb, var(--md-surface) 62%, transparent); border: 1px solid var(--island-line);
  }
  .tab {
    position: relative; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 13px 0 11px; border-radius: 12px;
    font-size: 13px; color: var(--fg-2); white-space: nowrap;
    transition: background var(--dur), color var(--dur), transform 160ms var(--ease-out);
  }
  .tab:hover { color: var(--fg); background: var(--hover); }
  .tab:active { transform: scale(0.96); }
  .tab.on { color: var(--md-on-secondary-container); background: var(--md-secondary-container); font-weight: 600; }
  .badge { position: absolute; top: 6px; right: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--danger); }

  /* 下载：进行中图标换成进度环，后面跟数量 */
  .ic { display: grid; place-items: center; width: 16px; height: 16px; }
  .ring { width: 16px; height: 16px; transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 2; }
  .ring .track { stroke: var(--line-strong); }
  .ring .fill { stroke: var(--md-primary); stroke-linecap: round; transition: stroke-dashoffset 400ms var(--ease-out); }
  .ring .fill.indet { transform-origin: 9px 9px; animation: spin 1.1s linear infinite; }
  .count { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--md-primary); color: var(--md-on-primary); font-size: 10px; line-height: 16px; font-style: normal; text-align: center; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--md-primary); animation: rise 240ms var(--ease-out); }

  /* 游戏运行时，标志旁边多一个小胶囊 */
  .run { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px; border-radius: 13px; font-size: 12px; color: var(--md-on-primary-container); background: color-mix(in srgb, var(--md-primary-container) 88%, transparent); }
  .live { width: 6px; height: 6px; border-radius: 50%; background: var(--md-primary); animation: beat 1.6s ease-in-out infinite; }
  @keyframes beat { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  /* 右侧工具和窗口按钮同一种样式：不加底，只在悬停时出底色；中间一道细线隔开 */
  .tools { display: flex; align-items: center; gap: 2px; padding-right: 6px; margin-right: 2px; border-right: 1px solid color-mix(in srgb, var(--md-on-surface) 18%, transparent); }
  .tb :global(svg) { filter: drop-shadow(0 1px 2px var(--bar-halo)); }
  .sound { position: relative; display: grid; place-items: center; }
  .tb { width: 36px; height: 30px; border-radius: 10px; display: grid; place-items: center; color: var(--bar-ink); transition: color var(--dur), background var(--dur); }
  .tb:hover { color: var(--fg); background: color-mix(in srgb, var(--md-surface) 70%, transparent); }
  .tb.on { color: var(--md-on-secondary-container); background: var(--md-secondary-container); }
  .pop { position: absolute; right: 0; top: 100%; margin-top: 10px; width: 240px; background: var(--bg-1); border: 1px solid var(--line-strong); border-radius: 14px; padding: 6px 12px; box-shadow: 0 12px 32px -12px rgb(0 0 0 / .4); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 34px; color: var(--fg-2); }
  .row + .row { border-top: 1px solid var(--line-soft); }
  .row input[type='range'] { flex: 1; padding: 0; border: 0; background: none; accent-color: var(--md-primary); }
  .v { width: 24px; text-align: right; font-size: 11px; }

  .win { display: flex; align-items: center; gap: 2px; height: 100%; }
  .win button { width: 40px; height: 30px; border-radius: 10px; display: grid; place-items: center; color: var(--bar-ink); transition: background var(--dur), color var(--dur); }
  .win button:hover { background: color-mix(in srgb, var(--md-surface) 70%, transparent); color: var(--fg); }
  /* 窗口按钮直接压在壁纸上，图标带一圈底色光晕，亮壁纸暗壁纸都看得见 */
  .win :global(svg) { filter: drop-shadow(0 1px 2px var(--bar-halo)); }
  .tb:hover :global(svg), .tb.on :global(svg), .win button:hover :global(svg) { filter: none; }
  /* 关闭沿用 Windows 的红色，用户一眼就认得 */
  .win .close:hover { background: #c42b1c; color: #fff; }

  @media (prefers-reduced-motion: reduce) { .ring .fill.indet, .live { animation: none; } }
</style>
