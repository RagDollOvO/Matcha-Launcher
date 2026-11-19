<script lang="ts">
  import MapIcon from '@lucide/svelte/icons/map';
  import { gmImage } from '../api/gamemaps';

  let { image, caption = false, eager = false }: { image: string; caption?: boolean; eager?: boolean } = $props();
  const url = $derived(gmImage(image));
  let loaded = $state('');
  let failed = $state('');
</script>

<span class="picture" aria-hidden="true">
  {#if !url || loaded !== url || failed === url}
    <span class="placeholder">
      <MapIcon size={caption ? 26 : 22} strokeWidth={1.25} />
      {#if caption}<span>{!url ? '暂无封面' : failed === url ? '封面暂不可用' : '正在载入封面…'}</span>{/if}
    </span>
  {/if}
  {#if url && failed !== url}
    <img src={url} alt="" loading={eager ? 'eager' : 'lazy'} referrerpolicy="no-referrer" class:ready={loaded === url}
         onload={() => (loaded = url)} onerror={() => (failed = url)} />
  {/if}
</span>

<style>
  .picture { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; }
  .placeholder { display: grid; place-content: center; justify-items: center; gap: 6px; width: 100%; height: 100%; color: var(--fg-3); font-size: 12px; }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; }
  img.ready { opacity: 1; }
</style>
