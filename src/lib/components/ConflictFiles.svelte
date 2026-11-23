<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Box from '@lucide/svelte/icons/box';
  import Check from '@lucide/svelte/icons/check';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import File from '@lucide/svelte/icons/file';
  import FileAudio from '@lucide/svelte/icons/file-audio';
  import FileCode from '@lucide/svelte/icons/file-code';
  import Image from '@lucide/svelte/icons/image';
  import Layers from '@lucide/svelte/icons/layers';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Package from '@lucide/svelte/icons/package';
  import Search from '@lucide/svelte/icons/search';
  import Square from '@lucide/svelte/icons/square';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import X from '@lucide/svelte/icons/x';
  import ModThumb from './ModThumb.svelte';
  import { errorText } from '../api/bridge';
  import { defaultReviewView, disableConflictProvider, readConflictReviews, setConflictReviewed, type ReviewFile, type ReviewPage, type ReviewView } from '../mods/conflict-reviews';
  import { app } from '../stores/app.svelte';
  import { player } from '../stores/player.svelte';
  import type { Profile } from '../types';

  let { profile, initialModId, initialView, onclose, onmod }: {
    profile: Profile; initialModId?: string; initialView: ReviewView; onclose: () => void; onmod: (id: string) => void;
  } = $props();

  const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const directory = (path: string) => path.slice(0, path.lastIndexOf('/') + 1) || '包根目录';
  const canPreview = (path: string) => /^sound\/.+\.(wav|mp3)$/i.test(path);
  function fileKind(path: string) {
    if (path.startsWith('sound/')) return { name: '声音', key: 'audio', icon: FileAudio };
    if (path.startsWith('materials/')) return { name: '材质', key: 'material', icon: Image };
    if (path.startsWith('models/')) return { name: '模型', key: 'model', icon: Box };
    if (path.startsWith('scripts/')) return { name: '脚本', key: 'script', icon: FileCode };
    return { name: '资源', key: 'other', icon: File };
  }

  let workspace: HTMLElement, heading: HTMLHeadingElement, search: HTMLInputElement;
  let list = $state<HTMLUListElement>(), detailHeading = $state<HTMLHeadingElement>();
  let detailBody = $state<HTMLDivElement>(), compactBack = $state<HTMLButtonElement>();
  let query = $state(''), view = $state(untrack(() => initialView)), page = $state(0), refresh = $state(0);
  let error = $state(''), loading = $state(true), saving = $state(false), clearFocus = $state(false);
  let selectedPath = $state(''), inspecting = $state(false);
  let feedback = $state<{ text: string; error?: boolean } | null>(null);
  let result = $state.raw<ReviewPage | null>(null);
  const views = ['pending', 'overlap', 'reviewed'] as const;
  const viewLabels = { pending: '冲突', overlap: '重叠', reviewed: '已确认' } satisfies Record<ReviewView, string>;
  const alternate = $derived(defaultReviewView(result?.counts));
  const focusMod = $derived(clearFocus ? undefined : initialModId);
  const scope = $derived({ gameRoot: app.game.root, profileId: profile.id });
  const pages = $derived(result ? Math.ceil(result.total / result.pageSize) : 0);
  const mods = $derived(new Map(app.mods.map(m => [m.id, m])));
  const file = $derived(result?.files.find(row => row.path === selectedPath));
  const locked = $derived(saving || !!app.busy);

  let audition: { id: string; path: string } | undefined;
  function stopPreview() {
    if (audition && player.isOn(audition.id, audition.path)) player.stop();
    audition = undefined;
  }
  onMount(() => {
    heading.focus({ preventScroll: true });
    return stopPreview;
  });

  function play(id: string, path: string) {
    audition = { id, path };
    void player.play(id, path);
  }
  function selectPath(path: string) {
    if (path === selectedPath) return;
    stopPreview();
    selectedPath = path;
    if (detailBody) detailBody.scrollTop = 0;
  }
  function showFile(path: string) {
    selectPath(path); inspecting = true;
    void tick().then(() => {
      if (compactBack?.getClientRects().length) detailHeading?.focus({ preventScroll: true });
    });
  }
  function focusSelected() {
    void tick().then(() => (list?.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? search)?.focus());
  }
  function backToFiles() {
    inspecting = false; stopPreview();
    focusSelected();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || app.confirmation || !workspace?.contains(e.target as Node)) return;
    e.preventDefault();
    if (inspecting && compactBack?.getClientRects().length) backToFiles();
    else onclose();
  }
  function moveSelection(e: KeyboardEvent, index: number) {
    const count = result?.files.length ?? 0;
    if (!count || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const next = Math.min(count - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)));
    if (next === index) return;
    selectPath(result!.files[next].path);
    focusSelected();
  }
  function go(next: number) {
    page = next; loading = true; error = ''; selectedPath = ''; inspecting = false;
    if (list) list.scrollTop = 0;
    stopPreview();
  }
  function find(text: string) {
    if (text === query) return;
    query = text; feedback = null; go(0);
  }
  function changeView(next: ReviewView) {
    if (view === next) return;
    view = next; feedback = null; go(0);
  }
  async function retry() {
    error = ''; loading = true;
    await app.refresh();
    refresh++;
  }

  async function review(row: ReviewFile) {
    if (locked || view === 'overlap') return;
    const accepted = view === 'pending';
    const request = scope;
    saving = true; feedback = null;
    try {
      const { summary } = await setConflictReviewed(request, row, accepted);
      app.acceptConflictReview(request, summary);
      if (audition?.path === row.path) stopPreview();
      feedback = { text: basename(row.path) + (accepted ? ' · 已确认共存' : ' · 已移回冲突') };
      refresh++;
    } catch (e) {
      feedback = { text: errorText(e), error: true };
      refresh++;
    } finally { saving = false; }
  }
  async function disable(row: ReviewFile, id: string) {
    if (locked || !profile.modIds.includes(id)) return;
    const title = mods.get(id)?.title ?? id;
    saving = true; feedback = null;
    try {
      const saved = await app.perform('保存 Mod 方案', () => disableConflictProvider(scope, row, id));
      feedback = saved === undefined
        ? { text: app.error || '方案未保存，请稍后再试。', error: true }
        : { text: '已在当前方案停用「' + title + '」。' };
      if (saved !== undefined && audition?.id === id) stopPreview();
      refresh++;
    } finally { saving = false; }
  }

  $effect(() => {
    const request = scope, state = view, term = query, current = page, modId = focusMod;
    app.checkedAt; refresh;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const next = await readConflictReviews(request, state, term, current, modId);
        if (!live) return;
        const last = Math.max(0, Math.ceil(next.total / next.pageSize) - 1);
        if (current > last) { go(last); return; }
        // Keep the selected file across scans. When handled, continue at the same position.
        if (!next.files.some(row => row.path === selectedPath)) {
          const index = result?.files.findIndex(row => row.path === selectedPath) ?? 0;
          selectPath(next.files[Math.max(0, Math.min(index, next.files.length - 1))]?.path ?? '');
          if (!selectedPath) inspecting = false;
        }
        result = next; error = ''; loading = false;
      } catch (e) {
        if (live) { error = errorText(e); result = null; loading = false; }
      }
    }, term ? 100 : 0);
    return () => { live = false; clearTimeout(timer); };
  });
