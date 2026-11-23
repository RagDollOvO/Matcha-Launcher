<script lang="ts">
  import Link from '@lucide/svelte/icons/link';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Layers from '@lucide/svelte/icons/layers';
  import { onMount, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { api } from '../api';
  import { errorText } from '../api/bridge';
  import { app, mib } from '../stores/app.svelte';
  import { parseWorkshopIds } from '../workshop';
  import type { WorkshopItem } from '../types';
  import WorkDialog from './WorkDialog.svelte';

  /** initial：Ctrl+V 粘贴进来的文字，有 ID 时直接解析 */
  let { initial = '', onclose }: { initial?: string; onclose: () => void } = $props();

  // 只取打开时传进来的文字，之后由用户编辑
  let text = $state(untrack(() => initial));
  const ids = $derived(parseWorkshopIds(text));
  let phase = $state<'edit' | 'resolving' | 'list' | 'sending'>('edit');
  let items = $state<WorkshopItem[]>([]);
  let asked = $state<string[]>([]);
  let error = $state('');
  const checked = new SvelteSet<string>();

  onMount(() => {
    if (initial && ids.length) void resolve();
  });

  async function resolve() {
    const list = ids.slice(0, 100);
    if (!list.length || phase === 'resolving') return;
    phase = 'resolving'; error = '';
    try {
      const r = await api.workshopResolve(list);
      items = r.items; asked = list;
      checked.clear();
      for (const it of items) if (it.downloadable) checked.add(it.id);
      phase = 'list';
    } catch (e) { error = errorText(e); phase = 'edit'; }
  }

  // 按粘贴顺序排；合集下面缩进列出它的条目，每个条目只出现一次
  const rows = $derived.by(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const shown = new Set<string>();
    const out: { item: WorkshopItem; depth: number }[] = [];
    const add = (id: string, depth: number) => {
      const item = byId.get(id);
      if (!item || shown.has(id)) return;
      shown.add(id); out.push({ item, depth });
      for (const c of item.children ?? []) add(c, Math.min(depth + 1, 2));
    };
    for (const id of asked) add(id, 0);
    for (const it of items) add(it.id, 1);
    return out;
  });
  const downloadable = $derived(items.filter((i) => i.downloadable));
  const pickedSize = $derived(items.filter((i) => checked.has(i.id)).reduce((n, i) => n + i.sizeBytes, 0));
  // 后端队列最多 32 个未结束的任务
  const room = $derived(Math.max(0, 32 - app.tasks.filter((t) => !['done', 'failed', 'canceled'].includes(t.state)).length));
  const over = $derived(checked.size > room);

  function toggle(id: string) { if (checked.has(id)) checked.delete(id); else checked.add(id); }
  /** 合集的勾选框：勾上 / 取消它下面全部可下载的条目 */
  function childrenOf(it: WorkshopItem) { return (it.children ?? []).filter((id) => items.find((x) => x.id === id)?.downloadable); }
  function toggleCollection(it: WorkshopItem) {
    const kids = childrenOf(it);
    const all = kids.length > 0 && kids.every((id) => checked.has(id));
    for (const id of kids) if (all) checked.delete(id); else checked.add(id);
  }
  async function download() {
    if (!checked.size || over) return;
    phase = 'sending';
    const n = await app.downloadWorkshop(items.filter((i) => checked.has(i.id)).map((i) => i.id));
    if (n) onclose(); else phase = 'list';
  }
  const date = (iso: string) => (iso ? iso.slice(0, 10) : '');
  const initialOf = (s: string) => s.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?';
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); app.toast('已复制链接'); } catch { app.toast('复制失败'); }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && phase === 'edit') { e.preventDefault(); void resolve(); }
  }
</script>

