<script lang="ts">
  // 思考过程：进行中显示最后几行（自动滚动、上沿渐隐）+ 计时；结束后收成「思考了 N 秒」
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Brain from '@lucide/svelte/icons/brain';
  import { prefs } from '../stores/prefs.svelte';
  import type { Block } from './chat.svelte';

  let { block, live }: { block: Extract<Block, { kind: 'thinking' }>; live: boolean } = $props();
  const thinking = $derived(live && !block.endedAt);
  let manual = $state<boolean | null>(null);
  const open = $derived(manual ?? (prefs.thinking === 'expanded' || (prefs.thinking === 'auto' && thinking)));
  let now = $state(Date.now());
  $effect(() => {
    if (!thinking) return;
    const t = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(t);
  });
  const secs = $derived(Math.max(1, Math.round(((block.endedAt ?? now) - block.startedAt) / 1000)));
  const label = $derived(thinking ? `思考中 ${secs}s` : block.startedAt ? `思考了 ${secs} 秒` : '思考过程');
  let body = $state<HTMLDivElement>();
  $effect(() => { void block.text; if (thinking && body) body.scrollTop = body.scrollHeight; });
</script>

{#if prefs.thinking !== 'hidden'}
  <div class="think" class:live={thinking}>
    <button class="head" aria-expanded={open} onclick={() => (manual = !open)}>
      <Brain size={12} />
      <span class="label" class:shimmer={thinking}>{label}</span>
      <span class="chev" class:open><ChevronRight size={12} /></span>
    </button>
    {#if open}
      <div class="body" class:tail={thinking && manual === null} bind:this={body}>{block.text}</div>
    {/if}
  </div>
{/if}

<style>
  .think { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .head { display: inline-flex; align-items: center; gap: 6px; height: 22px; font-size: 12px; color: var(--fg-3); transition: color var(--dur); }
  .head:hover { color: var(--fg-2); }
  .chev { display: grid; color: var(--fg-4); transition: transform 160ms var(--ease-out); }
  .chev.open { transform: rotate(90deg); }
  /* 进行中：文字上扫一道亮光 */
  .shimmer { background: linear-gradient(90deg, var(--fg-3) 0%, var(--fg-3) 40%, var(--fg) 50%, var(--fg-3) 60%, var(--fg-3) 100%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: sweep-text 1.6s linear infinite; }
  @keyframes sweep-text { from { background-position: 100% 0; } to { background-position: -150% 0; } }
  .body { width: 100%; max-height: 320px; overflow-y: auto; padding: 2px 0 2px 12px; border-left: 1px solid var(--line-strong); font-size: 12px; line-height: 1.7; color: var(--fg-3); white-space: pre-wrap; overflow-wrap: anywhere; animation: rise 200ms var(--ease-out); }
  .body.tail { max-height: 86px; overflow: hidden; mask-image: linear-gradient(180deg, transparent, #000 40%); }
  @media (prefers-reduced-motion: reduce) { .shimmer { animation: none; color: var(--fg-2); background: none; } .body { animation: none; } }
</style>
