<script lang="ts">
  let { keys }: { keys: string[] } = $props();
</script>

<span class="keys">{#each keys as key, i (i)}{#if i}<span class="plus" aria-hidden="true">+</span>{/if}<kbd>{key}</kbd>{/each}</span>

<style>
  .keys { display: inline-flex; align-items: center; gap: 4px; vertical-align: baseline; white-space: nowrap; }
  kbd { display: inline-block; min-width: 22px; padding: 1px 6px; border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: var(--r-sm); background: var(--bg-2); color: var(--fg); font: 11px/18px var(--font-mono); text-align: center; }
  .plus { color: var(--fg-3); font-size: 11px; }
</style>
