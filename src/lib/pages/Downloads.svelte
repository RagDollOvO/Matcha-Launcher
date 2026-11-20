<script lang="ts">
  // 统一的下载页：创意工坊下载 / 解包任务 + 内置浏览器下载的文件（VPK 直接导入，ZIP 先选内容）
  import { fly, fade, slide, crossfade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import Download from '@lucide/svelte/icons/download';
  import PackageOpen from '@lucide/svelte/icons/package-open';
  import Compass from '@lucide/svelte/icons/compass';
  import Globe from '@lucide/svelte/icons/globe';
  import Heart from '@lucide/svelte/icons/heart';
  import X from '@lucide/svelte/icons/x';
  import Check from '@lucide/svelte/icons/check';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import History from '@lucide/svelte/icons/history';
  import Search from '@lucide/svelte/icons/search';
  import Trash from '@lucide/svelte/icons/trash-2';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import Gauge from '@lucide/svelte/icons/gauge';
  import { app, mib } from '../stores/app.svelte';
  import { downloads, endAt, ended, ratio, size, streaming, taskLine, webAt, webEnded, webSized } from '../stores/downloads.svelte';
  import DownloadLimits from '../components/DownloadLimits.svelte';
  import { nav } from '../stores/nav.svelte';
  import { transfer, eta, left, when, type Rate } from '../stores/transfer.svelte';
  import { browser, tabs, type BrowserDownload } from '../browser/browser.svelte';
  import { trail, toModCreators, CREATOR_LABEL } from '../browser/trail';
  import { api, type BrowserArchive } from '../api';
  import { errorText } from '../api/bridge';
  import { reduceMotion } from '../motion';
  import ModThumb from '../components/ModThumb.svelte';
  import type { ModTask } from '../types';

  let archive = $state<{ id: string; listing: BrowserArchive; selected: string[] } | null>(null);
  let working = $state('');
  const still = reduceMotion();
  const enter = { y: still ? 0 : 8, duration: still ? 0 : 240, easing: cubicOut };
  // 任务从「进行中」挪到「已结束」：同一行飞过去（crossfade），其余行顺势补位（flip）；新出现的行轻轻上浮，清除的行淡出
  const [send, receive] = crossfade({
    duration: still ? 0 : 420,
    easing: cubicOut,
    fallback: (node, _params, intro) => (intro ? fly(node, enter) : fade(node, { duration: still ? 0 : 140 })),
  });
  const move = { duration: still ? 0 : 320, easing: cubicOut };

  // 「当前」：进行中 + 最近 7 天；「历史」：所有结束的记录，可搜索、筛选
  let tab = $state<'now' | 'history'>('now');
  const webDone = $derived(downloads.webRecent);
  const total = $derived(downloads.tasks.length + downloads.web.length);
  const canClear = $derived(downloads.recent.length > 0 || downloads.webRecent.some((d) => d.state !== 'done'));
  /** 只在历史里的记录数（更早的 + 收进历史的） */
  const older = $derived(Math.max(0, downloads.historyCount - downloads.recent.length - downloads.webRecent.length));

  const PAGE = 50;
  const SRC = [['all', '全部'], ['mod', 'Mod 下载'], ['web', '网页文件'], ['extract', '解包'], ['pack', '打包']] as const;
  const RES = [['all', '全部结果'], ['done', '成功'], ['failed', '失败'], ['canceled', '已取消']] as const;
  let q = $state('');
  let src = $state<(typeof SRC)[number][0]>('all');
  let res = $state<(typeof RES)[number][0]>('all');
  let limit = $state(PAGE);
  const filtered = $derived(!!q.trim() || src !== 'all' || res !== 'all');
  $effect(() => { void q; void src; void res; void tab; limit = PAGE; });
  const has = (needle: string, ...xs: (string | null | undefined)[]) => !needle || xs.some((x) => !!x && x.toLowerCase().includes(needle));
  /** 历史里的一行：Mod 任务或网页下载，按结束时间排在同一条时间线上 */
  type Entry = { key: string; at: number | null } & ({ t: ModTask; d?: undefined } | { d: BrowserDownload; t?: undefined });
  const stamp = (iso: string | null) => { const n = iso ? Date.parse(iso) : NaN; return Number.isNaN(n) ? null : n; };
  const hist = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const tasks = src === 'web' ? [] : downloads.finished
      .filter((t) => (src === 'all' || t.kind === (src === 'mod' ? 'download' : src))
        && (res === 'all' || t.state === res)
        && has(needle, t.title, t.workshopId, t.sourceId, t.error?.message));
    const webs = src !== 'all' && src !== 'web' ? [] : downloads.web
      .filter((d) => webEnded(d)
        && (res === 'all' || (res === 'done' ? d.state === 'done' : res === 'failed' && d.state !== 'done'))
        && has(needle, d.name, d.pageTitle, d.pageUrl, d.url));
    // 新的在前；没有时间的旧网页记录放最后
    const rows: Entry[] = [
      ...tasks.map((t): Entry => ({ key: `t:${t.taskId}`, at: stamp(endAt(t)), t })),
      ...webs.map((d): Entry => ({ key: `w:${d.id}`, at: stamp(webAt(d)), d })),
    ].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
    return { tasks, webs, rows, total: rows.length };
  });
  // 按本地月份分组；只渲染前 limit 条，滚到底再加载下一批
  const months = $derived.by(() => {
    const out: { key: string; label: string; total: number; rows: Entry[] }[] = [];
    const year = new Date().getFullYear();
    let budget = limit;
    for (const e of hist.rows) {
      const d = e.at === null ? null : new Date(e.at), key = d ? `${d.getFullYear()}-${d.getMonth()}` : 'none';
      let g = out.at(-1);
      if (g?.key !== key) out.push(g = { key, label: !d ? '没有记录时间' : d.getFullYear() === year ? `${d.getMonth() + 1} 月` : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`, total: 0, rows: [] });
      g.total++;
      if (budget > 0) { g.rows.push(e); budget--; }
    }
    return out.filter((g) => g.rows.length);
  });
  /** 删除历史里当前列出的记录（有筛选就只删找到的）；文件和 Mod 都留着 */
  async function removeShown() {
    const { tasks, webs, total: n } = hist;
    if (!n || !await app.confirm(filtered ? `删除找到的 ${n} 条记录` : '清空下载历史', `将从下载记录里删掉 ${n} 条${filtered ? '' : '，包括「当前」里已经结束的'}。\n已下载的文件、导入的 Mod 和解包出来的文件夹都会保留。`, '删除记录')) return;
    const gone = await downloads.forgetTasks(tasks.map((t) => t.taskId)) + downloads.forgetWeb(webs.map((d) => d.id));
    if (archive && webs.some((d) => d.id === archive?.id)) archive = null;
    if (gone) app.notify({ kind: 'ok', text: `已删除 ${gone} 条记录，文件都还在` });
  }
  function more(node: HTMLElement) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) limit += PAGE; }, { rootMargin: '400px' });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }
  function resetFilters() { q = ''; src = 'all'; res = 'all'; }
  const queued = $derived(downloads.active.filter((t) => t.state === 'queued').length);
  const failed = $derived(downloads.finished.filter((t) => t.state === 'failed').length);
  const cancelable = $derived(downloads.active.filter((t) => t.cancelable));
  const paused = $derived(downloads.paused.length);

  // 并发 / 限速的小面板：点外面或按 Esc 收起
  let limitsOpen = $state(false);
  const MiB = 1048576;
  const limitLabel = $derived(downloads.limits ? `同时 ${downloads.limits.maxConcurrent} 个 · ${downloads.limits.speedLimit ? `${+(downloads.limits.speedLimit / MiB).toFixed(2)} MiB/s` : '不限速'}` : '下载设置');
  $effect(() => { if (!downloads.limits && !downloads.limitsMissing) void downloads.loadLimits(); });
  function popover(node: HTMLElement) {
    const outside = (e: PointerEvent) => { if (!node.contains(e.target as Node)) limitsOpen = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') limitsOpen = false; };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', esc);
    return { destroy: () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', esc); } };
  }

  // 「当前」里最近 7 天按天分组；今天的下载在标题区汇总
  const DAYS = [['today', '今天'], ['yesterday', '昨天'], ['earlier', '前几天']] as const;
  function dayOf(iso: string) {
    const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), t = Date.parse(iso);
    return t >= start ? 'today' : t >= start - 86_400_000 ? 'yesterday' : 'earlier';
  }
  const byDay = $derived(DAYS.map(([k, label]) => ({ k, label, rows: downloads.recent.filter((t) => dayOf(endAt(t)) === k) })));
  const today = $derived(downloads.finished.filter((t) => t.kind === 'download' && t.state === 'done' && dayOf(endAt(t)) === 'today'));
  const todayBytes = $derived(today.reduce((n, t) => n + (t.unit === 'bytes' ? t.total ?? t.done : 0), 0));

  const summary = $derived(downloads.busy
    ? [downloads.busy > queued ? `${downloads.busy - queued} 个进行中` : '', queued ? `${queued} 个排队` : '', paused ? `${paused} 个已暂停` : '', downloads.overall !== null ? `${Math.floor(downloads.overall * 100)}%` : ''].filter(Boolean).join(' · ')
    : paused ? `${paused} 个已暂停，点「继续」接着排队`
    : today.length ? `全部结束 · 今天下载了 ${today.length} 个${todayBytes ? `，共 ${size(todayBytes)}` : ''}`
    : total ? `全部结束 · ${total} 条记录` : '创意工坊和网页里的下载都会出现在这里');

  // 顶部速度条：当前总速度、剩余、已下载、峰值 + 最近 60 秒曲线
  const measured = $derived(downloads.streams.some((id) => transfer.rates[id]));
  const speedParts = $derived(size(downloads.speed).split(' '));
  const peak = $derived(transfer.history.length ? Math.max(...transfer.history) : 0);
  const SW = 120, SH = 32, SLOTS = 60;
  const spark = $derived.by(() => {
    const h = transfer.history, n = h.length;
    if (n < 2) return null;
    const top = Math.max(peak, 1) * 1.15;
    const pts = h.map((v, i) => [((SLOTS - n + i) / (SLOTS - 1)) * SW, SH - (v / top) * (SH - 2)]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
    return { line, area: `${line}L${SW},${SH}L${pts[0][0].toFixed(2)},${SH}Z` };
  });
  function rateText(r: Rate) {
    if (r.stalled) return `${r.stalled} 秒没有新数据`;
    if (!r.speed) return '';
    return `${size(r.speed)}/s${r.eta !== null ? ` · ${left(r.eta)}` : ''}`;
  }

  // 「加入方案」加进启动方案（没有就用正在编辑的方案）
  const target = $derived(app.activeProfile ?? app.editingProfile);
  function addToProfile(id: string) {
    const p = target;
    if (p) void app.setModsEnabled([id], true, p, `已加入「${p.name}」`);
  }
  async function cancelAll() {
    const list = cancelable;
    if (!list.length || !await app.confirm('取消全部下载', `将取消 ${list.length} 个进行中和排队的任务。\n取消后可以在「已结束」里重试。`, '全部取消')) return;
    for (const t of list) await app.cancelTask(t.taskId);
  }

  const isMod = (d: BrowserDownload) => /\.(vpk|zip)$/i.test(d.name);
  const ext = (name: string) => (name.match(/\.([a-z0-9]{1,4})$/i)?.[1] ?? 'file').toUpperCase();
  function view(modId: string) { app.focusMod = modId; app.route = 'mods'; }
  function openUrl(url: string) { browser.open(url); app.route = 'browser'; }
  function openSource(d: BrowserDownload) { if (d.pageUrl) openUrl(d.pageUrl); }
  /** 确认框里的来源：找到作者页就写作者页，下载页放括号里 */
  function sourceText(d: BrowserDownload) {
    const page = d.pageTitle || d.pageUrl;
    const found = trail.creatorsOf(d);
    return found.length ? `${found.map((c) => `${CREATOR_LABEL[c.source]} · ${c.title}`).join('、')}${page ? `（下载页：${page}）` : ''}` : page;
  }
  function openWeb() {
    const blank = tabs.getSnapshot().tabs.find((t) => t.url === 'start');
    if (blank) tabs.activate(blank.id); else tabs.newTab();
    app.route = 'browser';
  }

  async function importDownload(d: BrowserDownload) {
    working = d.id;
    try {
      if (/\.zip$/i.test(d.name)) {
        if (archive?.id === d.id) { archive = null; return; }
        const listing = await api.browserArchive(d.id);
        archive = { id: d.id, listing, selected: listing.items.map((i) => i.name) };
      } else {
        const info = await api.previewMod(d.path);
        if (!await app.confirm('导入下载的 VPK', `${info.title}\n${info.sizeMB.toFixed(1)} MiB · ${info.fileCount} 个资源\n来源：${sourceText(d)}\n\n导入后默认启用，下次启动生效。${info.warning ? '\n' + info.warning : ''}`, '导入')) return;
        await api.browserImport(d.id, undefined, toModCreators(trail.creatorsOf(d)));
        await app.refresh(); app.notify({ kind: 'ok', text: '已导入「新下载」并启用' });
      }
    } catch (e) { app.notify({ kind: 'error', text: errorText(e) }); }
    finally { working = ''; }
  }
  async function importArchive(d: BrowserDownload) {
    if (!archive) return;
    const a = archive; working = d.id;
    try {
      if (!await app.confirm('导入压缩包中的 Mod', `已选 ${a.selected.length} 个 VPK。\n来源：${sourceText(d)}\n\n分卷数据会一起解压，导入后默认启用，下次启动生效。`, '导入所选')) return;
      const result = await api.browserImport(d.id, a.selected, toModCreators(trail.creatorsOf(d)));
      await app.refresh(); archive = null;
      app.notify({ kind: result.errors.length ? 'error' : 'ok', text: `已导入 ${result.imported.length} 个 Mod${result.errors.length ? `；${result.errors.join('；')}` : '，已启用'}`, ms: 8000 });
    } catch (e) { app.notify({ kind: 'error', text: errorText(e) }); }
    finally { working = ''; }
  }
  function toggleEntry(name: string) { if (archive) archive.selected = archive.selected.includes(name) ? archive.selected.filter((n) => n !== name) : [...archive.selected, name]; }
</script>

{#snippet task(t: ModTask, inHistory = false)}
  {@const done = ended(t)}
  {@const r = ratio(t)}
  {@const currentRoot = !t.gameRoot || t.gameRoot.toLowerCase() === app.game.root.toLowerCase()}
  {@const mod = t.modId && currentRoot ? app.mod(t.modId) : undefined}
  {@const gone = t.state === 'done' && (t.kind === 'download' || t.kind === 'pack') && !!t.modId && !mod && currentRoot && app.capabilities.mods}
  {@const rate = streaming(t) ? transfer.rates[t.taskId] : undefined}
  {@const fresh = downloads.fresh.has(t.taskId)}
  <div class="row" class:failed={t.state === 'failed'} class:muted={t.state === 'canceled'} class:fresh>
    <span class="pv">
      {#if mod}<ModThumb {mod} />{:else if t.kind === 'download'}<Download size={16} />{:else}<PackageOpen size={16} />{/if}
      {#if t.state === 'done'}<i class="ok" class:pop={fresh}><Check size={10} strokeWidth={3} /></i>{/if}
    </span>
    <div class="body">
      <div class="name-line">
        <span class="name" title={t.title}>{t.title}</span>
        {#if !done && r !== null}<span class="pct mono" class:held={t.state === 'paused'}>{Math.floor(r * 100)}%</span>
        {:else if done}{@const at = endAt(t)}<time class="when mono" datetime={at} title={new Date(at).toLocaleString()}>{when(at)}</time>{/if}
      </div>
      <div class="sub-line">
        <span class="sub" title={t.state === 'failed' ? t.error?.code : undefined}>{#if gone}<i class="gone">已删除</i>{/if}{taskLine(t)}{#if t.archiveCleaned} · 压缩包已清理{/if}</span>
        {#if rate}<span class="rate mono" class:stall={rate.stalled > 0}>{rateText(rate)}</span>{/if}
      </div>
      {#if !done}<span class="track" class:indet={r === null && t.state !== 'queued' && t.state !== 'paused'} class:queued={t.state === 'queued'} class:paused={t.state === 'paused'} class:stall={!!rate?.stalled} class:verify={t.state === 'verifying'}><span class="fill" style:transform="scaleX({r ?? 0})"></span></span>{/if}
    </div>
    <span class="ops">
      {#if t.state === 'done' && t.kind === 'extract' && t.dir}
        {@const dir = t.dir}
        <button class="btn sm ghost" onclick={() => app.reveal(dir)}><FolderOpen size={13} />打开文件夹</button>
      {:else if t.state === 'done' && t.kind === 'pack' && t.output}
        <button class="btn sm ghost" onclick={()=>app.reveal(t.output!)}><FolderOpen size={13}/>查看 VPK</button>
      {:else if gone && t.workshopId}
        {@const wid = t.workshopId}
        <button class="btn sm tonal" disabled={!app.game?.installed} title="Mod 已经删掉了，从创意工坊重新下载" onclick={() => void app.downloadWorkshop([wid])}><RotateCcw size={13} />重新下载</button>
      {:else if t.state === 'done' && (t.kind === 'download' || t.kind === 'pack') && t.modId && !gone && currentRoot}
        {@const id = t.modId}
        {#if mod && target}
          {#if target.modIds.includes(id)}<span class="inp" title={`已在「${target.name}」里`}><Check size={12} />已在方案</span>
          {:else}<button class="btn sm tonal" disabled={!!app.busy} title={`加入「${target.name}」`} onclick={() => addToProfile(id)}><Plus size={13} />加入方案</button>{/if}
        {/if}
        <button class="btn sm ghost" onclick={() => view(id)}>查看<ArrowRight size={13} /></button>
      {/if}
      {#if t.state === 'failed' || t.state === 'canceled'}
        {#if t.source === 'gamemaps' && t.dir}
          {@const dir = t.dir}
          <button class="btn sm ghost" onclick={() => app.reveal(dir)}><FolderOpen size={13} />打开文件夹</button>
        {/if}
        <button class="btn sm ghost" onclick={() => app.retryTask(t.taskId)}><RotateCcw size={13} />重试</button>
      {/if}
      {#if t.workshopId && t.source !== 'gamemaps'}
        {@const wid = t.workshopId}
        <button class="icon-btn" title="在创意工坊查看" aria-label={`在创意工坊查看 ${t.title}`} onclick={() => openUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${wid}`)}><ExternalLink size={14} /></button>
      {/if}
      {#if t.state === 'paused'}
        {@const redo = !t.resumable && t.done > 0}
        <button class="btn sm tonal" title={redo ? (t.kind === 'extract' ? '回到队尾，重新解包' : '回到队尾，从头重新下载') : '回到队尾，有空位就开始'} onclick={() => app.resumeTask(t.taskId)}><Play size={13} />继续</button>
      {:else if !done && t.pausable}
        <button class="icon-btn" title={`暂停，让后面的先${t.kind === 'extract' ? '做' : '下'}${!t.resumable && t.done > 0 ? (t.kind === 'extract' ? '（继续时会重新解包）' : '（继续时会从头下载）') : ''}`} aria-label={`暂停 ${t.title}`} onclick={() => app.pauseTask(t.taskId)}><Pause size={14} /></button>
      {/if}
      {#if !done && t.cancelable}
        <button class="icon-btn" title="取消" aria-label={`取消 ${t.title}`} data-sfx="close" onclick={() => app.cancelTask(t.taskId)}><X size={14} /></button>
      {:else if done && inHistory}
        <button class="icon-btn del" title="删除这条记录（Mod 和文件都不动）" aria-label={`删除记录 ${t.title}`} data-sfx="close" onclick={() => void downloads.forgetTasks([t.taskId])}><Trash size={14} /></button>
      {:else if done}
        <button class="icon-btn" title="收进历史" aria-label={`把 ${t.title} 收进历史`} data-sfx="close" onclick={() => downloads.archived.add(t.taskId)}><X size={14} /></button>
      {/if}
    </span>
  </div>
{/snippet}

{#snippet web(d: BrowserDownload, inHistory = false)}
  {@const live = d.state === 'downloading'}
  {@const sized = webSized(d)}
  {@const wr = sized && d.total ? Math.min(1, d.received! / d.total) : null}
  {@const rate = sized ? transfer.rates[d.id] : undefined}
  {@const fresh = downloads.fresh.has(d.id)}
  <div class="row" class:failed={d.state === 'failed' || d.state === 'interrupted'} class:fresh>
    <span class="pv file"><span class="ext mono">{ext(d.name)}</span>{#if d.state === 'done'}<i class="ok" class:pop={fresh}><Check size={10} strokeWidth={3} /></i>{/if}</span>
    <div class="body">
      <div class="name-line">
        <span class="name" title={d.name}>{d.name}</span>
        {#if wr !== null}<span class="pct mono">{Math.floor(wr * 100)}%</span>
        {:else if !live && webAt(d)}{@const at = webAt(d)!}<time class="when mono" datetime={at} title={new Date(at).toLocaleString()}>{when(at)}</time>{/if}
      </div>
      <div class="sub-line">
        <span class="sub">{d.cleaned ? '已导入 · 压缩包已清理' : d.state === 'done' ? `${mib(d.size ?? 0)}${isMod(d) ? '' : ' · 解压后再导入 VPK'}` : live ? (sized ? `下载中 · ${size(d.received!)}${d.total ? ` / ${size(d.total)}` : ''}` : '正在从网页下载…') : d.state === 'interrupted' ? '下载已中断，请回到原网页重新下载' : '下载失败，请回到原网页重试'}</span>
        {#if rate}<span class="rate mono" class:stall={rate.stalled > 0}>{rateText(rate)}</span>{/if}
      </div>
      {#if live}<span class="track" class:indet={wr === null} class:stall={!!rate?.stalled}><span class="fill" style:transform="scaleX({wr ?? 0})"></span></span>{/if}
      {#if d.pageUrl || trail.creatorsOf(d).length}
        {@const creators = trail.creatorsOf(d)}
        <span class="sources">
          {#each creators as c (c.key)}<button class="source creator" title={`作者页：${c.url}`} onclick={() => openUrl(c.url)}><Heart size={10} fill="currentColor" />{CREATOR_LABEL[c.source]} · {c.title}</button>{/each}
          {#if d.pageUrl}<button class="source" title={d.pageUrl} onclick={() => openSource(d)}><Globe size={11} />{d.pageTitle || d.pageUrl}<ArrowUpRight size={11} /></button>{/if}
        </span>
      {/if}
    </div>
    <span class="ops">
      {#if d.cleaned && (d.pageUrl || d.url)}
        <button class="btn sm ghost" onclick={() => openUrl(d.pageUrl || d.url)}>回来源页</button>
      {:else if d.state === 'done' && !d.cleaned}
        <button class="icon-btn" title="在资源管理器中查看" aria-label="在资源管理器中查看" onclick={() => app.reveal(d.path)}><FolderOpen size={14} /></button>
        {#if isMod(d)}
          <button class="btn sm solid" disabled={!!working || app.game?.running || !app.game?.installed} title={app.game?.running ? '游戏运行中，退出后可导入' : ''} onclick={() => importDownload(d)}>
            {working === d.id && !archive ? '处理中…' : /\.zip$/i.test(d.name) ? (archive?.id === d.id ? '收起' : '选择内容') : '导入'}
          </button>
        {/if}
      {/if}
      {#if !live && inHistory}<button class="icon-btn del" title="删除这条记录（文件保留）" aria-label={`删除记录 ${d.name}`} data-sfx="close" onclick={() => { downloads.forgetWeb([d.id]); if (archive?.id === d.id) archive = null; }}><Trash size={14} /></button>
      {:else if !live}<button class="icon-btn" title="收进历史（文件保留）" aria-label={`把 ${d.name} 收进历史`} data-sfx="close" onclick={() => { downloads.archivedWeb.add(d.id); if (archive?.id === d.id) archive = null; }}><X size={14} /></button>{/if}
    </span>
  </div>
  {#if archive?.id === d.id}
    {@const a = archive}
    <div class="archive" in:fly={{ ...enter, y: still ? 0 : -4 }}>
      <div class="arc-head"><span>{a.listing.items.length} 个 VPK · 已选 {a.selected.length}</span>
        <button class="btn sm ghost" onclick={() => (a.selected = a.selected.length === a.listing.items.length ? [] : a.listing.items.map((i) => i.name))}>{a.selected.length === a.listing.items.length ? '全不选' : '全选'}</button></div>
      {#each a.listing.items as item (item.name)}
        <label class="entry"><input type="checkbox" checked={a.selected.includes(item.name)} onchange={() => toggleEntry(item.name)} /><span>{item.name}</span><small class="mono">{mib(item.size)}</small></label>
      {:else}<p class="hint">这个 ZIP 里没有可导入的 VPK。</p>{/each}
      <div class="arc-foot">
        <button class="btn sm ghost" onclick={() => (archive = null)}>取消</button>
        <button class="btn sm solid" disabled={!a.selected.length || !!working || app.game.running} onclick={() => importArchive(d)}>{working === d.id ? '正在导入…' : `导入所选 ${a.selected.length} 个`}</button>
      </div>
    </div>
  {/if}
{/snippet}

<section class="page" aria-label="下载">
  <header class="head">
    <div class="top">
      <div class="ttl">
        <div class="tline">
          <h1>下载</h1>
          {#if total}
            <div class="seg" role="tablist" aria-label="下载视图">
              <button role="tab" aria-selected={tab === 'now'} class:on={tab === 'now'} data-sfx="tab" onclick={() => (tab = 'now')}>当前</button>
              <button role="tab" aria-selected={tab === 'history'} class:on={tab === 'history'} data-sfx="tab" onclick={() => (tab = 'history')}><History size={13} />历史<span class="n mono">{downloads.historyCount}</span></button>
            </div>
          {/if}
        </div>
        <p class="sub" role="status">{tab === 'history' ? `共 ${downloads.historyCount} 条记录${filtered ? ` · 找到 ${hist.total} 条` : ''}` : summary}</p>
      </div>
      <div class="acts">
        {#if tab === 'now'}
          {#if downloads.pausable.length > 1}<button class="btn ghost" title="排队和正在下的都先停下，进度条保留" onclick={() => downloads.pauseAll()}><Pause size={14} />全部暂停</button>{/if}
          {#if paused > 1}<button class="btn ghost" title="按原来的先后回到队尾" onclick={() => downloads.resumeAll()}><Play size={14} />全部继续</button>{/if}
          {#if cancelable.length > 1}<button class="btn ghost" onclick={cancelAll}><X size={14} />全部取消</button>{/if}
          {#if failed > 1}<button class="btn ghost" onclick={() => downloads.retryFailed()}><RotateCcw size={14} />重试失败的 {failed} 个</button>{/if}
          {#if canClear}<button class="btn ghost" title="结束的记录离开「当前」，在「历史」里还能找到" onclick={() => downloads.clearEnded()}>全部收进历史</button>{/if}
        {/if}
        {#if !downloads.limitsMissing}
          <div class="lim-wrap" use:popover>
            <button class="btn ghost" class:on={limitsOpen} aria-expanded={limitsOpen} aria-haspopup="dialog" title="同时下载数和限速" onclick={() => (limitsOpen = !limitsOpen)}><Gauge size={14} /><span class="mono-num">{limitLabel}</span></button>
            {#if limitsOpen}
              <div class="lim-pop" role="dialog" aria-label="下载设置" transition:fly={{ y: still ? 0 : -6, duration: still ? 0 : 180, easing: cubicOut }}>
                <DownloadLimits compact />
                <button class="lim-more" onclick={() => { limitsOpen = false; app.route = 'settings'; nav.settings = 'downloads'; }}>系统通知等更多设置<ArrowRight size={12} /></button>
              </div>
            {/if}
          </div>
        {/if}
        <button class="btn tonal" onclick={() => (app.route = 'workshop')}><Compass size={14} />去创意工坊</button>
      </div>
    </div>
    {#if tab === 'history' && total}
      <div class="hbar" transition:slide={{ duration: still ? 0 : 200, easing: cubicOut }}>
        <label class="search">
          <Search size={14} />
          <input aria-label="搜索下载记录" placeholder="搜索名字、工坊 ID、来源网页" bind:value={q} />
          {#if q}<button class="clear" aria-label="清空搜索" onclick={() => (q = '')}><X size={13} /></button>{/if}
        </label>
        <div class="chips" role="radiogroup" aria-label="来源">{#each SRC as [k, label] (k)}<button class="chip" role="radio" aria-checked={src === k} class:on={src === k} onclick={() => (src = k)}>{label}</button>{/each}</div>
        <span class="dv" aria-hidden="true"></span>
        <div class="chips" role="radiogroup" aria-label="结果">{#each RES as [k, label] (k)}<button class="chip" role="radio" aria-checked={res === k} class:on={res === k} onclick={() => (res = k)}>{label}</button>{/each}</div>
        {#if hist.total}<button class="btn ghost wipe" title="只删记录，文件和 Mod 都留着" onclick={removeShown}><Trash size={13} />{filtered ? `删除找到的 ${hist.total} 条` : '清空历史'}</button>{/if}
      </div>
    {/if}
    {#if downloads.measuring}
      <div class="meter" transition:slide={{ duration: still ? 0 : 220, easing: cubicOut }}>
        <div class="now" aria-label="当前总速度">
          {#if measured}<span class="v mono">{speedParts[0]}</span><span class="u">{speedParts[1]}/s</span>
          {:else}<span class="v mono dim">—</span><span class="u">测速中</span>{/if}
        </div>
        <dl class="stats">
          <div><dt>{downloads.waiting ? '这批剩余' : '剩余'}</dt><dd class="mono">{downloads.eta !== null ? eta(downloads.eta) : '—'}</dd></div>
          <div><dt>已下载</dt><dd class="mono">{size(downloads.received.done)}{downloads.received.total ? ` / ${size(downloads.received.total)}` : ''}</dd></div>
          <div><dt>峰值</dt><dd class="mono">{peak ? `${size(peak)}/s` : '—'}</dd></div>
        </dl>
        <svg class="spark" viewBox="0 0 {SW} {SH}" preserveAspectRatio="none" aria-hidden="true">
          {#if spark}<path class="area" d={spark.area} /><path class="line" d={spark.line} />{/if}
        </svg>
      </div>
    {/if}
    {#if downloads.busy}<span class="overall" class:indet={downloads.overall === null} transition:fade={{ duration: 150 }}><span style:transform="scaleX({downloads.overall ?? 0})"></span></span>{/if}
  </header>

  <div class="scroll">
    {#if !total}
      <div class="empty" in:fade={{ duration: 200 }}>
        <span class="empty-ic"><Download size={26} strokeWidth={1.75} /></span>
        <h2>还没有下载</h2>
        <p>在创意工坊点「下载」，或在网页里下载 VPK / ZIP，进度和文件都会出现在这里。</p>
        <div class="empty-acts"><button class="btn tonal" onclick={() => (app.route = 'workshop')}><Compass size={14} />逛创意工坊</button><button class="btn ghost" onclick={openWeb}><Globe size={14} />打开网页</button></div>
      </div>
    {:else if tab === 'history'}
      {#if !hist.total}
        <div class="empty small" in:fade={{ duration: 160 }}>
          <span class="empty-ic"><Search size={22} strokeWidth={1.75} /></span>
          <h2>{filtered ? '没有符合条件的记录' : '还没有历史记录'}</h2>
          {#if filtered}<div class="empty-acts"><button class="btn tonal" onclick={resetFilters}>清除筛选</button></div>{/if}
        </div>
      {:else}
        {#each months as g (g.key)}
          <section class="group">
            <h2>{g.label}<span class="n mono">{g.total}</span>{#if g.key === 'none'}<small>旧版的网页下载没有记下时间</small>{/if}</h2>
            <div class="rows">{#each g.rows as e (e.key)}<div class="slot" animate:flip={move} out:fade={{ duration: still ? 0 : 140 }}>{#if e.t}{@render task(e.t, true)}{:else if e.d}{@render web(e.d, true)}{/if}</div>{/each}</div>
          </section>
        {/each}
        {#if limit < hist.total}
          {#key limit}<div class="sentinel" use:more aria-hidden="true"></div>{/key}
          <p class="loading-more">还有 {hist.total - limit} 条，往下滚继续加载…</p>
        {/if}
      {/if}
    {:else}
      <!-- 分组一直渲染、没有行时用 CSS 藏起来：这样行在分组之间飞过去时，进出动画两头都能播 -->
      <section class="group">
        <h2>进行中<span class="n mono">{downloads.active.length + downloads.webActive.length}</span>{#if downloads.limits && downloads.live.length > downloads.limits.maxConcurrent}<small>同时下 {downloads.limits.maxConcurrent} 个，其余排队</small>{/if}</h2>
        <div class="rows">
          {#each downloads.active as t (t.taskId)}<div class="slot" animate:flip={move} in:receive={{ key: `t:${t.taskId}` }} out:send={{ key: `t:${t.taskId}` }}>{@render task(t)}</div>{/each}
          {#each downloads.webActive as d (d.id)}<div class="slot" animate:flip={move} in:receive={{ key: `w:${d.id}` }} out:send={{ key: `w:${d.id}` }}>{@render web(d)}</div>{/each}
        </div>
      </section>
      <section class="group">
        <h2>网页下载<span class="n mono">{webDone.length}</span><small>VPK 直接导入，ZIP 先选里面的 VPK</small></h2>
        {#if app.game?.running && webDone.length}<p class="hint warn">游戏运行中，退出游戏后可导入 Mod。</p>{/if}
        <div class="rows">{#each webDone as d (d.id)}<div class="slot" animate:flip={move} in:receive={{ key: `w:${d.id}` }} out:send={{ key: `w:${d.id}` }}>{@render web(d)}</div>{/each}</div>
      </section>
      <section class="group">
        <h2>最近 7 天<span class="n mono">{downloads.recent.length}</span><small>创意工坊下载会放进 Mod 页的「新下载」</small></h2>
        {#each byDay as g (g.k)}
          <div class="day">
            <h3>{g.label}<span class="mono">{g.rows.length}</span></h3>
            <div class="rows">{#each g.rows as t (t.taskId)}<div class="slot" animate:flip={move} in:receive={{ key: `t:${t.taskId}` }} out:send={{ key: `t:${t.taskId}` }}>{@render task(t)}</div>{/each}</div>
          </div>
        {/each}
      </section>
      {#if !downloads.busy && !downloads.recent.length && !downloads.webRecent.length}<p class="calm">最近 7 天没有新的下载。</p>{/if}
      {#if older}<button class="more-link" onclick={() => (tab = 'history')}><History size={14} />还有 {older} 条更早的记录在「历史」里<ArrowRight size={13} /></button>{/if}
    {/if}
  </div>
</section>

<style>
  .page { height: 100%; display: flex; flex-direction: column; }
  .head { position: relative; padding: 20px 24px 16px; border-bottom: 1px solid var(--line-soft); flex: none; }
  .top { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }

  /* 速度条：大号当前速度 + 三个小数字 + 60 秒曲线（主色） */
  .meter { position: relative; display: flex; align-items: flex-end; gap: 32px; padding-top: 18px; }
  .now, .stats { position: relative; z-index: 1; }
  .now { display: flex; align-items: baseline; gap: 6px; min-width: 128px; flex: none; }
  .now .v { font-size: 28px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .now .v.dim { color: var(--fg-4); }
  .now .u { font-size: 12px; color: var(--fg-3); }
  .stats { display: flex; gap: 28px; margin: 0; flex: none; }
  .stats div { display: flex; flex-direction: column; gap: 4px; }
  .stats dt { font-size: 11px; color: var(--fg-4); }
  .stats dd { margin: 0; font-size: 12px; line-height: 1; color: var(--fg-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* 曲线铺满整条标题区底部，数字叠在上面；最新的一秒在最右 */
  .spark { position: absolute; left: -24px; right: -24px; top: 4px; bottom: -16px; width: calc(100% + 48px); height: calc(100% + 12px); pointer-events: none; }
  .spark .area { fill: var(--md-primary); opacity: .1; }
  .spark .line { fill: none; stroke: var(--md-primary); stroke-opacity: .55; stroke-width: 1.5; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  h1 { margin: 0; font-size: 20px; font-weight: 700; }
  /* 标题和视图切换不折行：按钮多时让右边的按钮折行，不挤这里 */
  .tline { display: flex; align-items: center; gap: 14px; white-space: nowrap; }
  /* 当前 / 历史：和 Mod 页筛选同一种分段胶囊 */
  .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); }
  .seg button { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 12px; border-radius: 9px; color: var(--fg-2); font-size: 13px; transition: background var(--dur), color var(--dur); }
  .seg button:hover { color: var(--fg); }
  .seg button.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .seg .n { font-size: 11px; opacity: .7; }
  /* 历史的搜索 + 筛选条 */
  .hbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 14px; }
  .search { display: flex; align-items: center; gap: 6px; height: 32px; flex: 0 1 300px; min-width: 180px; padding: 0 8px 0 12px; border: 1px solid transparent; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); color: var(--fg-4); transition: border-color var(--dur), background var(--dur); }
  .search:focus-within { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); background: color-mix(in srgb, var(--md-surface-bright) 85%, transparent); }
  .search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: none; font-size: 13px; }
  .search .clear { display: grid; place-items: center; color: var(--fg-3); }
  .search .clear:hover { color: var(--fg); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .dv { width: 1px; height: 18px; background: var(--line-strong); }
  .sub { margin: 4px 0 0; font-size: 12px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
  /* 批量按钮多了（暂停、继续、取消、收起、重试）就折到第二行，靠右 */
  .acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; flex: 0 1 auto; min-width: 0; }
  .acts .btn { height: 32px; padding: 0 14px; border-radius: 12px; }
  .acts .btn.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .mono-num { font-variant-numeric: tabular-nums; }
  /* 并发 / 限速小面板：挂在按钮下方右对齐的浮岛 */
  .lim-wrap { position: relative; }
  .lim-pop { position: absolute; z-index: 20; top: calc(100% + 8px); right: 0; width: 340px; padding: 4px 0 0; border: 1px solid var(--island-line); border-radius: 18px; background: var(--md-surface-container); box-shadow: 0 18px 40px -18px rgb(0 0 0 / .45); overflow: hidden; }
  .lim-more { display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; height: 36px; border-top: 1px solid var(--line-soft); font-size: 12px; color: var(--fg-3); transition: background var(--dur), color var(--dur); }
  .lim-more:hover { background: var(--hover); color: var(--fg); }
  .wipe { margin-left: auto; height: 30px; border-radius: 10px; font-size: 12px; }
  .wipe:hover { color: var(--danger); }
  /* 总进度：贴在标题区底边 */
  .overall { position: absolute; left: 0; right: 0; bottom: -1px; height: 3px; overflow: hidden; }
  .overall span { display: block; height: 100%; background: var(--md-primary); transform-origin: left; transition: transform 400ms var(--ease-out); }
  .overall.indet span { transform: scaleX(0.25) !important; animation: sweep 1.3s var(--ease-in-out) infinite; }

  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 24px 32px; }
  .group { margin-top: 18px; }
  /* 没有行的分组 / 日期不显示（离场动画播放期间行还在，所以分组会等动画播完才收起） */
  .group:not(:has(.slot)), .day:not(:has(.slot)) { display: none; }
  h2 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--fg-2); }
  h2 .n { font-size: 11px; font-weight: 400; color: var(--fg-3); }
  h2 small { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--fg-4); }
  .day + .day { margin-top: 12px; }
  h3 { display: flex; align-items: baseline; gap: 6px; margin: 0 2px 6px; font-size: 11px; font-weight: 400; color: var(--fg-3); }
  h3 .mono { color: var(--fg-4); }

  /* 列表：和 Mod 页卡片同一种浮岛底 */
  .rows { border: 1px solid var(--island-line); border-radius: 16px; background: color-mix(in srgb, var(--md-surface-bright) 62%, transparent); overflow: hidden; }
  .slot + .slot { border-top: 1px solid var(--line-soft); }
  .row { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 12px; transition: background var(--dur); }
  .row:hover { background: var(--hover); }
  /* 刚完成：整行用主色容器色亮一下再褪掉 */
  .row.fresh { animation: glow 1.8s var(--ease-out); }
  @keyframes glow { from { background: color-mix(in srgb, var(--md-primary-container) 75%, transparent); } }
  .row.muted .name { color: var(--fg-3); }
  .pv { position: relative; display: grid; place-items: center; width: 44px; height: 44px; flex: none; border: 1px solid var(--line-soft); border-radius: 12px; background: var(--md-surface-container-high); color: var(--fg-3); }
  .pv :global(.thumb) { border-radius: 11px; }
  .file { background: var(--md-secondary-container); }
  .ext { font-size: 10px; letter-spacing: .04em; color: var(--md-on-secondary-container); }
  /* 完成的小勾：刚完成时弹一下，外面散开一圈 */
  .ok { position: absolute; right: -5px; bottom: -5px; display: grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; background: var(--md-primary); color: var(--md-on-primary); box-shadow: 0 0 0 2px var(--md-surface); }
  .ok.pop { animation: pop 460ms var(--ease-out); }
  .ok.pop::after { content: ''; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid var(--md-primary); animation: ring 700ms 120ms var(--ease-out) both; }
  @keyframes pop { 0% { transform: scale(0.4); opacity: 0; } 60% { transform: scale(1.22); opacity: 1; } 100% { transform: scale(1); } }
  @keyframes ring { from { transform: scale(1); opacity: .8; } to { transform: scale(2.6); opacity: 0; } }
  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .name-line { display: flex; align-items: baseline; gap: 10px; }
  .name { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pct { font-size: 12px; color: var(--md-primary); font-variant-numeric: tabular-nums; }
  .when { flex: none; font-size: 11px; color: var(--fg-4); font-variant-numeric: tabular-nums; }
  .sub-line { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .row .sub { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .failed .sub { color: var(--danger); white-space: normal; overflow-wrap: anywhere; }
  .rate { flex: none; font-size: 12px; color: var(--fg-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rate.stall { color: var(--fg-3); }
  .pct.held { color: var(--fg-3); }

  /* 进度条：主色；下载中有一道很淡的流光，停滞时变暗呼吸，校验换成第三色 */
  .track { position: relative; height: 4px; margin-top: 5px; border-radius: 2px; background: color-mix(in srgb, var(--md-on-surface) 10%, transparent); overflow: hidden; }
  .track .fill { position: absolute; inset: 0; overflow: hidden; background: var(--md-primary); border-radius: 2px; transform-origin: left; transition: transform 400ms var(--ease-out); }
  .track .fill::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--md-on-primary) 45%, transparent), transparent); transform: translateX(-100%); animation: glint 1.8s var(--ease-in-out) infinite; }
  .track:is(.indet, .stall, .verify, .queued, .paused) .fill::after { display: none; }
  /* 暂停：进度条留着，换成不抢眼的灰 */
  .track.paused .fill { background: color-mix(in srgb, var(--md-on-surface) 32%, transparent); }
  .track.indet .fill { transform: scaleX(0.3) !important; animation: sweep 1.2s var(--ease-in-out) infinite; }
  .track.stall .fill { animation: breathe 1.6s var(--ease-in-out) infinite alternate; }
  .track.verify .fill { background: var(--md-tertiary); }
  @keyframes glint { to { transform: translateX(100%); } }
  @keyframes breathe { from { opacity: .9; } to { opacity: .3; } }
  @keyframes sweep { from { translate: -100% 0; } to { translate: 340% 0; } }
  .source { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; margin-top: 1px; font-size: 11px; color: var(--fg-4); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .source:hover { color: var(--fg-2); }
  /* 作者页在前、下载页在后；窄的时候下载页先被省略 */
  .sources { display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%; }
  .sources .source { flex: 0 1 auto; min-width: 0; }
  .sources .creator { flex-shrink: 0; max-width: 60%; color: var(--fg-3); }
  .sources .creator :global(svg) { color: var(--accent); }
  .ops { display: flex; align-items: center; gap: 4px; flex: none; }
  .ops .btn { height: 28px; border-radius: 10px; }
  /* 主操作（导入）：主色；次操作（加入方案、去创意工坊）：次级容器色 */
  .solid { background: var(--md-primary); border-color: var(--md-primary); color: var(--md-on-primary); }
  .solid:hover { background: var(--md-primary); border-color: var(--md-primary); filter: brightness(1.07); }
  .tonal { background: var(--md-secondary-container); border-color: transparent; color: var(--md-on-secondary-container); }
  .tonal:hover { background: color-mix(in srgb, var(--md-secondary-container) 88%, var(--md-on-secondary-container)); border-color: transparent; }
  .inp { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px; font-size: 12px; color: var(--md-primary); white-space: nowrap; }
  .gone { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 6px; background: color-mix(in srgb, var(--md-on-surface) 8%, transparent); color: var(--fg-2); font-size: 11px; font-style: normal; }
  .icon-btn.del:hover { color: var(--danger); }
  /* 「当前」底部：去历史的入口 */
  .calm { margin: 48px 0 0; text-align: center; font-size: 13px; color: var(--fg-3); }
  .more-link { display: flex; align-items: center; gap: 6px; height: 32px; margin: 22px auto 0; padding: 0 14px; border-radius: 12px; color: var(--fg-2); font-size: 12px; transition: background var(--dur), color var(--dur); }
  .more-link:hover { background: var(--hover); color: var(--fg); }
  .sentinel { height: 1px; }
  .loading-more { margin: 14px 0 0; text-align: center; font-size: 12px; color: var(--fg-4); }
  .empty.small { padding: 64px 20px; }
  .btn:disabled { opacity: .4; cursor: default; pointer-events: none; }

  .archive { padding: 4px 12px 12px 68px; border-top: 1px dashed var(--line-soft); background: color-mix(in srgb, var(--md-surface-container) 55%, transparent); }
  .arc-head { display: flex; align-items: center; justify-content: space-between; height: 34px; font-size: 12px; color: var(--fg-3); }
  .entry { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 8px; border-radius: 8px; font-size: 12px; cursor: pointer; }
  .entry:hover { background: var(--hover); }
  .entry input { width: 14px; height: 14px; margin: 0; padding: 0; accent-color: var(--md-primary); }
  .entry span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .entry small { color: var(--fg-3); }
  .arc-foot { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
  .hint { margin: 0 0 8px; font-size: 12px; color: var(--fg-3); }
  .hint.warn { color: var(--danger); }

  /* 空状态：主色容器里的下载图标，轻轻上下浮 */
  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 96px 20px; color: var(--fg-3); }
  .empty-ic { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 22px; background: var(--md-primary-container); color: var(--md-on-primary-container); box-shadow: 0 14px 28px -16px color-mix(in srgb, var(--md-primary) 80%, transparent); animation: bob 3.2s var(--ease-in-out) infinite; }
  @keyframes bob { 50% { transform: translateY(-5px); } }
  .empty h2 { justify-content: center; margin: 18px 0 6px; font-size: 15px; color: var(--fg); }
  .empty p { margin: 0 0 20px; max-width: 360px; font-size: 13px; line-height: 1.7; }
  .empty-acts { display: flex; gap: 6px; }
  .empty-acts .btn { height: 32px; padding: 0 14px; border-radius: 12px; }
  @media (prefers-reduced-motion: reduce) {
    .ok.pop, .ok.pop::after, .row.fresh, .empty-ic, .track .fill::after { animation: none; }
    .track.stall .fill { animation: none; opacity: .4; }
  }
</style>
