<script lang="ts">
  import SquarePen from '@lucide/svelte/icons/square-pen';
  import History from '@lucide/svelte/icons/history';
  import Settings from '@lucide/svelte/icons/settings-2';
  import X from '@lucide/svelte/icons/x';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import Minimize2 from '@lucide/svelte/icons/minimize-2';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import Trash from '@lucide/svelte/icons/trash-2';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Wrench from '@lucide/svelte/icons/wrench';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import FolderTree from '@lucide/svelte/icons/folder-tree';
  import ScanSearch from '@lucide/svelte/icons/scan-search';
  import Activity from '@lucide/svelte/icons/activity';
  import Server from '@lucide/svelte/icons/server';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import Import from '@lucide/svelte/icons/import';
  import Search from '@lucide/svelte/icons/search';
  import Plug from '@lucide/svelte/icons/plug';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Leaf from '@lucide/svelte/icons/leaf';
  import Stethoscope from '@lucide/svelte/icons/stethoscope';
  import Rocket from '@lucide/svelte/icons/rocket';
  import FileCode from '@lucide/svelte/icons/file-code';
  import { tick } from 'svelte';
  import { checkup, laterCheckup, startCheckup } from './checkup.svelte';
  import ToolCard from './ToolCard.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import Composer from './Composer.svelte';
  import { agent } from './index';
  import { markdown } from './markdown';
  import { toolMeta } from './tools';
  import { piHost, type PiSessionInfo } from './host';
  import type { AssistantMessage, Block } from './chat.svelte';
  import { app } from '../stores/app.svelte';
  import { prefs } from '../stores/prefs.svelte';
  import { openSettings } from '../stores/nav.svelte';
  import { browser } from '../browser/browser.svelte';
  import { sfx } from '../sound/sfx.svelte';
  import { isAgentView, sendToMain } from './window.svelte';
  import { reduceMotion } from '../motion';
  import type { Route } from '../types';

  /** 在助手独立窗口里：铺满整个窗口，宽度交给系统窗口自己拖，不显示分隔条和放大按钮 */
  let { windowed = false }: { windowed?: boolean } = $props();

  type Tool = Extract<Block, { kind: 'tool' }>;
  type Seg = { kind: 'block'; b: Block; i: number } | { kind: 'group'; tools: Tool[]; key: string };

  let scroller = $state<HTMLDivElement>();
  let content = $state<HTMLDivElement>();
  let atBottom = $state(true);
  let atTop = $state(true);
  let copiedId = $state<number | null>(null);
  let groups = $state<Record<string, boolean>>({});
  let historyOpen = $state(false);
  let sessions = $state<PiSessionInfo[] | null>(null);
  let sessionsNote = $state('');
  let renaming = $state(false);
  let renameValue = $state('');
  /** 别的页面交过来的长指令（体检、DLL 接入）默认只露前几行 */
  let openUser = $state<Record<number, boolean>>({});
  const isLong = (t: string) => t.length > 360 || t.split('\n').length > 8;

  // ---------- 空状态：按当前页面给建议（都对应 tools.ts 里真实存在的工具） ----------
  /** run：不是直接发这句话，而是走专门的流程（体检要先读游戏设置再拼指令） */
  type Sug = { icon: typeof Search; text: string; run?: () => void };
  const CHECKUP: Sug = { icon: Stethoscope, text: '给游戏做个体检：启动项、CFG 和 DLL', run: () => void beginCheckup() };
  const ORGANIZE: Sug = { icon: FolderTree, text: '整理新下载的 Mod，按用途归类' };
  const STATUS: Sug = { icon: Activity, text: '检查游戏平台、L4N 和 DLL 的状态' };
  const CONFLICT: Sug = { icon: ScanSearch, text: '扫描 Mod，看看有没有资源冲突' };
  const FIND_MAPS: Sug = { icon: Search, text: '在工坊和 GameMaps 搜几张战役地图' };
  const SUGGEST: Partial<Record<Route, Sug[]>> = {
    servers: [
      { icon: Server, text: '查看服务器和自定义分类' },
      { icon: FolderTree, text: '按战役、对抗整理服务器，其他类别先给我建议' },
      { icon: Activity, text: '检查收藏服务器的在线状态和延迟' },
    ],
    mods: [ORGANIZE, CONFLICT, { icon: History, text: '看看最近的 Mod 整理记录' }],
    downloads: [{ icon: ListChecks, text: '看看下载任务的进度，失败的告诉我原因' }, { icon: Import, text: '把网页下载的 VPK 导入 Mod 库' }, ORGANIZE],
    workshop: [FIND_MAPS, ORGANIZE, CONFLICT],
    gamemaps: [FIND_MAPS, ORGANIZE, CONFLICT],
    plugins: [{ icon: Plug, text: '查看 DLL 模组和加载状态' }, { icon: RefreshCw, text: '检查 DLL 模组的来源有没有新版本' }, CHECKUP],
    settings: [CHECKUP, STATUS, CONFLICT],
  };
  const suggestions = $derived(SUGGEST[app.route] ?? [CHECKUP, ORGANIZE, CONFLICT]);

  // ---------- 第一次接上模型：先建议体检一次 ----------
  const firstMeet = $derived(checkup.mark === '');
  const CHECK_ITEMS = [
    { icon: Rocket, label: '启动项' },
    { icon: FileCode, label: 'CFG' },
    { icon: Plug, label: 'DLL 模组' },
    { icon: ScanSearch, label: 'Mod 冲突' },
  ];
  async function beginCheckup() {
    if (agent.running || checkup.starting) return;
    sfx.cute('sparkle');
    try { await startCheckup(); }
    catch (e) { app.toast(`体检没开始：${e instanceof Error ? e.message : String(e)}`); }
  }
  function later() { laterCheckup(); sfx.cute('blip'); }

  // ---------- 看板娘：按时段打招呼，戳一下会回一句 ----------
  let hour = $state(new Date().getHours());
  $effect(() => { const t = setInterval(() => (hour = new Date().getHours()), 60_000); return () => clearInterval(t); });
  const hello = $derived(hour < 5 ? '夜深啦～' : hour < 11 ? '早上好～' : hour < 13 ? '中午好～' : hour < 18 ? '下午好～' : '晚上好～');
  const POKES = ['茶茶在呢～', '随时待命！', '嘿嘿，别戳啦', '要帮忙就说～'];
  let pokeLine = $state('');
  let pokeTimer: ReturnType<typeof setTimeout> | undefined;
  function poke(e: MouseEvent) {
    const pool = POKES.filter((l) => l !== pokeLine);
    pokeLine = pool[Math.floor(Math.random() * pool.length)];
    sfx.cute('squeak');
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => (pokeLine = ''), 2000);
    if (reduceMotion()) return;
    (e.currentTarget as HTMLElement).querySelector('.squish')?.animate(
      [{ transform: 'none' }, { transform: 'scale(0.9, 1.08)' }, { transform: 'scale(1.06, 0.95)' }, { transform: 'none' }],
      { duration: 420, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
  }
  const lastAssistant = $derived([...agent.messages].reverse().find((m) => m.role === 'assistant') as AssistantMessage | undefined);
  const streaming = $derived(agent.messages.some((m) => m.role === 'assistant' && m.streaming && m.blocks.some((b) => b.kind !== 'tool' && !(b.kind === 'thinking' && b.endedAt))));
  const runningTool = $derived(agent.running ? (lastAssistant?.blocks.find((b) => b.kind === 'tool' && (b.status === 'running' || b.status === 'pending')) as Tool | undefined) : undefined);
  const waitingApproval = $derived(agent.dialogs.some((d) => d.state === 'waiting'));
  const working = $derived(!agent.running || streaming || waitingApproval ? '' : runningTool ? `正在${toolMeta(runningTool.name).label}…` : '正在思考…');

  /** 连续 3 个以上都已完成的工具调用收成一行 */
  function segments(m: AssistantMessage): Seg[] {
    const out: Seg[] = [];
    let run: { b: Tool; i: number }[] = [];
    const flush = () => {
      if (run.length >= 3 && run.every((t) => t.b.status === 'done' && !t.b.approval)) out.push({ kind: 'group', tools: run.map((t) => t.b), key: `${m.id}-${run[0].i}` });
      else out.push(...run.map((t) => ({ kind: 'block' as const, b: t.b as Block, i: t.i })));
      run = [];
    };
    m.blocks.forEach((b, i) => { if (b.kind === 'tool') run.push({ b, i }); else { flush(); out.push({ kind: 'block', b, i }); } });
    flush();
    return out;
  }
  const lastTextIndex = (m: AssistantMessage) => { for (let i = m.blocks.length - 1; i >= 0; i--) if (m.blocks[i].kind === 'text') return i; return -1; };
  const textOf = (m: AssistantMessage) => m.blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text).join('\n\n');
  const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  /** 一轮的最后一条助手消息（后面紧跟用户消息或已到末尾）才显示复制 / 用量 */
  const turnEnds = $derived.by(() => {
    const ids = new Set<number>();
    const list = agent.messages;
    for (let i = 0; i < list.length; i++) {
      if (list[i].role !== 'assistant') continue;
      const next = list.slice(i + 1).find((x) => x.role === 'user' || x.role === 'assistant');
      if (!next || next.role === 'user') ids.add(list[i].id);
    }
    return ids;
  });
  /** 整轮的 token 合计 */
  function turnUsage(id: number) {
    const list = agent.messages, end = list.findIndex((x) => x.id === id);
    let tokens = 0, cost = 0;
    for (let i = end; i >= 0 && list[i].role !== 'user'; i--) {
      const x = list[i];
      if (x.role === 'assistant' && x.usage) { tokens += (x.usage.input ?? 0) + (x.usage.output ?? 0); cost += x.usage.cost?.total ?? 0; }
    }
    return tokens ? `${fmtK(tokens)} tokens${cost ? ` · $${cost.toFixed(4)}` : ''}` : '';
  }

  function copy(id: number, text: string) {
    void navigator.clipboard?.writeText(text).then(() => { copiedId = id; setTimeout(() => (copiedId = null), 1200); });
  }
  // Markdown 里的「复制」和链接：事件委托
  function onContentClick(e: MouseEvent) {
    const t = e.target as Element;
    const cp = t.closest?.('[data-copy]');
    if (cp) {
      const code = cp.closest('.md-code')?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard?.writeText(code).then(() => { cp.textContent = '已复制'; setTimeout(() => (cp.textContent = '复制'), 1200); });
      return;
    }
    const a = t.closest?.('a[data-link]') as HTMLAnchorElement | null;
    if (a) {
      e.preventDefault();
      // 独立窗口里点链接：交给主窗口的内置浏览器打开
      if (isAgentView) void sendToMain({ type: 'browse', url: a.href });
      else { browser.open(a.href); app.route = 'browser'; }
    }
  }

  // ---------- 滚动：贴底跟随，用户上翻时不打断 ----------
  function onScroll() {
    if (!scroller) return;
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    atTop = scroller.scrollTop < 4;
  }
  function toBottom(smooth = false) { scroller?.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }
  $effect(() => {
    if (!content) return;
    const ro = new ResizeObserver(() => { if (atBottom) toBottom(); });
    ro.observe(content);
    return () => ro.disconnect();
  });
  // 自己发出消息时回到底部
  let lastCount = 0;
  $effect(() => {
    const n = agent.messages.length;
    const last = agent.messages[n - 1];
    if (n > lastCount && last?.role === 'user') { atBottom = true; void tick().then(() => toBottom()); }
    lastCount = n;
  });
  // 一轮结束时轻提示音
  let wasRunning = false;
  $effect(() => {
    const r = agent.running;
    if (wasRunning && !r && prefs.replySound) sfx.play('reply');
    wasRunning = r;
  });

  // ---------- 历史会话 ----------
  async function openHistory() {
    historyOpen = !historyOpen;
    if (!historyOpen) return;
    sessions = null; sessionsNote = '';
    const r = await piHost.sessions();
    if (r.ok) sessions = [...r.value.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else { sessions = []; sessionsNote = r.missing ? '当前版本还不能列出历史会话。' : r.code === 'pi_disconnected' ? '先连上茶茶。' : r.error; }
  }
  function openSession(s: PiSessionInfo) { historyOpen = false; agent.openSession(s.path); }
  async function removeSession(s: PiSessionInfo) {
    if (!await app.confirm('删除会话', `「${s.name || s.firstMessage || '未命名会话'}」\n${s.messageCount} 条消息\n\n删除后无法在 Matcha 里恢复。`, '删除')) return;
    const r = await piHost.deleteSession(s.path);
    if (r.ok) sessions = sessions?.filter((x) => x.path !== s.path) ?? null;
    else app.toast(r.missing ? '删除会话需要后端提供 pi-session-delete' : r.error);
  }
  const when = (iso: string) => {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
    const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
    return days < 7 ? `${days || 1} 天前` : iso.slice(5, 10);
  };
  function newChat() { historyOpen = false; agent.reset(); queueMicrotask(() => document.getElementById('agent-input')?.focus()); }
  function startRename() { if (!agent.connected) return; renameValue = agent.title; renaming = true; }
  function commitRename() { if (renaming && renameValue.trim() && renameValue !== agent.title) void agent.rename(renameValue); renaming = false; }
  const focus = (n: HTMLInputElement) => { n.focus(); n.select(); };

  // ---------- 分栏宽度：拖中间的分隔条调宽窄，面板头上的按钮一键放大 / 还原 ----------
  // 页面那一栏至少留 560px，面板最窄 320px
  let winW = $state(typeof innerWidth === 'number' ? innerWidth : 1360);
  const maxW = $derived(Math.max(320, winW - 560));
  const width = $derived(Math.min(maxW, prefs.panelWide ? Math.max(prefs.panelWidth, Math.round(winW * 0.6)) : prefs.panelWidth));
  let dragging = $state(false);
  function resize(e: PointerEvent) {
    const startX = e.clientX, start = width;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragging = true;
    // 放大状态下一拖就回到普通模式，宽度从当前宽度接着算
    prefs.panelWide = false;
    const move = (ev: PointerEvent) => { prefs.panelWidth = Math.max(320, Math.min(maxW, start + (startX - ev.clientX))); };
    const up = () => { dragging = false; el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }
  function displayPrompt(text: string) {
    const marker = '附件（文件内容作为资料）：\n', start = text.lastIndexOf(marker);
    if (start < 0) return text;
    try { const names = JSON.parse(text.slice(start + marker.length)).map((a: { name: string }) => a.name);
      return [text.slice(0, start).trimEnd(), names.join('、')].filter(Boolean).join('\n'); } catch { return text; }
  }
</script>

<svelte:window onclick={() => (historyOpen = false)} bind:innerWidth={winW} />

<!-- 看板娘：原图右下角自带一个播放键，用连接状态的小叶子徽章正好盖住 -->
{#snippet mascot(talk: string)}
  <div class="mascot">
    <span class="halo" aria-hidden="true"></span>
    <button class="poke" tabindex="-1" aria-label="戳一下 Matcha" onclick={poke}>
      <span class="bob"><span class="squish">
        <img src="/matcha.png" alt="" draggable="false" />
        <span class="badge" class:on={agent.connected} class:busy={agent.connecting} aria-hidden="true"><Leaf size={11} strokeWidth={2.6} /></span>
      </span></span>
    </button>
    {#if talk}{#key talk}<span class="bubble" class:hello={!pokeLine} role="status">{talk}</span>{/key}{/if}
  </div>
{/snippet}

<aside class="panel" class:dragging class:windowed style:width={windowed ? null : `${width}px`} aria-label="茶茶">
  {#if !windowed}<div class="grip" role="separator" aria-orientation="vertical" aria-label="拖动调整茶茶的宽度，双击恢复默认" title="拖动调整宽度 · 双击恢复默认" onpointerdown={resize} ondblclick={() => { prefs.panelWide = false; prefs.panelWidth = 380; }}><i></i></div>{/if}
  <header class:edge={!atTop} data-tauri-drag-region={windowed ? '' : undefined}>
    <div class="identity" data-tauri-drag-region={windowed ? '' : undefined}>
      <span class="byline" data-tauri-drag-region={windowed ? '' : undefined}><i class="dot" class:busy={agent.running || agent.connecting} class:on={agent.connected} title={agent.connecting ? '正在连接' : agent.connected ? '已连接' : '未连接'}></i>茶茶</span>
    {#if renaming}
      <input class="rename" aria-label="会话名称" bind:value={renameValue} use:focus onblur={commitRename} onkeydown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') renaming = false; }} />
    {:else}
      <button class="title" title="双击重命名" ondblclick={startRename}>{agent.title}</button>
    {/if}
    </div>
    <div class="hist">
      <button class="icon-btn" class:on={historyOpen} title="历史会话" aria-label="历史会话" disabled={!agent.connected} onclick={(e) => { e.stopPropagation(); void openHistory(); }}><History size={14} /></button>
      {#if historyOpen}
        <div class="sessions" role="dialog" aria-label="历史会话" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
          <button class="new-row" onclick={newChat}><SquarePen size={13} />新对话</button>
          {#if sessions === null}<p class="snote"><LoaderCircle size={12} class="spin" />读取中…</p>
          {:else if sessionsNote}<p class="snote">{sessionsNote}</p>
          {:else if !sessions.length}<p class="snote">还没有保存的会话。</p>
          {:else}
            {#each sessions as s (s.path)}
              {@const cur = s.current || s.path === agent.sessionFile}
              <div class="srow" class:cur>
                <button class="sopen" disabled={agent.running} onclick={() => openSession(s)}>
                  <span class="sname">{s.name || s.firstMessage || '未命名会话'}</span>
                  <span class="smeta mono">{when(s.updatedAt)} · {s.messageCount}</span>
                </button>
                {#if !cur}<button class="sdel" title="删除会话" aria-label="删除会话" onclick={() => void removeSession(s)}><Trash size={12} /></button>{/if}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
    <button class="icon-btn" title="新对话" aria-label="新对话" disabled={!agent.connected || agent.running} onclick={newChat}><SquarePen size={14} /></button>
    <button class="icon-btn" title="茶茶设置" aria-label="茶茶设置" class:on={app.route === 'settings'} onclick={() => openSettings('model')}><Settings size={14} /></button>
    {#if !windowed}<button class="icon-btn" title={prefs.panelWide ? '还原宽度' : '放大'} aria-label={prefs.panelWide ? '还原宽度' : '放大'} onclick={() => (prefs.panelWide = !prefs.panelWide)}>{#if prefs.panelWide}<Minimize2 size={14} />{:else}<Maximize2 size={14} />{/if}</button>{/if}
    <button class="icon-btn" title="收起（Ctrl+K 打开）" aria-label="收起" onclick={() => (app.agentOpen = false)}><X size={14} /></button>
  </header>

  <div class="scroll" bind:this={scroller} onscroll={onScroll}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="content" class:welcome={!agent.messages.length && !agent.running} bind:this={content} onclick={onContentClick}>
      {#if !agent.connected}
        {#if agent.connectionError && !agent.connecting}
          <div class="setup">
            {#if !agent.messages.length}{@render mascot(pokeLine)}{/if}
            <h2>和茶茶断开了</h2>
            <p>{agent.connectionError}</p>
            <div class="row"><button class="btn solid" onclick={() => agent.connect()}>重试连接</button>
              <button class="btn ghost" onclick={() => openSettings('model')}>设置</button></div>
          </div>
        {:else}
          <div class="setup" role="status">{@render mascot(pokeLine)}<p><LoaderCircle size={14} class="spin" /> 正在叫醒茶茶…</p></div>
        {/if}
      {:else if !agent.modelReady}
        <div class="setup">
          {#if !agent.messages.length}{@render mascot(pokeLine)}{/if}
          <h2>给茶茶选个模型</h2>
          <p>{agent.models.length ? '选择一个可用模型，就可以开始对话。' : '在设置里添加模型服务商，就能和茶茶聊天了。'}</p>
          <div class="row"><button class="btn primary" onclick={() => openSettings(agent.models.length ? 'model' : 'keys')}>设置模型 <ChevronRight size={15} /></button><button class="btn ghost" disabled={agent.connecting} onclick={() => agent.reconnect()}>重新连接</button></div>
        </div>
      {:else if !agent.messages.length && firstMeet}
        <div class="empty meet">
          {@render mascot(pokeLine || '第一次见面～')}
          <h2>先给游戏做个体检？</h2>
          <p class="lede">我挨个看一遍，只读不改，有问题再和你商量</p>
          <ul class="checks" aria-label="体检会看">
            {#each CHECK_ITEMS as c, i (c.label)}<li style:--i={i}><c.icon size={13} strokeWidth={2.2} />{c.label}</li>{/each}
          </ul>
          <div class="cta">
            <button class="btn primary" disabled={agent.running || checkup.starting} data-sfx="send" onclick={beginCheckup}>
              {#if checkup.starting}<LoaderCircle size={15} class="spin" />{:else}<Stethoscope size={15} />{/if}开始体检
            </button>
            <button class="btn ghost" disabled={checkup.starting} data-sfx="none" onclick={later}>以后再说</button>
          </div>
          <p class="fine">之后想做，空白对话里点「给游戏做个体检」就行</p>
        </div>
      {:else if !agent.messages.length}
        <div class="empty">
          {@render mascot(pokeLine || hello)}
          <h2>今天想整理什么？</h2>
          <p class="lede">Mod、服务器、DLL 都能交给我，动手改之前会先问你</p>
          <div class="sugs">
            {#each suggestions as s, i (s.text)}
              <button class="sug" style:--i={i} disabled={agent.running || (!!s.run && checkup.starting)} data-sfx="send" onclick={() => (s.run ? s.run() : agent.send(s.text))}>
                <span class="ic"><s.icon size={15} /></span>
                <span class="tx">{s.text}</span>
                <span class="go"><ChevronRight size={14} /></span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#each agent.messages as m (m.id)}
        {#if m.role === 'user'}
          {@const visibleText = displayPrompt(m.text)}
          {@const long = isLong(visibleText)}
          <div class="urow">
            <div class="user" class:clamped={long && !openUser[m.id]}>{visibleText}{#if m.images}<span class="imgn">{m.images} 张图片</span>{/if}</div>
            <div class="acts" class:shown={long}>
              {#if long}<button class="more" aria-expanded={!!openUser[m.id]} onclick={() => (openUser[m.id] = !openUser[m.id])}>{openUser[m.id] ? '收起' : '展开全文'}</button>{/if}
              <button title="复制" aria-label="复制" onclick={() => copy(m.id, m.text)}>{#if copiedId === m.id}<Check size={12} />{:else}<Copy size={12} />{/if}</button>
            </div>
          </div>
        {:else if m.role === 'notice'}
          <div class="notice {m.level}">
            <span>{m.text}</span>
            {#if m.action === 'retry' && !agent.running && agent.lastPrompt}<button onclick={() => agent.retry()}><RotateCcw size={11} />重试</button>{/if}
            {#if m.action === 'settings'}<button onclick={() => openSettings('model')}>设置</button>{/if}
          </div>
        {:else if m.role === 'divider'}
          <div class="divider"><span>{m.text}</span></div>
        {:else}
          {@const lt = lastTextIndex(m)}
          <div class="asst">
            {#each segments(m) as seg (seg.kind === 'group' ? seg.key : seg.i)}
              {#if seg.kind === 'group'}
                <button class="group" aria-expanded={!!groups[seg.key]} onclick={() => (groups[seg.key] = !groups[seg.key])}>
                  <Wrench size={12} />调用了 {seg.tools.length} 个工具<span class="gnames">{[...new Set(seg.tools.map((t) => toolMeta(t.name).label))].join('、')}</span>
                  <span class="chev" class:open={groups[seg.key]}><ChevronRight size={12} /></span>
                </button>
                {#if groups[seg.key]}<div class="gbody">{#each seg.tools as t (t.id)}<ToolCard block={t} onrespond={(id, allow) => agent.respond(id, allow)} />{/each}</div>{/if}
              {:else if seg.b.kind === 'text'}
                {#if seg.b.text}<div class="md">{@html markdown(seg.b.text)}{#if m.streaming && seg.i === lt}<span class="caret"></span>{/if}</div>{/if}
              {:else if seg.b.kind === 'thinking'}
                <ThinkingBlock block={seg.b} live={m.streaming} />
              {:else}
                <ToolCard block={seg.b} onrespond={(id, allow) => agent.respond(id, allow)} />
              {/if}
            {/each}
            {#if m.error}
              <div class="err">
                <span>{m.error}</span>
                {#if m === lastAssistant && !agent.running}<button class="btn sm" onclick={() => agent.retry()}><RotateCcw size={12} />重试</button>{/if}
              </div>
            {/if}
            {#if !m.streaming && turnEnds.has(m.id) && !(agent.running && m === lastAssistant)}
              {@const u = turnUsage(m.id)}
              <div class="meta">
                {#if lt >= 0}<button title="复制回复" aria-label="复制回复" onclick={() => copy(m.id, textOf(m))}>{#if copiedId === m.id}<Check size={12} />{:else}<Copy size={12} />{/if}</button>{/if}
                {#if m === lastAssistant && !agent.running}<button title="重新生成（重发上一条）" aria-label="重试" onclick={() => agent.retry()}><RotateCcw size={12} /></button>{/if}
                {#if u}<span class="mono">{u}</span>{/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}

      {#each agent.dialogs as dialog (dialog.id)}
        {#if !dialog.attached}
          {#if dialog.state === 'waiting'}
            <div class="dialog" role="group" aria-label={dialog.title}>
              <strong>{dialog.title}</strong>{#if dialog.message}<p>{dialog.message}</p>{/if}
              {#if dialog.method === 'select'}<select aria-label={dialog.title} bind:value={dialog.value}><option value="">选择…</option>{#each dialog.options ?? [] as option (option)}<option value={option}>{option}</option>{/each}</select>
              {:else if dialog.method !== 'confirm'}<textarea aria-label={dialog.title} bind:value={dialog.value}></textarea>{/if}
              <div class="row"><button class="btn sm solid" data-sfx="approve" disabled={dialog.pending || (dialog.method === 'select' && !dialog.value)} onclick={() => agent.respond(dialog.id, true)}>{dialog.pending ? '提交中…' : '确认'}</button><button class="btn sm" data-sfx="deny" disabled={dialog.pending} onclick={() => agent.respond(dialog.id, false)}>取消</button></div>
            </div>
          {:else}<div class="notice info"><span>{dialog.title} · {dialog.state === 'allowed' ? '已确认' : '已取消或过期'}</span></div>{/if}
        {/if}
      {/each}

      {#if working}<div class="working"><span class="dots"><i></i><i></i><i></i></span><span class="shimmer">{working}</span><span class="esc mono">Esc 停止</span></div>{/if}
    </div>
  </div>

  {#if !atBottom}
    <button class="to-bottom" aria-label="回到底部" onclick={() => { atBottom = true; toBottom(true); }}><ArrowDown size={14} /></button>
  {/if}

  <Composer />
</aside>

<style>
  .panel { position: relative; flex: none; min-width: 320px; max-width: calc(100vw - 560px); display: flex; flex-direction: column; border-radius: var(--r-island); border: 1px solid var(--island-line); background: var(--island); transition: width 260ms var(--ease-out);
    /* 面板里浮起来的小卡片（建议、气泡、输入框）：亮色接近白，暗色比底稍亮 */
    --card: color-mix(in srgb, var(--md-surface-container-lowest) 72%, transparent);
    --card-hover: var(--md-surface-container-lowest); }
  :global([data-theme='dark']) .panel { --card: color-mix(in srgb, var(--md-surface-container-high) 48%, transparent); --card-hover: color-mix(in srgb, var(--md-surface-container-high) 88%, transparent); }
  .panel.dragging { transition: none; user-select: none; }
  /* 独立窗口：铺满窗口，宽度由系统窗口决定 */
  .panel.windowed { flex: 1; width: auto; min-width: 0; max-width: none; transition: none; border: 0; border-radius: 0;
    background: linear-gradient(155deg, color-mix(in srgb, var(--md-primary-container) 16%, var(--md-surface)), var(--md-surface) 62%); }
  /* 分隔条：落在页面和面板之间那 8px 缝里，热区放宽；悬停时出现一根小竖条提示能拖 */
  .grip { position: absolute; left: -11px; top: 0; bottom: 0; width: 14px; cursor: col-resize; z-index: 3; display: grid; place-items: center; }
  .grip i { width: 4px; height: 40px; border-radius: 2px; background: color-mix(in srgb, var(--md-on-surface) 22%, transparent); opacity: 0; transition: opacity var(--dur), background var(--dur), height 200ms var(--ease-out); }
  .grip:hover i { opacity: 1; }
  .panel.dragging .grip i { opacity: 1; height: 64px; background: var(--md-primary); }
  /* 分隔线只在内容滚上去之后出现，空状态时顶栏和底色连成一片 */
  header { height: 61px; flex: none; display: flex; align-items: center; gap: 3px; padding: 0 12px 0 18px; border-bottom: 1px solid transparent; transition: border-color 200ms; }
  header.edge { border-bottom-color: var(--line-soft); }
  .identity { flex: 1; min-width: 0; display: grid; justify-items: start; gap: 1px; }
  .byline { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--fg-2); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-4); flex: none; margin-right: 4px; }
  .dot.on { background: var(--md-primary); }
  .dot.busy { background: var(--fg); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  .title { max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 650; text-align: left; }
  .rename { flex: 1; min-width: 0; height: 26px; font-size: 13px; }
  .icon-btn.on { background: var(--bg-2); color: var(--fg); }
  .icon-btn:disabled { opacity: .35; cursor: default; }
  .hist { position: relative; }
  .sessions { position: absolute; right: -60px; top: calc(100% + 6px); z-index: 10; width: 300px; max-height: 420px; overflow-y: auto; padding: 4px; background: var(--bg-1); border: 1px solid var(--line-strong); border-radius: 8px; box-shadow: 0 12px 32px #000a; transform-origin: top right; animation: drop-in 160ms var(--ease-out); }
  @keyframes drop-in { from { opacity: 0; transform: translateY(-4px) scale(0.97); } }
  .new-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 8px; border-radius: var(--r-sm); font-size: 12px; color: var(--fg); border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .new-row:hover { background: var(--bg-3); }
  .snote { display: flex; align-items: center; gap: 6px; margin: 8px; font-size: 12px; color: var(--fg-3); line-height: 1.6; }
  .srow { display: flex; align-items: center; border-radius: var(--r-sm); }
  .srow:hover { background: var(--bg-3); }
  .srow.cur { background: var(--bg-2); }
  .sopen { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px; text-align: left; }
  .sname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--fg-2); }
  .srow.cur .sname { color: var(--fg); }
  .smeta { flex: none; font-size: 10px; color: var(--fg-4); }
  .sdel { display: grid; place-items: center; width: 26px; height: 26px; color: var(--fg-4); opacity: 0; }
  .srow:hover .sdel { opacity: 1; }
  .sdel:hover { color: var(--danger); }

  .scroll { flex: 1; min-height: 0; overflow-y: auto; }
  .content { width: min(100%, 64ch); margin-inline: auto; display: flex; flex-direction: column; gap: 16px; padding: 20px clamp(16px, 4vw, 26px); user-select: text; }
  /* 底部多留一点，整组内容落在视觉中心（略高于几何中心） */
  .content.welcome { min-height: 100%; justify-content: safe center; padding-block: clamp(22px, 5vh, 48px) clamp(36px, 9vh, 88px); }
  .setup, .empty { display: flex; flex-direction: column; align-items: center; text-align: center; align-self: center; max-width: 100%; }
  .setup h2, .empty h2 { margin: 0; font-size: clamp(21px, 4.8vw, 25px); font-weight: 650; letter-spacing: -.035em; line-height: 1.4; }

  /* ---------- 看板娘：贴纸 + 光晕 + 招呼气泡 ---------- */
  .mascot { position: relative; width: 100px; height: 100px; margin: 0 auto 18px; animation: mascot-in 560ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
  @keyframes mascot-in { from { opacity: 0; transform: translateY(10px) scale(0.6); } }
  .halo { position: absolute; left: 50%; top: 52%; width: 200px; height: 200px; margin: -100px 0 0 -100px; border-radius: 50%; pointer-events: none;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--md-primary-container) 80%, transparent), color-mix(in srgb, var(--md-primary-container) 30%, transparent) 55%, transparent); }
  .poke { position: relative; display: block; width: 100%; height: 100%; }
  .bob { display: block; width: 100%; height: 100%; animation: bob 3.6s ease-in-out 700ms infinite; }
  @keyframes bob { 50% { transform: translateY(-4px) rotate(-1.5deg); } }
  .squish { position: relative; display: block; width: 100%; height: 100%; transform-origin: 50% 90%; transition: transform 260ms var(--ease-out); }
  .poke:hover .squish { transform: rotate(-4deg) scale(1.04); }
  .squish img { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; -webkit-user-drag: none; filter: drop-shadow(0 8px 10px rgb(0 0 0 / .14)); }
  /* 正好盖住原图右下角那个播放键（圆心约在 76.6%, 76.6%） */
  .badge { position: absolute; left: calc(76.6% - 12px); top: calc(76.6% - 12px); display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
    background: var(--md-surface-container-highest); color: var(--fg-3); box-shadow: 0 0 0 3px #fff, 0 4px 10px -3px rgb(0 0 0 / .3); transition: background 300ms, color 300ms; }
  .badge.on { background: var(--md-primary); color: var(--md-on-primary); }
  .badge.busy { animation: pulse 1s ease-in-out infinite; }
  .bubble { position: absolute; left: 80%; bottom: 82%; z-index: 1; padding: 3px 10px; white-space: nowrap; font-size: 12px; line-height: 1.6; color: var(--fg);
    background: var(--card-hover); border: 1px solid var(--island-line); border-radius: 12px 12px 12px 3px;
    box-shadow: 0 8px 18px -10px color-mix(in srgb, var(--md-shadow) 45%, transparent);
    transform-origin: 0 100%; animation: bubble-in 420ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
  @keyframes bubble-in { from { opacity: 0; transform: translateY(4px) scale(0.5); } }
  .empty .bubble.hello { animation-delay: 240ms; }
  .setup p { margin: 10px 0 22px; max-width: 23em; font-size: 14px; line-height: 1.75; color: var(--fg-2); overflow-wrap: anywhere; }
  .setup .btn { height: 36px; padding-inline: 15px; }
  .row { display: flex; gap: 6px; }
  .solid { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .solid:hover { background: var(--accent-hover); }
  .btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .empty { width: min(100%, 340px); }
  .empty h2 { animation: rise 420ms var(--ease-out) 80ms backwards; }
  .lede { margin: 6px 0 0; font-size: 13px; line-height: 1.6; color: var(--fg-3); animation: rise 420ms var(--ease-out) 130ms backwards; }
  /* 建议：带图标的浮起卡片，依次上浮进场 */
  .sugs { align-self: stretch; display: grid; gap: 8px; margin-top: 22px; }
  .sug { display: flex; align-items: center; gap: 11px; min-height: 50px; padding: 8px 10px 8px 9px; border-radius: 14px; border: 1px solid var(--island-line); background: var(--card);
    text-align: left; font-size: 13px; line-height: 1.5; color: var(--fg);
    transition: background var(--dur), border-color var(--dur), box-shadow 220ms var(--ease-out), transform 160ms var(--ease-out);
    animation: rise 420ms var(--ease-out) calc(180ms + var(--i) * 55ms) backwards; }
  .ic { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); transition: background var(--dur), color var(--dur); }
  .tx { flex: 1; min-width: 0; }
  .go { flex: none; display: grid; color: var(--fg-4); transition: transform 220ms var(--ease-out), color var(--dur); }
  .sug:hover:not(:disabled) { background: var(--card-hover); border-color: color-mix(in srgb, var(--md-primary) 38%, var(--island-line)); box-shadow: 0 12px 26px -18px color-mix(in srgb, var(--md-primary) 80%, transparent); }
  .sug:hover:not(:disabled) .ic { background: var(--md-primary); color: var(--md-on-primary); }
  .sug:hover:not(:disabled) .go { transform: translateX(2px); color: var(--md-primary); }
  .sug:active:not(:disabled) { transform: scale(0.98); }
  .sug:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
  .sug:disabled { opacity: .5; cursor: default; }

  /* ---------- 首见体检卡片 ---------- */
  .checks { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 18px 0 0; padding: 0; list-style: none; }
  .checks li { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px 0 9px; border-radius: 999px; font-size: 12px; font-weight: 550;
    background: var(--md-primary-container); color: var(--md-on-primary-container);
    animation: chip-in 460ms cubic-bezier(0.34, 1.56, 0.64, 1) calc(200ms + var(--i) * 70ms) backwards; }
  @keyframes chip-in { from { opacity: 0; transform: translateY(6px) scale(0.7); } }
  .cta { display: flex; gap: 8px; margin-top: 22px; animation: rise 420ms var(--ease-out) 460ms backwards; }
  .cta .btn { height: 38px; padding-inline: 16px; gap: 6px; }
  .cta .btn.primary { padding-inline: 18px 20px; box-shadow: 0 10px 22px -14px color-mix(in srgb, var(--md-primary) 90%, transparent); }
  .cta .btn.primary:active:not(:disabled) { transform: scale(0.97); }
  .meet .fine { margin: 14px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--fg-4); animation: rise 420ms var(--ease-out) 520ms backwards; }

  .urow { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .user { max-width: 88%; background: var(--bg-2); border: 1px solid var(--line); border-radius: 10px 10px 2px 10px; padding: 7px 11px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; animation: rise 200ms var(--ease-out); }
  .imgn { display: block; margin-top: 4px; font-size: 11px; color: var(--fg-3); }
  .acts, .meta { display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity var(--dur); }
  .urow:hover .acts, .asst:hover .meta, .asst:last-child .meta, .acts.shown { opacity: 1; }
  .user.clamped { max-height: calc(13px * 1.6 * 6 + 14px); overflow: hidden;
    mask-image: linear-gradient(to bottom, #000 calc(100% - 3.2em), transparent); -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 3.2em), transparent); }
  .acts .more { width: auto; padding: 0 8px; font-size: 11.5px; color: var(--fg-3); }
  .acts button, .meta button { display: grid; place-items: center; width: 24px; height: 22px; border-radius: var(--r-sm); color: var(--fg-4); }
  .acts button:hover, .meta button:hover { background: var(--bg-2); color: var(--fg); }
  .meta span { margin-left: 6px; font-size: 10px; color: var(--fg-4); }

  .asst { display: flex; flex-direction: column; gap: 8px; }
  .group { display: flex; align-items: center; gap: 7px; height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--r); font-size: 12px; color: var(--fg-2); text-align: left; }
  .group:hover { background: var(--bg-1); }
  .gnames { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-4); font-size: 11px; }
  .chev { display: grid; color: var(--fg-4); transition: transform 160ms var(--ease-out); }
  .chev.open { transform: rotate(90deg); }
  .gbody { display: flex; flex-direction: column; gap: 6px; padding-left: 10px; border-left: 1px solid var(--line); }
  .err { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid #4a1d1d; border-radius: var(--r); background: #140c0c; font-size: 12px; line-height: 1.6; color: var(--danger); overflow-wrap: anywhere; }
  .err .btn { flex: none; color: var(--fg); }
  .notice { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11px; color: var(--fg-3); text-align: center; }
  .notice.error { color: var(--danger); }
  .notice button { display: inline-flex; align-items: center; gap: 4px; color: var(--fg-2); text-decoration: underline; text-underline-offset: 3px; }
  .divider { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--fg-4); }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .dialog { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--fg-4); border-radius: 8px; background: var(--bg-1); animation: rise 200ms var(--ease-out); }
  .dialog strong { font-size: 13px; font-weight: 500; }
  .dialog p { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  .dialog select, .dialog textarea { width: 100%; }
  .dialog .row { margin-top: 6px; }

  .working { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--fg-3); }
  .esc { margin-left: auto; font-size: 10px; color: var(--fg-4); }
  .dots { display: inline-flex; gap: 3px; }
  .dots i { width: 4px; height: 4px; border-radius: 50%; background: var(--fg-3); animation: blink 1.2s ease-in-out infinite; }
  .dots i:nth-child(2) { animation-delay: .15s; }
  .dots i:nth-child(3) { animation-delay: .3s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
  .shimmer { background: linear-gradient(90deg, var(--fg-3) 40%, var(--fg) 50%, var(--fg-3) 60%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: sweep-text 1.6s linear infinite; }
  @keyframes sweep-text { from { background-position: 100% 0; } to { background-position: -150% 0; } }
  .caret { display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: -2px; background: var(--fg-2); animation: caret 1s steps(1) infinite; }
  @keyframes caret { 50% { opacity: 0; } }

  .to-bottom { position: absolute; left: 50%; bottom: 112px; z-index: 4; display: grid; place-items: center; width: 30px; height: 30px; margin-left: -15px; border-radius: 50%; background: var(--bg-2); border: 1px solid var(--line-strong); color: var(--fg); box-shadow: 0 6px 18px #0008; animation: rise 180ms var(--ease-out); }
  .to-bottom:hover { background: var(--bg-3); }

  /* ---------- Markdown ---------- */
  .md { font-size: 13px; line-height: 1.7; color: var(--fg); overflow-wrap: anywhere; }
  .md :global(p) { margin: 0 0 8px; }
  .md :global(p:last-child), .md :global(ul:last-child), .md :global(ol:last-child) { margin-bottom: 0; }
  .md :global(h3), .md :global(h4), .md :global(h5), .md :global(h6) { margin: 14px 0 6px; font-size: 13px; font-weight: 600; }
  .md :global(h3) { font-size: 15px; }
  .md :global(ul), .md :global(ol) { margin: 0 0 8px; padding-left: 20px; }
  .md :global(li) { margin: 2px 0; }
  .md :global(li::marker) { color: var(--fg-4); }
  .md :global(strong) { font-weight: 650; color: var(--fg); }
  .md :global(code) { font-family: var(--font-mono); font-size: 12px; padding: 1px 5px; border-radius: 4px; background: var(--bg-2); border: 1px solid var(--line); }
  .md :global(a) { color: var(--fg); text-decoration: underline; text-decoration-color: var(--fg-4); text-underline-offset: 3px; }
  .md :global(a:hover) { text-decoration-color: var(--fg); }
  .md :global(blockquote) { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid var(--line-strong); color: var(--fg-2); }
  .md :global(hr) { border: 0; border-top: 1px solid var(--line); margin: 12px 0; }
  .md :global(.md-code) { margin: 4px 0 10px; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: var(--bg-1); }
  .md :global(.md-code-head) { display: flex; justify-content: space-between; align-items: center; height: 26px; padding: 0 8px 0 10px; border-bottom: 1px solid var(--line); font-size: 11px; color: var(--fg-4); font-family: var(--font-mono); }
  .md :global(.md-code-head button) { font-size: 11px; color: var(--fg-3); }
  .md :global(.md-code-head button:hover) { color: var(--fg); }
  .md :global(pre) { margin: 0; padding: 10px; overflow-x: auto; font-size: 12px; line-height: 1.6; }
  .md :global(pre code) { padding: 0; border: 0; background: none; }
  .md :global(.md-table) { margin: 4px 0 10px; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r); }
  .md :global(table) { width: 100%; border-collapse: collapse; font-size: 12px; }
  .md :global(th), .md :global(td) { padding: 5px 8px; text-align: left; border-bottom: 1px solid var(--line); }
  .md :global(th) { color: var(--fg-2); font-weight: 500; background: var(--bg-1); }
  .md :global(tr:last-child td) { border-bottom: 0; }
  @media (prefers-reduced-motion: reduce) {
    .user, .dialog, .to-bottom, .sessions, .mascot, .bob, .bubble, .sug, .lede, .empty h2, .checks li, .cta, .meet .fine { animation: none; }
    .shimmer { animation: none; color: var(--fg-2); background: none; }
  }
</style>
