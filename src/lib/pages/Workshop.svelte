<script module lang="ts">
  import type { WorkshopPage, WorkshopQuery } from '../types';
  // 切到网页标签再回来时，保留上次的筛选、结果和滚动位置
  let cache: { query: WorkshopQuery; result: WorkshopPage; search: string; scroll: number } | null = null;
</script>

<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Search from '@lucide/svelte/icons/search';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Link from '@lucide/svelte/icons/link';
  import Layers from '@lucide/svelte/icons/layers';
  import Check from '@lucide/svelte/icons/check';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Inbox from '@lucide/svelte/icons/inbox';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import '../styles/discover.css';
  import { api } from '../api';
  import { errorText } from '../api/bridge';
  import { app, INBOX, mib } from '../stores/app.svelte';
  import { ratio } from '../stores/downloads.svelte';
  import { looksLikeWorkshop, looksLikeWorkshopId } from '../workshop';
  import { flyToDownloads } from '../motion';
  import type { WorkshopItem } from '../types';
  import WorkshopThumb from '../components/WorkshopThumb.svelte';
  import WorkshopDialog from '../components/WorkshopDialog.svelte';
  import DiscoverTabs from '../components/DiscoverTabs.svelte';
  import { support } from '../stores/support.svelte';

  const categories = [['', '全部'], ['Campaigns', '地图战役'], ['Survivors', '幸存者'], ['Weapons', '武器'],
    ['Special Infected', '特殊感染者'], ['Common Infected', '普通感染者'], ['Items', '物品'], ['Sounds', '声音'], ['Scripts', '脚本'], ['UI', '界面']];
  const sorts = [['trend', '本周热门'], ['mostrecent', '最新发布'], ['lastupdated', '最近更新'], ['totaluniquesubscribers', '最多订阅']] as const;
  let search = $state(cache?.search ?? '');
  let query = $state<WorkshopQuery>(cache?.query ?? { search: '', sort: 'trend', tag: '', kind: 'item', page: 1 });
  let result = $state<WorkshopPage | null>(cache?.result ?? null);
  let loading = $state(false), error = $state('');
  /** 只有新拿到的一页才播入场动画；从缓存恢复时不播 */
  let fresh = $state(false);
  let detail = $state<WorkshopItem | null>(null), detailLoading = $state(false), detailError = $state('');
  let dialog = $state<string | null>(null);
  let scroller = $state<HTMLDivElement>();
  const submitting = new SvelteSet<string>();
  let sequence = 0, detailSequence = 0;
  const inboxCount = $derived(app.mods.filter(m => app.isInbox(m.id)).length);
  const localMod = (item: WorkshopItem) => app.mods.find(m => m.workshopId === item.id);
  const activeTask = (item: WorkshopItem) => app.tasks.find(t => t.kind === 'download' && t.workshopId === item.id &&
    t.gameRoot.toLowerCase() === app.game.root.toLowerCase() && !['done', 'failed', 'canceled'].includes(t.state));
  const date = (value: string) => value ? value.slice(0, 10) : '—';
  const count = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n.toLocaleString('zh-CN');
  const label = $derived(query.search ? `“${query.search}”` : categories.find(([tag]) => tag === query.tag)?.[1]);

  async function browse(change: Partial<WorkshopQuery> = {}) {
    const request = ++sequence;
    query = { ...query, ...change }; loading = true; error = ''; result = null;
    scroller?.scrollTo({ top: 0 });
    try { const data = await api.workshopBrowse({ ...query }); if (sequence === request) { result = data; fresh = true; } }
    catch (e) { if (sequence === request) error = errorText(e); }
    finally { if (sequence === request) loading = false; }
  }
  function submit() {
    if (looksLikeWorkshop(search) || looksLikeWorkshopId(search)) { dialog = search; return; }
    void browse({ search: search.trim(), page: 1 });
  }
  async function show(item: WorkshopItem) {
    const request = ++detailSequence;
    detail = item; detailLoading = true; detailError = '';
    try { const full = await api.workshopDetail(item.id); if (request === detailSequence) detail = { ...item, ...full }; }
    catch (e) { if (request === detailSequence) detailError = errorText(e); }
    finally { if (request === detailSequence) detailLoading = false; }
  }
  function back() { detailSequence++; detail = null; detailLoading = false; detailError = ''; }
  function goLibrary() { app.modFilter.category = INBOX; app.modFilter.q = ''; app.route = 'mods'; }
  async function download(item: WorkshopItem, source?: Element | null) {
    if (item.kind === 'collection') { dialog = item.workshopUrl; return; }
    if (!item.downloadable || localMod(item) || activeTask(item) || submitting.has(item.id)) return;
    submitting.add(item.id);
    support.author(`steam:${item.id}`, item.authorName);
    try { if (await app.downloadWorkshop([item.id])) flyToDownloads(source); }
    finally { submitting.delete(item.id); }
  }
  function openSteam(id?: string) { void api.workshopOpen(id).catch(e => app.toast(errorText(e))); }
  onMount(() => {
    if (cache) { const top = cache.scroll; void tick().then(() => scroller?.scrollTo({ top })); }
    else void browse();
  });
  onDestroy(() => {
    sequence++; detailSequence++;
    if (result) cache = { query: $state.snapshot(query), result: $state.snapshot(result) as WorkshopPage, search, scroll: scroller?.scrollTop ?? 0 };
  });
