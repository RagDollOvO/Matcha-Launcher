<script lang="ts">
  import House from '@lucide/svelte/icons/house';
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import Compass from '@lucide/svelte/icons/compass';
  import Download from '@lucide/svelte/icons/download';
  import Plug from '@lucide/svelte/icons/plug';
  import Server from '@lucide/svelte/icons/server';
  import Terminal from '@lucide/svelte/icons/square-terminal';
  import Cog from '@lucide/svelte/icons/settings';
  import { app } from '../stores/app.svelte';
  import { downloads } from '../stores/downloads.svelte';
  import { left } from '../stores/transfer.svelte';
  import { reduceMotion } from '../motion';
  import type { Route } from '../types';

  type Item = { id: Route; label: string; icon: typeof House; match?: Route[] };
  const items: Item[] = [
    { id: 'home', label: '主页', icon: House },
    { id: 'mods', label: 'Mod', icon: Puzzle },
    { id: 'workshop', label: '发现 · 创意工坊、B站、GameMaps 与网页', icon: Compass, match: ['workshop', 'bilibili', 'gamemaps', 'browser'] },
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
    if (dlIcon && !reduceMotion()) dlIcon.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  });
  const R = 15, C = 2 * Math.PI * R;
  const ring = $derived(downloads.overall ?? 0);
  const busyTitle = $derived(downloads.busy ? `下载 · ${downloads.busy} 个进行中${downloads.overall !== null ? ` · ${Math.floor(downloads.overall * 100)}%` : ''}${downloads.eta !== null && !downloads.waiting ? ` · ${left(downloads.eta)}` : ''}` : downloads.unseen ? `下载 · ${downloads.unseen} 个新完成` : '下载');
</script>

<nav>
  <button class="logo" title="Matcha · 主页" aria-label="Matcha 主页" data-sfx="tab" onclick={() => (app.route = 'home')}>
    <img src="/matcha.png" alt="" width="32" height="32" draggable="false" />
  </button>
  {#each items as it (it.id)}
    {@const on = isOn(it)}
    {#if it.id === 'downloads'}
      <button class:on class="dl" class:busy={downloads.busy > 0} data-rail="downloads" data-sfx="tab" onclick={() => go(it)} title={busyTitle} aria-label={busyTitle}>
        {#if downloads.busy}
          <svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r={R} class="track" />
            <circle cx="18" cy="18" r={R} class="fill" class:indet={downloads.overall === null} stroke-dasharray={C} stroke-dashoffset={downloads.overall === null ? C * 0.75 : C * (1 - ring)} />
          </svg>
        {/if}
        <span class="ic" bind:this={dlIcon}><Download size={18} strokeWidth={1.6} /></span>
        {#if downloads.busy}<i class="count mono">{downloads.busy}</i>{:else if downloads.unseen}<i class="dot"></i>{/if}
      </button>
    {:else}
      <button class:on data-sfx="tab" onclick={() => go(it)} title={it.label} aria-label={it.label}>
        <it.icon size={18} strokeWidth={1.6} />
        {#if it.id === 'mods' && conflictCount}<i class="badge"></i>{/if}
      </button>
    {/if}
  {/each}
  <span class="grow"></span>
  <button class:on={app.route === 'settings'} data-sfx="tab" onclick={() => (app.route = 'settings')} title="设置" aria-label="设置">
    <Cog size={18} strokeWidth={1.6} />
  </button>
  <button class:on={app.agentOpen} data-sfx={app.agentOpen ? 'close' : 'open'} onclick={() => (app.agentOpen = !app.agentOpen)} title="pi agent（Ctrl+K）" aria-label="pi agent">
    <Terminal size={18} strokeWidth={1.6} />
  </button>
</nav>

<style>
  nav {
    width: 56px;
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 0 10px;
    border-radius: var(--r-island);
    /* 减重：去掉描边，底色更淡，主要靠图标本身 */
    background: color-mix(in srgb, var(--md-surface) 48%, transparent);
  }
  .logo { width: 40px; height: 40px; margin-bottom: 10px; border-radius: 12px; }
  .logo img { width: 32px; height: 32px; filter: drop-shadow(0 4px 10px rgb(0 0 0 / .22)); }
  .logo:hover { background: transparent; transform: rotate(-6deg) scale(1.05); }
  .grow { flex: 1; }
  button {
    position: relative;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 13px;
    color: var(--fg-3);
    transition: color var(--dur), background var(--dur), transform 160ms var(--ease-out);
  }
  button:hover { color: var(--fg); background: var(--hover); }
  button:active { transform: scale(0.94); }
  /* 选中：M3 导航栏的色块胶囊 */
  button.on { color: var(--md-on-secondary-container); background: var(--md-secondary-container); }
  .badge { position: absolute; top: 8px; right: 8px; width: 7px; height: 7px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 0 2px var(--md-surface-container); }

  /* 下载：进度环 + 数量；箭头在下载时轻轻往下落 */
  .dl.busy { color: var(--fg-2); }
  .ic { display: grid; place-items: center; }
  .dl.busy .ic { animation: drop 1.4s var(--ease-in-out) infinite; }
  @keyframes drop { 0%, 100% { transform: translateY(-1px); } 50% { transform: translateY(1.5px); } }
  .ring { position: absolute; inset: 2px; width: 36px; height: 36px; transform: rotate(-90deg); pointer-events: none; }
  .ring circle { fill: none; stroke-width: 1.5; }
  .ring .track { stroke: var(--line-strong); }
  .ring .fill { stroke: var(--md-primary); stroke-linecap: round; transition: stroke-dashoffset 400ms var(--ease-out); }
  .ring .fill.indet { transform-origin: 18px 18px; animation: spin 1.1s linear infinite; }
  .count { position: absolute; right: -2px; bottom: -1px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; background: var(--md-primary); color: var(--md-on-primary); font-size: 10px; line-height: 15px; font-style: normal; text-align: center; }
  .dot { position: absolute; top: 7px; right: 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--md-primary); animation: rise 240ms var(--ease-out); }
  @media (prefers-reduced-motion: reduce) { .dl.busy .ic { animation: none; } }
</style>
