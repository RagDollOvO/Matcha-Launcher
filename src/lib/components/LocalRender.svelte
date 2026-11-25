<script lang="ts" module>
  import type { RenderEntry } from '../types';
  /** Valve 随游戏放的 bin/dxvk_d3d9.dll（版本形如 native-1.9.1a-4-g…）：只在 -vulkan 时生效，不算玩家装了 DXVK */
  export const stockDxvk = (e?: RenderEntry) => e?.kind === 'dxvk' && /^native-/i.test(e.version ?? '');
  export const dxvkShort = (v: string) => v.replace(/^native-/i, '').replace(/-\d+-g[0-9a-f]+\+?$/i, '');
  export const DXVK_HOWTO = '把 DXVK 的 32 位 d3d9.dll 放到游戏根目录（left4dead2.exe 旁边）就会启用，L4N 平台启动走这条；游戏自带的旧版只在 -vulkan 时生效。';
</script>
<script lang="ts">
  let { entries, details = false }: { entries?: RenderEntry[]; details?: boolean } = $props();
  const label = (entry: RenderEntry) => entry.kind === 'legacy-matcha' ? '旧 Matcha 入口'
    : entry.kind === 'unknown' ? '文件待识别'
    : stockDxvk(entry) ? `游戏自带旧版 ${dxvkShort(entry.version!)}，需 -vulkan`
    : entry.version ?? 'DXVK · 版本待识别';
  const main = $derived(entries?.find(e => e.route === 'default'));
  const vulkan = $derived(entries?.find(e => e.route === 'vulkan'));
</script>
{#if !entries}
  <span>待检测</span>
{:else if details}
  {#if !main}<span class="entry">默认 · 未安装<small class="how">{DXVK_HOWTO}</small></span>{/if}
  {#each entries as e (e.route)}
    <span class="entry" title={e.path}>{e.route === 'default' ? '默认' : '-vulkan'} · {label(e)}<small>{e.path}</small></span>
  {/each}
{:else if main}
  <span class="entry" title={main.path}>默认 · {label(main)}</span>
{:else}
  <span class="entry" title={DXVK_HOWTO}>未安装{#if vulkan}{stockDxvk(vulkan) ? ' · 游戏自带旧版需 -vulkan' : ` · -vulkan ${label(vulkan)}`}{/if}</span>
{/if}
<style>.entry{display:block;overflow-wrap:anywhere}.entry + .entry{margin-top:.45em}small{display:block;color:var(--fg-3);font:11px var(--font-mono)}.how{font-family:inherit;line-height:1.6}</style>
