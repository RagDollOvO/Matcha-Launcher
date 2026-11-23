import { serverApi } from '../api/servers';
import { errorText } from '../api/bridge';
import type { Server, ServerGroup, ServerLayout } from '../types';

/** 服务器页「未分组」：不在任何合集里的服务器，固定排在最后 */
export const LOOSE = 'loose';
export interface ServerSection { id: string; name: string; servers: Server[]; loose?: boolean }

interface ServerUi {
  canQuery(): boolean;
  confirm(title: string, message: string, ok?: string, extra?: { lists: { title: string; rows: { k: string; v: string }[] }[] }): Promise<boolean>;
  toast(text: string, action?: { label: string; run: () => void }): void;
  openServerPage(): void;
}

let groupSequence = 0;
const newGroupId = () => 'sg-' + Date.now().toString(36) + (groupSequence++).toString(36);

export class ServerStore {
  private readonly lastOnline = new Map<string, Server>();
  private refreshing = $state(false);
  private rows = $state<Server[]>([]);
  /** 服务器合集；本机保留待保存副本，收到后端回执后清理 */
  private layout = $state<ServerLayout>({ groups: [], loose: [] });
  private layoutRemote = false;
  private layoutLoaded = false;
  /** 正在保存的布局请求数；期间不让轮询回来的旧布局盖掉刚拖好的顺序 */
  private layoutSaving = 0;
  private layoutDirty = false;
  private layoutBase: ServerLayout | undefined;
  private layoutConflict = $state(readLocal<boolean>('flare.serverLayout.conflict', false));
  private layoutWrites: Promise<void> = Promise.resolve();
  /** 规范化后的合集：只含现存服务器、不重复；未分组在最后 */
  private sections = $derived.by(() => sectionsOf(this.layout, this.rows, this.lastOnline));
  /** 服务器 id → 所在合集与序号（从 1 开始），卡片编号用 */
  private place = $derived.by(() => {
    const out = new Map<string, { group: string; index: number }>();
    for (const sec of this.sections) sec.servers.forEach((s, i) => out.set(s.id, { group: sec.id, index: i + 1 }));
    return out;
  });
  private queuedQueries = new Set<string>();

  constructor(private readonly ui: ServerUi) {}

  get servers() { return this.rows; }
  get serverLayout() { return this.layout; }
  get serverLayoutConflict() { return this.layoutConflict; }
  get serverSections() { return this.sections; }
  get serverPlace() { return this.place; }
  get serversRefreshing() { return this.refreshing; }

  acceptSnapshot(servers: Server[], layout?: ServerLayout) {
    this.rows = servers;
    this.acceptLayout(layout);
  }

  async refreshState() {
    try {
      const state = await serverApi.state();
      this.acceptSnapshot(state.servers, state.serverLayout);
    } catch (e) {
      if ((e as { code?: string }).code !== 'unsupported_capability') return this.ui.toast(errorText(e));
      try { this.rows = await serverApi.list(); }
      catch (error) { this.ui.toast(errorText(error)); }
    }
  }