<WorkDialog title="从创意工坊下载" lead="单个条目和合集链接都可以批量读取。" wide locked={phase === 'sending'} {onclose}>
  {#snippet symbol()}<Link size={22} />{/snippet}
  {#if phase === 'edit' || phase === 'resolving'}
    <div class="body">
      <label class="paste"><strong>工坊链接或条目 ID</strong>
        <textarea bind:value={text} rows="5" spellcheck="false" disabled={phase === 'resolving'} onkeydown={onKey}
                  placeholder={'一行一个，例如：\nhttps://steamcommunity.com/sharedfiles/filedetails/?id=2468013579'}></textarea>
      </label>
      {#if error}<p class="err" role="alert">{error}</p>{/if}
    </div>
  {:else}
    <div class="head">
      <button class="btn sm ghost" type="button" disabled={phase === 'sending'} onclick={() => (phase = 'edit')}><ArrowLeft size={13} />修改链接</button>
      <span class="grow"></span>
      <span class="count">{items.length} 项 · {downloadable.length} 项可下载</span>
      {#if downloadable.length}
        <button class="btn sm ghost" type="button" onclick={() => { if (checked.size === downloadable.length) checked.clear(); else downloadable.forEach((i) => checked.add(i.id)); }}>
          {checked.size === downloadable.length ? '全不选' : '全选可下载'}
        </button>
      {/if}
    </div>
    <div class="list">
      {#each rows as { item: it, depth } (it.id)}
        {@const coll = it.kind === 'collection'}
        {@const kids = coll ? childrenOf(it) : []}
        {@const on = coll ? kids.length > 0 && kids.every((id) => checked.has(id)) : checked.has(it.id)}
        {@const mixed = coll && !on && kids.some((id) => checked.has(id))}
        <label class="item" class:dim={!it.downloadable && !coll} class:selected={on || mixed} style:margin-left="{depth * 16}px">
          <input type="checkbox" checked={on} indeterminate={mixed}
                 disabled={coll ? !kids.length : !it.downloadable} onchange={() => (coll ? toggleCollection(it) : toggle(it.id))} />
          <span class="pv">
            {#if it.preview}<img src={it.preview} alt="" />{:else if coll}<Layers size={16} />{:else}<span class="ini">{initialOf(it.title)}</span>{/if}
          </span>
          <span class="info">
            <span class="t" title={it.title}>{it.title}</span>
            <span class="m">
              {#if coll}合集 · {it.children?.length ?? 0} 项{:else if !it.error}<span class="mono">{mib(it.sizeBytes)}</span>{#if it.updatedAt}{` · 更新于 ${date(it.updatedAt)}`}{/if}{/if}
              <span class="mono id"> · {it.id}</span>
            </span>
            {#if it.reason && !coll}<span class="why" class:bad={!!it.error}>{it.inLibrary ? '已在库中' : it.reason}</span>{/if}
          </span>
          {#if !it.downloadable && !coll && !it.inLibrary}
            <button class="icon-btn" type="button" title="复制工坊链接，到 Steam 里查看" aria-label="复制链接" onclick={(e) => { e.preventDefault(); void copy(it.workshopUrl); }}><Link size={13} /></button>
          {/if}
        </label>
      {/each}
    </div>
  {/if}
  {#snippet footer()}
    {#if phase === 'edit' || phase === 'resolving'}
      <span class="note" class:warn={ids.length > 100} aria-live="polite">{ids.length > 100 ? `已识别 ${ids.length} 项，本次读取前 100 项` : ids.length ? `已识别 ${ids.length} 项` : 'Ctrl + Enter 读取链接'}</span>
      <button class="btn ghost" type="button" onclick={onclose}>取消</button>
      <button class="btn primary" type="button" disabled={!ids.length || phase === 'resolving'} onclick={resolve}>
        {#if phase === 'resolving'}<LoaderCircle size={14} class="spin" />正在读取…{:else}{ids.length ? '读取 ' + Math.min(ids.length, 100) + ' 项' : '读取链接'}{/if}
      </button>
    {:else}
      <span class="note" class:warn={over}>{over ? `下载队列还能放 ${room} 项，请少选一些` : '下载后在 Mod 页的「新下载」里整理'}</span>
      <button class="btn ghost" type="button" disabled={phase === 'sending'} onclick={onclose}>取消</button>
      <button class="btn primary" type="button" disabled={!checked.size || over || phase === 'sending'} onclick={download}>
        {#if phase === 'sending'}<LoaderCircle size={14} class="spin" />{/if}下载 {checked.size} 项{checked.size ? ` · ${mib(pickedSize)}` : ''}
      </button>
    {/if}
  {/snippet}
</WorkDialog>

<style>
  .btn:disabled, .icon-btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .body, .paste { display: grid; gap: 8px; }
  textarea { width: 100%; min-height: 125px; resize: vertical; padding: 10px 12px; font: 13px/1.65 var(--font-mono); background: var(--md-surface-container-low); }
  .note.warn, .err { color: var(--danger); }
  .err { margin: 0; overflow-wrap: anywhere; }
  .grow { flex: 1; }
  .note { margin-right: auto; color: var(--fg-2); min-width: 0; }
  .head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-bottom: 10px; }
  .count { color: var(--fg-2); }
  .list { display: grid; gap: 3px; padding: 5px; border-radius: 12px; background: var(--md-surface-container-low); }
  .item { display: flex; align-items: center; gap: 10px; min-height: 55px; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  .item:hover, .item:focus-within { background: var(--bg-2); }
  .item.selected { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .item.dim { cursor: default; }
  .item.dim .t { color: var(--fg-3); }
  input[type='checkbox'] { width: 15px; height: 15px; flex: none; margin: 0; accent-color: var(--md-primary); cursor: pointer; }
  input:disabled { cursor: default; opacity: .4; }
  .pv { display: grid; place-items: center; width: 40px; height: 40px; flex: none; border-radius: 7px; overflow: hidden; background: var(--bg-2); color: var(--fg-2); }
  .pv img { width: 100%; height: 100%; object-fit: cover; }
  .ini { font-family: var(--font-display); font-size: 20px; color: var(--fg-4); }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .t { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .m { font-size: 12px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .selected .m, .selected .id { color: inherit; }
  .id { color: var(--fg-4); }
  .why { font-size: 12px; color: var(--fg-2); }
  .why.bad { color: var(--danger); }
</style>
