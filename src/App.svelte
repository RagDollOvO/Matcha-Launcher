<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/stores/app.svelte';
  import TitleBar from './lib/components/TitleBar.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import Home from './lib/pages/Home.svelte';
  import Mods from './lib/pages/Mods.svelte';
  import Workshop from './lib/pages/Workshop.svelte';
  import Browser from './lib/pages/Browser.svelte';
  import Downloads from './lib/pages/Downloads.svelte';
  import Bilibili from './lib/pages/Bilibili.svelte';
  import GameMaps from './lib/pages/GameMaps.svelte';
  import Settings from './lib/pages/Settings.svelte';
  import Plugins from './lib/pages/Plugins.svelte';
  import Servers from './lib/pages/Servers.svelte';
  import AgentPanel from './lib/agent/AgentPanel.svelte';
  import { agent } from './lib/agent';
  import { sfx, type SfxName } from './lib/sound/sfx.svelte';
  import Confirmation from './lib/components/Confirmation.svelte';
  import PendingFeature from './lib/components/PendingFeature.svelte';
  import SupportPrompt from './lib/components/SupportPrompt.svelte';
  import Backdrop from './lib/components/Backdrop.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import { welcome, finishWelcome } from './lib/stores/welcome.svelte';
  import { initTheme } from './lib/theme/theme.svelte';
  import { initCarousel } from './lib/theme/carousel.svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { agentWin, showAgentWindow, hideAgentWindow, onMainMessage, sendToAgent } from './lib/agent/window.svelte';
  import { browser } from './lib/browser/browser.svelte';
  import { openSettings } from './lib/stores/nav.svelte';
  import { desktop } from './lib/api/bridge';
  import { startCheckup } from './lib/agent/checkup.svelte';
  import { initSettingsSync } from './lib/stores/settings-sync.svelte';

  // 尽早套上配色，避免首帧闪默认色
  void initTheme();
  void initCarousel();

  // 背景音乐只在主窗口放，切页面不断；游戏运行、窗口收起或最小化时暂停
  let pageHidden = $state(document.hidden);
  $effect(() => sfx.holdMusic(!!app.game?.running || pageHidden));

  onMount(() => {
    sfx.setMusicHost(true);
    const onVisibility = () => (pageHidden = document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    // Keep the CLI connection independent of whether the assistant panel is open.
    agent.connect();
    let dispose: (() => void) | undefined, stopped = false;
    void app.init().then(fn => { if (stopped) fn(); else dispose = fn; });
    // 茶茶改了设置（启动项、CFG、下载、界面偏好…）时，让对应的页面和存储跟上
    const offSync = initSettingsSync();
    const timer = setInterval(() => { if (!app.busy && !app.confirmation) void app.refresh(); }, 5000);
    // 助手独立窗口发来的请求：开链接、打开设置、弹提示、它自己收起了
    let offAgent: (() => void) | undefined;
    // 设置里可以随时切回独立窗口，所以桌面版总是监听
    if (desktop) {
      void onMainMessage((m) => {
        if (m.type === 'hidden') app.agentOpen = false;
        else if (m.type === 'browse') { browser.open(m.url); app.route = 'browser'; }
        else if (m.type === 'settings') { app.agentOpen = false; openSettings(m.section); }
        else if (m.type === 'toast') app.toast(m.text);
        else if (m.type === 'checkup') void startCheckup();
      }).then((u) => { if (stopped) u(); else offAgent = u; });
    }
    return () => { stopped = true; dispose?.(); offAgent?.(); offSync(); clearInterval(timer); sfx.setMusicHost(false); document.removeEventListener('visibilitychange', onVisibility); };
  });

  // 助手：桌面版在主窗口右边弹出独立窗口；打不开（浏览器预览、壳没放行）时退回主窗口内分栏
  $effect(() => {
    const open = app.agentOpen;
    if (agentWin.mode !== 'window') return;
    if (open) void showAgentWindow();
    else void hideAgentWindow();
  });
  // 告诉助手窗口当前在哪个页面（它的快捷建议跟着页面变）
  $effect(() => {
    const route = app.route;
    if (agentWin.mode === 'window') void sendToAgent({ type: 'route', route });
  });

  // 全局音效：点击按 data-sfx 取音色（默认 click，"none" 静音）。
  // 用捕获阶段监听，组件内 stopPropagation 也不影响。
  const INTERACTIVE = 'button, [role="button"], [role="switch"], select, a';
  let hovered: Element | null = null;
  function onOver(e: PointerEvent) {
    const el = (e.target as Element).closest?.(INTERACTIVE) ?? null;
    if (el === hovered) return;
    hovered = el;
    if (el && !(el as HTMLButtonElement).disabled && el.getAttribute('data-sfx') !== 'none') sfx.play('hover');
  }
  function onClickCapture(e: MouseEvent) {
    const el = (e.target as Element).closest?.(`[data-sfx], ${INTERACTIVE}`);
    if (!el || (el as HTMLButtonElement).disabled || el.tagName === 'SELECT') return;
    sfx.play((el.getAttribute('data-sfx') as SfxName | null) ?? 'click');
  }

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      // 欢迎引导里按 Ctrl+K：直接结束引导，叫出茶茶
      if (welcome.open) finishWelcome();
      app.agentOpen = true;
      if (agentWin.mode === 'window') void sendToAgent({ type: 'focus' });
      else queueMicrotask(() => document.getElementById('agent-input')?.focus());
    }
    // Esc 收起助手；正在输入框里打字时不抢 Esc
    if (e.key === 'Escape' && app.agentOpen && !e.defaultPrevented) {
      const el = e.target as HTMLElement;
      if (!el.closest?.('input, textarea, select, [contenteditable]') && !app.confirmation) app.agentOpen = false;
    }
  }
