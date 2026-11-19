<script lang="ts">
  import { parseRich, type Inline } from '../plugins/rich-text';
  import { browser } from '../browser/browser.svelte';
  import { app } from '../stores/app.svelte';
  import Keys from './Keys.svelte';
  let { text }: { text: string } = $props();
  const blocks = $derived(parseRich(text));
  function open(url: string) { browser.open(url); app.route = 'browser'; }
</script>

{#snippet line(parts: Inline[])}{#each parts as part, i (i)}{#if part.kind === 'keys'}<Keys keys={part.keys}/>{:else if part.kind === 'strong'}<strong>{part.text}</strong>{:else if part.kind === 'code'}<code>{part.text}</code>{:else if part.kind === 'link'}<button class="link" title={part.url} onclick={() => open(part.url)}>{part.text}</button>{:else}{part.text}{/if}{/each}{/snippet}

<div class="rich">
  {#each blocks as block, i (i)}
    {#if block.kind === 'h'}<h4>{@render line(block.inline)}</h4>
    {:else if block.kind === 'p'}<p>{#each block.lines as parts, j (j)}{#if j}<br/>{/if}{@render line(parts)}{/each}</p>
    {:else if block.kind === 'ul'}<ul>{#each block.items as parts, j (j)}<li>{@render line(parts)}</li>{/each}</ul>
    {:else}<ol>{#each block.items as parts, j (j)}<li>{@render line(parts)}</li>{/each}</ol>{/if}
  {/each}
</div>

<style>
  .rich { color: var(--fg-2); font-size: 14px; line-height: 1.9; overflow-wrap: anywhere; user-select: text; }
  .rich > :first-child { margin-top: 0; }
  .rich > :last-child { margin-bottom: 0; }
  p, ul, ol { margin: 0 0 14px; }
  h4 { margin: 24px 0 10px; color: var(--fg); font-size: 14px; font-weight: 550; }
  ul, ol { padding-left: 20px; }
  li { padding-left: 4px; }
  li::marker { color: var(--fg-3); }
  strong { color: var(--fg); font-weight: 550; }
  code { padding: 1px 5px; border-radius: var(--r-sm); background: var(--bg-2); color: var(--fg); font: 12px var(--font-mono); }
  .link { display: inline; padding: 0; color: var(--dev-accent, var(--fg)); text-decoration: underline; text-decoration-color: var(--fg-4); text-underline-offset: 3px; font: inherit; }
  .link:hover { text-decoration-color: currentColor; }
</style>
