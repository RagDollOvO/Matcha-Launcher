<script lang="ts">
  // Svelte adaptation of DSH Browser's tab/toolbar/lazy-carrier design.
  import { onMount } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import House from '@lucide/svelte/icons/house';
  import X from '@lucide/svelte/icons/x';
  import Globe from '@lucide/svelte/icons/globe';
  import Star from '@lucide/svelte/icons/star';
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { app } from '../stores/app.svelte';
  import { downloads } from '../stores/downloads.svelte';
  import { desktop, errorText } from '../api/bridge';
  import { browser, tabs } from '../browser/browser.svelte';
  import { START_URL } from '../browser/dsh/store';
  import DiscoverTabs from '../components/DiscoverTabs.svelte';

  let tabState = $state(tabs.getSnapshot());
  let draft = $state('');
  let address: HTMLInputElement;
  let carrier: HTMLDivElement;
  let bounds = $state<{ x: number; y: number; width: number; height: number; physical: true } | null>(null);
  let attached = $state(false);
  const active = $derived(tabState.tabs.find(t => t.id === tabState.activeId));
  const editing = $derived(active && browser.linkDrafts[active.id]);
  const isHome = $derived(!active || active.url === START_URL);
  const visible = $derived(app.route === 'browser');
  const sources = [
    { name: 'B站', title: '看演示，找作者', detail: '视频 · 安装教程 · 发布动态', url: 'https://search.bilibili.com/all?keyword=%E6%B1%82%E7%94%9F%E4%B9%8B%E8%B7%AF2%20mod' },
    { name: '爱发电', title: '支持喜欢的创作', detail: '作者主页 · 赞助 · 作品获取', url: 'https://afdian.com/' },
    { name: 'Steam 社区', title: '工坊网页版', detail: '指南 · 讨论 · 作者主页', url: 'https://steamcommunity.com/app/550/workshop/' },
  ];
  $effect(() => { browser.workspace(app.game?.root ?? ''); });
  $effect(() => { draft = active?.url === START_URL ? '' : active?.url ?? ''; });
  $effect(() => { if (visible && editing) address?.focus(); });
  // Native children sit above HTML. Hide them for dialogs and download selection.
  let lastSync = '';
  // Revisit hidden tabs once their last download finishes so the native view can close.
  const downloadViews = $derived([...new Set(downloads.webActive.map(d => d.view))].sort().join(','));
  $effect(() => {
    const params = { tabs: tabState.tabs.map(t => ({ id: t.id, url: t.url })), activeId: tabState.activeId,
      visible: visible && attached && !!bounds && !isHome && !app.confirmation && !app.friendsOpen, bounds };
    const next = JSON.stringify([params, downloadViews]);
    if (desktop && attached && browser.historyReady && next !== lastSync) {
      lastSync = next;
      void browser.call('sync', params).catch(() => { lastSync = ''; });
    }
  });
  onMount(() => {
    const unsubscribe = tabs.subscribe(() => { tabState = { ...tabs.getSnapshot() }; });
    tabState = { ...tabs.getSnapshot() };
    void browser.init().catch(e => { browser.error = errorText(e); });
    const measure = () => {
      const r = carrier.getBoundingClientRect();
      if (!r.width || !r.height) { bounds = null; return; }
      // WebView2 的 CSS 像素同时受主界面缩放和显示器 DPI 影响。按两端取整，和子窗口共用物理像素边界。
      const px = (v: number) => Math.round(v * window.devicePixelRatio);
      const x = px(r.left), y = px(r.top);
      bounds = { x, y, width: px(r.right) - x, height: px(r.bottom) - y, physical: true };
    };
    let dpi = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const dpiChanged = () => {
      dpi = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dpi.addEventListener('change', dpiChanged, { once: true });
      measure();
    };
    dpi.addEventListener('change', dpiChanged, { once: true });
    const observer = new ResizeObserver(measure); observer.observe(carrier);
    measure(); attached = true;
    return () => { unsubscribe(); observer.disconnect(); dpi.removeEventListener('change', dpiChanged); void browser.call('sync', { tabs: [], visible: false }).catch(() => {}); };
  });
  async function attempt(fn: () => Promise<unknown>) { try { await fn(); } catch (e) { browser.error = errorText(e); } }
  function submitAddress(e: SubmitEvent) {
    e.preventDefault();
    if (editing) browser.openEditedAddress();
    else void attempt(() => browser.navigate(draft));
  }
  function key(e: KeyboardEvent) {
    if (!visible || !(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === 'l') { e.preventDefault(); address.focus(); address.select(); }
    if (e.key.toLowerCase() === 't') { e.preventDefault(); tabs.newTab(); }
  }
</script>

<svelte:window onkeydown={key} />
<section class:hidden={!visible} class="browser" aria-label="DSH 内置浏览器">
  <DiscoverTabs />
  <form class="toolbar" onsubmit={submitAddress}>
    <button type="button" class="tool" disabled={isHome} aria-label="后退" title="后退" onclick={() => attempt(() => browser.action('back'))}><ArrowLeft size={16} /></button>
    <button type="button" class="tool" disabled={isHome} aria-label="前进" title="前进" onclick={() => attempt(() => browser.action('forward'))}><ArrowRight size={16} /></button>
    <button type="button" class="tool" disabled={isHome} aria-label={browser.loading[active?.id ?? ''] ? '停止加载' : '刷新网页'} onclick={() => attempt(() => browser.action(browser.loading[active?.id ?? ''] ? 'stop' : 'reload'))}>{#if browser.loading[active?.id ?? '']}<X size={16} />{:else}<RotateCw size={15} />{/if}</button>
    <button type="button" class="tool" aria-label="浏览器主页" title="主页" onclick={() => attempt(() => browser.home())}><House size={15} /></button>
    <input bind:this={address} value={editing?.text ?? draft} oninput={e => {
      if (editing) { editing.text = e.currentTarget.value; editing.error = ''; } else draft = e.currentTarget.value;
    }} aria-label={editing ? '编辑链接地址' : '网址或搜索词'} aria-describedby={editing ? 'edit-hint' : undefined}
      aria-invalid={editing?.error ? true : undefined} placeholder={editing ? '输入网页地址' : '输入网址或搜索 Mod'} spellcheck="false" />
    {#if editing}<button type="submit" class="go">打开</button>{/if}
    <button type="button" class="tool" class:saved={browser.bookmarks.some(b => b.url === active?.url)} disabled={isHome} aria-label="收藏当前网页" title="收藏当前网页" onclick={() => browser.bookmark()}><Star size={15} /></button>
    <button type="button" class="tool downloads-toggle" aria-label="打开下载页" title="下载" onclick={() => (app.route = 'downloads')}><Download size={16} />{#if downloads.webActive.length}<i></i>{/if}</button>
    <button type="button" class="tool" disabled={isHome} aria-label="在系统浏览器打开" title="在系统浏览器打开" onclick={() => attempt(() => browser.call('external', { url: active?.url }))}><ExternalLink size={15} /></button>
  </form>
  {#if browser.error}<div class="error" role="alert"><span>{browser.error}</span><button aria-label="关闭提示" onclick={() => browser.error = ''}><X size={14} /></button></div>{/if}
  <div class="carrier" bind:this={carrier}>
    {#if editing}
      <div class="edit-hint" id="edit-hint">
        {#if editing.error}<span role="alert">{editing.error}</span>{:else}删掉地址栏里的多余字符，按 <kbd>Enter</kbd> 打开网页。{/if}
      </div>
    {:else if isHome}
      <div class="start">
        <div class="start-inner">
          <h1>打开网页</h1>
          <p class="intro">逛作者主页、看演示视频。网页里下载的 VPK / ZIP 会进入「下载」，可直接导入。</p>
          <div class="sources">
            {#each sources as source, i}
              <button class="source" style:--i={i} onclick={() => attempt(() => browser.navigate(source.url))}>
                <span class="src-top"><strong>{source.name}</strong><ArrowUpRight size={16} /></span>
                <span class="src-title">{source.title}</span>
                <small>{source.detail}</small>
              </button>
            {/each}
          </div>
          {#if browser.bookmarks.length}
            <h2>收藏的网页</h2>
            <div class="bookmarks">{#each browser.bookmarks as b}<button class="chip" title={b.url} onclick={() => browser.open(b.url)}><Star size={12} /><span>{b.title}</span></button>{/each}</div>
          {/if}
          <button class="to-downloads" onclick={() => (app.route = 'downloads')}><Download size={14} />查看下载{#if downloads.web.length}<span class="mono">{downloads.web.length}</span>{/if}<ArrowRight size={14} /></button>
        </div>
      </div>
    {:else if !desktop}
      <div class="start"><div class="start-inner placeholder"><Globe size={28} strokeWidth={1.25} /><h2>在 Matcha 桌面版中浏览</h2><p class="intro">桌面版提供独立登录状态、网页播放和下载接收。</p></div></div>
    {/if}
  </div>
</section>

<style>
  .browser { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--bg); }
  .hidden { display: none; }
  .toolbar { display: flex; gap: 4px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--line); flex: none; }
  .tool { display: grid; place-items: center; height: 30px; width: 30px; flex: none; color: var(--fg-2); border-radius: var(--r); position: relative; transition: background var(--dur), color var(--dur); }
  .tool:hover { background: var(--bg-2); color: var(--fg); }
  button:disabled { opacity: .35; cursor: default; }
  .saved { color: var(--fg); }
  .saved :global(svg) { fill: currentColor; }
  .toolbar input { flex: 1; width: 0; height: 30px; font-size: 12px; color: var(--fg-2); }
  .go { height: 30px; padding: 0 12px; border-radius: var(--r); color: var(--md-on-primary); background: var(--md-primary); font-size: 12px; }
  .edit-hint { padding: 16px 24px; font-size: 13px; color: var(--fg-2); }
  .edit-hint kbd { font: 12px var(--font-mono); color: var(--fg); }
  .edit-hint [role="alert"] { color: var(--danger); }
  .downloads-toggle i { position: absolute; right: 5px; top: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--fg); }
  .error { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 16px; color: var(--danger); font-size: 12px; background: #160d0d; border-bottom: 1px solid #4a1d1d; overflow-wrap: anywhere; }
  .error button { flex: none; color: var(--fg-2); }
  .carrier { position: relative; flex: 1; min-height: 0; background: var(--bg); }

  /* 新标签页：深色，三个常用来源 + 收藏 */
  .start { height: 100%; overflow-y: auto; }
  .start-inner { max-width: 760px; margin: 0 auto; padding: 48px 28px 32px; }
  h1 { font-size: 22px; font-weight: 500; margin: 0 0 6px; }
  .intro { margin: 0 0 24px; font-size: 13px; color: var(--fg-3); line-height: 1.7; }
  .sources { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .source { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px 16px; text-align: left; background: var(--bg-1); border: 1px solid var(--line); border-radius: 8px; transition: border-color var(--dur), background var(--dur), transform 160ms var(--ease-out); animation: rise 280ms var(--ease-out) backwards; animation-delay: calc(var(--i) * 45ms); }
  .source:hover { border-color: var(--line-strong); background: var(--bg-2); }
  .source:active { transform: scale(0.98); }
  .src-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .src-top strong { font-size: 16px; font-weight: 500; }
  .src-top :global(svg) { color: var(--fg-4); transition: transform 200ms var(--ease-out), color var(--dur); }
  .source:hover .src-top :global(svg) { color: var(--fg); transform: translate(2px, -2px); }
  .src-title { font-size: 13px; color: var(--fg-2); }
  .source small { font-size: 12px; color: var(--fg-4); }
  h2 { font-size: 13px; font-weight: 500; margin: 28px 0 10px; color: var(--fg-2); }
  .bookmarks { display: flex; flex-wrap: wrap; gap: 6px; }
  .bookmarks .chip { max-width: 240px; }
  .bookmarks span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .to-downloads { display: inline-flex; align-items: center; gap: 7px; margin-top: 28px; font-size: 13px; color: var(--fg-3); }
  .to-downloads:hover { color: var(--fg); }
  .to-downloads .mono { font-size: 11px; color: var(--fg-2); }
  .placeholder { display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 96px; color: var(--fg-3); }
  .placeholder h2 { color: var(--fg); font-size: 16px; margin: 16px 0 6px; }
  @media (max-width: 760px) { .sources { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: reduce) { .source { animation: none; } }
</style>
