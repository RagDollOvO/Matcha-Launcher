<script lang="ts">
  import { api } from '../api';
  import { app } from '../stores/app.svelte';
  import type { DllCoverSource } from '../plugins/catalog';
  let { title, platformId, source: coverSource, kind = 'collection' }: { title: string; platformId?: string; source?: DllCoverSource; kind?: 'catalog' | 'collection' | 'module' } = $props();
  let url = $state<string | null>(null), failed = $state(false);
  $effect(() => {
    const owner = coverSource?.owner, id = owner?.id;
    const cover = coverSource?.kind === 'catalog' ? owner?.presentation?.catalog?.cover : coverSource?.kind === 'module' ? owner?.presentation?.cover : coverSource?.collectionId ? owner?.presentation?.collections?.find(c=>c.id===coverSource.collectionId)?.cover : owner?.presentation?.collection?.cover;
    const key = `${app.game.root}:${owner?.version}:${owner?.installed}`;
    void key;
    let live = true; url = null; failed = false;
    if (id && cover && coverSource) void api.pluginCover(id, coverSource.kind, coverSource.collectionId).then(r => { if (live) url = r.dataUrl; }).catch(() => { if (live) failed = true; });
    return () => { live = false; };
  });
  const image = $derived(url || (platformId === 'skeeto' ? '/platforms/skeeto.png' : null));
  const glyph = $derived([...title.replace(/^[^\p{L}\p{N}]+/u, '')][0]?.toUpperCase() ?? '·');
  const label = $derived(kind === 'module' ? 'FEATURE' : kind === 'catalog' ? 'CATALOG' : 'COLLECTION');
</script>

<div class="cover" class:logo={platformId === 'skeeto'}>
  {#if image && !failed}
    <img src={image} alt={`${title} 封面`} onerror={() => failed = true} draggable="false" />
  {:else}
    <!-- 没有封面时的排版封面：黑底、细线、大字首字母 -->
    <div class="tile" aria-label={`${title} 封面`}>
      <span class="label"><i></i>{label}</span>
      <span class="glyph" aria-hidden="true">{glyph}</span>
      <span class="name">{title}</span>
    </div>
  {/if}
</div>

<style>
  .cover { width: 100%; height: 100%; overflow: hidden; background: var(--bg-1); container: cover / size; }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .logo img { object-fit: contain; background: #fff; }
  .tile { position: relative; height: 100%; display: flex; flex-direction: column; justify-content: space-between; padding: 9cqmin; background-color: var(--bg-1); background-image: repeating-linear-gradient(135deg, transparent 0 13px, #ffffff06 13px 14px); color: var(--fg); overflow: hidden; }
  .label { display: flex; align-items: center; gap: 7px; font: 10px var(--font-mono); letter-spacing: .14em; color: var(--fg-3); }
  .label i { width: 5px; height: 5px; background: var(--accent); }
  .glyph { position: absolute; right: -4cqw; bottom: -14cqh; font: 500 82cqh/1 var(--font-display); color: var(--bg-3); letter-spacing: -.02em; pointer-events: none; }
  .name { position: relative; max-width: 86%; font-size: clamp(14px, 7.5cqw, 30px); font-weight: 600; line-height: 1.25; letter-spacing: -.01em; overflow-wrap: anywhere; text-wrap: balance; }
  /* 列表缩略图：只留首字母，用壁纸取色的柔和底 */
  @container cover (max-width: 120px) {
    .tile { justify-content: center; align-items: center; padding: 0; background: color-mix(in srgb, var(--md-secondary-container) 85%, transparent); }
    .label, .name { display: none; }
    .glyph { position: static; font-size: 44cqh; font-weight: 600; color: var(--md-on-secondary-container); }
  }
</style>
