<script lang="ts">
  // 工具调用：中文名 + 一行参数摘要 + 状态/耗时；展开看参数和结果；写操作的确认放在卡片里
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Loader from '@lucide/svelte/icons/loader-circle';
  import Check from '@lucide/svelte/icons/check';
  import X from '@lucide/svelte/icons/x';
  import Shield from '@lucide/svelte/icons/shield-alert';
  import Copy from '@lucide/svelte/icons/copy';
  import type { Block } from './chat.svelte';
  import { toolMeta, argSummary } from './tools';

  let { block, onrespond }: { block: Extract<Block, { kind: 'tool' }>; onrespond: (id: string, allow: boolean) => void } = $props();
  let open = $state(false);
  let copied = $state(false);

  const meta = $derived(toolMeta(block.name));
  const waiting = $derived(block.approval?.state === 'waiting');
  const busy = $derived(block.status === 'pending' || block.status === 'running');
  const summary = $derived(argSummary(block.args));
  const secs = $derived(block.startedAt && block.endedAt ? ((block.endedAt - block.startedAt) / 1000).toFixed(1) : '');
  const args = $derived(Object.entries(block.args));
  const pretty = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  function copy() {
    void navigator.clipboard?.writeText(block.output).then(() => { copied = true; setTimeout(() => (copied = false), 1200); });
  }
</script>

<div class="card" class:waiting class:err={block.status === 'error'} class:busy>
  <button class="head" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="ic"><meta.icon size={13} /></span>
    <span class="name">{meta.label}</span>
    {#if block.name === 'player_memory_edit'}<span class="w" title="茶茶自己维护本机 MEMORY.md">记忆</span>
    {:else if meta.write}<span class="w" title="会修改文件或游戏配置，执行前需要你确认">写入</span>{/if}
    <span class="args">{summary}</span>
    <span class="st">
      {#if waiting}<Shield size={13} />
      {:else if busy}<Loader size={13} class="spin" />
      {:else if block.status === 'done'}{#if secs}<span class="sec mono">{secs}s</span>{/if}<Check size={13} />
      {:else}<X size={13} />{/if}
    </span>
    <span class="chev" class:open><ChevronRight size={12} /></span>
  </button>

  {#if block.approval}
    {#if waiting}
      <div class="approval">
        <strong>{block.approval.title}</strong>
        {#if block.approval.message}<p>{block.approval.message}</p>{/if}
        <div class="ab">
          <button class="btn sm solid" data-sfx="approve" onclick={() => onrespond(block.approval!.id, true)}>允许</button>
          <button class="btn sm" data-sfx="deny" onclick={() => onrespond(block.approval!.id, false)}>拒绝</button>
        </div>
      </div>
    {:else}
      <div class="decided">{block.approval.state === 'allowed' ? '已允许' : '已拒绝或超时'} · {block.approval.title}</div>
    {/if}
  {/if}

  {#if open}
    <div class="body">
      <div class="lbl">工具 <span class="mono">{block.name}</span></div>
      {#if args.length}
        <dl class="kv">
          {#each args as [k, v] (k)}<dt class="mono">{k}</dt><dd class="mono">{pretty(v)}</dd>{/each}
        </dl>
      {/if}
      {#if block.output}
        <div class="lbl row">结果<button class="cp" onclick={copy} title="复制结果"><Copy size={11} />{copied ? '已复制' : '复制'}</button></div>
        <pre class="mono">{block.output}</pre>
      {:else if busy}
        <div class="lbl">执行中…</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .card { border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); overflow: hidden; transition: border-color var(--dur); }
  .card.busy { border-color: var(--line-strong); }
  .card.waiting { border-color: var(--fg-3); }
  .card.err .st, .card.err .ic { color: var(--danger); }
  .head { width: 100%; display: flex; align-items: center; gap: 7px; height: 32px; padding: 0 8px 0 10px; text-align: left; transition: background var(--dur); }
  .head:hover { background: var(--bg-2); }
  .ic { display: grid; color: var(--fg-3); flex: none; }
  .name { font-size: 12px; color: var(--fg); white-space: nowrap; }
  .w { flex: none; font-size: 10px; padding: 0 4px; height: 15px; line-height: 13px; border: 1px solid var(--line-strong); border-radius: 3px; color: var(--fg-3); }
  .args { flex: 1; min-width: 0; font-size: 11px; color: var(--fg-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st { display: flex; align-items: center; gap: 5px; color: var(--fg-3); flex: none; }
  .sec { font-size: 10px; color: var(--fg-4); }
  .chev { display: grid; color: var(--fg-4); transition: transform 160ms var(--ease-out); flex: none; }
  .chev.open { transform: rotate(90deg); }
  .approval { border-top: 1px solid var(--line); padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; background: var(--bg-2); animation: rise 200ms var(--ease-out); }
  .approval strong { font-size: 13px; font-weight: 500; }
  .approval p { margin: 0; color: var(--fg-2); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  .ab { display: flex; gap: 6px; margin-top: 8px; }
  .solid { background: var(--fg); border-color: var(--fg); color: var(--bg); }
  .solid:hover { background: #fff; border-color: #fff; }
  .decided { border-top: 1px solid var(--line); padding: 5px 10px; font-size: 11px; color: var(--fg-3); }
  .body { border-top: 1px solid var(--line); padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 6px; }
  .lbl { font-size: 11px; color: var(--fg-4); }
  .lbl .mono { color: var(--fg-3); margin-left: 4px; }
  .lbl.row { display: flex; align-items: center; justify-content: space-between; }
  .cp { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--fg-3); }
  .cp:hover { color: var(--fg); }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; font-size: 11px; }
  .kv dt { color: var(--fg-3); }
  .kv dd { margin: 0; color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  pre { margin: 0; max-height: 240px; overflow: auto; padding: 8px; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-sm); font-size: 11px; line-height: 1.6; color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  @media (prefers-reduced-motion: reduce) { .approval { animation: none; } }
</style>
