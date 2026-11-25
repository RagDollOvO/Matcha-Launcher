<script module lang="ts">
  import type { GmPage, GmQuery } from '../api/gamemaps';
  let cache: { query: GmQuery; result: GmPage; search: string; scroll: number } | null = null;
</script>

<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Search from '@lucide/svelte/icons/search';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Check from '@lucide/svelte/icons/check';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import MapIcon from '@lucide/svelte/icons/map';
  import Eye from '@lucide/svelte/icons/eye';
  import Heart from '@lucide/svelte/icons/heart';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import FileArchive from '@lucide/svelte/icons/file-archive';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import DiscoverTabs from '../components/DiscoverTabs.svelte';
  import GameMapsPicture from '../components/GameMapsPicture.svelte';
  import '../styles/discover.css';
  import { errorText } from '../api/bridge';
  import { gmApi, gmBlocked, gmMissing, gmUrl, GM_FLAG_LABEL, GM_HOME, type GmDetail, type GmItem, type GmSection, type GmSort } from '../api/gamemaps';
  import { app, mib } from '../stores/app.svelte';
  import { ratio } from '../stores/downloads.svelte';
  import { browser } from '../browser/browser.svelte';
  import { flyToDownloads } from '../motion';
  import { sfx } from '../sound/sfx.svelte';
  import { support } from '../stores/support.svelte';

  const CATS: Record<GmSection, [string, string][]> = {
    maps: [['', '全部'], ['campaign', '战役'], ['co-op', '合作'], ['survival', '生存'], ['versus', '对抗'], ['scavenge', '清道夫'], ['mutation', '突变'], ['mission', '任务'], ['other', '其他']],
    mods: [['', '全部'], ['weapons', '武器'], ['survivors', '生还者'], ['infected', '感染者'], ['sounds', '声音'], ['textures', '材质'], ['gui-ui', '界面'], ['scripts', '脚本'], ['items', '物品'], ['effects', '特效'], ['skins', '皮肤'], ['packs', '合集']],
  };
  const SORTS: [GmSort, string][] = [['recent', '最新'], ['popular', '最热门'], ['rviews', '少人看过']];

  let search = $state(cache?.search ?? '');
  let query = $state<GmQuery>(cache?.query ?? { section: 'maps', category: '', sort: 'recent', page: 1, q: '' });
  let result = $state<GmPage | null>(cache?.result ?? null);
  let loading = $state(false), error = $state(''), missing = $state(false), blocked = $state(false), fresh = $state(false);
  let detail = $state<GmDetail | null>(null), detailLoading = $state(false), detailError = $state('');
  let scroller = $state<HTMLDivElement>();
  let seq = 0, dseq = 0;
  const submitting = new SvelteSet<string>();
  const label = $derived(query.q ? `“${query.q}”` : `${query.section === 'maps' ? '地图' : 'Mod'}${query.category ? ` · ${CATS[query.section].find(([c]) => c === query.category)?.[1]}` : ''}`);

  async function browse(change: Partial<GmQuery> = {}) {
    const id = ++seq;
    query = { ...query, ...change }; loading = true; error = ''; blocked = false; result = null;
    scroller?.scrollTo({ top: 0 });
    try { const page = await gmApi.browse({ ...query }); if (id === seq) { result = page; fresh = true; missing = false; } }
    catch (e) { if (id === seq) { missing = gmMissing(e); blocked = gmBlocked(e); error = errorText(e); } }
    finally { if (id === seq) loading = false; }
  }
  function submit() {
    const m = search.match(/gamemaps\.com\/details\/(\d+)/i) ?? search.trim().match(/^(\d{3,7})$/);
    if (m) { void openDetail(m[1]); return; }
    void browse({ q: search.trim(), page: 1 });
  }
  function pickSection(section: GmSection) { search = ''; void browse({ section, category: '', q: '', page: 1 }); }
  function pickCat(category: string) { search = ''; void browse({ category, q: '', page: 1 }); }

  async function openDetail(target: GmItem | string) {
    const id = ++dseq;
    const gid = typeof target === 'string' ? target : target.id;
    if (missing) { openPage(gmUrl(gid)); return; }
    detail = typeof target === 'string' ? null : { ...target, authors: target.author ? [{ name: target.author, role: 'Author' }] : [], description: target.summary ?? '', tags: [], screenshots: [], linked: [] };
    detailLoading = true; detailError = '';
    // 详情页没有 New / Updated 标记，沿用列表卡片上的。
    try { const d = await gmApi.detail(gid); if (id === dseq) detail = { ...d, flags: d.flags ?? (typeof target === 'string' ? undefined : target.flags) }; }
    catch (e) { if (id === dseq) detailError = errorText(e); }
    finally { if (id === dseq) detailLoading = false; }
  }
  function back() { dseq++; detail = null; detailLoading = false; detailError = ''; }

  // ---------- 下载 ----------
  const owned = (id: string) => app.mods.some((m) => {
    try { const u = new URL(m.origin?.pageUrl ?? ''); return ['gamemaps.com', 'www.gamemaps.com'].includes(u.hostname) && u.pathname.replace(/\/$/, '') === `/details/${id}`; }
    catch { return false; }
  });
  const activeTask = (id: string) => app.tasks.find((t) => t.kind === 'download' && t.source === 'gamemaps' && t.sourceId === id && t.gameRoot.toLowerCase() === app.game.root.toLowerCase() && !['done', 'failed', 'canceled'].includes(t.state));
  const wsOwned = (wid: string) => app.mods.some((m) => m.workshopId === wid);
  const wsTask = (wid: string) => app.tasks.find((t) => t.kind === 'download' && t.workshopId === wid && !['done', 'failed', 'canceled'].includes(t.state));
  async function download(item: GmItem, source?: Element | null) {
    if (owned(item.id) || activeTask(item.id) || submitting.has(item.id)) return;
    submitting.add(item.id);
    support.author(`gm:${item.id}`, item.author);
    try { await gmApi.download(item.id, item.title); sfx.play('download'); flyToDownloads(source); }
    catch (e) { app.toast(gmMissing(e) ? 'GameMaps 下载需要后端提供 gamemaps-download，先在浏览器里下载' : errorText(e)); if (gmMissing(e)) openPage(gmUrl(item.id)); }
    finally { submitting.delete(item.id); }
  }
  async function downloadWorkshop(wid: string, source?: Element | null) {
    if (wsOwned(wid) || wsTask(wid)) return;
    if (await app.downloadWorkshop([wid])) flyToDownloads(source);
  }
  function openPage(url: string) { browser.open(url); app.route = 'browser'; }
  const k = (n?: number) => (n === undefined ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

  onMount(() => {
    if (cache) { const top = cache.scroll; void tick().then(() => scroller?.scrollTo({ top })); }
    else void browse();
  });
  onDestroy(() => {
    seq++; dseq++;
    if (result) cache = { query: $state.snapshot(query), result: $state.snapshot(result) as GmPage, search, scroll: scroller?.scrollTop ?? 0 };
  });
</script>

{#snippet action(item: GmItem, large = false, source?: () => Element | null)}
  {@const task = activeTask(item.id)}
  {#if owned(item.id)}
    <span class="owned"><Check size={13} />已在库</span>
  {:else if task || submitting.has(item.id)}
    {@const r = task ? ratio(task) : null}
    <span class="dl busy" class:large class:indet={r === null} role="status"><span class="fill" style:transform="scaleX({r ?? 0})"></span>
      <span class="txt">{#if r !== null && task?.state === 'running'}<span class="mono">{Math.floor(r * 100)}%</span>{:else}<LoaderCircle size={12} class="spin" />{task?.state === 'verifying' ? '解包中' : '排队中'}{/if}</span></span>
  {:else}
    <button class="dl" class:large data-sfx="none" disabled={!app.game.installed} title={app.game.installed ? `下载${item.sizeBytes ? ` ${mib(item.sizeBytes)}` : ''}，完成后放进「新下载」` : '请先在主页选择游戏目录'} onclick={() => download(item, source?.())}>
      <Download size={14} />下载{#if large && item.sizeBytes}<span class="size mono">{mib(item.sizeBytes)}</span>{/if}
    </button>
  {/if}
{/snippet}

<div class="gm discover">
  <DiscoverTabs />

  {#if detail || detailLoading}
    <div class="detail-scroll">
      <button class="back" onclick={back}><ArrowLeft size={15} />返回列表</button>
      {#if detail}
        {@const d = detail}
        <div class="detail-grid">
          <div class="detail-art"><GameMapsPicture image={d.image} eager /></div>
          <div class="detail-info">
            <span class="kicker">{['GAMEMAPS', d.typeLabel, ...(d.flags ?? []).map((f) => GM_FLAG_LABEL[f])].filter(Boolean).join(' · ')}</span>
            <h2>{d.title}</h2>
            <p class="author">{d.authors.length ? d.authors.map((a) => (a.role && a.role !== 'Author' ? `${a.name}（${a.role}）` : a.name)).join('、') : d.author ?? ''}</p>
            <dl class="facts">
              {#if d.file?.sizeBytes || d.sizeBytes}<div><dt>大小</dt><dd class="mono">{mib(d.file?.sizeBytes ?? d.sizeBytes ?? 0)}</dd></div>{/if}
              {#if d.views !== undefined}<div><dt>浏览</dt><dd class="mono">{k(d.views)}</dd></div>{/if}
              {#if d.likes !== undefined}<div><dt>喜欢</dt><dd class="mono">{k(d.likes)}</dd></div>{/if}
              {#if d.file?.date || d.updatedAt}<div><dt>更新</dt><dd class="mono">{(d.file?.date ?? d.updatedAt ?? '').slice(0, 10)}</dd></div>{/if}
            </dl>
            {#if d.file}<p class="file"><FileArchive size={13} /><span class="mono">{d.file.name}</span>{#if d.file.version}<span>· {d.file.version}</span>{/if}</p>{/if}
            <div class="detail-actions">
              {@render action(d, true, () => document.querySelector('.gm .detail-art'))}
              {#if d.workshopId}
                {#if wsOwned(d.workshopId)}<span class="owned"><Check size={13} />工坊版已在库中</span>
                {:else if wsTask(d.workshopId)}<span class="owned"><LoaderCircle size={13} class="spin" />工坊版下载中</span>
                {:else}<button class="btn" title="作者也发布在 Steam 创意工坊，可以走工坊下载" onclick={() => downloadWorkshop(d.workshopId!, document.querySelector('.gm .detail-art'))}>从创意工坊下载</button>{/if}
              {/if}
              <button class="btn ghost" onclick={() => openPage(d.url || gmUrl(d.id))}><ExternalLink size={13} />原页面</button>
            </div>
            <p class="note">下载完成后自动解出 VPK 放进「新下载」，默认启用。{#if detailLoading}<LoaderCircle size={12} class="spin" />{/if}</p>
          </div>
        </div>

        {#if d.instructions}
          <div class="instr"><TriangleAlert size={15} /><div><b>作者说明</b><p>{d.instructions}</p></div></div>
        {/if}
        {#if d.screenshots.length}
          <section class="block"><h3>截图</h3>
            <div class="shots">{#each d.screenshots as s, i (i)}<span class="shot"><GameMapsPicture image={s} /></span>{/each}</div>
          </section>
        {/if}
        <section class="block">
          <h3>介绍</h3>
          {#if detailError}<p class="error">{detailError}</p>{/if}
          <p class="prose">{d.description || (detailLoading ? '正在读取…' : '作者没有写介绍。')}</p>
          {#if d.tags.length}<div class="tags">{#each d.tags as t (t)}<span class="tag">{t}</span>{/each}</div>{/if}
        </section>
        {#if d.linked.length}
          <section class="block"><h3>相关内容</h3>
            <div class="linked">
              {#each d.linked as l (l.id)}
                <button class="lk" onclick={() => void openDetail(l)}>
                  <span class="lk-art"><GameMapsPicture image={l.image} /></span>
                  <span class="lk-t">{l.title}</span><span class="lk-m mono">{l.typeLabel}{l.sizeBytes ? ` · ${mib(l.sizeBytes)}` : ''}</span>
                </button>
              {/each}
            </div>
          </section>
        {/if}
      {:else}
        <p class="status"><LoaderCircle size={15} class="spin" />正在读取…</p>
        {#if detailError}<p class="error">{detailError}</p>{/if}
      {/if}
    </div>
  {:else}
    <div class="controls">
      <div class="top">
        <form class="search" onsubmit={(e) => { e.preventDefault(); submit(); }}>
          <Search size={15} /><input aria-label="搜索 GameMaps" bind:value={search} maxlength="100" placeholder="搜地图或 Mod，或粘贴条目链接" />
          {#if search}<kbd class="mono">Enter</kbd>{/if}
        </form>
        <button class="btn ghost" title="在内置浏览器里打开 GameMaps" onclick={() => openPage(`${GM_HOME}/${query.section}`)}><ExternalLink size={14} />在浏览器打开</button>
      </div>
      <div class="filters">
        <div class="seg" role="radiogroup" aria-label="类型">
          <button role="radio" aria-checked={query.section === 'maps'} class:on={query.section === 'maps' && !query.q} onclick={() => pickSection('maps')}>地图</button>
          <button role="radio" aria-checked={query.section === 'mods'} class:on={query.section === 'mods' && !query.q} onclick={() => pickSection('mods')}>Mod</button>
        </div>
        <nav class="cats" aria-label="分类">
          {#each CATS[query.section] as [c, name] (c)}
            <button class="chip" class:on={query.category === c && !query.q} aria-pressed={query.category === c && !query.q} onclick={() => pickCat(c)}>{name}</button>
          {/each}
        </nav>
        <span class="sort">
          <select aria-label="排序" value={query.sort} onchange={(e) => browse({ sort: e.currentTarget.value as GmSort, page: 1 })}>
            {#each SORTS as [v, l] (v)}<option value={v}>{l}</option>{/each}
          </select>
          <ChevronDown size={13} />
        </span>
      </div>
    </div>

    <div class="results" bind:this={scroller} aria-busy={loading}>
      {#if loading}
        <p class="result-line" role="status"><span>正在读取 GameMaps…</span></p>
        <div class="grid" aria-hidden="true">{#each Array(8) as _, i (i)}<div class="card skeleton"><span class="art"></span><span class="line w80"></span><span class="line w40"></span></div>{/each}</div>
      {:else if missing}
        <div class="empty">
          <span class="empty-ic"><MapIcon size={22} strokeWidth={1.5} /></span>
          <h2>GameMaps 还没接上后端</h2>
          <p>后端提供 <span class="mono">gamemaps-browse</span> 后，这里直接列出 GameMaps 上的 L4D2 地图和 Mod，一键下载进「新下载」。现在可以先在内置浏览器里逛，下载的文件会进「下载」页，可直接导入。</p>
          <button class="btn" onclick={() => openPage(`${GM_HOME}/${query.section}`)}><ExternalLink size={14} />在浏览器打开 GameMaps</button>
        </div>
      {:else if error}
        <div class="empty">
          <h2>{blocked ? 'GameMaps 暂时拦截了请求' : 'GameMaps 暂时连接不上'}</h2>
          <p class="error">{blocked ? '站点的防护拦下了请求，过一会儿再试，或先在浏览器里打开。' : error}</p>
          <div class="empty-acts"><button class="btn" onclick={() => browse()}>重新读取</button><button class="btn ghost" onclick={() => openPage(GM_HOME)}>在浏览器打开</button></div>
        </div>
      {:else if result}
        <div class="result-line"><span>{label}</span><span class="muted mono">{result.page} / {result.totalPages}</span></div>
        {#if !result.items.length}
          <div class="empty"><Search size={28} strokeWidth={1.25} /><h2>没有找到相关内容</h2><p>试试英文关键词，或换个分类。</p></div>
        {:else}
          <div class="grid" class:fresh>
            {#each result.items as item, i (item.id)}
              {@const marks = item.flags?.filter((f) => f !== 'beta') ?? []}
              {@const beta = item.flags?.includes('beta')}
              <article class="card" style:--i={Math.min(i, 11)}>
                <button class="art" data-gm={item.id} aria-label={`查看 ${item.title}`} aria-describedby={`gm-badges-${item.id}`} onclick={() => void openDetail(item)}>
                  <GameMapsPicture image={item.image} caption />
                  <span class="badges" id={`gm-badges-${item.id}`}>
                    {#each marks as f (f)}<i class={f}>{GM_FLAG_LABEL[f]}</i>{/each}
                    {#if item.typeLabel}<i>{item.typeLabel}</i>{/if}
                    {#if beta}<i class="beta">Beta</i>{/if}
                  </span>
                </button>
                <div class="info">
                  <button class="title" title={item.title} onclick={() => void openDetail(item)}><span>{item.title}</span></button>
                  <p class="byline">{item.author ?? ''}{item.author && item.updatedAt ? ' · ' : ''}{item.updatedAt?.slice(0, 10) ?? ''}</p>
                  <div class="foot">
                    <span class="stats mono">{#if item.views !== undefined}<Eye size={11} />{k(item.views)}{/if}{#if item.likes !== undefined}<Heart size={11} />{k(item.likes)}{/if}{#if item.sizeBytes && item.views === undefined}{mib(item.sizeBytes)}{/if}</span>
                    {@render action(item, false, () => document.querySelector(`[data-gm="${item.id}"]`))}
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/if}
        <div class="pagination">
          <button class="btn" disabled={result.page <= 1} onclick={() => browse({ page: query.page - 1 })}><ArrowLeft size={14} />上一页</button>
          <span class="mono">{result.page} / {result.totalPages}</span>
          <button class="btn" disabled={result.page >= result.totalPages} onclick={() => browse({ page: query.page + 1 })}>下一页<ArrowRight size={14} /></button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .muted { color: var(--fg-3); }

  .results { flex: 1; min-height: 0; overflow-y: auto; padding: 0 24px 28px; }
  .result-line { display: flex; justify-content: space-between; gap: 12px; margin: 0; padding: 14px 0 12px; font-size: 12px; color: var(--fg-2); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .grid.fresh .card { animation: rise 320ms var(--ease-out) backwards; animation-delay: calc(var(--i) * 35ms); }
  .art { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: var(--md-surface-container-high); }
  .art :global(img) { transition: transform 360ms var(--ease-out); }
  @media (hover: hover) and (pointer: fine) { .card:hover .art :global(img) { transform: scale(1.04); } }
  /* 和 B 站页的角标同一套：「新」用 tertiary 突出；按最新排序时大半是老图「更新」，只染字色，归档压暗。 */
  .badges { position: absolute; inset: 8px 8px auto; display: flex; flex-wrap: wrap; gap: 4px; pointer-events: none; }
  .badges i { height: 22px; padding: 0 8px; border-radius: 8px; color: var(--fg); background: color-mix(in srgb, var(--md-surface) 88%, transparent); font-size: 11px; font-style: normal; line-height: 22px; white-space: nowrap; box-shadow: 0 2px 6px -2px rgb(0 0 0 / .3); }
  .badges i.new { background: var(--md-tertiary-container); color: var(--md-on-tertiary-container); }
  .badges i.updated { color: var(--md-primary); }
  .badges i.archived { color: var(--fg-3); }
  .badges i.beta { color: var(--fg-2); }
  .stats { display: inline-flex; align-items: center; gap: 4px; }
  .stats :global(svg:not(:first-child)) { margin-left: 6px; }

  .pagination { display: flex; align-items: center; justify-content: center; gap: 20px; margin: 30px 0 8px; color: var(--fg-2); font-size: 12px; }
  .btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .empty { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 300px; padding: 40px 20px; text-align: center; color: var(--fg-3); }
  .empty-ic { display: grid; place-items: center; width: 52px; height: 52px; border: 1px solid var(--line-strong); border-radius: 50%; color: var(--fg-2); }
  .empty h2 { font-size: 15px; font-weight: 500; margin: 16px 0 6px; color: var(--fg); }
  .empty p { margin: 0 0 20px; max-width: 480px; font-size: 13px; line-height: 1.7; }
  .empty-acts { display: flex; gap: 6px; }
  .error { color: var(--danger); overflow-wrap: anywhere; }

  .detail-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 24px 40px; }
  .back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 18px; color: var(--fg-2); font-size: 13px; }
  .back:hover { color: var(--fg); }
  .detail-grid { display: grid; grid-template-columns: minmax(260px, 1.1fr) minmax(240px, 1fr); gap: 28px; align-items: start; animation: rise 260ms var(--ease-out); }
  .detail-art { aspect-ratio: 16 / 9; border: 1px solid var(--line-soft); border-radius: 16px; overflow: hidden; background: var(--md-surface-container-high); }
  .detail-info { min-width: 0; }
  .kicker { font: 11px var(--font-mono); letter-spacing: .06em; color: var(--fg-3); }
  .detail-info h2 { font-size: 20px; font-weight: 500; line-height: 1.4; margin: 8px 0 6px; overflow-wrap: anywhere; user-select: text; }
  .author { color: var(--fg-2); margin: 0 0 16px; overflow-wrap: anywhere; }
  .facts { display: flex; gap: 26px; margin: 0; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .facts div { display: flex; flex-direction: column; gap: 3px; }
  .facts dt { font-size: 11px; color: var(--fg-3); }
  .facts dd { margin: 0; font-size: 13px; }
  .file { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; font-size: 12px; color: var(--fg-3); }
  .file .mono { color: var(--fg-2); }
  .detail-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .note { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-3); margin: 12px 0 0; }
  .instr { display: flex; gap: 10px; margin-top: 24px; padding: 12px 14px; border: 1px solid var(--line-soft); border-left: 3px solid var(--md-primary); border-radius: 12px; background: color-mix(in srgb, var(--md-surface-bright) 62%, transparent); color: var(--fg-2); }
  .instr b { font-size: 13px; font-weight: 500; color: var(--fg); }
  .instr p { margin: 4px 0 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  .block { margin-top: 28px; }
  h3 { font-size: 14px; font-weight: 500; margin: 0 0 12px; }
  .shots { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
  .shot { flex: none; display: grid; place-items: center; width: 280px; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: var(--bg-2); color: var(--fg-4); }
  .prose { margin: 0 0 14px; color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.85; user-select: text; max-width: 900px; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .linked { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
  .lk { display: grid; grid-template-columns: 72px 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center; padding: 6px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); text-align: left; transition: border-color var(--dur); }
  .lk:hover { border-color: var(--line-strong); }
  .lk-art { grid-row: span 2; display: grid; place-items: center; width: 72px; aspect-ratio: 16 / 9; border-radius: var(--r-sm); overflow: hidden; background: var(--bg-2); color: var(--fg-4); }
  .lk-t { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lk-m { font-size: 11px; color: var(--fg-4); }
  .status { display: flex; gap: 10px; color: var(--fg-2); align-items: center; }
  @media (max-width: 1100px) { .controls { padding: 14px 18px 0; } .results, .detail-scroll { padding-left: 18px; padding-right: 18px; } }
  @media (max-width: 860px) { .detail-grid { grid-template-columns: 1fr; } .detail-art { max-width: 560px; } }
  @media (prefers-reduced-motion: reduce) { .grid.fresh .card, .detail-grid { animation: none; } .art :global(img) { transition: none; } }
</style>
