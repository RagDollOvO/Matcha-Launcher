<script lang="ts">
  import { app } from '../stores/app.svelte';
  import type { PlatformPlugin } from '../types';
  import Toggle from './Toggle.svelte';
  let { p, compact = false }: { p: PlatformPlugin; compact?: boolean } = $props();
  const reason = $derived(app.game.running ? '退出游戏后可修改，下次启动生效' : app.busy ? `正在${app.busy}` : !app.runtime.installed ? '先部署 Matcha 加载器' : p.verification?.state === 'rejected' && !p.enabled ? '先处理加载核验错误' : '');
</script>

{#if p.installed === false}
  <button class="btn install" class:sm={compact} class:primary={!compact} disabled={!!reason || !p.packageDirectory} title={reason || '预览并确认安装，默认停用'} onclick={e => { e.stopPropagation(); if (p.packageDirectory) void app.importPlugin(p.packageDirectory); }}>安装</button>
{:else if compact}
  <span class="compact" title={reason || '下次完整启动游戏时生效'}><Toggle on={p.enabled} disabled={!!reason} onchange={() => app.togglePlugin(p.id)} label={`${p.enabled ? '停用' : '启用'} ${p.name}`}/></span>
{:else}
  <div class="full">
    <div class="line"><span>{p.enabled ? '已启用' : '已停用'}</span><Toggle on={p.enabled} disabled={!!reason} onchange={() => app.togglePlugin(p.id)} label={`${p.enabled ? '停用' : '启用'} ${p.name}`}/></div>
    {#if reason}<small>{reason}</small>{/if}
  </div>
{/if}

<style>
  .compact { display: inline-flex; padding: 6px; }
  .install { height: 32px; padding: 0 14px; justify-content: center; }
  .install.sm { height: 28px; padding: 0 12px; font-size: 12px; }
  .full { display: flex; flex-direction: column; gap: 8px; }
  .line { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; color: var(--fg); }
  small { font-size: 12px; line-height: 1.5; color: var(--fg-3); }
</style>