</script>

{#snippet action(item: WorkshopItem, large = false, source?: () => Element | null)}
  {@const task = activeTask(item)}
  {#if localMod(item)}
    <span class="owned"><Check size={13} />已在库</span>
  {:else if item.kind === 'collection' && !item.error}
    <button class="dl" class:large data-sfx="open" onclick={() => download(item)}><Layers size={14} />选择内容</button>
  {:else if task || submitting.has(item.id)}
    {@const r = task ? ratio(task) : null}
    <span class="dl busy" class:large class:indet={r === null} role="status" aria-label="下载进度">
      <span class="fill" style:transform="scaleX({r ?? 0})"></span>
      <span class="txt">{#if !task || task.state === 'queued'}<LoaderCircle size={12} class="spin" />排队中{:else if task.state === 'verifying'}校验中{:else if r !== null}<span class="mono">{Math.floor(r * 100)}%</span>{:else}<LoaderCircle size={12} class="spin" />下载中{/if}</span>
    </span>
  {:else if item.downloadable}
    <button class="dl" class:large data-sfx="none" disabled={!app.game.installed} title={app.game.installed ? '下载到「新下载」' : '请先在主页选择游戏目录'} onclick={() => download(item, source?.())}><Download size={14} />下载{#if large}<span class="size mono">{mib(item.sizeBytes)}</span>{/if}</button>
  {:else}
    <button class="text-action" title={item.reason} onclick={() => openSteam(item.id)}>Steam 查看<ExternalLink size={12} /></button>
  {/if}
{/snippet}

<div class="workshop discover">
  <DiscoverTabs />

  {#if detail}
    <div class="detail-scroll">
      <button class="back" onclick={back}><ArrowLeft size={15} />返回浏览</button>
      <div class="detail-grid">
        <div class="detail-art"><WorkshopThumb item={detail} size="detail" /></div>
        <div class="detail-info">
          <span class="kicker">{detail.kind === 'collection' ? '合集' : '作品'}</span>
          <h2>{detail.title}</h2>
          <p class="author">{detail.authorName || `Steam 作者 ${detail.author}`}</p>
          <dl class="facts">
            <div><dt>更新于</dt><dd>{date(detail.updatedAt)}</dd></div>
            <div><dt>{detail.kind === 'collection' ? '条目' : '大小'}</dt><dd class="mono">{detail.kind === 'collection' ? `${detail.children?.length ?? '…'} 个` : mib(detail.sizeBytes)}</dd></div>
            {#if detail.subscriptions !== undefined}<div><dt>订阅</dt><dd class="mono">{count(detail.subscriptions)}</dd></div>{/if}
          </dl>
          {#if detail.tags?.length}<div class="tags">{#each detail.tags as tag}<span class="tag">{tag}</span>{/each}</div>{/if}
          <div class="detail-actions">{@render action(detail, true, () => document.querySelector('.detail-art'))}
            <button class="btn ghost" onclick={() => openSteam(detail!.id)}>Steam 原页面<ExternalLink size={13} /></button>
          </div>
          <p class="note">下载完成后放进「新下载」，由你选择加入方案。</p>
          {#if detail.reason && !detail.downloadable && detail.kind !== 'collection' && !localMod(detail)}<p class="reason">{detail.reason}</p>{/if}
        </div>
      </div>
      <section class="description">
        <h3>作品介绍</h3>
        {#if detailLoading}<p class="status"><LoaderCircle size={15} class="spin" />正在读取详情…</p>
        {:else if detailError}<p class="error" role="alert">{detailError}</p><button class="btn" onclick={() => show(detail!)}>重新读取</button>
        {:else}<p class="prose">{detail.description || '作者暂未填写介绍。'}</p>{/if}
      </section>
    </div>
  {:else}
    <div class="controls">
      <div class="top">
        <form class="search" onsubmit={(e) => { e.preventDefault(); submit(); }}>
          <Search size={15} /><input aria-label="搜索创意工坊" bind:value={search} maxlength="200" placeholder="搜索作品，或粘贴工坊链接 / ID" />
          {#if search}<kbd class="mono">Enter</kbd>{/if}
          <button class="paste" type="button" data-sfx="open" onclick={() => (dialog = '')}><Link size={14} />粘贴链接</button>
        </form>
        <button class="btn ghost" title="下载好的 Mod 先放在这里，整理后加入方案" onclick={goLibrary}><Inbox size={14} />新下载{#if inboxCount}<span class="num mono">{inboxCount}</span>{/if}</button>
      </div>
      <div class="filters">
        <div class="seg" role="radiogroup" aria-label="作品类型">
          <button role="radio" aria-checked={query.kind === 'item'} class:on={query.kind === 'item'} onclick={() => browse({ kind: 'item', page: 1 })}>作品</button>
          <button role="radio" aria-checked={query.kind === 'collection'} class:on={query.kind === 'collection'} onclick={() => browse({ kind: 'collection', page: 1 })}>合集</button>
        </div>
        <nav class="cats" aria-label="工坊分类">
          {#each categories as [tag, name] (tag)}
            <button class="chip" class:on={query.tag === tag} aria-pressed={query.tag === tag} onclick={() => browse({ tag, page: 1 })}>{name}</button>
          {/each}
        </nav>
        <span class="sort">
          <select aria-label="工坊排序" value={query.sort} onchange={(e) => browse({ sort: e.currentTarget.value as WorkshopQuery['sort'], page: 1 })}>
            {#each sorts as [value, name]}<option {value}>{name}</option>{/each}
          </select>
          <ChevronDown size={13} />
        </span>
      </div>
    </div>

    <div class="results" bind:this={scroller} aria-busy={loading}>
      {#if loading}
        <p class="result-line" role="status"><span>正在浏览 Steam 工坊…</span></p>
        <div class="grid" aria-hidden="true">
          {#each Array(8) as _, i (i)}<div class="work skeleton"><span class="art"></span><span class="line w80"></span><span class="line w40"></span></div>{/each}
        </div>
      {:else if error}
        <div class="empty"><h2>工坊暂时连接不上</h2><p class="error" role="alert">{error}</p><div class="empty-actions"><button class="btn" onclick={() => browse()}>重新加载</button><button class="btn ghost" onclick={() => openSteam()}>在 Steam 查看<ExternalLink size={13} /></button></div></div>
      {:else if result}
        <div class="result-line"><span>{label} <span class="muted">· {result.total.toLocaleString('zh-CN')} 项</span></span><span class="muted mono">{result.page} / {result.totalPages}</span></div>
        {#if !result.items.length}
          <div class="empty"><Search size={28} strokeWidth={1.25} /><h2>没有找到相关作品</h2><p>换个关键词，或试试「全部」分类。</p><button class="btn" onclick={() => { search = ''; void browse({ search: '', tag: '', page: 1 }); }}>清除筛选</button></div>
        {:else}
          <div class="grid" class:fresh>
            {#each result.items as item, i (item.id)}
              <article class="work" style:--i={Math.min(i, 11)}>
                <button class="art" data-art={item.id} aria-label={`查看 ${item.title}`} onclick={() => show(item)}>
                  <WorkshopThumb {item} />
                  {#if item.kind === 'collection'}<span class="badge"><Layers size={12} />合集</span>{/if}
                </button>
                <div class="info">
                  <button class="title" title={item.title} onclick={() => show(item)}><span>{item.title}</span></button>
                  <p class="byline" title={item.authorName || item.author}>{item.authorName || `Steam 作者 ${item.author}`}</p>
                  <div class="foot">
                    <span class="mono">{item.kind === 'collection' ? `${item.childCount ?? 0} 个条目` : item.subscriptions !== undefined ? `${count(item.subscriptions)} 订阅` : mib(item.sizeBytes)}</span>
                    {@render action(item, false, () => document.querySelector(`[data-art="${item.id}"]`))}
                  </div>
                </div>
              </article>
            {/each}
          </div>
          <div class="pagination">
            <button class="btn" disabled={result.page <= 1} onclick={() => browse({ page: query.page - 1 })}><ArrowLeft size={14} />上一页</button>
            <span class="mono">{result.page} / {result.totalPages}</span>
            <button class="btn" disabled={result.page >= result.totalPages} onclick={() => browse({ page: query.page + 1 })}>下一页<ArrowRight size={14} /></button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>
{#if dialog !== null}<WorkshopDialog initial={dialog} onclose={() => (dialog = null)} />{/if}

<style>
  .muted { color: var(--fg-3); }

  /* ---------- 搜索 + 筛选 ---------- */
  .top .search { padding-right: 5px; }
  .paste { position: relative; display: inline-flex; align-items: center; gap: 6px; flex: none; height: 28px; padding: 0 9px; border-radius: 9px; color: var(--fg-2); font-size: 12px; white-space: nowrap; transition: background var(--dur), color var(--dur); }
  .paste::before { content: ''; position: absolute; inset: 7px auto 7px -5px; width: 1px; background: var(--line); }
  .paste:hover { color: var(--fg); background: var(--hover); }
  .num { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--md-primary); color: var(--md-on-primary); font-size: 11px; }

  /* ---------- 结果 ---------- */
  .results { flex: 1; min-height: 0; overflow-y: auto; padding: 0 24px 28px; }
  .result-line { display: flex; justify-content: space-between; gap: 12px; margin: 0; padding: 14px 0 12px; font-size: 12px; color: var(--fg-2); }
  /* 工坊预览图基本是正方形：封面做成 1:1 铺满，不再左右留灰边（和 Mod 页卡片一致） */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
  .grid.fresh .work { animation: rise 320ms var(--ease-out) backwards; animation-delay: calc(var(--i) * 35ms); }
  .art { position: relative; display: block; width: 100%; aspect-ratio: 1; overflow: hidden; background: var(--md-surface-container-high); }
  .art :global(.thumb) { background: var(--md-surface-container-high); }
  .art :global(img) { object-fit: cover; transition: transform 360ms var(--ease-out); }
  @media (hover: hover) and (pointer: fine) { .work:hover .art :global(img) { transform: scale(1.04); } }
  .badge { position: absolute; left: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 8px; background: color-mix(in srgb, var(--md-surface) 88%, transparent); color: var(--fg); font-size: 11px; box-shadow: 0 2px 6px -2px rgb(0 0 0 / .3); }

  .pagination { display: flex; align-items: center; justify-content: center; gap: 20px; margin: 30px 0 8px; color: var(--fg-2); font-size: 12px; }
  .btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .empty { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 280px; padding: 35px 20px; text-align: center; color: var(--fg-3); }
  .empty h2 { font-size: 16px; font-weight: 500; margin: 16px 0 4px; color: var(--fg); }
  .empty p { margin: 6px 0 20px; max-width: 580px; }
  .empty-actions { display: flex; gap: 8px; }
  .error, .reason { color: var(--danger); overflow-wrap: anywhere; }

  /* ---------- 详情 ---------- */
  .detail-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 24px 40px; }
  .back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 18px; color: var(--fg-2); font-size: 13px; }
  .back:hover { color: var(--fg); }
  .detail-grid { display: grid; grid-template-columns: minmax(240px, 1.1fr) minmax(220px, 1fr); gap: 28px; align-items: start; animation: rise 260ms var(--ease-out); }
  .detail-art { aspect-ratio: 16 / 10; border: 1px solid var(--line-soft); border-radius: 16px; overflow: hidden; background: var(--md-surface-container-high); }
  .detail-info { min-width: 0; }
  .kicker { font: 11px var(--font-mono); letter-spacing: .08em; color: var(--fg-3); }
  .detail-info h2 { font-size: 22px; font-weight: 500; line-height: 1.35; margin: 8px 0 6px; overflow-wrap: anywhere; user-select: text; }
  .author { color: var(--fg-2); margin: 0 0 18px; overflow-wrap: anywhere; }
  .facts { display: flex; gap: 28px; margin: 0; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .facts div { display: flex; flex-direction: column; gap: 3px; }
  .facts dt { font-size: 11px; color: var(--fg-3); }
  .facts dd { margin: 0; font-size: 13px; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 14px 0 0; }
  .detail-actions { display: flex; align-items: center; gap: 8px; margin-top: 20px; }
  .note { font-size: 12px; color: var(--fg-3); margin: 12px 0 0; }
  .reason { font-size: 13px; }
  .description { border-top: 1px solid var(--line); margin-top: 28px; padding-top: 18px; }
  h3 { font-size: 14px; font-weight: 500; margin: 0 0 14px; }
  .prose { color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.85; user-select: text; max-width: 900px; }
  .status { display: flex; gap: 10px; color: var(--fg-2); align-items: center; }

  @media (max-width: 1100px) { .controls { padding: 14px 18px 0; } .results, .detail-scroll { padding-left: 18px; padding-right: 18px; } }
  @media (max-width: 860px) { .detail-grid { grid-template-columns: 1fr; } .detail-art { max-width: 560px; } }
  @media (prefers-reduced-motion: reduce) { .grid.fresh .work, .detail-grid, .dl.busy { animation: none; } .art :global(img) { transition: none; } }
</style>
