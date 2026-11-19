<script lang="ts">
  import type { Snippet } from 'svelte';
  let {name, sub, state, off=false, error, onopen, cover, facts, control}:{
    name:string; sub:string; state:{text:string;tone:string}; off?:boolean; error?:string;
    onopen:()=>void; cover:Snippet; facts?:Snippet; control?:Snippet;
  }=$props();
</script>
<article class="card" class:off>
  <button class="main" aria-label={'查看功能 ' + name} onclick={onopen}>
    <span class="top"><span class="thumb">{@render cover()}</span><span class="id"><span class="name">{name}</span><span class="ver">{sub}</span></span></span>
    <span class="facts"><span class="state {state.tone}"><i></i>{state.text}</span>{@render facts?.()}</span>
    {#if error}<span class="error">{error}</span>{/if}
  </button>
  {#if control}<div class="control">{@render control()}</div>{/if}
</article>
<style>  /* 和 Mod 页卡片同一种小浮岛：半透明亮面 + 岛描边，悬停轻轻抬起 */
  .card {
    position: relative; min-width: 0;
    border: 1px solid var(--island-line); border-radius: 16px;
    background: color-mix(in srgb, var(--md-surface-bright) 62%, transparent);
    transition: background var(--dur), border-color var(--dur), transform 240ms var(--ease-out), box-shadow 240ms var(--ease-out);
  }
  .main { display: flex; flex-direction: column; gap: 10px; width: 100%; height: 100%; padding: 14px 16px 14px 14px; border-radius: inherit; text-align: left; outline: none; }
  .main:focus-visible { box-shadow: 0 0 0 2px var(--md-primary); }
  .top { display: flex; align-items: center; gap: 12px; min-width: 0; padding-right: 48px; }
  .thumb { flex: none; width: 44px; height: 44px; border-radius: 12px; overflow: hidden; transition: opacity var(--dur), filter var(--dur); }
  .id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .name { font-size: 15px; font-weight: 600; line-height: 1.35; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ver { font: 11px var(--font-mono); color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: auto; font-size: 12px; color: var(--fg-3); }
  .state { display: inline-flex; align-items: center; gap: 6px; }
  .state i { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-4); }
  .state.next { color: var(--fg-2); }
  .state.next i { background: color-mix(in srgb, var(--md-primary) 70%, transparent); }
  .state.live { color: var(--md-primary); }
  .state.live i { background: var(--md-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-primary) 22%, transparent); }
  .state.danger { color: var(--danger); }
  .state.danger i { background: var(--danger); }
  .error { font-size: 12px; line-height: 1.5; color: var(--danger); overflow-wrap: anywhere; }
  .control { position: absolute; top: 14px; right: 12px; }

  .off .thumb { opacity: .5; filter: grayscale(1); }
  .off .name { color: var(--fg-2); }

  @media (hover: hover) and (pointer: fine) {
    .card:hover { background: color-mix(in srgb, var(--md-surface-bright) 88%, transparent); transform: translateY(-2px); box-shadow: 0 14px 28px -18px rgb(0 0 0 / .45); }
  }
  @media (prefers-reduced-motion: reduce) { .card:hover { transform: none; } }
</style>
