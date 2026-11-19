<script lang="ts">
  import type { RenderEntry } from '../types';
  let { entries, details = false }: { entries?: RenderEntry[]; details?: boolean } = $props();
  const label = (entry: RenderEntry) => entry.kind === 'legacy-matcha' ? '旧 Matcha 入口'
    : entry.kind === 'unknown' ? '文件待识别' : entry.version ?? 'DXVK · 版本待识别';
</script>
{#if !entries}
  <span>待检测</span>
{:else if !entries.length}
  <span>未检测到</span>
{:else}
  {#each (details ? entries : entries.slice(0,1)) as e (e.route)}
    <span class="entry" title={e.path}>{e.route === 'default' ? '默认' : '-vulkan'} · {label(e)}{#if details}<small>{e.path}</small>{/if}</span>
  {/each}
{/if}
<style>.entry{display:block;overflow-wrap:anywhere}.entry + .entry{margin-top:.45em}small{display:block;color:var(--fg-3);font:11px var(--font-mono)}</style>
