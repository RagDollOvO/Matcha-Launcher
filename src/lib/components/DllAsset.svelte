<script lang="ts" module>
  // 同一张图在列表、详情、灯箱里复用一次读取。
  const cache = new Map<string, Promise<string | null>>();
</script>

<script lang="ts">
  import ImageOff from '@lucide/svelte/icons/image-off';
  import { api } from '../api';
  import { app } from '../stores/app.svelte';
  import type { PlatformPlugin } from '../types';
  let { plugin, path, alt = '', fit = 'cover', onload }: { plugin: PlatformPlugin; path: string; alt?: string; fit?: 'cover' | 'contain'; onload?: (url: string) => void } = $props();
  let url = $state<string | null>(null), missing = $state(false);

  $effect(() => {
    const key = `${app.game.root}|${plugin.id}@${plugin.version}|${plugin.installed}|${path}`;
    let live = true; url = null; missing = false;
    let job = cache.get(key);
    if (!job) {
      // 封面走 plugin-cover（含 Agent 补的 @overlay/ 封面）；其余图片走 plugin-asset。文件缺失或未声明时显示占位。
      job = (path === plugin.presentation?.cover ? api.pluginCover(plugin.id, 'module') : api.pluginAsset(plugin.id, path))
        .then(r => r.dataUrl).catch(() => null);
      cache.set(key, job);
      void job.then(v => { if (!v) cache.delete(key); });
    }
    void job.then(v => { if (!live) return; if (v) { url = v; onload?.(v); } else missing = true; });
    return () => { live = false; };
  });
</script>

{#if url}
  <img src={url} {alt} style:object-fit={fit} draggable="false" />
{:else}
  <span class="placeholder" class:missing aria-label={alt || path}>
    {#if missing}<ImageOff size={16} /><span class="mono">{path}</span>{/if}
  </span>
{/if}

<style>
  img { display: block; width: 100%; height: 100%; }
  .placeholder { display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; width: 100%; height: 100%; min-height: 96px; background: var(--bg-1); color: var(--fg-4); }
  .placeholder:not(.missing) { background: linear-gradient(90deg, var(--bg-1), var(--bg-2), var(--bg-1)); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .mono { font: 11px var(--font-mono); max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .placeholder:not(.missing) { animation: none; } }
</style>
