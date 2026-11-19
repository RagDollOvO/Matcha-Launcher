<script lang="ts">
  import { untrack } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';

  let { value, delay = 0 }: { value: number; delay?: number } = $props();
  const t = new Tween(0, { duration: 700, easing: cubicOut, delay: untrack(() => delay) });
  $effect(() => { t.target = value; });
</script>

{Math.round(t.current)}