</script>

<svelte:window onkeydown={onKey} />

<section bind:this={workspace} class="review" aria-labelledby="overlap-title">
  <header class="intro">
    <button class="back" onclick={onclose}><ArrowLeft size={15} />返回 Mod</button>
    <div class="headline">
      <span class="mark" aria-hidden="true"><Layers size={20} /></span>
      <div class="hl-text">
        <div class="h-row">
          <h2 id="overlap-title" bind:this={heading} tabindex="-1">资源检查</h2>
          <span class="scope" title={'方案：' + profile.name}>{profile.name}</span>
        </div>
        <p title="依据 VPK 目录记录的文件大小和 CRC32">同路径、内容不同是冲突；同路径、内容相同是重叠。</p>
      </div>
    </div>
  </header>

  <div class="toolbar">
    <div class="views" role="group" aria-label="资源分类">
      {#each views as tab (tab)}
        <button aria-pressed={view === tab} disabled={saving} onclick={() => changeView(tab)}>
          <i class={'state-dot ' + tab}></i>{viewLabels[tab]}{#if result}<span class="number mono">{result.counts[tab]}</span>{/if}
        </button>
      {/each}
    </div>
    <div class="filters">
      {#if focusMod}
        <button class="focus-chip" aria-label="清除 Mod 筛选" title={'仅看 ' + (mods.get(focusMod)?.title ?? focusMod) + ' · 点击查看整个方案'}
          disabled={saving} onclick={() => { clearFocus = true; go(0); search.focus(); }}>
          <span>仅看 {mods.get(focusMod)?.title ?? focusMod}</span><X size={13} />
        </button>
      {/if}
      <div class="find">
        <Search size={16} aria-hidden="true" />
        <input bind:this={search} aria-label="搜索包内路径或 Mod" placeholder="搜索文件名、路径或 Mod"
          value={query} oninput={(e) => find(e.currentTarget.value)} />
        {#if query}<button class="icon-btn" aria-label="清空文件搜索" onclick={() => { find(''); search.focus(); }}><X size={14} /></button>{/if}
      </div>
    </div>
  </div>

  {#if feedback}
    <div class="notice" class:failed={feedback.error} role={feedback.error ? 'alert' : 'status'}>
      {#if !feedback.error}<Check size={15} aria-hidden="true" />{/if}{feedback.text}
    </div>
  {/if}

  {#if error}
    <div class="empty" role="alert"><h3>资源清单暂时读不到</h3><p>{error}</p><button class="btn" onclick={() => void retry()}>刷新重试</button></div>
  {:else if loading || !result}
    <div class="empty" role="status"><LoaderCircle size={22} class="spin" /><p>正在读取资源清单…</p></div>
  {:else if !result.files.length}
    <div class="empty">
      <span class="empty-icon" class:clear={!query.trim() && !focusMod}>{#if query.trim() || focusMod}<Search size={22} />{:else}<Check size={24} />{/if}</span>
      <h3 role="status">
        {#if query.trim() || focusMod}没有匹配的{viewLabels[view]}文件
        {:else if view === 'reviewed'}还没有共存确认
        {:else if view === 'overlap'}当前方案没有同内容的重叠
        {:else if result.counts.reviewed}当前冲突已确认共存
        {:else}当前方案没有资源冲突{/if}
      </h3>
      {#if query.trim()}
        <button class="btn ghost" onclick={() => { find(''); search.focus(); }}>清空搜索</button>
      {:else if focusMod}
        <button class="btn ghost" onclick={() => { clearFocus = true; go(0); search.focus(); }}>查看整个方案</button>
      {:else if alternate !== view && result.counts[alternate]}
        <button class="btn ghost" onclick={() => changeView(alternate)}>查看{viewLabels[alternate]} <ChevronRight size={15} /></button>
      {/if}
    </div>
  {:else}
    <div class="work-area" class:inspecting>
      <div class="file-pane">
        <div class="table-head" aria-hidden="true"><span>包内文件 · {result.total}</span><span>来源 Mod</span></div>
        <ul class="file-list" aria-label={viewLabels[view] + '文件'} bind:this={list}>
          {#each result.files as row, index (row.path)}
            {@const kind = fileKind(row.path)}
            {@const dir = directory(row.path)}
            <!-- 清单按路径排好序：同目录的文件归到一个小标题下，行里只写文件名 -->
            {#if index === 0 || directory(result.files[index - 1].path) !== dir}
              <li class="dir" role="presentation"><span class="mono" title={dir}>{dir}</span></li>
            {/if}
            <li>
              <button class="file-row" aria-current={row.path === selectedPath ? 'true' : undefined}
                tabindex={row.path === selectedPath ? 0 : -1} title={row.path} aria-label={row.path + '，' + row.modIds.length + ' 个来源'}
                onclick={() => showFile(row.path)} onkeydown={(e) => moveSelection(e, index)}>
                <span class="file-icon" data-kind={kind.key}><kind.icon size={15} aria-hidden="true" /></span>
                <span class="file-label">
                  <strong class="mono">{basename(row.path)}</strong>
                </span>
                <span class="owners" aria-label={row.modIds.length + ' 个来源'}>
                  {#each row.modIds.slice(0, 3) as id, i (id)}
                    {@const m = mods.get(id)}
                    <span class="face" style:z-index={3 - i}>{#if m}<ModThumb mod={m} />{/if}</span>
                  {/each}
                  {#if row.modIds.length > 3}<span class="more mono">+{row.modIds.length - 3}</span>{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
        {#if pages > 1}
          <nav class="pagination" aria-label="资源文件分页">
            <span class="page-count">共 <b class="mono">{result.total}</b> 条</span>
            <button class="icon-btn" aria-label="上一页" disabled={page === 0} onclick={() => go(page - 1)}><ChevronLeft size={18} /></button>
            <span class="mono">{page + 1} / {pages}</span>
            <button class="icon-btn" aria-label="下一页" disabled={page + 1 >= pages} onclick={() => go(page + 1)}><ChevronRight size={18} /></button>
          </nav>
        {/if}
      </div>

      {#if file}
        {@const kind = fileKind(file.path)}
        <article class="inspector" aria-labelledby="selected-overlap">
          <div class="inspector-body" bind:this={detailBody}>
            <button class="back detail-back" bind:this={compactBack} onclick={backToFiles}><ArrowLeft size={15} />返回文件</button>
            <div class="file-card">
              <span class="file-icon large" data-kind={kind.key}><kind.icon size={24} aria-hidden="true" /></span>
              <div class="file-title">
                <h3 class="mono" id="selected-overlap" bind:this={detailHeading} tabindex="-1">{basename(file.path)}</h3>
                <p class="full-path mono">{file.path}</p>
                <div class="facts">
                  <span class="fact" data-kind={kind.key}>{kind.name}文件</span>
                  <span class="fact">{file.modIds.length} 个 Mod 提供</span>
                  <span class="fact" class:different={view === 'pending'}
                    title={file.contentVersions > 1 ? '文件大小或 CRC32 不同' : '文件大小与 CRC32 一致'}>
                    {file.contentVersions > 1 ? file.contentVersions + ' 种内容' : '内容相同'}
                  </span>
                  {#if view === 'reviewed'}<span class="fact ok"><Check size={12} />已确认共存</span>{/if}
                </div>
              </div>
            </div>

            <div class="source-head"><h4>提供此文件的 Mod</h4><span>点名称查看详情</span></div>
            <ul class="provider-list" aria-label="提供此文件的 Mod">
              {#each file.modIds as id (id)}
                {@const m = mods.get(id)}
                {@const enabled = profile.modIds.includes(id)}
                <li class="provider-row">
                  <button class="provider" onclick={() => onmod(id)} aria-label={'查看 ' + (m?.title ?? id) + ' 详情'}>
                    <span class="provider-art">{#if m}<ModThumb mod={m} />{:else}<Package size={18} />{/if}</span>
                    <span class="provider-text"><b>{m?.title ?? id}</b><small class="mono">{m?.file ?? id}</small></span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                  <div class="provider-actions">
                    {#if canPreview(file.path)}
                      {@const playing = player.isOn(id, file.path)}
                      <button class="pill listen" class:playing aria-label={(playing ? '停止 ' : '试听 ') + (m?.title ?? id)} onclick={() => play(id, file!.path)}>
                        {#if playing}<Square size={11} fill="currentColor" />停止{:else}<Volume2 size={15} />试听{/if}
                      </button>
                    {/if}
                    {#if view !== 'overlap'}
                      <button class="pill disable" title={enabled ? '仅在当前方案停用整个 Mod' : '已不在当前方案'} aria-label={'方案停用 ' + (m?.title ?? id)}
                        disabled={locked || !enabled} onclick={() => void disable(file!, id)}>{enabled ? '停用' : '已停用'}</button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
            {#if view !== 'overlap'}<p class="scheme-note">停用只改当前方案，下次用这个方案启动时生效。</p>{/if}
          </div>
          {#if view !== 'overlap'}
            <div class="resolution" class:done={view === 'reviewed'}>
              {#if view === 'pending'}
                <div><strong>都保留</strong><p>确认共存后移到「已确认」，各 Mod 的启用状态不变。</p></div>
                <button class="btn primary decide" disabled={locked} onclick={() => void review(file!)}><Check size={16} />确认共存</button>
              {:else}
                <div><strong><Check size={15} />已确认共存</strong><p>撤销后，这个文件会回到「冲突」。</p></div>
                <button class="btn decide" disabled={locked} onclick={() => void review(file!)}>撤销确认</button>
              {/if}
            </div>
          {/if}
        </article>
      {/if}
    </div>
  {/if}
</section>

<style>
  .review {
    flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
    container: overlap / inline-size; --gutter: clamp(18px, 3cqw, 36px);
    --rule: color-mix(in srgb, var(--md-outline-variant) 50%, transparent);
    --pane: var(--md-surface-container-low);
    background: var(--pane); color: var(--fg);
  }
  .intro, .toolbar, .notice { padding-inline: var(--gutter); }
  button:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
  button:disabled { cursor: default; opacity: .55; }
  .scope, .focus-chip span, .file-label > *, .provider-text > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ---------- 页头：返回 + 图标章 + 标题/方案 + 一句话 ---------- */
  .intro { flex: none; padding-block: 12px 16px; }
  .back { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 6px; margin-inline-start: -6px; border-radius: 8px; color: var(--fg-2); font-size: 13px; white-space: nowrap; transition: background var(--dur), color var(--dur); }
  .back:hover { color: var(--fg); background: var(--hover); }
  .headline { display: flex; align-items: center; gap: 12px; min-width: 0; margin-top: 10px; }
  .mark { flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 13px; background: var(--md-tertiary-container); color: var(--md-on-tertiary-container); }
  .hl-text { min-width: 0; }
  .h-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .h-row h2 { margin: 0; font: 700 22px/1.25 var(--font-display); letter-spacing: .02em; white-space: nowrap; }
  .h-row h2:focus, .file-title h3:focus { outline: none; }
  .scope { max-width: 240px; height: 22px; line-height: 22px; padding: 0 9px; border-radius: 11px; background: var(--hover); color: var(--fg-2); font-size: 12px; }
  .hl-text p { margin: 3px 0 0; font-size: 13px; color: var(--fg-2); }

  /* ---------- 工具条：分段切换 + 筛选 ---------- */
  .toolbar { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding-block: 0 12px; border-bottom: 1px solid var(--rule); }
  .views { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--md-surface-container-high); }
  .views button { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--fg-2); transition: background var(--dur), color var(--dur); }
  .views button:hover:not(:disabled) { color: var(--fg); }
  .views button[aria-pressed="true"] { background: var(--md-surface-container-highest); color: var(--fg); box-shadow: 0 1px 3px rgb(0 0 0 / .16); }
  .views button:disabled { opacity: 1; }
  .state-dot { flex: none; width: 7px; height: 7px; border-radius: 99px; }
  .state-dot.pending { background: var(--md-error); }
  .state-dot.overlap { background: var(--md-outline); }
  .state-dot.reviewed { background: var(--md-primary); }
  .number { min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--hover); text-align: center; font-size: 11.5px; line-height: 18px; color: var(--fg-2); }
  .filters { display: flex; align-items: center; min-width: 0; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  /* 搜索：填充胶囊，和服务器页、Mod 页的筛选条一致 */
  .find { display: flex; align-items: center; flex: 1; width: clamp(220px, 26cqw, 320px); min-width: 0; gap: 8px; height: 34px; padding: 0 6px 0 12px; border: 1px solid transparent; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); color: var(--fg-3); transition: border-color var(--dur), background var(--dur); }
  .find:focus-within { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); background: color-mix(in srgb, var(--md-surface-bright) 85%, transparent); }
  .find > :global(svg) { flex: none; }
  .find input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; background: transparent; font-size: 13px; color: var(--fg); }
  .find input::placeholder { color: var(--fg-3); }
  .focus-chip { display: inline-flex; align-items: center; min-width: 0; max-width: min(260px, 100%); gap: 6px; height: 30px; padding: 0 9px 0 12px; border-radius: 15px; background: color-mix(in srgb, var(--md-tertiary-container) 75%, transparent); color: var(--md-on-tertiary-container); font-size: 12.5px; transition: filter var(--dur); }
  .focus-chip:hover:not(:disabled) { filter: brightness(1.1); }
  .focus-chip :global(svg), .notice :global(svg) { flex: none; }
  .notice { flex: none; display: flex; align-items: center; min-height: 34px; padding-block: 6px; gap: 8px; background: color-mix(in srgb, var(--md-primary) 12%, var(--pane)); color: var(--md-primary); font-size: 13px; overflow-wrap: anywhere; }
  .notice.failed { color: var(--danger); background: color-mix(in srgb, var(--md-error) 10%, var(--pane)); }

  /* ---------- 左：文件清单 ---------- */
  .work-area { flex: 1; min-height: 0; min-width: 0; display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.2fr); }
  .file-pane, .inspector { min-height: 0; min-width: 0; display: flex; flex-direction: column; }
  .file-pane { border-inline-end: 1px solid var(--rule); }
  .table-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px 6px var(--gutter); color: var(--fg-3); font-size: 12px; }
  .file-list, .provider-list { margin: 0; padding: 0; list-style: none; }
  .file-list { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; padding: 0 6px 14px calc(var(--gutter) - 10px); display: flex; flex-direction: column; gap: 1px; }
  /* 目录小标题：等宽小字 + 一条细线，同目录的文件挂在下面 */
  .dir { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 12px 10px 5px; color: var(--fg-3); font-size: 11.5px; }
  .dir:first-child { padding-top: 4px; }
  .dir span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dir::after { content: ''; flex: 1; min-width: 12px; height: 1px; background: var(--rule); }
  /* 行底色用实色，叠放的来源缩略图描边才能和底色对上 */
  .file-row {
    --row: var(--pane);
    position: relative; width: 100%; min-width: 0; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center; gap: 10px; min-height: 42px; padding: 6px 10px; border-radius: 10px; line-height: 1.4;
    background: var(--row); text-align: left; transition: background var(--dur);
  }
  .file-row:hover { --row: color-mix(in srgb, var(--md-on-surface) 6%, var(--pane)); }
  .file-row:focus-visible { outline-offset: -2px; }
  .file-row[aria-current="true"] { --row: color-mix(in srgb, var(--md-primary) 13%, var(--pane)); }
  .file-row[aria-current="true"]::before { content: ''; position: absolute; inset: 11px auto 11px 0; width: 3px; border-radius: 3px; background: var(--md-primary); }
  /* 文件类型：一种类型一个色相，浅底 + 同色图标，不再用整块容器色 */
  .file-icon { --k: var(--fg-3); width: 28px; height: 28px; display: grid; place-items: center; flex: none; border-radius: 8px; background: color-mix(in srgb, var(--k) 15%, transparent); color: var(--k); }
  [data-kind="audio"] { --k: var(--md-tertiary); }
  [data-kind="script"] { --k: color-mix(in oklab, var(--md-tertiary) 55%, var(--md-primary)); }
  [data-kind="material"] { --k: var(--md-secondary); }
  [data-kind="model"] { --k: var(--md-primary); }
  .file-label { min-width: 0; }
  .file-label strong, .provider-text b { display: block; font-size: 13.5px; font-weight: 600; color: var(--fg); }
  .file-row[aria-current="true"] .file-label strong { color: var(--md-primary); }
  .provider-text small { display: block; color: var(--fg-3); font-size: 12px; }
  .owners { display: inline-flex; align-items: center; padding-left: 7px; }
  .face { position: relative; flex: none; width: 24px; height: 24px; margin-left: -7px; border-radius: 7px; overflow: hidden; background: var(--md-surface-container-high); box-shadow: 0 0 0 2px var(--row); transition: margin var(--dur) var(--ease-out); }
  /* 悬停时叠放的来源头像散开一点，看得出是几个 Mod */
  .file-row:hover .face:not(:first-child) { margin-left: -3px; }
  .more { margin-left: 5px; font-size: 11px; color: var(--fg-3); }
  .pagination { display: flex; align-items: center; min-height: 46px; gap: 8px; padding: 0 14px 0 var(--gutter); border-top: 1px solid var(--rule); color: var(--fg-2); }
  .page-count { flex: 1; }

  /* ---------- 右：选中文件 ---------- */
  .inspector { background: var(--md-surface-container); }
  .inspector-body { flex: 0 1 auto; min-height: 0; padding: clamp(16px, 2.4cqw, 28px) var(--gutter) 16px; overflow: auto; }
  /* 文件头：不再单独垫一张卡，直接放在检查区上，底下一条细线和来源分开 */
  .file-card { display: flex; align-items: center; gap: 16px; padding: 2px 0 22px; border-bottom: 1px solid var(--rule); }
  .file-icon.large { width: 60px; height: 60px; border-radius: 18px; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--k) 22%, transparent); }
  .file-title { flex: 1; min-width: 0; }
  .file-title h3 { margin: 0; font-size: clamp(17px, 2.1cqw, 22px); line-height: 1.3; font-weight: 650; overflow-wrap: anywhere; }
  .full-path { margin: 3px 0 0; font-size: 12.5px; color: var(--fg-3); overflow-wrap: anywhere; user-select: text; }
  .facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .fact { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 11px; background: var(--hover); color: var(--fg-2); font-size: 12px; }
  .fact[data-kind] { background: color-mix(in srgb, var(--k) 15%, transparent); color: var(--k); }
  .fact.ok { background: color-mix(in srgb, var(--md-primary) 16%, transparent); color: var(--md-primary); }
  .fact.different { background: color-mix(in srgb, var(--md-error) 16%, transparent); color: var(--md-error); }

  .source-head { display: flex; align-items: baseline; gap: 8px; margin: 20px 0 6px; }
  .source-head h4 { margin: 0; font-size: 14px; font-weight: 600; }
  .source-head span { margin-left: auto; font-size: 12px; color: var(--fg-3); }
  /* 来源列表：不垫底色，行之间细线分隔 */
  .provider-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 0; }
  .provider-row + .provider-row { border-top: 1px solid var(--rule); }
  .provider { flex: 1 1 160px; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 4px 8px 4px 4px; margin-left: -4px; border-radius: 12px; text-align: left; transition: background var(--dur); }
  .provider:hover { background: var(--hover); }
  .provider > :global(svg) { flex: none; color: var(--fg-3); opacity: 0; transform: translate(-3px, 3px); transition: opacity var(--dur), color var(--dur), transform 200ms var(--ease-out); }
  .provider:hover > :global(svg), .provider:focus-visible > :global(svg) { opacity: 1; color: var(--md-primary); transform: none; }
  .provider-art { position: relative; flex: none; width: 48px; height: 48px; display: grid; place-items: center; overflow: hidden; border-radius: 13px; background: var(--md-surface-container-highest); color: var(--fg-2); box-shadow: 0 6px 14px -10px rgb(0 0 0 / .7); }
  .provider-text { flex: 1; min-width: 0; }
  .provider-actions { display: flex; align-items: center; gap: 6px; margin-inline-start: auto; }
  .pill { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 15px; font-size: 13px; font-weight: 500; white-space: nowrap; transition: background var(--dur), color var(--dur), border-color var(--dur); }
  .listen { background: var(--md-surface-container-highest); color: var(--fg); }
  .listen:hover { background: color-mix(in srgb, var(--md-on-surface) 10%, var(--md-surface-container-highest)); }
  .listen.playing { background: var(--md-tertiary-container); color: var(--md-on-tertiary-container); }
  .disable { border: 1px solid var(--line-strong); color: var(--fg-2); }
  .disable:hover:not(:disabled) { background: var(--md-error-container); border-color: transparent; color: var(--md-on-error-container); }
  .scheme-note { margin: 10px 2px 0; font-size: 12px; color: var(--fg-3); }

  /* 底部决定条：整页唯一一块实色重点，主色只用在这里 */
  .resolution {
    flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 14px;
    margin: 4px var(--gutter) 18px; padding: 12px 12px 12px 18px; border-radius: 16px;
    background: var(--md-primary-container); color: var(--md-on-primary-container);
  }
  .resolution.done { background: var(--md-surface-container-high); color: var(--fg); }
  .resolution > div { min-width: 0; }
  .resolution strong { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 650; }
  .resolution.done strong { color: var(--md-primary); }
  .resolution p { margin: 2px 0 0; color: color-mix(in srgb, currentColor 72%, transparent); font-size: 12.5px; }
  .decide { height: 38px; padding-inline: 16px; border-radius: 12px; font-size: 14px; font-weight: 600; box-shadow: 0 6px 16px -10px color-mix(in srgb, var(--md-primary) 90%, black); }
  .resolution.done .decide { box-shadow: none; }

  .empty { min-height: 0; flex: 1; overflow: auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; color: var(--fg-2); }
  .empty h3, .empty p { margin: 0; overflow-wrap: anywhere; }
  .empty h3 { color: var(--fg); font-size: 18px; font-weight: 600; }
  .empty-icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; color: var(--fg-2); background: var(--md-surface-container-high); }
  .empty-icon.clear { color: var(--md-on-primary-container); background: var(--md-primary-container); }
  .detail-back { display: none; }

  @container overlap (max-width: 670px) {
    .work-area { grid-template-columns: minmax(0, 1fr); }
    .work-area .inspector { display: none; }
    .work-area.inspecting .file-pane { display: none; }
    .work-area.inspecting .inspector { display: flex; }
    .detail-back { display: inline-flex; margin-bottom: 12px; }
    .intro { padding-block: 10px 12px; }
    .hl-text p { display: none; }
  }
  @container overlap (max-width: 460px) {
    .toolbar { align-items: stretch; flex-direction: column; }
    .views { align-self: flex-start; }
    .filters { justify-content: flex-start; }
    .file-card { gap: 12px; padding-bottom: 16px; }
    .file-icon.large { width: 48px; height: 48px; border-radius: 14px; }
    .scope { display: none; }
  }
</style>