  // ---------- 服务器 ----------
  /** 正在查询时再请求的 id 排队，本轮结束后补查，不丢 */
  async refreshServers(ids = this.rows.map(s => s.id)) {
    if (!this.ui.canQuery() || !ids.length) return;
    if (this.refreshing) { ids.forEach(id => this.queuedQueries.add(id)); return; }
    this.refreshing = true;
    try { this.rows = await serverApi.query(ids); }
    catch (e) { this.ui.toast(errorText(e)); }
    finally {
      this.refreshing = false;
      const next = [...this.queuedQueries].filter(id => this.rows.some(s => s.id === id));
      this.queuedQueries.clear();
      if (next.length) void this.refreshServers(next);
    }
  }
  async toggleFavorite(id: string) {
    const s = this.rows.find((x) => x.id === id);
    if (s) await this.setServersFavorite([id], !s.favorite);
  }
  async setServersFavorite(ids: string[], favorite: boolean) {
    const list = ids.filter(id => { const s = this.rows.find(x => x.id === id); return s && s.favorite !== favorite; });
    if (!list.length) return;
    try { for (const id of list) this.rows = await serverApi.favorite(id, favorite); }
    catch (e) { this.ui.toast(errorText(e)); return; }
    if (list.length > 1) this.ui.toast(favorite ? `已收藏 ${list.length} 台服务器` : `已取消收藏 ${list.length} 台服务器`);
  }
  async toggleFriendFavorite(friend: Pick<Server, 'id' | 'addr'>) {
    const saved = this.rows.find(s => s.addr === friend.addr);
    if (saved?.favorite) return this.setServersFavorite([saved.id], false);
    this.rows = await serverApi.favoriteFriend(friend.id);
  }
  /** 逐个添加；新服务器放进合集 groupId（LOOSE = 未分组）。备注和连接端口只在单个添加时使用 */
  async addServers(addresses: string[], opts: { label?: string; gamePort?: string; groupId?: string; onProgress?: (done: number) => void } = {}) {
    const added: string[] = [], failed: { address: string; message: string; code?: string }[] = [];
    const single = addresses.length === 1;
    for (const [i, address] of addresses.entries()) {
      const before = new Set(this.rows.map(s => s.id));
      try {
        this.rows = await serverApi.add(address, single ? opts.label ?? '' : '', single ? opts.gamePort ?? '' : '');
        const id = this.rows.find(s => !before.has(s.id))?.id;
        if (id) added.push(id);
      } catch (e) {
        const code = (e as { code?: string }).code;
        failed.push({ address, message: errorText(e), code });
        if (code === 'server_limit') break;
      }
      opts.onProgress?.(i + 1);
    }
    if (added.length && opts.groupId && opts.groupId !== LOOSE) this.moveServers(added, opts.groupId);
    if (added.length) void this.refreshServers(added);
    return { added, failed };
  }
  async removeServers(ids: string[]) {
    const list = this.rows.filter(s => ids.includes(s.id));
    if (!list.length) return;
    const what = list.length === 1 ? `「${list[0].name}」` : ` ${list.length} 台服务器`;
    const names = list.length > 1 ? '\n\n' + list.slice(0, 8).map(s => `· ${s.name}`).join('\n') + (list.length > 8 ? `\n· …另 ${list.length - 8} 台` : '') : '';
    if (!await this.ui.confirm('移除服务器', `从 Matcha 列表移除${what}？\n收藏和合集位置一并删除，之后可重新添加。${names}`)) return;
    const done = await this.dropServers(list.map(s => s.id));
    if (done > 1) this.ui.toast(`已移除 ${done} 台服务器`);
  }
  removeServer(id: string) { return this.removeServers([id]); }
  private async dropServers(ids: string[]) {
    let done = 0;
    try { for (const id of ids) { this.rows = await serverApi.remove(id); done++; } }
    catch (e) { this.ui.toast(errorText(e)); }
    this.pruneLayout();
    return done;
  }
  /** 改备注。后端还没有 update-server 时，移除后用同一地址重新添加，再恢复收藏和合集位置 */
  async renameServer(id: string, label: string, inPlaceOnly = false) {
    const s = this.rows.find(x => x.id === id);
    const next = label.trim();
    if (!s || next === s.label || (!s.label && next === s.name)) return;
    if (next.length > 80) return this.ui.toast('备注最多 80 个字符');
    try { this.rows = await serverApi.update(id, next, s.gamePort); return; }
    catch (e) { if ((e as { code?: string }).code !== 'unsupported_capability') return this.ui.toast(errorText(e)); }
    if (inPlaceOnly) return this.ui.toast('当前服务版本较旧，请升级后再清除备注。');
    const layout = this.explicitLayout();
    const port = s.gamePort === null ? '' : String(s.gamePort);
    let list: Server[];
    try {
      list = await serverApi.remove(id);
      const before = new Set(list.map(x => x.id));
      try { list = await serverApi.add(s.addr, next, port); }
      catch (e) { this.ui.toast(errorText(e)); list = await serverApi.add(s.addr, s.label, port); }
      const fresh = list.find(x => !before.has(x.id))?.id;
      if (!fresh) { this.rows = list; return; }
      if (s.favorite) list = await serverApi.favorite(fresh, true);
      const swap = (ids: string[]) => ids.map(x => (x === id ? fresh : x));
      this.layout = { groups: layout.groups.map(g => ({ ...g, serverIds: swap(g.serverIds) })), loose: swap(layout.loose) };
      this.persistLayout();
      this.rows = list;
      void this.refreshServers([fresh]);
    } catch (e) { this.ui.toast(errorText(e)); void serverApi.list().then(rows => { this.rows = rows; }); }
  }

