<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Star from '@lucide/svelte/icons/star';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Search from '@lucide/svelte/icons/search';
  import Lock from '@lucide/svelte/icons/lock';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Layers from '@lucide/svelte/icons/layers';
  import Inbox from '@lucide/svelte/icons/inbox';
  import FolderInput from '@lucide/svelte/icons/folder-input';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Check from '@lucide/svelte/icons/check';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Zap from '@lucide/svelte/icons/zap';
  import Play from '@lucide/svelte/icons/play';
  import X from '@lucide/svelte/icons/x';
  import Users from '@lucide/svelte/icons/users';
  import ServerIcon from '@lucide/svelte/icons/server';
  import Menu from '../components/Menu.svelte';
  import Toggle from '../components/Toggle.svelte';
  import type { MenuItem, MenuState } from '../components/menu';
  import LaunchMode from '../components/LaunchMode.svelte';
  import { app, LOOSE, type ServerSection } from '../stores/app.svelte';
  import type { Server, ServerMode } from '../types';
  import { campaignOf } from '../maps';
  import { askAgent } from '../plugins/intake';

  const ALL = 'all', FAV = 'fav';
  const modes: ('全部' | ServerMode)[] = ['全部', '战役', '写实', '对抗', '生存', '清道夫', '自定义'];
  const statuses: Record<Server['status'], string> = { unqueried: '待探测', querying: '探测中', online: '在线', timeout: '查询超时', error: '探测失败', 'wrong-game': '游戏不匹配' };
  type Sort = 'custom' | 'players' | 'ping' | 'name';
  const sorts: { id: Sort; label: string }[] = [{ id: 'custom', label: '自定义顺序' }, { id: 'players', label: '人数多在前' }, { id: 'ping', label: '延迟低在前' }, { id: 'name', label: '名称' }];

  // ---------- 本机记忆：当前合集、排序、筛选、折叠 ----------
  const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 无存储时只在本次会话生效 */ } };
  const rememberedView = read<string>('flare.servers.view', ALL);
  let view = $state(rememberedView === 'friends-playing' ? ALL : rememberedView);
  let sort = $state<Sort>(read('flare.servers.sort', 'custom'));
  let hideEmpty = $state<boolean>(read('flare.servers.hideEmpty', false));
  let hideFull = $state<boolean>(read('flare.servers.hideFull', false));
  let autoRefresh = $state<boolean>(read('flare.servers.auto', false));
  const collapsed = new SvelteSet<string>(read<string[]>('flare.servers.collapsed', []));
  $effect(() => write('flare.servers.view', view));
  $effect(() => write('flare.servers.sort', sort));
  $effect(() => write('flare.servers.hideEmpty', hideEmpty));
  $effect(() => write('flare.servers.hideFull', hideFull));
  $effect(() => write('flare.servers.auto', autoRefresh));
  $effect(() => write('flare.servers.collapsed', [...collapsed]));

  let mode = $state<(typeof modes)[number]>('全部');
  let q = $state('');

  // ---------- 当前视图：全部 / 收藏 / 某个合集 ----------
  /** 单个合集视图时为该合集（含未分组） */
  const group = $derived(view === ALL || view === FAV ? undefined : app.serverSection(view));
  $effect(() => { if (view !== ALL && view !== FAV && !app.serverSection(view)) view = ALL; });
  const custom = $derived(group && !group.loose ? app.serverGroup(group.id) : undefined);
  /** 全部、收藏视图在有自建合集时按合集分段显示 */
  const multi = $derived(!group && app.serverLayout.groups.length > 0);
  const full = (s: Server) => s.players !== null && s.maxPlayers !== null && s.maxPlayers > 0 && s.players >= s.maxPlayers;
  const filtering = $derived(!!q.trim() || mode !== '全部' || hideEmpty || hideFull);
  const match = (s: Server) => {
    const k = q.trim().toLowerCase();
    return (mode === '全部' || s.mode === mode) && (!hideEmpty || (s.players ?? 0) > 0) && (!hideFull || !full(s))
      && (!k || `${s.name} ${s.map} ${campaignOf(s.map)?.name ?? ''} ${s.addr} ${s.label}`.toLowerCase().includes(k));
  };
  const sorters: Record<Exclude<Sort, 'custom'>, (a: Server, b: Server) => number> = {
    players: (a, b) => (b.players ?? -1) - (a.players ?? -1) || (a.ping ?? Infinity) - (b.ping ?? Infinity),
    ping: (a, b) => (a.ping ?? Infinity) - (b.ping ?? Infinity),
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
  };
  type Shown = ServerSection & { shown: Server[] };
  const sections = $derived.by((): Shown[] => {
    const src = group ? [group] : app.serverSections;
    return src
      .map((sec) => {
        let shown = sec.servers.filter((s) => (view !== FAV || s.favorite) && match(s));
        if (sort !== 'custom') shown = [...shown].sort(sorters[sort]);
        return { ...sec, shown };
      })
      // 全部视图里保留空的自建合集当拖放目标；收藏、筛选时只显示有结果的
      .filter((sec) => group || sec.shown.length || (view === ALL && !sec.loose && !filtering));
  });
  /** 当前视图里看得见的卡片顺序（折叠的分段不算），用于 Shift 连选和全选 */
  const visible = $derived(sections.flatMap((sec) => (multi && collapsed.has(sec.id) ? [] : sec.shown.map((s) => s.id))));
  const pool = $derived(group ? group.servers : view === FAV ? app.servers.filter((s) => s.favorite) : app.servers);
  const stat = (list: Server[]) => ({
    total: list.length,
    online: list.filter((s) => s.status === 'online' || (s.status === 'querying' && s.players !== null)).length,
    players: list.reduce((n, s) => n + (s.players ?? 0), 0),
  });
  const totals = $derived(stat(pool));
  const favCount = $derived(app.servers.filter((s) => s.favorite).length);
  const looseCount = $derived(app.serverSection(LOOSE)?.servers.length ?? 0);
  const title = $derived(group ? group.name : view === FAV ? '收藏' : '全部服务器');
  function go(next: string) {
    if (next !== view && listEl) listEl.scrollTop = 0;
    view = next; selected = []; edit = null; formError = '';
  }

  // ---------- 卡片小工具 ----------
  const pad = (n: number | undefined) => String(n ?? 0).padStart(2, '0');
  const hasData = (s: Server) => s.status === 'online' || (s.status === 'querying' && s.players !== null);
  const copyOnly = (s: Server) => app.launchState === 'running' || (s.vac === true && app.launchConfig.vacMode === 'insecure');
  const connectBlock = (s: Server): string => s.status !== 'online' ? (s.status === 'querying' ? '正在探测' : '服务器不在线') : app.launchState !== 'idle' ? '游戏正在启动' : app.busy ? `正在${app.busy}` : '';
  function connect(s: Server) {
    if (copyOnly(s)) return app.copyServer(s);
    if (!connectBlock(s)) void app.connectServer(s.id);
  }
  function ago(iso: string) {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
  }
  const dur = (sec: number) => sec < 60 ? `${Math.max(0, Math.round(sec))}s` : sec < 3600 ? `${(sec / 60).toFixed(1)}m` : `${(sec / 3600).toFixed(1)}h`;
  const meta = (s: Server) => hasData(s)
    ? [s.mode !== '未知' ? s.mode : '', s.vac === true ? 'VAC' : s.vac === false ? '非 VAC' : '', s.bots ? `${s.bots} Bot` : ''].filter(Boolean).join(' · ') || s.addr
    : s.addr;
  const tip = (s: Server) => [s.name, s.addr + (s.connectAddr && s.connectAddr !== s.addr ? ` → ${s.connectAddr}` : ''), s.checkedAt ? `探测于 ${new Date(s.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '', s.error].filter(Boolean).join('\n');
  const listText = (name: string, list: Server[]) => `${name}\n${list.map((s, i) => `${i + 1}. ${s.name}  connect ${s.connectAddr ?? s.addr}`).join('\n')}`;
  function quickJoin(list: Server[]) {
    const best = app.bestServer(list);
    if (!best) return app.toast('没有在线、有空位且无密码的服务器');
    connect(best);
  }
  // 2026-11-17 用户要求：「让 Agent 整理 / 检查」暂时不在服务器页露出（顶栏按钮、右键菜单、多选栏都拿掉了），逻辑先留着，要恢复时把入口加回去即可
  async function agentWork(ids?: string[], action: 'organize' | 'inspect' = 'organize') {
    const targets = ids ?? (selected.length ? [...selected] : pool.filter(match).map(s => s.id));
    if (!targets.length) return app.toast('先添加或选择服务器。');
    const scope = { serverIds: targets, view: title, groupId: group?.id ?? null,
      filters: { query: q, mode, hideEmpty, hideFull } };
    if (action === 'organize' && !await app.flushServerLayout()) return;
    const task = action === 'inspect' ? '检查这些服务器的实时状态、延迟与连接信息，按具体错误给我排查建议。'
      : '整理这些服务器的自定义分类。沿用已有类别，结合玩法给出归类建议；战役、对抗、死门等名称按实际依据和我的选择使用。分类和资料变更先预览并确认。';
    const prompt = `${task}\n先读取 matcha-server-organizer 技能并调用 server_inventory。以下 JSON 是本次页面范围资料，服务器目标沿用其中的真实 ID：\n${JSON.stringify(scope)}\n游戏启动、退出和启动参数保持原样。`;
    app.toast(askAgent(prompt) === 'sent' ? '已交给茶茶，进度在对话里' : '指令已放进茶茶的对话框');
  }

  // ---------- 选择 ----------
  let selected = $state<string[]>([]);
  let anchor: string | null = null;
  const selecting = $derived(selected.length > 0);
  $effect(() => {
    const alive = new Set(app.servers.map((s) => s.id));
    if (selected.some((id) => !alive.has(id))) selected = selected.filter((id) => alive.has(id));
  });
  function pick(id: string, range = false) {
    if (range && anchor && visible.includes(anchor) && visible.includes(id)) {
      const [a, b] = [visible.indexOf(anchor), visible.indexOf(id)].sort((x, y) => x - y);
      selected = [...new Set([...selected, ...visible.slice(a, b + 1)])];
      return;
    }
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    anchor = id;
  }
  /** 右键点在已选中的卡片上 → 作用于整个选择；否则只作用于这一张 */
  const targets = (id: string) => (selected.includes(id) ? [...selected] : [id]);
  const serversOf = (ids: string[]) => ids.map((id) => app.servers.find((s) => s.id === id)).filter((s): s is Server => !!s);
  const fromCardControl = (e: Event) => (e.target as Element).closest('button, input, select, a, .roster');
  function onCardClick(e: MouseEvent, id: string) {
    if (suppressClick || fromCardControl(e)) return;
    if (e.shiftKey) pick(id, true);
    else if (e.ctrlKey || e.metaKey || selecting) pick(id);
  }

  // ---------- 行内编辑：合集名、服务器备注 ----------
  type Edit = { kind: 'group' | 'new-group' | 'server' | 'title'; id?: string } | null;
  let edit = $state<Edit>(null);
  let editValue = $state('');
  function startEdit(next: NonNullable<Edit>, value: string) { edit = next; editValue = value; }
  function commit() {
    if (!edit) return;
    const v = editValue.trim();
    const e = edit;
    edit = null;
    if (e.kind === 'server' && e.id) void app.renameServer(e.id, v);
    else if (!v) return;
    else if ((e.kind === 'group' || e.kind === 'title') && e.id) app.renameServerGroup(e.id, v);
    else if (e.kind === 'new-group') { const g = app.createServerGroup(v); if (g) go(g.id); }
  }
  function onEditKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') edit = null;
  }
  function focus(node: HTMLInputElement) { node.focus(); node.select(); }
  function renameServer(s: Server) { startEdit({ kind: 'server', id: s.id }, s.label || s.name); }
  function moveTo(ids: string[], gid: string) {
    const list = ids.filter((id) => app.serverPlace.get(id)?.group !== gid);
    if (!list.length) return;
    app.moveServers(list, gid);
    app.toast(`${list.length} 台服务器移到${gid === LOOSE ? '未分组' : `「${app.serverGroup(gid)?.name}」`}`);
  }
  function newGroupWith(ids: string[]) {
    const g = app.createServerGroup(app.freshServerGroupName(), ids);
    if (g) startEdit({ kind: 'group', id: g.id }, g.name);
  }

  // ---------- 菜单 ----------
  let menu = $state<MenuState>(null);
  const closeMenu = () => (menu = null);
  function menuAt(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault(); e.stopPropagation();
    if (items.length) menu = { x: e.clientX, y: e.clientY, items };
  }
  function menuBelow(el: HTMLElement, items: MenuItem[]) {
    const r = el.getBoundingClientRect();
    menu = { x: r.left, y: r.bottom + 4, items };
  }
  function moveItems(ids: string[]): MenuItem[] {
    const where = new Set(ids.map((id) => app.serverPlace.get(id)?.group));
    const only = where.size === 1 ? [...where][0] : null;
    return [
      ...app.serverLayout.groups.map((g): MenuItem => ({ label: g.name, current: only === g.id, run: () => moveTo(ids, g.id) })),
      { label: '未分组', current: only === LOOSE, run: () => moveTo(ids, LOOSE) },
      { kind: 'sep' },
      { label: '新建合集…', icon: Plus, run: () => newGroupWith(ids) },
    ];
  }
  function serverItems(ids: string[]): MenuItem[] {
    const list = serversOf(ids);
    if (!list.length) return [];
    const one = list.length === 1 ? list[0] : null;
    const allFav = list.every((s) => s.favorite);
    const n = list.length;
    const items: MenuItem[] = [];
    if (one) {
      items.push(copyOnly(one)
        ? { label: '复制连接命令', icon: Copy, hint: '双击', run: () => app.copyServer(one) }
        : { label: full(one) ? '已满 · 仍然连接' : '启动并连接', icon: Play, hint: '双击', disabled: connectBlock(one) || false, run: () => app.connectServer(one.id) });
      if (!copyOnly(one)) items.push({ label: '复制连接命令', icon: Copy, run: () => app.copyServer(one) });
      items.push({ label: '复制查询地址', run: () => app.copyText(one.addr, '已复制地址') });
    } else {
      items.push({ label: `复制 ${n} 条连接命令`, icon: Copy, run: () => app.copyText(listText('服务器', list), `已复制 ${n} 条连接命令`) });
    }
    items.push({ label: one ? '刷新' : `刷新 ${n} 台`, icon: RefreshCw, run: () => app.refreshServers(list.map((s) => s.id)) });
    items.push({ kind: 'sep' });
    items.push({ label: allFav ? '取消收藏' : '收藏', icon: Star, hint: 'F', run: () => app.setServersFavorite(list.map((s) => s.id), !allFav) });
    items.push({ label: '移动到', icon: FolderInput, items: moveItems(list.map((s) => s.id)) });
    if (one) items.push({ label: '编辑备注', icon: Pencil, hint: 'F2', run: () => renameServer(one) });
    if (!one) items.push({ label: '用这些新建合集', icon: Plus, run: () => newGroupWith(list.map((s) => s.id)) });
    items.push({ kind: 'sep' });
    items.push({ label: one ? '从列表移除' : `移除 ${n} 台`, icon: Trash2, hint: 'Del', danger: true, run: () => app.removeServers(list.map((s) => s.id)) });
    return items;
  }
  function groupItems(gid: string, where: 'side' | 'main'): MenuItem[] {
    const sec = app.serverSection(gid);
    if (!sec) return [];
    const g = app.serverGroup(gid);
    const i = app.serverLayout.groups.findIndex((x) => x.id === gid);
    const items: MenuItem[] = [
      { label: '快速加入', icon: Zap, disabled: app.bestServer(sec.servers) ? false : '没有在线、有空位且无密码的服务器', run: () => quickJoin(sec.servers) },
      { label: '刷新本组', icon: RefreshCw, disabled: sec.servers.length ? false : '合集是空的', run: () => app.refreshServers(sec.servers.map((s) => s.id)) },
      { label: '复制全部连接命令', icon: Copy, disabled: sec.servers.length ? false : '合集是空的', run: () => app.copyText(listText(sec.name, sec.servers), `已复制 ${sec.servers.length} 条连接命令`) },
      { label: '全选本组', disabled: sec.servers.length ? false : '合集是空的', run: () => { if (view !== gid && !multi) go(gid); selected = sec.servers.map((s) => s.id); } },
    ];
    if (g) {
      items.push(
        { kind: 'sep' },
        { label: '重命名', icon: Pencil, run: () => startEdit({ kind: where === 'side' || !custom ? 'group' : 'title', id: gid }, g.name) },
        { label: '上移', icon: ChevronUp, disabled: i > 0 ? false : '已在最前', run: () => app.shiftServerGroup(gid, -1) },
        { label: '下移', icon: ChevronDown, disabled: i < app.serverLayout.groups.length - 1 ? false : '已在最后', run: () => app.shiftServerGroup(gid, 1) },
        { kind: 'sep' },
        { label: '删除合集', hint: '服务器移到未分组', icon: Trash2, danger: true, run: () => app.deleteServerGroup(gid) },
        { label: '删除合集和其中的服务器…', danger: true, disabled: sec.servers.length ? false : '合集是空的', run: () => app.deleteServerGroupWithServers(gid) },
      );
    }
    return items;
  }

  // ---------- 拖拽：卡片拖到合集 / 收藏，或在网格里调整顺序（指针实现，Tauri 在 Windows 上会拦截 HTML5 拖拽） ----------
  type Over = { kind: 'group'; gid: string } | { kind: 'fav' } | { kind: 'slot'; gid: string; card: string | null; after: boolean };
  let drag = $state<{ ids: string[]; x: number; y: number; over: Over | null } | null>(null);
  let press: { id: string; x: number; y: number } | null = null;
  let suppressClick = false;
  function canDropGroup(gid: string) { return !!drag && drag.ids.some((id) => app.serverPlace.get(id)?.group !== gid); }
  function canDropFav() { return !!drag && serversOf(drag.ids).some((s) => !s.favorite); }
  function onPress(e: PointerEvent, id: string) {
    if (e.button !== 0 || edit || fromCardControl(e)) return;
    press = { id, x: e.clientX, y: e.clientY };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onRelease, { once: true });
    window.addEventListener('pointercancel', endDrag, { once: true });
  }
  function onMove(e: PointerEvent) {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      const ids = selected.includes(press.id) ? visible.filter((id) => selected.includes(id)) : [press.id];
      drag = { ids: ids.length ? ids : [press.id], x: 0, y: 0, over: null };
      document.documentElement.classList.add('dragging-servers');
    }
    drag.x = e.clientX; drag.y = e.clientY;
    hit(e.clientX, e.clientY);
    if (!scrollRaf) scrollRaf = requestAnimationFrame(autoScroll);
  }
  /** 拖到列表上下边缘时自动滚动，跨合集拖放不必先折叠 */
  let listEl = $state<HTMLDivElement>();
  let scrollRaf = 0;
  function autoScroll() {
    scrollRaf = 0;
    if (!drag || !listEl) return;
    const r = listEl.getBoundingClientRect(), edge = 48, { x, y } = drag;
    if (x < r.left || x > r.right) return;
    const d = y < r.top + edge ? y - (r.top + edge) : y > r.bottom - edge ? y - (r.bottom - edge) : 0;
    if (!d) return;
    const before = listEl.scrollTop;
    listEl.scrollTop += Math.sign(d) * Math.min(20, 4 + Math.abs(d) / 3);
    if (listEl.scrollTop === before) return;
    hit(x, y);
    scrollRaf = requestAnimationFrame(autoScroll);
  }
  function hit(x: number, y: number) {
    if (!drag) return;
    const el = document.elementFromPoint(x, y);
    const key = el?.closest('[data-drop]')?.getAttribute('data-drop');
    let over: Over | null = null;
    if (key === FAV) over = canDropFav() ? { kind: 'fav' } : null;
    else if (key) over = canDropGroup(key.slice(2)) ? { kind: 'group', gid: key.slice(2) } : null;
    else {
      const card = el?.closest<HTMLElement>('[data-card]');
      const zone = card ?? el?.closest<HTMLElement>('[data-zone]');
      const gid = card?.dataset.group ?? zone?.dataset.zone;
      if (gid && sort === 'custom') {
        if (card && drag.ids.includes(card.dataset.card!)) over = null;
        else if (card) { const r = card.getBoundingClientRect(); over = { kind: 'slot', gid, card: card.dataset.card!, after: x > r.left + r.width / 2 }; }
        else over = { kind: 'slot', gid, card: null, after: true };
      } else if (gid) over = canDropGroup(gid) ? { kind: 'group', gid } : null;
    }
    drag.over = over;
  }
  function onRelease() {
    if (drag) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false));
      const { ids, over } = drag;
      if (over?.kind === 'fav') void app.setServersFavorite(ids, true);
      else if (over?.kind === 'group') moveTo(ids, over.gid);
      else if (over?.kind === 'slot') {
        const from = new Set(ids.map((id) => app.serverPlace.get(id)?.group));
        const rest = (app.serverSection(over.gid)?.servers ?? []).map((s) => s.id).filter((id) => !ids.includes(id));
        const index = over.card ? rest.indexOf(over.card) + (over.after ? 1 : 0) : rest.length;
        app.moveServers(ids, over.gid, index);
        if (from.size > 1 || !from.has(over.gid)) app.toast(`${ids.length} 台服务器移到${over.gid === LOOSE ? '未分组' : `「${app.serverGroup(over.gid)?.name}」`}`);
      }
    }
    endDrag();
  }
  function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onRelease);
    window.removeEventListener('pointercancel', endDrag);
    document.documentElement.classList.remove('dragging-servers');
    cancelAnimationFrame(scrollRaf); scrollRaf = 0;
    press = null; drag = null;
  }
  $effect(() => endDrag);
  const groupName = (gid: string) => (gid === LOOSE ? '未分组' : `「${app.serverGroup(gid)?.name}」`);
  const dragLabel = $derived.by(() => {
    if (!drag) return '';
    const what = drag.ids.length === 1 ? serversOf(drag.ids)[0]?.name ?? '1 台' : `${drag.ids.length} 台服务器`;
    const o = drag.over;
    if (!o) return `${what} · 拖到合集、收藏或其他卡片之间`;
    if (o.kind === 'fav') return `${what} 加入收藏`;
    if (o.kind === 'group') return `${what} 移到${groupName(o.gid)}`;
    const same = drag.ids.every((id) => app.serverPlace.get(id)?.group === o.gid);
    return same ? `${what} · 调整顺序` : `${what} 移到${groupName(o.gid)}`;
  });
  const insertAt = (s: Server, gid: string, last: boolean): 'before' | 'after' | null => {
    const o = drag?.over;
    if (!o || o.kind !== 'slot' || o.gid !== gid) return null;
    if (o.card === s.id) return o.after ? 'after' : 'before';
    return o.card === null && last ? 'after' : null;
  };

  // ---------- 添加：单个、多行、端口范围 ----------
  const HOST = String.raw`(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)`;
  const HOSTPORT = new RegExp(`${HOST}:\\d{1,5}(?:-\\d{1,5})?`, 'gi');
  const BARE = new RegExp(`^${HOST}$`, 'i');
  /** 每行认一个或多个地址：connect 命令、host:port、裸域名；host:起-止 展开为端口范围（最多 32 个） */
  function parseAddresses(text: string) {
    const list: string[] = [];
    let bad = 0;
    for (const raw of text.split(/[\r\n,;，；]+/)) {
      const line = raw.trim();
      if (!line) continue;
      let found = [...line.matchAll(/connect\s+([^\s;"']+)/gi)].map((m) => m[1]);
      if (!found.length) found = line.match(HOSTPORT) ?? [];
      if (!found.length && BARE.test(line)) found = [line];
      if (!found.length) { bad++; continue; }
      for (const a of found) {
        const r = a.match(/^(.+):(\d{1,5})-(\d{1,5})$/);
        if (!r) { list.push(a); continue; }
        const from = +r[2], to = +r[3];
        if (to < from || to - from >= 32) { bad++; continue; }
        for (let p = from; p <= to; p++) list.push(`${r[1]}:${p}`);
      }
    }
    return { list: [...new Set(list)], bad };
  }
  let address = $state('');
  let label = $state('');
  let gamePort = $state('');
  let advanced = $state(false);
  let multiline = $state(false);
  let adding = $state<{ done: number; total: number } | null>(null);
  let addOpen = $state(false);
  let addressField = $state<HTMLInputElement | HTMLTextAreaElement>();
  const showAdd = $derived(addOpen || !app.servers.length);
  let formError = $state('');
  let target = $state<string>(LOOSE);
  const addTarget = $derived(group ? group.id : app.serverGroup(target) ? target : LOOSE);
  const parsed = $derived(parseAddresses(address));
  const batch = $derived(parsed.list.length > 1);
  async function toggleAdd() {
    addOpen = !addOpen;
    if (addOpen) { await tick(); addressField?.focus(); }
  }
  function onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/[\r\n]/.test(text.trim())) return;
    e.preventDefault();
    address = text.trim();
    multiline = true;
  }
  async function add() {
    const addresses = parsed.list.length ? parsed.list : [address.trim()];
    if (adding || !addresses[0]) return;
    const room = 100 - app.servers.length;
    if (addresses.length > room) { formError = `最多保存 100 台服务器，还能添加 ${Math.max(0, room)} 台。`; return; }
    addOpen = true;
    adding = { done: 0, total: addresses.length }; formError = '';
    const { added, failed } = await app.addServers(addresses, { label, gamePort, groupId: addTarget, onProgress: (d) => { if (adding) adding.done = d; } });
    adding = null;
    if (failed.length) {
      // 留下没加进去的地址，方便改了再试
      address = failed.map((f) => f.address).join('\n');
      multiline = failed.length > 1;
      formError = failed.length === 1 ? failed[0].message : failed.slice(0, 4).map((f) => `${f.address}：${f.message}`).join('\n') + (failed.length > 4 ? `\n…另 ${failed.length - 4} 条` : '');
    } else { address = ''; multiline = false; }
    if (added.length) { label = ''; gamePort = ''; advanced = false; }
    if (addresses.length > 1 && added.length) app.toast(`已添加 ${added.length} 台到${groupName(addTarget)}`);
  }

  // ---------- 键盘 ----------
  function onKey(e: KeyboardEvent) {
    if (app.friendsOpen || menu || app.confirmation || edit || app.route !== 'servers' || (e.target as Element).closest?.('input, select, textarea, .ctx-menu')) return;
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-card]')?.dataset.card;
    const ids = selected.length ? [...selected] : focused ? [focused] : [];
    if (e.key === 'Escape') { if (drag) endDrag(); else selected = []; return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && visible.length) { e.preventDefault(); selected = [...visible]; return; }
    if (!ids.length || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Delete') { e.preventDefault(); void app.removeServers(ids); }
    else if (e.key.toLowerCase() === 'f') { e.preventDefault(); const list = serversOf(ids); void app.setServersFavorite(ids, !list.every((s) => s.favorite)); }
    else if (e.key === 'F2' && ids.length === 1) { e.preventDefault(); const s = serversOf(ids)[0]; if (s) renameServer(s); }
  }
  function onCardKey(e: KeyboardEvent, s: Server) {
    if ((e.target as Element) !== e.currentTarget) return;
    if (e.key === 'Enter') { e.preventDefault(); connect(s); }
    else if (e.key === ' ') { e.preventDefault(); pick(s.id, e.shiftKey); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      menu = { x: r.left + 24, y: r.top + 24, items: serverItems(targets(s.id)) };
    }
  }

  onMount(() => {
    void app.refreshServers();
    const timer = setInterval(() => {
      if(document.visibilityState !== 'visible') return;
      if(autoRefresh) void app.refreshServers();
    }, 30000);
    return () => clearInterval(timer);
  });
</script>

<svelte:window onkeydown={onKey} />

{#snippet card(s: Server, gid: string, last: boolean)}
  {@const place = app.serverPlace.get(s.id)}
  {@const picked = selected.includes(s.id)}
  {@const ins = insertAt(s, gid, last)}
  {@const live = hasData(s)}
  {@const isFull = full(s)}
  {@const camp = live ? campaignOf(s.map) : null}
  {@const n = s.players ?? 0}
  {@const cap = s.maxPlayers ?? 0}
  {@const failed = !live && s.status !== 'querying' && s.status !== 'unqueried'}
  {@const roster = live ? s.playerList : null}
  {@const block = connectBlock(s)}
  <div class="card" class:off={!live} class:full={live && isFull} class:warm={live && !isFull && cap > 0 && n / cap >= 0.75} class:picked class:moving={drag?.ids.includes(s.id)} class:ins-before={ins === 'before'} class:ins-after={ins === 'after'}
       data-card={s.id} data-group={gid} role="button" tabindex="0" aria-label={`${pad(place?.index)} ${s.name}`} aria-pressed={selecting ? picked : undefined}
       onpointerdown={(e) => onPress(e, s.id)} onclick={(e) => onCardClick(e, s.id)} ondblclick={(e) => { if (!fromCardControl(e)) connect(s); }}
       onkeydown={(e) => onCardKey(e, s)} oncontextmenu={(e) => menuAt(e, serverItems(targets(s.id)))}>
    <div class="top">
      <button class="idx mono" class:show={selecting} class:on={picked} type="button" title={picked ? '取消选择' : '选择（Ctrl / Shift + 点击卡片也可多选）'} aria-label={picked ? `取消选择 ${s.name}` : `选择 ${s.name}`}
              data-sfx="none" onclick={(e) => { e.stopPropagation(); pick(s.id, e.shiftKey); }}>
        <span class="num">{pad(place?.index)}</span><span class="box">{#if picked}<Check size={11} strokeWidth={3} />{/if}</span>
      </button>
      <div class="title">
        {#if edit?.kind === 'server' && edit.id === s.id}
          <input class="rename" bind:value={editValue} maxlength={80} placeholder="留空恢复服务器名称" onkeydown={onEditKey} onblur={commit} use:focus />
        {:else}
          <div class="name" title={tip(s)}>{s.name}</div>
        {/if}
        {#if live || s.lastSeen}
          <span class="map" title={s.map}>
            {#if camp}<span class="camp">{camp.name}</span>
              <span class="chs" title={`第 ${camp.chapter} / ${camp.chapters} 章`} role="img" aria-label={`第 ${camp.chapter} 章，共 ${camp.chapters} 章`}>{#each Array(camp.chapters) as _, i (i)}<i class:on={i < camp.chapter} class:cur={i === camp.chapter - 1}></i>{/each}</span>
            {:else if live}<span class="code mono">{s.map || '—'}</span>
            {:else if s.lastSeen}<span class="seen">上次在线 {ago(s.lastSeen)}</span>{/if}
          </span>
        {/if}
        <div class="meta">{#if s.password}<Lock size={11} /><span class="sr">需要密码 · </span>{/if}{meta(s)}</div>
      </div>
      <button class="star" class:on={s.favorite} type="button" title={s.favorite ? '取消收藏（F）' : '收藏（F）'} aria-label={s.favorite ? `取消收藏 ${s.name}` : `收藏 ${s.name}`} aria-pressed={s.favorite}
              onclick={(e) => { e.stopPropagation(); void app.toggleFavorite(s.id); }}><Star size={13} fill={s.favorite ? 'currentColor' : 'none'} /></button>
    </div>
    <div class="stat" title="玩家 / 上限">
      {#if live}
        <span class="n" class:zero={!n}>{n}</span><span class="cap">/{cap || '—'}</span>
        <span class="state">{isFull ? '已满' : !n ? '空闲' : cap ? `余 ${cap - n} 位` : '在线'}</span>
      {:else}
        <span class="n zero">—</span>
        <span class="state" class:err={failed}>{#if s.status === 'querying'}<i class="pulse"></i>探测中…{:else}{statuses[s.status]}{/if}</span>
      {/if}
    </div>
    <div class="meter" aria-hidden="true"><i style:width={live && cap ? `${Math.min(100, (n / cap) * 100)}%` : '0%'}></i></div>
    {#if roster?.length}
      <details class="roster">
        <summary title="查看在线名单">
          <Users size={13} />
          <span class="roster-names">{roster.slice(0, 2).map(p => p.name || '正在连接…').join(' · ')}</span>
          {#if roster.length > 2}<span class="roster-extra mono">+{roster.length - 2}</span>{/if}
          <span class="roster-arrow"><ChevronDown size={12} /></span>
        </summary>
        <ul class="players" aria-label="在线名单">
          {#each roster as p, i (i)}<li><span class="pn" title={p.name}>{p.name || '正在连接…'}</span><span class="pt mono" title="本次连接时长">{dur(p.seconds)}</span></li>{/each}
        </ul>
      </details>
    {:else if failed && s.error}
      <p class="why" title={s.error}>{s.error}</p>
    {/if}
    <div class="foot">
      <span class="ping mono" class:slow={live && s.ping !== null && s.ping > 100} title={live && s.ping !== null ? '查询延迟' : '暂无延迟'}>
        <i class:online={s.status === 'online'} class:busy={s.status === 'querying'}></i>{live && s.ping !== null ? `${s.ping} ms` : '—'}
      </span>
      <span class="go">
        {#if copyOnly(s)}
          <button class="btn sm tonal" type="button" title="复制到游戏控制台" onclick={(e) => { e.stopPropagation(); void app.copyServer(s); }}>复制命令</button>
        {:else}
          <button class="btn sm connect" type="button" disabled={!!block} title={block || (isFull ? '已满 · 仍然连接' : '启动并连接（双击卡片）')} onclick={(e) => { e.stopPropagation(); connect(s); }}>连接</button>
        {/if}
        <button class="icon-btn" type="button" title="更多" aria-label={`${s.name} 的更多操作`} onclick={(e) => { e.stopPropagation(); menuBelow(e.currentTarget, serverItems(targets(s.id))); }}><Ellipsis size={14} /></button>
      </span>
    </div>
  </div>
{/snippet}

<section class="servers" aria-label="服务器">
  <aside class="side">
    <div class="group">
      <div class="gh"><span class="section-label">服务器</span></div>
      <div class="item" class:on={view === ALL} role="button" tabindex="0" onclick={() => go(ALL)} onkeydown={(e) => e.key === 'Enter' && go(ALL)}>
        <span class="lic"><Layers size={13} /></span><span class="nm">全部</span><span class="mono n">{app.servers.length}</span>
      </div>
      <div class="item" class:on={view === FAV} class:target={!!drag && canDropFav()} class:drop={drag?.over?.kind === 'fav'} data-drop={FAV}
           role="button" tabindex="0" onclick={() => go(FAV)} onkeydown={(e) => e.key === 'Enter' && go(FAV)}>
        <span class="lic"><Star size={13} /></span><span class="nm">收藏</span><span class="mono n">{favCount}</span>
      </div>
    </div>

    <div class="group">
      <div class="gh"><span class="section-label">合集</span>
        <button class="icon-btn" title="新建合集" aria-label="新建合集" onclick={() => startEdit({ kind: 'new-group' }, app.freshServerGroupName())}><Plus size={14} /></button>
      </div>
      {#each app.serverSections as sec (sec.id)}
        {#if !sec.loose}
          {#if edit?.kind === 'group' && edit.id === sec.id}
            <input class="inline" bind:value={editValue} maxlength={40} onkeydown={onEditKey} onblur={commit} use:focus />
          {:else}
            {@const st = stat(sec.servers)}
            <div class="item" class:on={view === sec.id} class:target={!!drag && canDropGroup(sec.id)} class:drop={drag?.over?.kind === 'group' && drag.over.gid === sec.id}
                 data-drop={'g:' + sec.id} role="button" tabindex="0" title={`${st.online} 在线 / ${st.total} 台 · ${st.players} 名玩家`}
                 onclick={() => go(sec.id)} onkeydown={(e) => e.key === 'Enter' && go(sec.id)} oncontextmenu={(e) => menuAt(e, groupItems(sec.id, 'side'))}>
              <span class="nm">{sec.name}</span>
              <span class="ops">
                <button class="icon-btn" title="重命名" aria-label={`重命名 ${sec.name}`} onclick={(e) => { e.stopPropagation(); startEdit({ kind: 'group', id: sec.id }, sec.name); }}><Pencil size={12} /></button>
                <button class="icon-btn" title="删除合集（服务器移到未分组）" aria-label={`删除合集 ${sec.name}`} onclick={(e) => { e.stopPropagation(); app.deleteServerGroup(sec.id); }}><Trash2 size={12} /></button>
              </span>
              <span class="mono n">{#if st.online}<i class="live"></i>{/if}{sec.servers.length}</span>
            </div>
          {/if}
        {/if}
      {/each}
      {#if edit?.kind === 'new-group'}
        <input class="inline" bind:value={editValue} maxlength={40} onkeydown={onEditKey} onblur={commit} use:focus />
      {/if}
      <div class="item loose" class:on={view === LOOSE} class:target={!!drag && canDropGroup(LOOSE)} class:drop={drag?.over?.kind === 'group' && drag.over.gid === LOOSE}
           data-drop={'g:' + LOOSE} role="button" tabindex="0" onclick={() => go(LOOSE)} onkeydown={(e) => e.key === 'Enter' && go(LOOSE)}
           oncontextmenu={(e) => menuAt(e, groupItems(LOOSE, 'side'))}>
        <span class="lic"><Inbox size={13} /></span><span class="nm">未分组</span><span class="mono n">{looseCount}</span>
      </div>
    </div>
  </aside>

  <div class="main">
    <header>
      <div class="ttl">
        <div class="name-line">
          {#if edit?.kind === 'title' && custom}
            <input class="title-edit" bind:value={editValue} maxlength={40} onkeydown={onEditKey} onblur={commit} use:focus />
          {:else}
            <h2 title={custom ? '双击重命名' : undefined} ondblclick={() => custom && startEdit({ kind: 'title', id: custom.id }, custom.name)}>{title}</h2>
          {/if}
          {#if group}
            <button class="icon-btn" title="合集操作" aria-label="合集操作" onclick={(e) => menuBelow(e.currentTarget, groupItems(group.id, 'main'))}><Ellipsis size={15} /></button>
          {/if}
        </div>
        <div class="sub mono">{totals.total} 台 · {totals.online} 在线 · {totals.players} 名玩家</div>
      </div>
      <div class="tools">
        {#if app.serverLayoutConflict}
          <button class="btn" onclick={() => app.retryServerLayoutDraft()}>重试分类草稿</button>
          <button class="btn ghost" onclick={() => app.useSavedServerLayout()}>采用已保存分类</button>
        {/if}
        <LaunchMode />
        {#if group}
          <button class="btn primary" title="加入本组在线、有空位、人最多的服务器" disabled={!app.bestServer(group.servers)} onclick={() => quickJoin(group.servers)}><Zap size={14} />快速加入</button>
        {/if}
        <button class="btn" onclick={() => app.refreshServers(pool.map((s) => s.id))} disabled={app.serversRefreshing || !pool.length}>
          <RefreshCw size={14} class={app.serversRefreshing ? 'spin' : ''} />{app.serversRefreshing ? '探测中…' : group || view === FAV ? '刷新' : '刷新全部'}
        </button>
        {#if app.servers.length}
          <button class="btn add-toggle" type="button" class:on={addOpen} aria-controls="server-add" aria-expanded={addOpen} disabled={!!adding} onclick={toggleAdd}>
            {#if addOpen}<ChevronUp size={14} />收起添加{:else}<Plus size={14} />添加服务器{/if}
          </button>
        {/if}
      </div>
    </header>

    <form class="add" id="server-add" hidden={!showAdd} onsubmit={(e) => { e.preventDefault(); void add(); }}>
      <div class="add-line">
        {#if multiline}
          <textarea class="address mono" aria-label="服务器地址（每行一个）" rows="4" bind:this={addressField} bind:value={address} maxlength={8000}
                    placeholder={'每行一个地址，支持 connect 命令和端口范围\nconnect 1.2.3.4:27015\nexample.com:27015-27022'}></textarea>
        {:else}
          <input class="address mono" aria-label="服务器地址" placeholder="IP 或域名:端口，例如 example.com:27015" bind:this={addressField} bind:value={address} maxlength={300} onpaste={onPaste} />
        {/if}
        {#if !group && app.serverLayout.groups.length}
          <span class="pick target">
            <select aria-label="添加到合集" bind:value={target} title="新服务器放进的合集">
              <option value={LOOSE}>放入：未分组</option>
              {#each app.serverLayout.groups as g (g.id)}<option value={g.id}>放入：{g.name}</option>{/each}
            </select>
            <ChevronDown size={13} />
          </span>
        {/if}
        <button class="btn tonal" type="submit" disabled={!!adding || !address.trim()}>
          <Plus size={14} /><span>{adding ? `添加中 ${adding.done}/${adding.total}` : batch ? `添加 ${parsed.list.length} 台` : '添加'}{#if group && !adding}<span class="to">到{group.loose ? '未分组' : `「${group.name}」`}</span>{/if}</span>
        </button>
        <button class="options" type="button" onclick={() => (advanced = !advanced)} aria-expanded={advanced}>更多选项</button>
      </div>
      {#if multiline || batch || parsed.bad}
        <p class="parse">
          {#if parsed.list.length}识别到 {parsed.list.length} 个地址{/if}{#if parsed.bad}{parsed.list.length ? '，' : ''}{parsed.bad} 行无法识别（端口范围最多 32 个）{/if}
          {#if multiline}<button type="button" class="link" onclick={() => { multiline = false; address = parsed.list[0] ?? ''; }}>改回单行</button>{/if}
        </p>
      {/if}
      {#if advanced}
        <div class="advanced">
          <label>备注<input placeholder="可选，替代服务器名称" maxlength={80} bind:value={label} disabled={batch} /></label>
          <label>连接端口<input class="port mono" placeholder="自动" inputmode="numeric" maxlength={5} bind:value={gamePort} disabled={batch} /></label>
          <span>{batch ? '批量添加仅使用查询地址。' : '连接端口与查询端口不同时填写。'}</span>
          {#if !multiline}<button type="button" class="link" onclick={() => (multiline = true)}>多行粘贴</button>{/if}
        </div>
      {/if}
      {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
    </form>

    <div class="filters">
      <div class="search"><Search size={14} /><input aria-label="筛选服务器" placeholder="名称、地图或地址" bind:value={q} />{#if q}<button class="clear" aria-label="清空筛选" onclick={() => (q = '')}><X size={13} /></button>{/if}</div>
      <span class="pick"><select aria-label="游戏模式" bind:value={mode}>{#each modes as m (m)}<option value={m}>{m === '全部' ? '全部模式' : m}</option>{/each}</select><ChevronDown size={13} /></span>
      <button class="chip" class:on={hideEmpty} aria-pressed={hideEmpty} onclick={() => (hideEmpty = !hideEmpty)}>隐藏空服</button>
      <button class="chip" class:on={hideFull} aria-pressed={hideFull} onclick={() => (hideFull = !hideFull)}>隐藏满员</button>
      <span class="grow"></span>
      <span class="pick"><select aria-label="排序" bind:value={sort} title={sort === 'custom' ? '拖动卡片调整顺序' : '按自定义顺序时才能拖动排序'}>{#each sorts as o (o.id)}<option value={o.id}>{o.label}</option>{/each}</select><ChevronDown size={13} /></span>
      <span class="auto" title="页面开着时每 30 秒刷新一次"><Toggle on={autoRefresh} onchange={() => (autoRefresh = !autoRefresh)} label="每 30 秒自动刷新" />30 秒刷新</span>
    </div>

    <div class="list" bind:this={listEl} aria-busy={app.serversRefreshing} role="presentation" onclick={(e) => { if (!(e.target as Element).closest('.card') && !e.ctrlKey && !e.shiftKey) selected = []; }}>
      {#if !app.servers.length}
        <div class="first"><span class="first-ic"><ServerIcon size={26} strokeWidth={1.75} /></span><h3>还没有服务器</h3></div>
      {:else}
        {#each sections as sec (sec.id)}
          {@const st = stat(sec.servers)}
          {@const folded = multi && collapsed.has(sec.id)}
          <div class="sec">
            {#if multi}
              <div class="sec-head" class:drop={drag?.over?.kind === 'group' && drag.over.gid === sec.id} data-drop={'g:' + sec.id}
                   role="presentation" oncontextmenu={(e) => menuAt(e, groupItems(sec.id, 'main'))}>
                <button class="fold" type="button" aria-expanded={!folded} aria-label={folded ? `展开 ${sec.name}` : `折叠 ${sec.name}`}
                        onclick={() => (folded ? collapsed.delete(sec.id) : collapsed.add(sec.id))}><span class:closed={folded}><ChevronDown size={14} /></span></button>
                <button class="sec-name" type="button" title="只看这个合集" onclick={() => go(sec.id)}>{sec.name}</button>
                <span class="sec-stat mono">{st.online}/{st.total} 在线 · {st.players} 人{#if filtering && sec.shown.length !== sec.servers.length} · 显示 {sec.shown.length}{/if}</span>
                <span class="grow"></span>
                <span class="sec-ops">
                  <button class="icon-btn" title="快速加入" aria-label={`快速加入 ${sec.name}`} disabled={!app.bestServer(sec.servers)} onclick={() => quickJoin(sec.servers)}><Zap size={13} /></button>
                  <button class="icon-btn" title="刷新本组" aria-label={`刷新 ${sec.name}`} disabled={!sec.servers.length} onclick={() => app.refreshServers(sec.servers.map((s) => s.id))}><RefreshCw size={13} /></button>
                  <button class="icon-btn" title="合集操作" aria-label={`${sec.name} 合集操作`} onclick={(e) => menuBelow(e.currentTarget, groupItems(sec.id, 'main'))}><Ellipsis size={14} /></button>
                </span>
              </div>
            {/if}
            {#if !folded}
              <div class="grid" data-zone={sec.id} class:zone-drop={drag?.over?.kind === 'slot' && drag.over.gid === sec.id && !sec.shown.length}>
                {#each sec.shown as s, i (s.id)}{@render card(s, sec.id, i === sec.shown.length - 1)}{/each}
                {#if !sec.shown.length}
                  <div class="zone-empty">
                    {#if filtering}没有符合筛选条件的服务器。
                    {:else if view === FAV}点服务器上的星标即可收藏。
                    {:else if sec.loose}所有服务器都已归入合集。
                    {:else}拖入服务器或粘贴地址添加。{/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <div class="zone-empty pad">{filtering ? '没有符合筛选条件的服务器。' : view === FAV ? '点服务器上的星标即可收藏。' : '这里还没有服务器。'}</div>
        {/each}
      {/if}
    </div>

    {#if selecting}
      {@const picked = serversOf(selected)}
      {@const allFav = picked.every((s) => s.favorite)}
      <footer class="bulk fade-in">
        <span class="count">已选 <b class="mono">{selected.length}</b> 台</span>
        <button class="btn sm" onclick={(e) => menuBelow(e.currentTarget, moveItems(selected))}><FolderInput size={13} />移动到</button>
        <button class="btn sm" onclick={() => app.setServersFavorite(selected, !allFav)}><Star size={13} />{allFav ? '取消收藏' : '收藏'}</button>
        <button class="btn sm" onclick={() => app.refreshServers([...selected])}><RefreshCw size={13} />刷新</button>
        <button class="btn sm" onclick={() => app.copyText(listText('服务器', picked), `已复制 ${picked.length} 条连接命令`)}><Copy size={13} />复制命令</button>
        <button class="btn sm danger-btn" onclick={() => app.removeServers([...selected])}><Trash2 size={13} />移除</button>
        <span class="grow"></span>
        <button class="btn sm ghost" onclick={() => (selected = [])}><X size={13} />取消选择 <span class="key mono">Esc</span></button>
      </footer>
    {:else}
      <footer>
        <span>{app.serversRefreshing ? '正在查询…' : `${stat(app.servers).online} 在线 / ${app.servers.length} 已添加`}</span>
        <span>{app.launchConfig.mode === 'clean' ? '纯净对抗 · 使用 Steam 原版目录' : app.launchConfig.vacMode === 'insecure' ? 'L4N 平台启动 · 当前带 -insecure，VAC 服务器提供连接命令' : 'L4N 平台启动 · 保持 Steam 登录'}</span>
      </footer>
    {/if}
  </div>
</section>

{#if drag}
  <div class="drag-chip" style:left="{drag.x + 14}px" style:top="{drag.y + 14}px">{dragLabel}</div>
{/if}
{#if menu}
  <Menu items={menu.items} x={menu.x} y={menu.y} onclose={closeMenu} />
{/if}

<style>
  .servers { position: absolute; inset: 0; display: flex; }

  /* ---------- 侧栏 ---------- */
  .side { width: 196px; flex: none; border-right: 1px solid var(--line-soft); padding: 20px 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
  .group { display: flex; flex-direction: column; gap: 2px; }
  .gh { display: flex; align-items: center; justify-content: space-between; height: 26px; padding: 0 2px 0 8px; margin-bottom: 4px; }
  .gh .icon-btn { width: 22px; height: 22px; }
  .item { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px; border-radius: var(--r); color: var(--fg-2); cursor: pointer; transition: background var(--dur), color var(--dur), outline-color var(--dur); outline: 1px dashed transparent; outline-offset: -1px; }
  .item:hover { background: var(--hover); color: var(--fg); }
  /* 选中项：M3 导航的「活动指示」——次级容器色（同 Mod 页左栏） */
  .item.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .item.on .n { color: inherit; opacity: .7; }
  .item.target { outline-color: var(--line-strong); }
  .item.drop { outline: 1px solid var(--md-primary); background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .item:focus-visible { outline: 2px solid color-mix(in srgb, var(--md-primary) 70%, transparent); }
  .item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .n { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-3); }
  .item .lic { display: grid; place-items: center; width: 16px; flex: none; color: var(--fg-3); }
  .item.on .lic { color: inherit; }
  .item.loose { color: var(--fg-3); }
  .item .ops { display: none; flex: none; }
  .item .ops .icon-btn { width: 22px; height: 22px; }
  .item:hover .ops { display: flex; }
  .item:has(.ops):hover .n { display: none; }
  .live { width: 5px; height: 5px; border-radius: 50%; background: var(--md-primary); }
  .inline { height: 32px; margin: 0; padding: 0 8px; font-size: 13px; }

  /* ---------- 主区 ---------- */
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding: 22px 24px 16px; }
  .ttl { min-width: 0; }
  .name-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  h2 { margin: 0; font-size: 20px; font-weight: 700; line-height: 30px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title-edit { font-size: 18px; height: 34px; width: min(320px, 100%); }
  .sub { margin-top: 4px; font-size: 12px; color: var(--fg-3); }
  .tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  /* 顶部按钮：填充胶囊；「快速加入」是主操作，用主色 */
  .tools > .btn { height: 32px; padding: 0 14px; border-radius: 12px; border-color: transparent; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); }
  .tools > .btn:hover:not(:disabled) { border-color: transparent; background: var(--md-surface-container-highest); }
  .tools > .btn.primary { background: var(--md-primary); color: var(--md-on-primary); box-shadow: 0 8px 18px -10px color-mix(in srgb, var(--md-primary) 90%, transparent); }
  .tools > .btn.primary:hover:not(:disabled) { background: var(--md-primary); filter: brightness(1.07); }
  .tools > .add-toggle { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .tools > .add-toggle:hover:not(:disabled), .tools > .add-toggle.on { background: color-mix(in srgb, var(--md-secondary-container) 88%, var(--md-on-secondary-container)); }
  .tonal { background: var(--md-secondary-container); border-color: transparent; color: var(--md-on-secondary-container); }
  .tonal:hover:not(:disabled) { background: color-mix(in srgb, var(--md-secondary-container) 88%, var(--md-on-secondary-container)); border-color: transparent; }
  /* 下拉：去掉系统箭头，外面一层 .pick 放 lucide 箭头（同 Mod / 发现页） */
  .pick { position: relative; display: inline-flex; align-items: center; flex: none; color: var(--fg-3); }
  .pick select { appearance: none; height: 32px; max-width: 160px; padding: 0 28px 0 12px; border: 1px solid transparent; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); color: var(--fg-2); font-size: 12px; cursor: pointer; transition: background var(--dur), border-color var(--dur); }
  .pick select:hover { background: var(--md-surface-container-highest); }
  .pick select:focus-visible { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); }
  .pick :global(svg) { position: absolute; right: 10px; pointer-events: none; }
  .btn:disabled, .icon-btn:disabled { opacity: .45; cursor: default; }
  .btn:disabled:hover, .icon-btn:disabled:hover { background: none; }

  .add { padding: 0 24px 14px; }
  .add-line { display: flex; align-items: flex-start; gap: 8px; }
  .address { flex: 1; min-width: 120px; padding: 7px 14px; height: 34px; border: 1px solid transparent; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); transition: border-color var(--dur), background var(--dur); }
  .address:focus { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); background: color-mix(in srgb, var(--md-surface-bright) 85%, transparent); }
  textarea.address { height: auto; min-height: 84px; resize: vertical; line-height: 1.6; }
  .add-line .btn { height: 34px; padding: 0 14px; border-radius: 12px; }
  .add-line .pick select { height: 34px; max-width: 170px; }
  .to { color: var(--fg-3); }
  .options { color: var(--fg-3); white-space: nowrap; font-size: 12px; height: 32px; }
  .options:hover, .link:hover { color: var(--fg); }
  .link { color: var(--fg-2); font-size: 12px; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--fg-4); margin-left: 8px; }
  .parse { margin: 8px 0 0; font-size: 12px; color: var(--fg-3); }
  .advanced { display: flex; gap: 14px; align-items: end; flex-wrap: wrap; margin-top: 12px; }
  .advanced label { display: flex; flex-direction: column; gap: 6px; color: var(--fg-2); font-size: 12px; }
  .advanced input:disabled { opacity: .45; }
  .advanced span { color: var(--fg-3); font-size: 12px; padding-bottom: 6px; }
  .advanced .link { margin: 0 0 6px; }
  .advanced input { height: 32px; border-color: transparent; border-radius: 10px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); }
  .advanced input:focus { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); }
  .port { width: 80px; }
  .form-error { margin: 8px 0 0; color: var(--danger); font-size: 12px; white-space: pre-line; }

  .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 0 24px 12px; }
  /* 筛选条：搜索和下拉都是填充胶囊（原来搜索框只有一条下划线） */
  .search { display: flex; align-items: center; gap: 6px; width: 220px; height: 32px; padding: 0 8px 0 12px; border: 1px solid transparent; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); color: var(--fg-4); transition: border-color var(--dur), background var(--dur); }
  .search:focus-within { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); background: color-mix(in srgb, var(--md-surface-bright) 85%, transparent); }
  .search input { border: 0; background: none; padding: 0; height: 100%; flex: 1; min-width: 0; }
  .search .clear { display: grid; place-items: center; color: var(--fg-3); }
  .search .clear:hover { color: var(--fg); }
  .grow { flex: 1; }
  .auto { display: inline-flex; gap: 8px; align-items: center; font-size: 12px; color: var(--fg-2); white-space: nowrap; }

  .list { flex: 1; min-height: 0; overflow: auto; border-top: 1px solid var(--line-soft); padding-bottom: 24px; }
  /* 合集标题：吸顶时是一枚浮在卡片上的胶囊，不再是一整条实色带 */
  .sec-head {
    position: sticky; top: 8px; z-index: 2; display: flex; align-items: center; gap: 6px; height: 38px; margin: 10px 16px 0; padding: 0 10px 0 8px;
    border: 1px solid var(--island-line); border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container) 90%, transparent);
    box-shadow: 0 8px 18px -14px rgb(0 0 0 / .45); transition: background var(--dur), box-shadow var(--dur);
  }
  .sec-head.drop { background: var(--md-secondary-container); box-shadow: 0 0 0 1px var(--md-primary); }
  .sec-ops .icon-btn:hover { background: var(--hover); }
  .fold { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; color: var(--fg-3); }
  .fold:hover { color: var(--fg); background: var(--hover); }
  .fold span { display: grid; transition: transform var(--dur); }
  .fold span.closed { transform: rotate(-90deg); }
  .sec-name { font-size: 13px; font-weight: 500; color: var(--fg); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sec-name:hover { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--fg-4); }
  .sec-stat { font-size: 12px; color: var(--fg-3); white-space: nowrap; }
  .sec-ops { display: flex; gap: 2px; opacity: 0; transition: opacity var(--dur); }
  .sec-head:hover .sec-ops, .sec-ops:focus-within { opacity: 1; }
  .sec-ops .icon-btn { width: 24px; height: 24px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(236px, 1fr)); gap: 12px; padding: 14px 24px 20px; border-radius: 16px; transition: background var(--dur); }
  .grid.zone-drop { background: color-mix(in srgb, var(--md-secondary-container) 40%, transparent); box-shadow: inset 0 0 0 1px var(--md-primary); }
  .zone-empty { grid-column: 1 / -1; padding: 22px 16px; border: 1.5px dashed var(--line-strong); border-radius: 14px; color: var(--fg-3); font-size: 12px; text-align: center; }
  .zone-empty.pad { margin: 24px; }

  /* ---------- 卡片 ---------- */
  /* 卡片：内容岛上的小浮岛（同 Mod / 发现页），悬停微微抬起；原来悬停写死成近黑 #121212，浅色主题下整张卡会变黑 */
  .card {
    position: relative; display: flex; flex-direction: column; min-width: 0; padding: 12px; outline: none; cursor: default;
    background: color-mix(in srgb, var(--md-surface-bright) 62%, transparent); border: 1px solid var(--island-line); border-radius: 16px;
    transition: border-color var(--dur), background var(--dur), opacity var(--dur), transform 240ms var(--ease-out), box-shadow 240ms var(--ease-out);
  }
  @media (hover: hover) and (pointer: fine) {
    .card:hover { background: color-mix(in srgb, var(--md-surface-bright) 88%, transparent); transform: translateY(-2px); box-shadow: 0 14px 28px -18px rgb(0 0 0 / .45); }
  }
  @media (prefers-reduced-motion: reduce) { .card:hover { transform: none; } }
  .card.off { background: color-mix(in srgb, var(--md-surface-bright) 40%, transparent); }
  .card:focus-visible { box-shadow: 0 0 0 2px var(--md-primary); }
  .card.picked { border-color: var(--md-primary); box-shadow: 0 0 0 1px var(--md-primary); background: color-mix(in srgb, var(--md-secondary-container) 40%, transparent); }
  .card.moving { opacity: .35; }
  .card.ins-before::before, .card.ins-after::after { content: ''; position: absolute; top: 4px; bottom: 4px; width: 3px; border-radius: 2px; background: var(--md-primary); }
  .card.ins-before::before { left: -7px; }
  .card.ins-after::after { right: -7px; }

  .top { display: flex; align-items: flex-start; gap: 8px; }
  .idx { position: relative; flex: none; display: flex; align-items: center; width: 24px; height: 24px; font-family: var(--font-display); font-weight: 500; font-size: 18px; line-height: 1; letter-spacing: .02em; color: var(--fg-3); font-variant-numeric: tabular-nums; }
  .card:hover .idx { color: var(--fg-2); }
  .card.off .idx { color: var(--fg-4); }
  .idx .box { display: none; place-items: center; width: 16px; height: 16px; margin-left: 2px; border: 1.5px solid var(--fg-3); border-radius: 5px; color: var(--md-on-primary); }
  .idx:hover .num, .idx.show .num { display: none; }
  .idx:hover .box, .idx.show .box { display: grid; }
  .idx.on .box { background: var(--md-primary); border-color: var(--md-primary); }
  .title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding-top: 2px; }
  .name { font-size: 15px; font-weight: 600; line-height: 20px; color: var(--fg); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .card.off .name { color: var(--fg-2); }
  .rename { width: 100%; height: 28px; padding: 0 6px; font-size: 14px; }
  .star { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 5px; color: var(--fg-3); opacity: 0; transition: opacity var(--dur), color var(--dur), background var(--dur); }
  .card:hover .star, .star:focus-visible, .star.on { opacity: 1; }
  .star:hover { color: var(--fg); background: var(--hover); }
  .star.on { color: var(--md-primary); }
  .meta { font-size: 12px; line-height: 16px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta :global(svg) { display: inline-block; vertical-align: -1px; margin-right: 5px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* 人数、容量条和名单预览是一组；只有收到名单时才显示展开入口。 */
  .stat { display: flex; align-items: baseline; gap: 3px; margin-top: 10px; }
  .stat .n { font-family: var(--font-display); font-weight: 500; font-size: 28px; line-height: 24px; color: var(--fg); font-variant-numeric: tabular-nums; }
  .stat .n.zero { color: var(--fg-4); }
  .stat .cap { font-family: var(--font-display); font-weight: 500; font-size: 15px; line-height: 1; color: var(--fg-3); }
  .stat .state { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-3); white-space: nowrap; }
  .stat .state.err { color: var(--danger); }
  .card.full .stat .state { color: var(--danger); }
  /* 容量条：平时主色，快满（≥ 75%）第三色，满了错误色 */
  .meter { height: 4px; margin-top: 6px; border-radius: 2px; background: color-mix(in srgb, var(--md-on-surface) 10%, transparent); overflow: hidden; }
  .meter i { display: block; height: 100%; border-radius: 2px; background: var(--md-primary); transition: width .4s ease, background var(--dur); }
  .card.warm .meter i { background: var(--md-tertiary); }
  .card.warm .stat .state { color: var(--md-tertiary); }
  .card.full .meter i { background: var(--danger); }
  .roster { margin-top: 6px; min-width: 0; }
  .roster summary { display: flex; align-items: center; gap: 5px; min-height: 24px; padding: 0 3px; border-radius: var(--r-sm); list-style: none; color: var(--fg-2); font-size: 12px; cursor: pointer; }
  .roster summary::-webkit-details-marker { display: none; }
  .roster summary:hover { background: var(--hover); color: var(--fg); }
  .roster summary :global(svg) { flex: none; }
  .roster-names { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .roster-extra { flex: none; color: var(--fg-3); }
  .roster-arrow { flex: none; display: grid; place-items: center; margin-left: auto; }
  .roster[open] .roster-arrow { transform: rotate(180deg); }
  .why { margin: 7px 0 0; font-size: 11px; line-height: 1.5; color: var(--fg-3); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-3); animation: pulse 1s ease-in-out infinite alternate; }
  @keyframes pulse { from { opacity: .25; } to { opacity: 1; } }
  .players { list-style: none; margin: 3px 0 0; padding: 4px 3px; max-height: 144px; overflow-y: auto; overscroll-behavior: contain; }
  .players li { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 20px; }
  .pn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); }
  .pt { flex: none; font-size: 11px; color: var(--fg-4); }

  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; margin-top: auto; padding-top: 8px; box-sizing: content-box; }
  .map { min-width: 0; display: flex; align-items: center; gap: 7px; min-height: 16px; white-space: nowrap; overflow: hidden; }
  .camp { font-size: 12px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; }
  .chs { display: inline-flex; align-items: center; gap: 3px; flex: none; }
  .chs i { width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--md-on-surface) 16%, transparent); }
  .chs i.on { background: color-mix(in srgb, var(--md-primary) 50%, transparent); }
  .chs i.cur { background: var(--md-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-primary) 22%, transparent); }
  .code { font-size: 12px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; }
  .seen { font-size: 12px; color: var(--fg-4); overflow: hidden; text-overflow: ellipsis; }
  .ping { flex: none; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--fg-3); }
  .ping.slow { color: var(--danger); }
  .ping i { width: 5px; height: 5px; border-radius: 50%; background: var(--fg-4); }
  .ping i.online { background: var(--md-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-primary) 22%, transparent); }
  .ping i.busy { animation: pulse 1s ease-in-out infinite alternate; }
  .go { display: inline-flex; flex: none; align-items: center; gap: 2px; }
  .go .icon-btn { width: 24px; height: 24px; }
  .go .btn { border-radius: 10px; }
  .go .connect { background: var(--md-secondary-container); border-color: transparent; color: var(--md-on-secondary-container); }
  .go .connect:hover:not(:disabled), .go .connect:focus-visible { background: var(--md-primary); color: var(--md-on-primary); }

  /* ---------- 底栏 ---------- */
  footer { padding: 10px 24px; min-height: 42px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 18px; font-size: 12px; color: var(--fg-3); border-top: 1px solid var(--line-soft); }
  .bulk { justify-content: flex-start; gap: 8px; background: color-mix(in srgb, var(--md-secondary-container) 50%, transparent); color: var(--fg-2); }
  .bulk .btn { border-radius: 10px; }
  .bulk .count { margin-right: 6px; }
  .bulk b { color: var(--fg); font-weight: 500; }
  .danger-btn { color: var(--danger); }
  .danger-btn:hover { border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
  .key { font-size: 11px; color: var(--fg-4); margin-left: 2px; }

  /* 空状态：主色容器里的服务器图标，轻轻上下浮（同下载页） */
  .first { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 80px 36px; }
  .first-ic { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 22px; background: var(--md-primary-container); color: var(--md-on-primary-container); box-shadow: 0 14px 28px -16px color-mix(in srgb, var(--md-primary) 80%, transparent); animation: bob 3.2s var(--ease-in-out) infinite; }
  @keyframes bob { 50% { transform: translateY(-5px); } }
  h3 { font-size: 16px; font-weight: 600; color: var(--fg); margin: 18px 0 6px; }
  @media (prefers-reduced-motion: reduce) { .first-ic { animation: none; } }

  .drag-chip { position: fixed; z-index: 50; pointer-events: none; max-width: 360px; overflow: hidden; text-overflow: ellipsis; padding: 6px 12px; border-radius: 10px; background: var(--md-surface-container-high); border: 1px solid var(--island-line); box-shadow: 0 10px 24px -12px rgb(0 0 0 / .45); color: var(--fg); font-size: 12px; white-space: nowrap; }
  :global(html.dragging-servers), :global(html.dragging-servers *) { cursor: grabbing !important; }

  @media (max-width: 860px) {
    .side { width: 168px; }
    header { flex-wrap: wrap; align-items: flex-start; }
  }
</style>
