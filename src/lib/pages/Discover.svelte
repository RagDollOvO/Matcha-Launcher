<script lang="ts">
  import { app } from '../stores/app.svelte';
  import Workshop from './Workshop.svelte';
  import Bilibili from './Bilibili.svelte';
  import GameMaps from './GameMaps.svelte';
  import Browser from './Browser.svelte';

  const web = $derived(app.route === 'browser');
  const source = $derived(web ? app.browserOrigin : app.route);
</script>

{#if source === 'workshop' || source === 'bilibili' || source === 'gamemaps'}
  <!-- Keep just the source being browsed, including its detail, filters and scroll position. -->
  <div class="source" class:covered={web} inert={web}>
    {#if source === 'workshop'}<Workshop />
    {:else if source === 'bilibili'}<Bilibili />
    {:else}<GameMaps />{/if}
  </div>
{/if}
<Browser />

<style>
  .source { height: 100%; }
  .covered { visibility: hidden; }
</style>