  // ---------- 服务器合集 ----------
  serverGroup(id: string) { return this.layout.groups.find(g => g.id === id); }
  serverSection(id: string) { return this.sections.find(s => s.id === id); }
  freshServerGroupName(base = '新合集') {
    for (let i = 1; ; i++) { const n = i === 1 ? base : `${base} ${i}`; if (!this.serverGroupTaken(n)) return n; }
  }
  private serverGroupTaken(name: string, except?: string) {
    return name === '未分组' || this.layout.groups.some(g => g.name === name && g.id !== except);
  }
  createServerGroup(name: string, ids: string[] = []): ServerGroup | undefined {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    if (this.serverGroupTaken(n)) { this.ui.toast(`已有合集「${n}」`); return; }
    const id = newGroupId();
    this.layout.groups.push({ id, name: n, serverIds: [] });
    if (ids.length) this.moveServers(ids, id); else this.persistLayout();
    return this.serverGroup(id);
  }
  renameServerGroup(id: string, name: string) {
    const g = this.serverGroup(id);
    const n = name.trim().slice(0, 40);
    if (!g || !n || n === g.name) return;
    if (this.serverGroupTaken(n, id)) return this.ui.toast(`已有合集「${n}」`);
    g.name = n;
    this.persistLayout();
  }
  shiftServerGroup(id: string, step: -1 | 1) {
    const groups = this.layout.groups;
    const i = groups.findIndex(g => g.id === id), j = i + step;
    if (i < 0 || j < 0 || j >= groups.length) return;
    [groups[i], groups[j]] = [groups[j], groups[i]];
    this.persistLayout();
  }
  /** 只删合集本身，里面的服务器回到未分组 */
  deleteServerGroup(id: string) {
    const g = this.serverGroup(id);
    if (!g) return;
    const layout = this.explicitLayout();
    const moved = layout.groups.find(x => x.id === id)?.serverIds ?? [];
    this.layout = { groups: layout.groups.filter(x => x.id !== id), loose: [...layout.loose, ...moved] };
    this.persistLayout();
    this.ui.toast(moved.length ? `已删除合集「${g.name}」，${moved.length} 台服务器移到未分组` : `已删除合集「${g.name}」`);
  }
  async deleteServerGroupWithServers(id: string) {
    const g = this.serverGroup(id), sec = this.serverSection(id);
    if (!g || !sec) return;
    if (!sec.servers.length) return this.deleteServerGroup(id);
    if (!await this.ui.confirm('删除合集和其中的服务器', `删除合集「${g.name}」，并从 Matcha 移除其中 ${sec.servers.length} 台服务器？\n收藏状态一并删除，之后可重新添加。`)) return;
    const name = g.name;
    this.layout.groups = this.layout.groups.filter(x => x.id !== id);
    const done = await this.dropServers(sec.servers.map(s => s.id));
    this.ui.toast(`已删除合集「${name}」和 ${done} 台服务器`);
  }
  /** 把服务器移到合集（LOOSE = 未分组）的第 index 位；index 按去掉这些服务器后的目标列表计，缺省放到最后 */
  moveServers(ids: string[], groupId: string, index?: number) {
    const moving = new Set(ids);
    const layout = this.explicitLayout();
    const lists = new Map<string, string[]>([...layout.groups.map(g => [g.id, g.serverIds] as const), [LOOSE, layout.loose]]);
    const order = [...lists.values()].flat().filter(id => moving.has(id));
    const target = lists.get(groupId);
    if (!order.length || !target) return;
    for (const [k, v] of lists) lists.set(k, v.filter(id => !moving.has(id)));
    const rest = lists.get(groupId)!;
    rest.splice(index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length)), 0, ...order);
    this.layout = { groups: layout.groups.map(g => ({ ...g, serverIds: lists.get(g.id)! })), loose: lists.get(LOOSE)! };
    this.persistLayout();
  }
  /** 当前布局写成显式列表（未分组里没登记顺序的也写进去），便于原位替换和移动 */
  private explicitLayout(): ServerLayout {
    const ids = (sec: ServerSection | undefined) => sec?.servers.map(s => s.id) ?? [];
    return {
      groups: this.layout.groups.map(g => ({ id: g.id, name: g.name, serverIds: ids(this.serverSection(g.id)) })),
      loose: ids(this.serverSection(LOOSE)),
    };
  }
  /** 只在确认移除后调用；列表临时为空（如查询失败）时不清理，避免丢布局 */
  private pruneLayout() {
    const alive = new Set(this.rows.map(s => s.id));
    this.layout = {
      groups: this.layout.groups.map(g => ({ id: g.id, name: g.name, serverIds: g.serverIds.filter(id => alive.has(id)) })),
      loose: this.layout.loose.filter(id => alive.has(id)),
    };
    this.persistLayout();
  }
  private acceptLayout(remote: ServerLayout | undefined) {
    if (remote && Array.isArray(remote.groups)) {
      if (this.layoutSaving) return;
      const clean = cleanLayout(remote);
      const local = readLocal<unknown>(LAYOUT_KEY, null);
      if (!this.layoutRemote && local) {
        // 首次接入或重试未完成的保存，收到回执后再清理本机副本。
        this.layoutRemote = true;
        this.layoutBase = structuredClone(remote);
        this.layout = cleanLayout(local);
        this.layoutDirty = true;
        if (this.layoutConflict) this.markLayoutConflict(); else this.persistLayout();
      } else if (this.layoutDirty) {
        if (this.layoutBase && JSON.stringify(this.layoutBase) !== JSON.stringify(remote)) this.markLayoutConflict();
        else if (!this.layoutConflict) this.persistLayout();
      } else {
        this.layoutBase = structuredClone(remote);
        if (JSON.stringify(clean) !== JSON.stringify($state.snapshot(this.layout))) this.layout = clean;
        this.layoutConflict = false; removeLocal('flare.serverLayout.conflict');
      }
      this.layoutRemote = true;
    } else if (!this.layoutLoaded) {
      this.layout = cleanLayout(readLocal<unknown>(LAYOUT_KEY, null));
    }
    this.layoutLoaded = true;
  }
  private persistLayout() {
    const layout = $state.snapshot(this.layout) as ServerLayout;
    writeLocal(LAYOUT_KEY, layout);
    this.layoutDirty = true;
    if (!this.layoutRemote) return;
    this.layoutSaving++;
    this.layoutWrites = this.layoutWrites.then(async () => {
      try {
        if (this.layoutConflict) return;
        await serverApi.saveLayout(layout, this.layoutBase);
        this.layoutBase = structuredClone(layout);
        if (this.layoutSaving === 1) { this.layoutDirty = false; removeLocal(LAYOUT_KEY); }
      } catch (e) {
        if ((e as { code?: string }).code === 'server_layout_stale') this.markLayoutConflict();
        else this.ui.toast(errorText(e));
      }
      finally { this.layoutSaving--; }
    });
  }
  private markLayoutConflict() {
    const notify = !this.layoutConflict;
    this.layoutConflict = true; writeLocal('flare.serverLayout.conflict', true);
    if (notify) this.ui.toast('分类有新变化，本机草稿已保留，请在服务器页处理草稿。', { label: '查看草稿', run: this.ui.openServerPage });
  }
  async flushServerLayout(): Promise<boolean> {
    await this.layoutWrites;
    if (!this.layoutDirty && !this.layoutConflict) return true;
    this.ui.toast('分类草稿仍待保存，请先在服务器页处理草稿。'); return false;
  }
  async retryServerLayoutDraft() {
    try {
      const draft = $state.snapshot(this.layout) as ServerLayout, original = JSON.stringify(draft);
      const state = await serverApi.state();
      const sections = sectionsOf(draft, state.servers, this.lastOnline);
      const layout = { groups: sections.filter(s => !s.loose).map(s => ({ id: s.id, name: s.name, serverIds: s.servers.map(x => x.id) })),
        loose: sections.find(s => s.loose)?.servers.map(x => x.id) ?? [] };
      const describe = (l: ServerLayout) => sectionsOf(l, state.servers, this.lastOnline).map(g => ({ k: g.name,
        v: g.servers.length ? g.servers.map(s => `${s.name} (${s.addr})`).join('、') : '空类别' }));
      if (!await this.ui.confirm('重新提交分类草稿', '核对已保存分类和本机草稿；确认后按草稿重新归类，备注和收藏保留。已移除的服务器会从草稿引用中清理。', '保存本机草稿', {
        lists: [{ title: '已保存的类别', rows: describe(state.serverLayout) }, { title: '本机草稿中的类别', rows: describe(layout) }],
      })) return;
      await this.layoutWrites;
      if (JSON.stringify($state.snapshot(this.layout)) !== original) return this.ui.toast('草稿刚有新修改，请重新预览。');
      this.rows = state.servers; this.layoutBase = structuredClone(state.serverLayout); this.layout = layout;
      this.layoutConflict = false; removeLocal('flare.serverLayout.conflict');
      this.persistLayout(); await this.layoutWrites;
    } catch (e) { this.ui.toast(errorText(e)); }
  }
  async useSavedServerLayout() {
    const original = JSON.stringify($state.snapshot(this.layout));
    if (!await this.ui.confirm('采用已保存分类', '采用后端当前已保存的分类，并清除本机这份待保存草稿。服务器、备注和收藏保持原样。', '采用已保存分类')) return;
    await this.layoutWrites;
    if (JSON.stringify($state.snapshot(this.layout)) !== original) return this.ui.toast('草稿刚有新修改，请重新确认。');
    try {
      const state = await serverApi.state();
      if (JSON.stringify($state.snapshot(this.layout)) !== original) return this.ui.toast('草稿刚有新修改，请重新确认。');
      this.rows = state.servers; this.layout = cleanLayout(state.serverLayout); this.layoutBase = structuredClone(state.serverLayout);
      this.layoutDirty = false; this.layoutConflict = false; removeLocal(LAYOUT_KEY); removeLocal('flare.serverLayout.conflict');
    } catch (e) { this.ui.toast(errorText(e)); }
  }
  /** 合集里最适合加入的服务器：在线、有空位、无密码；人多优先，其次延迟低 */
  bestServer(list: Server[]): Server | undefined {
    return list
      .filter(s => s.status === 'online' && !s.password && s.players !== null && s.maxPlayers !== null && s.players < s.maxPlayers)
      .sort((a, b) => b.players! - a.players! || (a.ping ?? 9999) - (b.ping ?? 9999))[0];
  }
}

