<script lang="ts">
  import { onMount } from 'svelte';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Square from '@lucide/svelte/icons/square';
  import { api, type ConflictFilePage } from '../api';
  import { errorText } from '../api/bridge';
  import { app } from '../stores/app.svelte';
  import { player } from '../stores/player.svelte';
  import type { Profile } from '../types';

  let { profile, onclose, onmod }: { profile: Profile; onclose: () => void; onmod: (id: string) => void } = $props();
  let dialog: HTMLDialogElement, search: HTMLInputElement, list: HTMLDivElement;
  let query = $state(''), page = $state(0), retry = $state(0), error = $state(''), loading = $state(true);
  let result = $state.raw<ConflictFilePage | null>(null);
  const pages = $derived(result ? Math.ceil(result.total / result.pageSize) : 0);
  const mods = $derived(new Map(app.mods.map(m => [m.id, m])));
  let audition: { id: string; path: string } | undefined;

  onMount(() => {
    dialog.showModal();
    search.focus();
    return () => {
      dialog.close();
      if (audition && player.isOn(audition.id, audition.path)) player.stop();
    };
  });
  function play(id: string, path: string) {
    audition = { id, path };
    void player.play(id, path);
  }
  function go(next: number) {
    page = next;
    loading = true;
    error = '';
    list.scrollTop = 0;
  }
  function find(text: string) {
    if (text === query) return;
    query = text; result = null; go(0);
  }

  $effect(() => {
    const root = app.game.root, ids = [...profile.modIds], term = query, current = page;
    retry;
    let live = true;
    // Keep expanded rows in place across the launcher's periodic snapshot refresh.
    const timer = setTimeout(async () => {
      try {
        const next = await api.conflictFiles(root, ids, term, current);
        if (!live) return;
        const last = Math.max(0, Math.ceil(next.total / next.pageSize) - 1);
        if (current > last) { go(last); return; }
        result = next; error = ''; loading = false;
      } catch (e) { if (live) { error = errorText(e); result = null; } }
    }, term ? 100 : 0);
    return () => { live = false; clearTimeout(timer); };
  });
</script>

