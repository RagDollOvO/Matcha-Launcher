<script module lang="ts">
  import type { BiliQuery, BiliVideo } from '../api/bilibili';
  // 切走再回来时保留已加载的列表和滚动位置
  let cache: { query: BiliQuery; feed: BiliVideo[]; totalPages: number; total: number; search: string; topic: string; scroll: number } | null = null;
</script>

<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import Search from '@lucide/svelte/icons/search';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Check from '@lucide/svelte/icons/check';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Tv from '@lucide/svelte/icons/tv';
  import Play from '@lucide/svelte/icons/play';
  import Copy from '@lucide/svelte/icons/copy';
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  import Heart from '@lucide/svelte/icons/heart';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Link from '@lucide/svelte/icons/link';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Package from '@lucide/svelte/icons/package';
  import DiscoverTabs from '../components/DiscoverTabs.svelte';
  import '../styles/discover.css';
  import { api } from '../api';
  import { errorText } from '../api/bridge';
  import { biliApi, biliBlocked, biliMissing, cover, playCount, type BiliDetail } from '../api/bilibili';
  import { extractLinks, isDisk, linkBadges, linkSegments as segments, looksLikeBili, type FoundLink } from '../bilibili-links';
  import { score, compileKeywords, dayGroup, type Scored } from '../bilibili-filter';
  import { biliFilter } from '../stores/bili-filter.svelte';
  import { openSettings } from '../stores/nav.svelte';
  import KeywordInput from '../components/KeywordInput.svelte';
  import { app, mib } from '../stores/app.svelte';
  import { ratio } from '../stores/downloads.svelte';
  import { browser } from '../browser/browser.svelte';
  import { creatorOf, registerVideo } from '../browser/trail';
  import { flyToDownloads } from '../motion';
  import { support } from '../stores/support.svelte';
  import type { WorkshopItem } from '../types';

  const BASE = '求生之路2 mod';
  const TOPICS = [['', '全部'], ['武器', '武器'], ['人物', '人物'], ['地图', '地图'], ['特感', '特感'], ['音效', '音效'], ['界面', '界面'], ['脚本', '脚本']];

  // 过滤偏好和设置页「B站过滤」共用，只存本机
  const filter = biliFilter;
  let showHidden = $state(false);
  let blockOpen = $state(false);

  let search = $state(cache?.search ?? '');
  let topic = $state(cache?.topic ?? '');
  // 一律按最新发布：这一页是「最近更新了哪些 Mod」的信息流
  let query = $state<BiliQuery>(cache?.query ?? { keyword: BASE, order: 'pubdate', page: 1 });
  let feed = $state<BiliVideo[]>(cache?.feed ?? []);
  let totalPages = $state(cache?.totalPages ?? 0), total = $state(cache?.total ?? 0);
  let loaded = $state(!!cache);
  let loading = $state(false), loadingMore = $state(false), error = $state(''), moreError = $state(''), missing = $state(false), blocked = $state(false), fresh = $state(false);
  let detail = $state<BiliDetail | null>(null), detailLoading = $state(false), detailError = $state('');
  let scroller = $state<HTMLDivElement>();
  let seq = 0, dseq = 0;
  const submitting = new SvelteSet<string>();
  const wsInfo = new SvelteMap<string, WorkshopItem | 'error'>();

  const keyword = () => search.trim() || (topic ? `求生之路2 ${topic} mod` : BASE);
  const rules = $derived({ include: compileKeywords(filter.include), exclude: compileKeywords(filter.exclude) });
  const ruleCount = $derived(filter.include.length + filter.exclude.length);
  const scored = $derived(feed.map((v) => score(v, rules)));
  const passRes = (x: Scored) => !filter.onlyRes || x.links.length > 0;
  /** 关键词规则一直生效；「只看 Mod」再隐藏不像 Mod 的 */
  const hiddenBy = (x: Scored) => !!x.ruled || (filter.mode === 'mod' && x.verdict === 'noise');
  const shown = $derived(scored.filter((x) => passRes(x) && (showHidden || !hiddenBy(x))));
  const hiddenCount = $derived(scored.filter((x) => passRes(x) && hiddenBy(x)).length);
  const ruledCount = $derived(scored.filter((x) => passRes(x) && x.ruled).length);
  const groups = $derived.by(() => {
    // 同名分组合并：翻页时 B站偶尔插进更新的视频，顺序不一定单调，分组名重复会让列表停止刷新
    const out: { label: string; items: Scored[] }[] = [];
    for (const x of shown) {
      const label = dayGroup(x.v.pubdate);
      let g = out.find((o) => o.label === label);
      if (!g) out.push(g = { label, items: [] });
      g.items.push(x);
    }
    return out;
  });
  const detailLinks = $derived(detail ? extractLinks(`${detail.description}\n${detail.pinnedComment ?? ''}`) : []);
  const date = (iso: string) => iso ? iso.slice(0, 10) : '';
  function ago(iso: string) {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 60) return `${m || 1} 分钟前`;
    if (m < 1440) return `${Math.round(m / 60)} 小时前`;
    if (m < 7 * 1440) return `${Math.round(m / 1440)} 天前`;
    return date(iso);
  }
  const isNew = (iso: string) => Date.now() - Date.parse(iso) < 86400000;

  async function browse(change: Partial<BiliQuery> = {}) {
    const id = ++seq;
    query = { ...query, ...change, order: 'pubdate', page: 1 };
    loading = true; error = ''; moreError = ''; blocked = false; feed = []; totalPages = 0; showHidden = false;
    scroller?.scrollTo({ top: 0 });
    try { const p = await biliApi.search({ ...query }); if (id === seq) { feed = p.items; totalPages = p.totalPages; total = p.total; fresh = true; missing = false; loaded = true; } }
    catch (e) { if (id === seq) { missing = biliMissing(e); blocked = biliBlocked(e); error = errorText(e); } }
    finally { if (id === seq) loading = false; }
  }
  /** 下一页接在后面；后端自带限频，这里串行 */
  async function more() {
    if (loading || loadingMore || error || moreError || !totalPages || query.page >= totalPages) return false;
    const id = seq;
    loadingMore = true;
    try {
      const p = await biliApi.search({ ...query, page: query.page + 1 });
      if (id !== seq) return false;
      const have = new Set(feed.map((v) => v.bvid));
      feed = [...feed, ...p.items.filter((v) => !have.has(v.bvid))];
      query.page = p.page; totalPages = p.totalPages;
      return true;
    } catch (e) { if (id === seq) { moreError = errorText(e); blocked = biliBlocked(e); } return false; }
    finally { loadingMore = false; }
  }
  /** 列表底部离可视区不到 600px 就加载下一页；过滤后内容太短时连着补，一次最多 4 页。
   *  直接量位置而不用 IntersectionObserver：窗口在后台时 IO 不回调，这里在加载完和滚动时都会查一次。 */
  let sentinelEl = $state<HTMLDivElement>();
  let filling = false;
  async function fillIfShort() {
    if (filling || app.route !== 'bilibili') return;
    filling = true;
    try {
      for (let n = 0; n < 4; n++) {
        await tick();
        if (app.route !== 'bilibili' || !sentinelEl || !scroller) return;
        if (sentinelEl.getBoundingClientRect().top - scroller.getBoundingClientRect().bottom > 600) return;
        if (!await more()) return;
      }
    } finally { filling = false; }
  }
  // 首屏加载完、换过滤条件后内容变短时，都补一下
  $effect(() => { void shown.length; if (loaded && !loading) void fillIfShort(); });
  function submit() {
    if (looksLikeBili(search)) { void openDetail(search.trim()); return; }
    void browse({ keyword: keyword() });
  }
  function pickTopic(t: string) { topic = t; search = ''; void browse({ keyword: keyword() }); }

  async function openDetail(target: BiliVideo | string) {
    const id = ++dseq;
    if (missing && typeof target === 'string') { openPage(target.startsWith('http') ? target : `https://www.bilibili.com/video/${target}`); return; }
    detail = typeof target === 'string' ? null : { ...target };
    detailLoading = true; detailError = '';
    // 简介里的链接登记下来：之后在内置浏览器里粘贴打开的网盘、爱发电，下载时能对上这个视频
    try { const d = await biliApi.detail(typeof target === 'string' ? target : target.bvid); registerVideo(d); if (id === dseq) detail = d; }
    catch (e) { if (id === dseq) { detailError = errorText(e); if (!detail && biliMissing(e)) { missing = true; } } }
    finally { if (id === dseq) detailLoading = false; }
  }
  function back() { dseq++; detail = null; detailLoading = false; detailError = ''; }
  // 详情里的工坊资源：顺手查标题和大小
  $effect(() => {
    for (const l of detailLinks) {
      const id = l.workshopId;
      if (!id || wsInfo.has(id)) continue;
      wsInfo.set(id, 'error');
      void api.workshopDetail(id).then((it) => wsInfo.set(id, { ...it, id } as WorkshopItem)).catch(() => wsInfo.set(id, 'error'));
    }
  });

  // ---------- 动作 ----------
  const localMod = (id: string) => app.mods.find((m) => m.workshopId === id);
  const activeTask = (id: string) => app.tasks.find((t) => t.kind === 'download' && t.workshopId === id && t.gameRoot.toLowerCase() === app.game.root.toLowerCase() && !['done', 'failed', 'canceled'].includes(t.state));
  async function download(id: string, source?: Element | null) {
    if (localMod(id) || activeTask(id) || submitting.has(id)) return;
    submitting.add(id);
    // 在视频详情里下的：点赞提醒指向这个视频
    if (detail) support.viaBili(detail, id);
    try { if (await app.downloadWorkshop([id])) flyToDownloads(source); }
    finally { submitting.delete(id); }
  }
  function openPage(url: string) { browser.open(url); app.route = 'browser'; }
  /** 从视频简介 / 置顶评论打开的链接：之后在那个网盘里下的文件，点赞提醒指向这个视频 */
  function openFromVideo(url: string) {
    if (!detail) return openPage(url);
    support.viaBiliLink(detail, url);
    // 新标签页的来源链从这个视频开始
    browser.open(url, creatorOf(detail.url, detail.title) ?? undefined);
    app.route = 'browser';
  }
  function editFromVideo(raw: string) {
    const video = detail;
    if (!video) return;
    browser.editAddress(raw, creatorOf(video.url, video.title) ?? undefined, url => support.viaBiliLink(video, url));
    app.route = 'browser';
  }
  function selectedIn(p: Element | null) {
    const s = window.getSelection();
    return s && !s.isCollapsed && p?.contains(s.anchorNode) && p.contains(s.focusNode) ? s.toString() : '';
  }
  async function openDisk(l: FoundLink) {
    if (l.code) { try { await navigator.clipboard.writeText(l.code); app.toast(`提取码 ${l.code} 已复制，网页里直接粘贴`); } catch { app.toast(`提取码：${l.code}`); } }
    openFromVideo(l.url);
  }
  function searchInBrowser() { openPage(`https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword())}`); }

  const icon = (l: FoundLink) => (l.kind === 'workshop' ? Package : isDisk(l.kind) ? HardDrive : l.kind === 'afdian' ? Heart : l.kind === 'github' ? GitBranch : Link);

  onMount(() => {
    if (cache) { const top = cache.scroll; void tick().then(() => scroller?.scrollTo({ top })); }
    else void browse();
  });
  onDestroy(() => {
    seq++; dseq++;
    if (loaded && feed.length) cache = { query: $state.snapshot(query), feed: $state.snapshot(feed) as BiliVideo[], totalPages, total, search, topic, scroll: scroller?.scrollTop ?? 0 };
  });
