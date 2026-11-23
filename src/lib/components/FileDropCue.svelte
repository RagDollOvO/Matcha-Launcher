<script lang="ts">
  import FolderInput from '@lucide/svelte/icons/folder-input';
  import Star from '@lucide/svelte/icons/star';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { title, detail, blocked = false, favorite = false }: {
    title: string; detail?: string; blocked?: boolean; favorite?: boolean;
  } = $props();
</script>

<div class="area" class:blocked>
  <div class="cue" role="status">
    <span class="symbol" aria-hidden="true">{#if blocked}<TriangleAlert size={20}/>{:else if favorite}<Star size={20}/>{:else}<FolderInput size={20}/>{/if}</span>
    <div><strong>{title}</strong>{#if detail}<small>{detail}</small>{/if}</div>
  </div>
</div>

<style>
  .area { position: absolute; z-index: 4; inset: 8px; display: grid; align-items: end; justify-items: center; padding: 0 10px 12px; border: 2px dashed var(--md-primary); border-radius: 14px; pointer-events: none; }
  .area.blocked { border-color: var(--danger); }
  .cue { max-width: min(100%, 520px); display: flex; align-items: center; gap: 11px; padding: 9px 14px 9px 9px; border-radius: 12px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .blocked .cue { background: var(--md-error-container); color: var(--md-on-error-container); }
  .symbol { display: grid; place-items: center; flex: none; width: 38px; height: 38px; border-radius: 8px; background: var(--md-surface-container); color: var(--md-primary); }
  .blocked .symbol { color: var(--danger); }
  strong, small { display: block; overflow-wrap: anywhere; }
  strong { font-size: 15px; }
  small { font-size: 12px; }
</style>