<dialog bind:this={dialog} aria-labelledby="overlap-files-title" oncancel={(e) => { e.preventDefault(); onclose(); }}>
  <header>
    <div><p class="scope">方案 · {profile.name}</p><h2 id="overlap-files-title">重叠文件</h2></div>
    <button class="icon-btn" aria-label="关闭重叠文件" onclick={onclose}><X size={17} /></button>
  </header>
  <label class="find">
    <Search size={16} />
    <input bind:this={search} aria-label="搜索包内文件路径" placeholder="搜索文件名或包内路径"
      value={query} oninput={(e) => find(e.currentTarget.value)} />
    {#if query}<button class="icon-btn" aria-label="清空文件搜索" onclick={() => { find(''); search.focus(); }}><X size={14} /></button>{/if}
  </label>
  <div class="results" bind:this={list}>
    {#if error}
      <div class="empty" role="alert"><p>{error}</p><button class="btn sm" onclick={() => { error = ''; retry++; }}>重试</button></div>
    {:else if loading || !result}
      <p class="empty" role="status">正在读取重叠文件…</p>
    {:else if !result.files.length}
      <p class="empty">{query.trim() ? '没有匹配这个路径的重叠文件' : '这个方案里没有重叠文件'}</p>
    {:else}
      {#each result.files as file (file.path)}
        {@const slash = file.path.lastIndexOf('/')}
        <details>
          <summary title={file.path}>
            <ChevronRight size={15} class="disclosure" />
            <span class="path"><strong>{file.path.slice(slash + 1)}</strong><span class="dir mono">{file.path.slice(0, slash + 1) || '包根目录'}</span></span>
            <span class="count">{file.modIds.length} 个 Mod</span>
          </summary>
          <ul>
            {#each file.modIds as id (id)}
              {@const m = mods.get(id)}
              <li>
                <button class="provider" onclick={() => onmod(id)} title={`查看 ${m?.title ?? id} 的详情`}>
                  <span><b>{m?.title ?? id}</b><small class="mono">{m?.file ?? id}</small></span><ChevronRight size={14} />
                </button>
                {#if /^sound\/.+\.(wav|mp3)$/i.test(file.path)}
                  {@const playing = player.isOn(id, file.path)}
                  <button class="btn sm ghost" aria-label={`${playing ? '停止' : '试听'} ${m?.title ?? id}`} onclick={() => play(id, file.path)}>
                    {#if playing}<Square size={13} />停止{:else}<Volume2 size={14} />试听{/if}
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        </details>
      {/each}
    {/if}
  </div>
  <footer>
    <span role="status">{result ? `${query.trim() ? '找到' : '共'} ${result.total} 个重叠文件` : ''}</span>
    {#if pages > 1}
      <nav aria-label="重叠文件分页">
        <button class="btn sm ghost" disabled={page === 0} onclick={() => go(page - 1)}>上一页</button>
        <span class="mono">{page + 1} / {pages}</span>
        <button class="btn sm ghost" disabled={page + 1 >= pages} onclick={() => go(page + 1)}>下一页</button>
      </nav>
    {/if}
  </footer>
</dialog>

<style>
  dialog { width: min(640px, calc(100vw - 32px)); height: min(560px, 84vh); max-height: 100%; padding: 0; color: var(--fg); background: var(--bg-1); border: 1px solid var(--line); border-radius: 16px; }
  dialog[open] { display: flex; flex-direction: column; }
  dialog::backdrop { background: rgb(0 0 0 / .45); }
  header, footer, nav, summary, .find, li, .provider { display: flex; align-items: center; }
  header, footer { justify-content: space-between; gap: 12px; }
  header { padding: 20px 22px 14px; }
  .scope { margin: 0 0 3px; color: var(--fg-3); font-size: 13px; overflow-wrap: anywhere; }
  h2 { margin: 0; font-size: 21px; line-height: 1.4; }
  .find { gap: 8px; flex: none; margin: 0 20px 12px; padding: 0 10px; border-radius: 10px; background: var(--md-surface-container-high); color: var(--fg-3); }
  .find:focus-within { outline: 1px solid var(--md-primary); }
  .find input { min-width: 0; flex: 1; height: 35px; padding: 0; border: 0; outline: 0; background: transparent; }
  .results { flex: 1; min-height: 0; overflow: auto; padding: 0 16px; }
  details + details { border-top: 1px solid var(--line-soft); }
  summary { list-style: none; gap: 10px; padding: 9px 6px; cursor: pointer; border-radius: 6px; }
  summary::-webkit-details-marker { display: none; }
  summary:hover, .provider:hover { background: var(--hover); }
  summary :global(.disclosure) { flex: none; color: var(--fg-3); }
  details[open] :global(.disclosure) { transform: rotate(90deg); }
  .path, .provider span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  strong, b { display: block; font-size: 14px; font-weight: 550; }
  .dir, small { display: block; font-size: 12px; color: var(--fg-3); }
  .count { flex: none; color: var(--fg-2); font-size: 13px; }
  ul { margin: 0 0 12px 23px; padding: 0 0 0 10px; border-left: 2px solid var(--md-secondary-container); }
  li { gap: 8px; }
  .provider { flex: 1; min-width: 0; gap: 4px; text-align: left; padding: 6px; border-radius: 6px; }
  .provider :global(svg) { flex: none; color: var(--fg-3); }
  .empty { padding: 32px 12px; color: var(--fg-3); text-align: center; }
  footer { min-height: 46px; padding: 6px 20px; border-top: 1px solid var(--line-soft); color: var(--fg-3); font-size: 13px; }
  nav { gap: 6px; white-space: nowrap; }
</style>
