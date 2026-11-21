<script lang="ts">
  // 「发现」页的顶栏：固定的「创意工坊」+ 内置浏览器的网页标签。创意工坊页和浏览器页共用这一条。
  import { onMount, tick } from 'svelte';
  import Compass from '@lucide/svelte/icons/compass';
  import Tv from '@lucide/svelte/icons/tv';
  import MapIcon from '@lucide/svelte/icons/map';
  import Globe from '@lucide/svelte/icons/globe';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { app } from '../stores/app.svelte';
  import { browser, tabs } from '../browser/browser.svelte';
  import { START_URL } from '../browser/dsh/store';

  let snap = $state(tabs.getSnapshot());
  onMount(() => tabs.subscribe(() => { snap = { ...tabs.getSnapshot() }; }));

  // 固定标签：创意工坊、B站；其余是内置浏览器的网页标签
  const onWorkshop = $derived(app.route === 'workshop' || app.route === 'bilibili' || app.route === 'gamemaps');
  // 空白的新标签页只在正看着它时显示，免得一直多挂一个「新标签页」
  const shown = $derived(snap.tabs.filter((t) => t.url !== START_URL || browser.linkDrafts[t.id] || (!onWorkshop && t.id === snap.activeId)));
  const activeKey = $derived(onWorkshop ? app.route : snap.activeId ?? '');

  function openTab(id: string) { tabs.activate(id); browser.downloadsOpen = false; app.route = 'browser'; }
  function newTab() {
    const blank = snap.tabs.find((t) => t.url === START_URL && !browser.linkDrafts[t.id]);
    if (blank) tabs.activate(blank.id); else tabs.newTab();
    app.route = 'browser';
  }
  function close(id: string) {
    const wasActive = app.route === 'browser' && id === snap.activeId;
    // Choose among the tabs the player can see; the store also keeps a blank start tab.
    const i = shown.findIndex(t => t.id === id);
    const neighbor = shown[i + 1] ?? shown[i - 1];
    tabs.closeTab(id);
    if (!wasActive) return;
    if (!neighbor) app.closeLastWebTab();
    else if (tabs.activeTab()?.id !== neighbor.id) tabs.activate(neighbor.id);
  }

  // 底部指示条：一根 1px 宽的条用 translateX + scaleX 移到当前标签下
  let strip = $state<HTMLDivElement>();
  let bar = $state({ x: 0, w: 0, ready: false });
  async function place() {
    await tick();
    const el = strip?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeKey)}"]`);
    if (!el || !strip) return;
    const first = !bar.ready;
    bar = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
    if (first) requestAnimationFrame(() => strip?.classList.add('animate'));
  }
  $effect(() => { void activeKey; void shown.length; void snap.tabs.map((t) => t.label).join(); void place(); });
  onMount(() => { const ro = new ResizeObserver(() => void place()); if (strip) ro.observe(strip); return () => ro.disconnect(); });
</script>

<div class="dtabs" class:flush={onWorkshop} role="tablist" aria-label="发现" bind:this={strip}>
  <button class="tab pinned" data-key="workshop" role="tab" aria-selected={app.route === 'workshop'} class:on={app.route === 'workshop'} data-sfx="tab" onclick={() => (app.route = 'workshop')}>
    <Compass size={14} />创意工坊
  </button>
  <button class="tab pinned" data-key="bilibili" role="tab" aria-selected={app.route === 'bilibili'} class:on={app.route === 'bilibili'} data-sfx="tab" onclick={() => (app.route = 'bilibili')}>
    <Tv size={14} />B站
  </button>
  <button class="tab pinned" data-key="gamemaps" role="tab" aria-selected={app.route === 'gamemaps'} class:on={app.route === 'gamemaps'} data-sfx="tab" onclick={() => (app.route = 'gamemaps')}>
    <MapIcon size={14} />GameMaps
  </button>
  {#if shown.length}<span class="sep" aria-hidden="true"></span>{/if}
  {#each shown as tab (tab.id)}
    {@const on = !onWorkshop && tab.id === snap.activeId}
    {@const label = tab.url === START_URL ? (browser.linkDrafts[tab.id] ? '编辑链接' : '新标签页') : tab.label}
    <div class="tab web" data-key={tab.id} class:on>
      <button class="open" role="tab" aria-selected={on} data-sfx="tab" title={tab.url === START_URL ? label : tab.url} onclick={() => openTab(tab.id)}>
        {#if browser.loading[tab.id]}<LoaderCircle class="spin" size={13} />{:else}<Globe size={13} />{/if}
        <span>{label}</span>
      </button>
      <button class="x" aria-label={`关闭 ${label}`} data-sfx="close" onclick={() => close(tab.id)}><X size={12} /></button>
    </div>
  {/each}
  <button class="new" title="打开网页（B站、爱发电…）" aria-label="新标签页" onclick={newTab}><Plus size={15} /></button>
  <i class="bar" class:show={bar.ready} style:transform="translateX({bar.x}px) scaleX({bar.w})"></i>
</div>

<style>
  .dtabs { position: relative; display: flex; align-items: center; gap: 2px; height: 42px; padding: 0 12px; flex: none; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
  .dtabs::-webkit-scrollbar { display: none; }
  .tab { display: flex; align-items: center; height: 30px; flex: none; border-radius: var(--r); color: var(--fg-3); transition: color var(--dur), background var(--dur); }
  /* 在工坊 / B站 / GameMaps 时标签栏和下面的搜索筛选算一块，不画分隔线；网页标签下保留 */
  .dtabs.flush { border-bottom-color: transparent; }
  .tab:hover { color: var(--fg-2); background: var(--hover); }
  .tab.on { color: var(--md-primary); }
  .pinned { gap: 7px; padding: 0 12px; font-size: 13px; font-weight: 500; }
  .web { max-width: 200px; min-width: 0; }
  .web .open { display: flex; align-items: center; gap: 7px; min-width: 0; height: 100%; padding: 0 4px 0 10px; font-size: 12px; }
  .web .open span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .web :global(svg) { flex: none; }
  .x { display: grid; place-items: center; width: 20px; height: 20px; margin-right: 5px; flex: none; border-radius: var(--r-sm); color: var(--fg-4); opacity: 0; transition: opacity var(--dur), background var(--dur), color var(--dur); }
  .web:hover .x, .web.on .x, .x:focus-visible { opacity: 1; }
  .x:hover { background: var(--bg-3); color: var(--fg); }
  .sep { width: 1px; height: 16px; margin: 0 6px; background: var(--line-strong); flex: none; }
  .new { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: var(--r); color: var(--fg-3); transition: color var(--dur), background var(--dur); }
  .new:hover { color: var(--fg); background: var(--hover); }
  /* M3 主标签指示条：主色 3px */
  .bar { position: absolute; left: 0; bottom: 0; width: 1px; height: 3px; background: var(--md-primary); transform-origin: left; opacity: 0; pointer-events: none; }
  .bar.show { opacity: 1; }
  .dtabs:global(.animate) .bar { transition: transform 220ms var(--ease-out); }
</style>