</script>

{#snippet wsAction(id: string, large = false, source?: () => Element | null)}
  {@const task = activeTask(id)}
  {#if localMod(id)}
    <span class="owned"><Check size={13} />已在库</span>
  {:else if task || submitting.has(id)}
    {@const r = task ? ratio(task) : null}
    <span class="dl busy" class:large class:indet={r === null} role="status"><span class="fill" style:transform="scaleX({r ?? 0})"></span>
      <span class="txt">{#if r !== null && task?.state === 'running'}<span class="mono">{Math.floor(r * 100)}%</span>{:else}<LoaderCircle size={12} class="spin" />{task?.state === 'verifying' ? '校验中' : '排队中'}{/if}</span></span>
  {:else}
    <button class="dl" class:large data-sfx="none" disabled={!app.game.installed} title={app.game.installed ? '从创意工坊下载到「新下载」' : '请先在主页选择游戏目录'} onclick={() => download(id, source?.())}><Download size={14} />下载</button>
  {/if}
{/snippet}

{#snippet passage(title: string, text: string, error = '')}
  <section class="block">
    <h3>{title}
      {#if text}
        <button class="edit-text" title="带入选中的文字；未选中时带入整段原文"
          onmousedown={e => e.preventDefault()}
          onclick={e => editFromVideo(selectedIn(e.currentTarget.closest('section')?.querySelector('.prose') ?? null) || text)}>
          <Pencil size={12} />在地址栏编辑
        </button>
      {/if}
    </h3>
    {#if error}<p class="error">{error}</p>{/if}
    <p class="prose">{#each segments(text || '（作者没有写简介）') as s, i (i)}{#if s.url || s.editFirst}<button class="inl" title={s.editFirst ? '在地址栏编辑' : s.url}
      onclick={e => { if (selectedIn(e.currentTarget.closest('.prose'))) return; if (s.editFirst) editFromVideo(s.text); else if (s.url) openFromVideo(s.url); }}>{s.text}</button>{:else}{s.text}{/if}{/each}</p>
  </section>
{/snippet}

<svelte:window onclick={() => (blockOpen = false)} />

<div class="bili discover">
  <DiscoverTabs />

  {#if detail || detailLoading}
    <div class="detail-scroll">
      <button class="back" onclick={back}><ArrowLeft size={15} />返回结果</button>
      {#if detail}
        <div class="detail-grid">
          <button class="detail-art" aria-label="打开视频" onclick={() => openPage(detail!.url)}>
            {#if detail.cover}<img src={cover(detail.cover, 960, 540)} alt="" referrerpolicy="no-referrer" />{:else}<span class="ph"><Tv size={30} strokeWidth={1.25} /></span>{/if}
            <span class="play"><Play size={20} fill="currentColor" /></span>
          </button>
          <div class="detail-info">
            <span class="kicker">B站视频 · {detail.bvid}</span>
            <h2>{detail.title}</h2>
            <p class="author">{detail.author}{detail.pubdate ? ` · ${date(detail.pubdate)}` : ''}</p>
            <dl class="facts">
              <div><dt>播放</dt><dd class="mono">{playCount(detail.play)}</dd></div>
              {#if detail.favorites !== undefined}<div><dt>收藏</dt><dd class="mono">{playCount(detail.favorites)}</dd></div>{/if}
              <div><dt>时长</dt><dd class="mono">{detail.duration}</dd></div>
            </dl>
            <div class="detail-actions"><button class="btn" onclick={() => openPage(detail!.url)}><Play size={13} />打开视频</button></div>
          </div>
        </div>

        <section class="block">
          <h3>识别到的资源 <span class="n mono">{detailLinks.length}</span>{#if detailLoading}<LoaderCircle size={13} class="spin" />{/if}</h3>
          {#if detailLinks.length}
            <div class="res">
              {#each detailLinks as l (l.url)}
                {@const I = icon(l)}
                {@const info = l.workshopId ? wsInfo.get(l.workshopId) : undefined}
                <div class="rrow">
                  <span class="ric"><I size={15} /></span>
                  <div class="rbody">
                    <span class="rkind">{l.label}{#if l.code}<button class="code mono" title="复制提取码" onclick={() => app.copyText(l.code!, '提取码已复制')}>提取码 {l.code}</button>{/if}</span>
                    <span class="rurl">{#if info && info !== 'error'}{info.title}{#if info.sizeBytes} · <span class="mono">{mib(info.sizeBytes)}</span>{/if}{:else}{l.editFirst ? l.raw : l.url}{/if}</span>
                  </div>
                  <div class="racts">
                    {#if l.raw && !l.editFirst}<button class="icon-btn" title="在地址栏编辑" aria-label={`在地址栏编辑${l.label}`} onclick={() => editFromVideo(l.raw!)}><Pencil size={14} /></button>{/if}
                    {#if l.workshopId}
                      <button class="btn sm ghost" onclick={() => openPage(l.url)}>工坊页</button>
                      {@render wsAction(l.workshopId, false, () => document.querySelector('.detail-art'))}
                    {:else if l.editFirst}
                      <button class="btn sm" onclick={() => editFromVideo(l.raw!)}><Pencil size={12} />在地址栏编辑</button>
                    {:else if isDisk(l.kind)}
                      <button class="btn sm" onclick={() => void openDisk(l)}>{#if l.code}<Copy size={12} />复制提取码并打开{:else}打开网盘{/if}</button>
                    {:else}
                      <button class="btn sm" onclick={() => openFromVideo(l.url)}><ExternalLink size={12} />打开</button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            <p class="note">工坊资源可以直接下载；网盘、爱发电在内置浏览器里打开，下载的 VPK / ZIP 会进「下载」页，可直接导入。</p>
          {:else if !detailLoading}
            <p class="note">没识别到资源。{#if detail.description || detail.pinnedComment}可以选中下方原文，在地址栏编辑，或{/if}<button class="link" onclick={() => openPage(detail!.url)}>去视频页看看</button>。</p>
          {/if}
        </section>

        {@render passage('简介', detail.description, detailError)}
        {#if detail.pinnedComment}{@render passage('置顶评论', detail.pinnedComment)}{/if}
      {:else}
        <p class="status"><LoaderCircle size={15} class="spin" />正在读取视频…</p>
        {#if detailError}<p class="error">{detailError}</p>{/if}
      {/if}
    </div>
  {:else}
    <div class="controls">
      <div class="top">
        <form class="search" onsubmit={(e) => { e.preventDefault(); submit(); }}>
          <Search size={15} /><input aria-label="搜索 B站" bind:value={search} maxlength="100" placeholder="搜 Mod，或粘贴视频链接 / BV 号" />
          {#if search}<kbd class="mono">Enter</kbd>{/if}
        </form>
        <button class="btn ghost" title="在内置浏览器里打开 B站搜索" onclick={searchInBrowser}><ExternalLink size={14} />在浏览器搜索</button>
      </div>
      <div class="filters">
        <nav class="cats" aria-label="分类">
          {#each TOPICS as [t, name] (t)}
            <button class="chip" class:on={topic === t && !search.trim()} aria-pressed={topic === t && !search.trim()} onclick={() => pickTopic(t)}>{name}</button>
          {/each}
        </nav>
        <div class="seg" role="radiogroup" aria-label="过滤">
          <button role="radio" aria-checked={filter.mode === 'mod'} class:on={filter.mode === 'mod'} title="隐藏实况、群车录像、服务器流程、整活等，只留 Mod 发布" onclick={() => (filter.mode = 'mod')}>只看 Mod</button>
          <button role="radio" aria-checked={filter.mode === 'all'} class:on={filter.mode === 'all'} onclick={() => (filter.mode = 'all')}>全部</button>
        </div>
        <button class="chip" class:on={filter.onlyRes} aria-pressed={filter.onlyRes} title="只看简介里有工坊、网盘等下载链接的视频" onclick={() => (filter.onlyRes = !filter.onlyRes)}>有下载链接</button>
        <div class="blockwrap">
          <button class="icon-btn" class:on={ruleCount > 0} title={ruleCount ? `关键词规则：必须包含 ${filter.include.length} 个 · 屏蔽词 ${filter.exclude.length} 个` : '关键词规则'} aria-label="关键词规则" aria-expanded={blockOpen} onclick={(e) => { e.stopPropagation(); blockOpen = !blockOpen; }}><ListFilter size={15} />{#if ruleCount}<i class="dot mono">{ruleCount}</i>{/if}</button>
          {#if blockOpen}
            <div class="bpop" role="dialog" aria-label="关键词规则" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') blockOpen = false; }}>
              <b>必须包含</b>
              <p>含有其中任一个才显示，留空不限制</p>
              <KeywordInput bind:words={filter.include} label="必须包含的关键词" placeholder="例如：武器、贴皮" />
              <b>屏蔽词</b>
              <p>含有任一个就隐藏，优先于「必须包含」</p>
              <KeywordInput bind:words={filter.exclude} label="屏蔽词" placeholder="例如：原神、/第.+期/" />
              <p class="tip">匹配标题、简介、标签和 UP 主。<button class="link" onclick={() => { blockOpen = false; openSettings('bili'); }}>在设置里管理</button></p>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class="results" bind:this={scroller} aria-busy={loading} onscroll={() => void fillIfShort()}>
      {#if loading}
        <p class="result-line" role="status"><span>正在读取「{query.keyword}」的最新视频…</span></p>
        <div class="grid" aria-hidden="true">{#each Array(8) as _, i (i)}<div class="card skeleton"><span class="art"></span><span class="line w80"></span><span class="line w40"></span></div>{/each}</div>
      {:else if missing}
        <div class="empty">
          <span class="empty-ic"><Tv size={22} strokeWidth={1.5} /></span>
          <h2>B站搜索还没接上后端</h2>
          <p>后端提供 <span class="mono">bilibili-search</span> 后，这里会按发布时间列出新的 Mod 视频，并自动识别简介里的创意工坊、网盘链接。现在可以先在内置浏览器里搜。</p>
          <button class="btn" onclick={searchInBrowser}><ExternalLink size={14} />在浏览器里搜「{keyword()}」</button>
        </div>
      {:else if error}
        <div class="empty">
          <h2>{blocked ? 'B站暂时拦截了请求' : 'B站暂时连接不上'}</h2>
          <p class="error">{blocked ? '请求太频繁触发了风控，过一会儿再试，或先在浏览器里搜。' : error}</p>
          <div class="empty-acts"><button class="btn" onclick={() => browse()}>重新读取</button><button class="btn ghost" onclick={searchInBrowser}>在浏览器里搜</button></div>
        </div>
      {:else if loaded}
        <div class="result-line">
          <span>「{query.keyword}」最新发布 <span class="muted">· 已读 {feed.length} 条 · 显示 {shown.filter((x) => !hiddenBy(x)).length}</span>
            {#if hiddenCount}<button class="hid" onclick={() => (showHidden = !showHidden)}><EyeOff size={12} />{showHidden ? '收起' : '显示'}被过滤的 {hiddenCount} 条</button>{/if}
          </span>
        </div>
        {#if !shown.length && !loadingMore}
          <div class="empty"><Search size={28} strokeWidth={1.25} /><h2>{feed.length ? '这一批都被过滤掉了' : '没有找到相关视频'}</h2>
            <p>{feed.length ? '往下翻会继续加载更早的视频；也可以看看被过滤的，或换成「全部」。' : '换个关键词试试。'}</p>
            {#if hiddenCount}<div class="empty-acts"><button class="btn" onclick={() => (showHidden = true)}>显示被过滤的</button>{#if ruledCount}<button class="btn ghost" onclick={() => openSettings('bili')}>调整关键词</button>{:else if filter.mode === 'mod'}<button class="btn ghost" onclick={() => (filter.mode = 'all')}>切到全部</button>{/if}</div>{/if}
          </div>
        {/if}
        {#each groups as g (g.label)}
          <h4 class="day">{g.label}<span class="mono">{g.items.length}</span></h4>
          <div class="grid" class:fresh>
            {#each g.items as x, i (x.v.bvid)}
              {@const v = x.v}
              {@const ws = x.links.filter((l) => l.workshopId)}
              {@const recent = isNew(v.pubdate)}
              {@const badges = linkBadges(x.links)}
              {@const badgeId = recent || x.kind || badges.length ? `bili-badges-${v.bvid}` : undefined}
              <article class="card" class:noise={hiddenBy(x)} style:--i={Math.min(i, 11)}>
                <button class="art" data-bili={v.bvid} aria-label={`查看 ${v.title}`} aria-describedby={badgeId} onclick={() => void openDetail(v)}>
                  {#if v.cover}<img src={cover(v.cover)} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<span class="ph"><Tv size={26} strokeWidth={1.25} /></span>{/if}
                  {#if badgeId}
                    <span class="badges" id={badgeId}>
                      {#if recent}<i class="new">新</i>{/if}
                      {#if x.kind}<i class="kind">{x.kind}</i>{/if}
                      {#each badges as b (b)}<i>{b}</i>{/each}
                    </span>
                  {/if}
                  {#if v.duration}<span class="dur mono">{v.duration}</span>{/if}
                </button>
                <div class="info">
                  <button class="title" title={v.title} onclick={() => void openDetail(v)}><span>{v.title}</span></button>
                  <p class="byline">{v.author}{v.pubdate ? ` · ${ago(v.pubdate)}` : ''}</p>
                  {#if x.ruled}<p class="why" title={x.ruled}>已过滤：{x.ruled}</p>
                  {:else if x.verdict === 'noise'}<p class="why" title={x.reasons.join(' · ')}>已过滤：{x.reasons.join(' · ') || '不像 Mod 发布'}</p>{/if}
                  <div class="foot">
                    <span class="mono"><Play size={11} />{playCount(v.play)}</span>
                    {#if ws.length === 1}{@render wsAction(ws[0].workshopId!, false, () => document.querySelector(`[data-bili="${v.bvid}"]`))}
                    {:else if x.links.length}<button class="dl" onclick={() => void openDetail(v)}>{ws.length > 1 ? `工坊 ×${ws.length}` : '查看资源'}</button>
                    {:else}<button class="text-action" onclick={() => void openDetail(v)}>详情</button>{/if}
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/each}
        <div class="sentinel" bind:this={sentinelEl}></div>
        {#if loadingMore}<p class="more"><LoaderCircle size={13} class="spin" />正在加载更早的视频…</p>
        {:else if moreError}<p class="more error">{blocked ? 'B站暂时拦截了请求，过一会儿再试' : moreError}<button onclick={() => { moreError = ''; void more(); }}>重试</button></p>
        {:else if totalPages && query.page >= totalPages}<p class="more">没有更多了</p>{/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .blockwrap { position: relative; flex: none; }
  .blockwrap .icon-btn.on { color: var(--fg); background: var(--bg-2); }
  .bpop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 6; width: 300px; padding: 12px; background: var(--md-surface-container); border: 1px solid var(--island-line); border-radius: 14px; box-shadow: 0 16px 36px -14px rgb(0 0 0 / .4); display: flex; flex-direction: column; gap: 8px; transform-origin: top right; animation: rise 160ms var(--ease-out); }
  .bpop b { font-size: 13px; font-weight: 500; }
  .bpop p { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-3); }
  .bpop { width: 320px; gap: 6px; }
  .bpop b + p { margin-top: -4px; }
  .bpop p + b { margin-top: 6px; }
  .bpop .tip { margin-top: 4px; }
  .bpop .link { color: var(--fg-2); text-decoration: underline; text-decoration-color: var(--fg-4); text-underline-offset: 3px; }
  .bpop .link:hover { color: var(--fg); }
  .blockwrap .icon-btn { position: relative; }
  .blockwrap .dot { position: absolute; top: 1px; right: 0; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background: var(--md-primary); color: var(--md-on-primary); font-size: 9px; font-style: normal; line-height: 14px; text-align: center; }
  .hid { display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; color: var(--fg-2); text-decoration: underline; text-decoration-color: var(--fg-4); text-underline-offset: 3px; font-size: 12px; }
  .hid:hover { color: var(--fg); }
  .day { display: flex; align-items: baseline; gap: 8px; margin: 18px 0 10px; font-size: 13px; font-weight: 500; color: var(--fg-2); }
  .day:first-of-type { margin-top: 4px; }
  .day .mono { font-size: 11px; font-weight: 400; color: var(--fg-4); }
  .card.noise { opacity: .5; }
  .card.noise:hover { opacity: .85; }
  .why { margin: -3px 0 7px; font-size: 12px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 24px 0 4px; font-size: 12px; color: var(--fg-3); }
  .more button { color: var(--fg-2); text-decoration: underline; text-underline-offset: 3px; }
  .sentinel { height: 1px; }
  .muted { color: var(--fg-3); }

  .results { flex: 1; min-height: 0; overflow-y: auto; padding: 0 24px 28px; }
  .result-line { display: flex; justify-content: space-between; gap: 12px; margin: 0; padding: 14px 0 12px; font-size: 12px; color: var(--fg-2); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .grid.fresh .card { animation: rise 320ms var(--ease-out) backwards; animation-delay: calc(var(--i) * 35ms); }
  .art { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: var(--md-surface-container-high); }
  .art img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 360ms var(--ease-out); }
  @media (hover: hover) and (pointer: fine) { .card:hover .art img { transform: scale(1.04); } }
  .ph { display: grid; place-items: center; width: 100%; height: 100%; color: var(--fg-4); }
  .badges { position: absolute; inset: 8px 8px auto; display: flex; flex-wrap: wrap; gap: 4px; }
  .badges i { height: 22px; padding: 0 8px; border-radius: 8px; color: var(--fg); background: color-mix(in srgb, var(--md-surface) 88%, transparent); font-size: 11px; font-style: normal; line-height: 22px; white-space: nowrap; box-shadow: 0 2px 6px -2px rgb(0 0 0 / .3); }
  .badges i.new { background: var(--md-tertiary-container); color: var(--md-on-tertiary-container); }
  .badges i.kind { background: var(--md-primary-container); color: var(--md-on-primary-container); }
  .dur { position: absolute; right: 8px; bottom: 8px; height: 20px; line-height: 20px; padding: 0 6px; border-radius: 6px; background: color-mix(in srgb, var(--md-surface) 88%, transparent); font-size: 11px; color: var(--fg-2); }
  .foot > .mono { display: inline-flex; align-items: center; gap: 4px; }

  .btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .empty { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 300px; padding: 40px 20px; text-align: center; color: var(--fg-3); }
  .empty-ic { display: grid; place-items: center; width: 52px; height: 52px; border: 1px solid var(--line-strong); border-radius: 50%; color: var(--fg-2); }
  .empty h2 { font-size: 15px; font-weight: 500; margin: 16px 0 6px; color: var(--fg); }
  .empty p { margin: 0 0 20px; max-width: 460px; font-size: 13px; line-height: 1.7; }
  .empty-acts { display: flex; gap: 6px; }
  .error { color: var(--danger); overflow-wrap: anywhere; }

  /* ---------- 详情 ---------- */
  .detail-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 24px 40px; }
  .back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 18px; color: var(--fg-2); font-size: 13px; }
  .back:hover { color: var(--fg); }
  .detail-grid { display: grid; grid-template-columns: minmax(260px, 1.1fr) minmax(220px, 1fr); gap: 28px; align-items: start; animation: rise 260ms var(--ease-out); }
  .detail-art { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--line-soft); border-radius: 16px; overflow: hidden; background: var(--md-surface-container-high); }
  .detail-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .play { position: absolute; left: 50%; top: 50%; display: grid; place-items: center; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%; background: var(--bg); color: var(--fg); border: 1px solid var(--line-strong); opacity: .9; transition: transform 200ms var(--ease-out); }
  .detail-art:hover .play { transform: scale(1.08); }
  .detail-info { min-width: 0; }
  .kicker { font: 11px var(--font-mono); letter-spacing: .04em; color: var(--fg-3); }
  .detail-info h2 { font-size: 20px; font-weight: 500; line-height: 1.4; margin: 8px 0 6px; overflow-wrap: anywhere; user-select: text; }
  .author { color: var(--fg-2); margin: 0 0 16px; }
  .facts { display: flex; gap: 28px; margin: 0; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .facts div { display: flex; flex-direction: column; gap: 3px; }
  .facts dt { font-size: 11px; color: var(--fg-3); }
  .facts dd { margin: 0; font-size: 13px; }
  .detail-actions { display: flex; gap: 8px; margin-top: 18px; }
  .block { margin-top: 28px; }
  h3 { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; margin: 0 0 12px; }
  h3 .n { font-size: 11px; color: var(--fg-3); font-weight: 400; }
  .edit-text { display: inline-flex; align-items: center; gap: 5px; padding: 4px 6px; color: var(--fg-3); font-size: 12px; font-weight: 400; }
  .edit-text:hover { color: var(--md-primary); }
  .res { border: 1px solid var(--line); border-radius: 8px; background: var(--bg-1); overflow: hidden; }
  .rrow { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 12px; border-top: 1px solid var(--line); animation: rise 220ms var(--ease-out) backwards; }
  .rrow:first-child { border-top: 0; }
  .ric { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border: 1px solid var(--line-strong); border-radius: var(--r); color: var(--fg-2); background: var(--bg); }
  .rbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .rkind { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .code { font-size: 11px; padding: 0 6px; height: 18px; line-height: 16px; border: 1px solid var(--line-strong); border-radius: 3px; color: var(--fg); }
  .rurl { font-size: 12px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .racts { display: flex; align-items: center; gap: 6px; flex: none; }
  .note { margin: 10px 0 0; font-size: 12px; color: var(--fg-3); line-height: 1.7; }
  .link, .inl { color: var(--fg); text-decoration: underline; text-decoration-color: var(--fg-4); text-underline-offset: 3px; }
  .link:hover, .inl:hover { text-decoration-color: var(--fg); }
  .inl { display: inline; padding: 0; font: inherit; text-align: left; overflow-wrap: anywhere; user-select: text; }
  .prose { margin: 0 0 18px; color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.85; user-select: text; max-width: 900px; }
  .status { display: flex; gap: 10px; color: var(--fg-2); align-items: center; }
  @media (max-width: 1100px) { .controls { padding: 14px 18px 0; } .results, .detail-scroll { padding-left: 18px; padding-right: 18px; } }
  @media (max-width: 860px) { .detail-grid { grid-template-columns: 1fr; } .detail-art { max-width: 560px; } }
  @media (prefers-reduced-motion: reduce) { .grid.fresh .card, .detail-grid, .rrow { animation: none; } .art img { transition: none; } }
</style>
