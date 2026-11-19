<script lang="ts">
  import Image from '@lucide/svelte/icons/image';
  import { peekWorkshopPreview, workshopPreview, type PreviewSize } from '../workshop-preview';
  import type { WorkshopItem } from '../types';
  let { item, size = 'card' }: { item: WorkshopItem; size?: PreviewSize } = $props();
  const id = $derived(item.id);
  const version = $derived(item.updatedAt);
  const supplied = $derived(item.preview);
  const available = $derived(!!item.hasPreview);
  let element = $state<HTMLSpanElement>();
  let source = $state<string | null>(null);
  let failed = $state(false);
  let detailOnly = $state(false);
  $effect(() => {
    const key = id, updated = version, rendition = size;
    const cached = peekWorkshopPreview(key, updated, rendition);
    const preview = supplied ?? cached?.dataUrl;
    const poster = rendition === 'detail' ? peekWorkshopPreview(key, updated, 'card')?.dataUrl : undefined;
    source = preview ?? poster ?? null; failed = false; detailOnly = !!cached?.detailOnly;
    if (!element || preview || cached?.detailOnly || !available) return;
    let alive = true;
    let lease: ReturnType<typeof workshopPreview> | undefined;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      observer.disconnect();
      lease = workshopPreview(key, updated, rendition);
      void lease.promise.then(result => {
        if (!alive) return;
        source = result.dataUrl ?? poster ?? null;
        detailOnly = !!result.detailOnly;
        failed = !source && !result.detailOnly;
      }, () => { if (alive && !poster) failed = true; });
    }, { rootMargin: '160px' });
    observer.observe(element);
    return () => { alive = false; observer.disconnect(); lease?.release(); };
  });
</script>

<span class="thumb" bind:this={element}>
  {#if source && !failed}<img src={source} alt="" onerror={() => (failed = true)} />
  {:else}<span class="missing"><Image size={26} strokeWidth={1} /><span>{detailOnly ? '点开详情看大图' : failed ? '预览暂时加载失败' : item.hasPreview ? '正在载入预览' : '暂无预览图'}</span></span>{/if}
</span>

<style>
  .thumb { display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); width: 100%; height: 100%; place-items: center; overflow: hidden; background: var(--md-surface-container-high); }
  img { width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; }
  .missing { display: flex; align-items: center; flex-direction: column; gap: 10px; color: var(--fg-3); font-size: 12px; }
</style>