// 服务器合集：后端接入 serverLayout 之前的本机暂存；接入后 acceptLayout 会推上去并清掉
const LAYOUT_KEY = 'flare.serverLayout.pending';
function readLocal<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 无本机存储时只在本次会话有效 */ }
}
function removeLocal(key: string) {
  try { localStorage.removeItem(key); } catch { /* 同上 */ }
}
function cleanLayout(raw: unknown): ServerLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ServerLayout>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const used = new Set<string>();
  const groups = (Array.isArray(r.groups) ? r.groups : []).flatMap((g): ServerGroup[] => {
    if (!g || typeof g.id !== 'string' || typeof g.name !== 'string' || g.id === LOOSE || used.has(g.id)) return [];
    used.add(g.id);
    return [{ id: g.id, name: g.name.slice(0, 40), serverIds: ids(g.serverIds) }];
  });
  return { groups, loose: ids(r.loose) };
}
/** 查询中的条目沿用上次在线结果显示，避免每轮刷新时卡片清空闪烁 */
function stable(s: Server, lastOnline: Map<string, Server>): Server {
  if (s.status === 'online') lastOnline.set(s.id, s);
  if (s.status !== 'querying') return s;
  const prev = lastOnline.get(s.id);
  return prev ? { ...prev, label: s.label, favorite: s.favorite, gamePort: s.gamePort,
    name: s.name || prev.name, connectAddr: s.connectAddr ?? prev.connectAddr, status: 'querying' } : s;
}
function sectionsOf(layout: ServerLayout, servers: Server[], lastOnline: Map<string, Server>): ServerSection[] {
  const byId = new Map(servers.map(s => [s.id, stable(s, lastOnline)]));
  const seen = new Set<string>();
  const take = (ids: string[]) => ids.flatMap(id => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return [];
    seen.add(id);
    return [s];
  });
  const out: ServerSection[] = layout.groups.map(g => ({ id: g.id, name: g.name, servers: take(g.serverIds) }));
  const loose = take(layout.loose);
  out.push({ id: LOOSE, name: '未分组', loose: true, servers: [...loose, ...servers.filter(s => !seen.has(s.id)).map(s => byId.get(s.id)!)] });
  return out;
}