</script>

<svelte:window
  onkeydown={onKey}
  onpointerover={onOver}
  onpointerdowncapture={() => sfx.unlock()}
  onkeydowncapture={() => sfx.unlock()}
  onclickcapture={onClickCapture}
/>

<Backdrop />
<!-- 欢迎引导盖在上面时，下面的主界面照常加载但不接收焦点和点击 -->
<div class="shell" inert={welcome.open}>
  <TitleBar />
  {#if app.error}<div class="connection-error" role="alert">{app.error} <button class="btn sm" onclick={() => { app.error = ''; void app.refresh(); }}>重新检查</button></div>{/if}
  <div class="body">
    <!-- 左侧导航栏已并进顶栏（TitleBar.svelte），Rail.svelte 暂时保留未用 -->
    <main class:home={app.route === 'home' && app.ready}>
      {#if app.ready}
        {#if app.route === 'home'}<Home />
        {:else if app.route === 'mods'}
          {#if app.capabilities.mods}<Mods />{:else}<PendingFeature title="VPK 管理" detail="VPK 扫描、覆盖路径分析和方案应用正在接入。当前可先管理 Matcha DLL 模组。" />{/if}
        {:else if app.route === 'workshop'}<Workshop />
        {:else if app.route === 'bilibili'}<Bilibili />
        {:else if app.route === 'gamemaps'}<GameMaps />
        {:else if app.route === 'downloads'}<Downloads />
        {:else if app.route === 'settings'}<Settings />
        {:else if app.route === 'plugins'}<Plugins />
        {:else if app.route === 'servers'}
          {#if app.capabilities.servers}<Servers />{:else}<PendingFeature title="服务器探测" detail="A2S 服务器探测与收藏功能待接入，实时人数和延迟将在收到探测结果后显示。" />{/if}
        {/if}
        <Browser />
        <SupportPrompt />
      {:else}
        <div class="loading" role="status">{app.error ? '连接本地平台后继续' : '正在检测 Steam 与游戏安装…'}</div>
      {/if}
    </main>
    <!-- 助手：从右边滑出，和页面左右分栏（不盖在页面上）；中间的拖动条调宽度，面板头上可以一键放大 -->
    {#if app.agentOpen && agentWin.mode === 'inline'}
      <div class="agent-slot" in:fly={{ x: 40, duration: 260, easing: cubicOut }}><AgentPanel /></div>
    {/if}
  </div>
  <Confirmation />
</div>
{#if welcome.open}<Welcome />{/if}
<!-- 提示放在主界面外面，欢迎引导里也看得到 -->
<Toasts />

<style>
  /* 悬浮岛布局：标题栏、导航、内容区、助手面板各自是一块圆角岛，岛之间露出壁纸 */
  .shell { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 4px; height: 100%; padding: 4px 8px 8px; }
  .body { position: relative; flex: 1; display: flex; gap: 8px; min-height: 0; }
  .agent-slot { display: flex; flex: none; min-height: 0; }
  main {
    flex: 1; min-width: 0; position: relative; overflow: hidden;
    border-radius: var(--r-island); background: var(--island); border: 1px solid var(--island-line);
    transition: background 480ms var(--ease-out), border-color 480ms var(--ease-out);
  }
  /* 主页：内容区透明，直接压在清晰壁纸上 */
  main.home { background: transparent; border-color: transparent; }
  .connection-error { padding: 8px 16px; color: var(--md-on-error-container); background: var(--md-error-container); border-radius: var(--r); font-size: 13px; overflow-wrap: anywhere; }
  .connection-error button { margin-left: 12px; }
  .loading { padding: 48px 36px; color: var(--fg-2); }
</style>
