<script lang="ts">
  // 一个 DLL 功能的卡片：总览和合集页的网格里都用它。
  import { pluginUsage } from '../plugins/catalog';
  import type { PlatformPlugin } from '../types';
  import DllModuleCard from './DllModuleCard.svelte';
  import DllCover from './DllCover.svelte';
  import DllPluginControl from './DllPluginControl.svelte';
  import { provenanceSummary, sourceHasUpdate } from '../plugins/intake';
  import { trustTier } from '../plugins/safety';
  let { p, onopen }: { p: PlatformPlugin; onopen: () => void } = $props();
  const usage = $derived(pluginUsage(p));
  const prov = $derived(provenanceSummary(p));
  const off = $derived(p.installed !== false && !p.enabled);
  // 两个状态分开说：开关是「下次启动」，运行状态是「当前这局游戏」
  const state = $derived(
    p.installed === false ? { text: '未安装', tone: 'muted' }
    : p.runtimeState === 'failed' || p.error ? { text: '加载失败', tone: 'danger' }
    : p.runtimeState === 'initialized' ? { text: '运行中', tone: 'live' }
    : p.enabled ? { text: '下次启动加载', tone: 'next' }
    : { text: '已停用', tone: 'muted' });
</script>
<DllModuleCard name={p.name} sub={['v'+p.version,p.author].filter(Boolean).join(' · ')} {state} {off} error={p.error || undefined} {onopen}>
  {#snippet cover()}<DllCover title={p.name} source={{ owner: p, kind: 'module' }} kind="module"/>{/snippet}
  {#snippet facts()}
      {#if usage.library}<span class="fact">整体加载</span>{/if}
      {#if usage.inGameMenu}<span class="fact"><kbd>Ctrl F7</kbd>游戏内设置</span>{/if}
      {#if p.update && p.installed !== false}<span class="tag new">有新版本 v{p.update.version}</span>{:else if sourceHasUpdate(p)}<span class="tag new">来源有新版本</span>{/if}
      {#if trustTier(p) === 'blocked'}<span class="tag bad">已拦截</span>{:else if p.screening?.findings.some(f => f.severity === 'review')}<span class="tag warn">有敏感能力</span>{/if}
      {#if prov.hasAgent}<span class="tag">茶茶整理</span>{/if}
      {#if prov.hasUser}<span class="tag">手动修改</span>{/if}
  {/snippet}
  {#snippet control()}<DllPluginControl {p} compact/>{/snippet}
</DllModuleCard>
<style>  .fact { display: inline-flex; align-items: center; gap: 6px; }
  kbd { padding: 0 6px; border-radius: 6px; background: color-mix(in srgb, var(--md-surface-container-highest) 80%, transparent); color: var(--fg-2); font: 11px/18px var(--font-mono); }
  .tag { padding: 0 8px; border-radius: 999px; line-height: 20px; background: color-mix(in srgb, var(--md-surface-container-highest) 70%, transparent); color: var(--fg-2); }
  .tag.new { background: var(--md-primary-container); color: var(--md-on-primary-container); }
  .tag.bad { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
  .tag.warn { box-shadow: inset 0 0 0 1px var(--line-strong); background: transparent; color: var(--fg-2); }
</style>
