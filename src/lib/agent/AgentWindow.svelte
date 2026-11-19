<script lang="ts">
  // 助手独立窗口的页面（index.html?view=agent）。配色和壁纸跟主窗口同源，存在同一份本地存储里，所以自动一致。
  import { onMount } from 'svelte';
  import AgentPanel from './AgentPanel.svelte';
  import Toasts from '../components/Toasts.svelte';
  import Confirmation from '../components/Confirmation.svelte';
  import Backdrop from '../components/Backdrop.svelte';
  import { agent } from './index';
  import { app } from '../stores/app.svelte';
  import { initTheme } from '../theme/theme.svelte';
  import { initCarousel } from '../theme/carousel.svelte';
  import { sfx } from '../sound/sfx.svelte';
  import { onAgentMessage, sendToMain, hideSelf } from './window.svelte';
  import type { Route } from '../types';

  void initTheme();
  void initCarousel();
  document.title = '茶茶 · Matcha';
  app.agentOpen = true;

  onMount(() => {
    agent.connect();
    let off: (() => void) | undefined;
    void onAgentMessage((m) => {
      if (m.type === 'send') { if (!agent.send(m.text)) agent.draft = m.text; }
      else if (m.type === 'sync') void agent.refreshAttached();
      else if (m.type === 'route') app.route = m.route as Route;
      else if (m.type === 'focus') queueMicrotask(() => document.getElementById('agent-input')?.focus());
      else if (m.type === 'ping') void sendToMain({ type: 'ready' });
    }).then((u) => { off = u; void sendToMain({ type: 'ready' }); });
    return () => off?.();
  });

  // 面板上的 X（以及 Esc）会把 agentOpen 置 false：在独立窗口里就是把自己藏起来，并告诉主窗口
  $effect(() => {
    if (app.agentOpen) return;
    void hideSelf();
    void sendToMain({ type: 'hidden' });
    app.agentOpen = true;
  });

  function onKey(e: KeyboardEvent) {
    sfx.unlock();
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (!el.closest?.('input, textarea, select, [contenteditable]') && !app.confirmation) app.agentOpen = false;
  }
</script>

<svelte:window onpointerdowncapture={() => sfx.unlock()} onkeydown={onKey} />

<Backdrop soft />
<div class="agent-shell"><AgentPanel windowed /></div>
<Toasts />
<Confirmation />

<style>
  .agent-shell { position: relative; z-index: 1; height: 100%; display: flex; }
</style>
