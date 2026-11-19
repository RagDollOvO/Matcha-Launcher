import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parsePort, parseServerAddress, serverError } from './address.mjs';
import { emptyObservation, queryServer } from './query.mjs';
import { launchSpec } from '../launch.mjs';
import { FriendServers } from './friends.mjs';
import { planServerChange } from './organize.mjs';

function serverLayout(value) {
  const invalid = () => { throw serverError('server_layout_invalid', '合集需要有效的名称、唯一 ID 和有序服务器 ID 列表。'); };
  if (!value || !Array.isArray(value.groups) || !Array.isArray(value.loose)) invalid();
  const groups = new Set(), servers = new Set();
  const ids = list => {
    if (!Array.isArray(list)) invalid();
    return list.map(id => {
      if (typeof id !== 'string' || !id || servers.has(id)) invalid();
      servers.add(id); return id;
    });
  };
  return { groups: value.groups.map(g => {
    if (!g || typeof g.id !== 'string' || !g.id || g.id === 'loose' || groups.has(g.id) || typeof g.name !== 'string' || !g.name.trim()) invalid();
    groups.add(g.id);
    return { id: g.id, name: g.name, serverIds: ids(g.serverIds) };
  }), loose: ids(value.loose) };
}

export class ServerManager {
  constructor({ dataDir, query = queryServer, readFriends }) {
    this.file = path.join(dataDir, 'servers.json');
    this.probe = query;
    this.friends = new FriendServers(row => this.slot(() => this.probe(row)), readFriends);
    this.entries = [];
    this.layout = { groups: [], loose: [] };
    this.cache = new Map();
    this.inFlight = new Map();
    this.writes = Promise.resolve();
    this.waiters = [];
    this.active = 0;
    this.plans = new Map();
    this.ready = this.load();
    this.ready.catch(() => {}); // Surface corrupt files through commands/snapshot issues.
  }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.servers) || saved.servers.length > 100) throw new Error('format');
      const seen = new Set(), ids = new Set();
      this.entries = saved.servers.map(s => {
        const { addr } = parseServerAddress(s.addr);
        if (typeof s.id !== 'string' || !s.id || ids.has(s.id) || seen.has(addr) || typeof s.favorite !== 'boolean') throw new Error('entry');
        seen.add(addr); ids.add(s.id);
        return { id: s.id, addr, label: typeof s.label === 'string' ? s.label.slice(0, 80) : '',
          favorite: s.favorite, gamePort: s.gamePort == null ? null : parsePort(s.gamePort) };
      });
      if (saved.serverLayout !== undefined) this.layout = serverLayout(saved.serverLayout);
    } catch (e) {
      if (e.code !== 'ENOENT') throw serverError('servers_invalid', `服务器列表读取失败，原文件已保留：${this.file}`);
    }
  }
  async list() {
    return (await this.snapshot()).servers;
  }
  async snapshot() {
    await this.ready;
    const servers = this.entries.map(entry => {
      const { reportedGamePort, ...observation } = this.cache.get(entry.id) ?? emptyObservation();
      const connectAddr = observation.connectAddr
        ? `${parseServerAddress(entry.addr).host}:${entry.gamePort ?? reportedGamePort ?? parseServerAddress(observation.connectAddr).port}`
        : null;
      return { ...entry, ...observation, connectAddr, name: entry.label || observation.name || entry.addr };
    });
    return { servers, serverLayout: structuredClone(this.layout) };
  }
  mutate(fn, updateLayout = layout => layout) {
    const result = this.writes.then(async () => {
      await this.ready;
      const next = fn(this.entries);
      const layout = updateLayout(this.layout);
      const staging = `${this.file}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      try {
        await fs.writeFile(staging, JSON.stringify({ version: 1, servers: next, serverLayout: layout }, null, 2), { flag: 'wx' });
        await fs.rename(staging, this.file);
      } catch (e) { await fs.unlink(staging).catch(() => {}); throw e; }
      this.entries = next;
      this.layout = layout;
      return this.list();
    });
    this.writes = result.catch(() => {});
    return result;
  }
  add({ address, label = '', gamePort = null }) {
    const { addr } = parseServerAddress(address);
    if (typeof label !== 'string' || label.length > 80) throw serverError('server_label_invalid', '备注最多 80 个字符。');
    const port = gamePort === '' || gamePort == null ? null : parsePort(gamePort);
    return this.mutate(entries => {
      if (entries.some(e => e.addr === addr)) throw serverError('server_exists', '这个查询地址已在列表中。');
      if (entries.length >= 100) throw serverError('server_limit', '最多保存 100 个服务器，请先移除闲置条目。');
      return [...entries, { id: randomUUID(), addr, label: label.trim(), gamePort: port, favorite: false }];
    });
  }
  favoriteFriend(id) {
    const {addr,gamePort} = this.friends.target(id);
    return this.mutate(entries => {
      if (entries.some(e => e.addr === addr))
        return entries.map(e => e.addr === addr ? { ...e, favorite:true } : e);
      if (entries.length >= 100) throw serverError('server_limit','最多保存 100 个服务器，请先移除闲置条目。');
      return [...entries, {id:randomUUID(), addr,gamePort,label:'',favorite:true}];
    });
  }
  favorite(id, favorite) {
    if (typeof favorite !== 'boolean') throw serverError('invalid_argument', '收藏状态需要布尔值。');
    return this.mutate(entries => {
      if (!entries.some(e => e.id === id)) throw serverError('server_missing', '服务器已从列表移除。');
      return entries.map(e => e.id === id ? { ...e, favorite } : e);
    });
  }
  update({ id, label, gamePort }) {
    if (typeof label !== 'string' || label.length > 80) throw serverError('server_label_invalid', '备注最多 80 个字符。');
    const port = gamePort === '' || gamePort == null ? null : parsePort(gamePort);
    return this.mutate(entries => {
      if (!entries.some(e => e.id === id)) throw serverError('server_missing', '服务器已从列表移除。');
      return entries.map(e => e.id === id ? { ...e, label: label.trim(), gamePort: port } : e);
    });
  }
  async saveLayout(layout, { expected } = {}) {
    const next = serverLayout(layout);
    const baseline = expected === undefined ? undefined : serverLayout(expected);
    await this.mutate(entries => {
      if (baseline && (!isDeepStrictEqual(baseline, this.layout) || [...next.groups.flatMap(g => g.serverIds), ...next.loose].some(id => !entries.some(s => s.id === id))))
        throw serverError('server_layout_stale', '已保存的分类或服务器有新变化，本机草稿已保留，请核对后重新提交。');
      return entries;
    }, () => next);
    return { status: 'saved' };
  }
  async previewChange(action, params) {
    await this.ready; await this.writes;
    const state = { entries: this.entries, layout: this.layout };
    const plan = planServerChange(state, action, params, (await this.list()));
    const planId = randomUUID(); this.plans.set(planId, { ...plan, at: Date.now() });
    if (this.plans.size > 30) this.plans.delete(this.plans.keys().next().value);
    return { planId, action, changes: plan.changes, added: plan.added, removed: plan.removed, skipped: plan.skipped, errors: plan.errors };
  }
  async applyChange(planId, confirmation, signal) {
    if (confirmation?.approved !== true || confirmation.source !== 'user') throw serverError('confirmation_required', '请先确认服务器整理清单。');
    const plan = this.plans.get(planId);
    if (!plan) throw serverError('server_plan_stale', '服务器整理计划已失效，请重新读取清单并预览。');
    const servers = await this.mutate(() => {
      if (signal?.aborted) throw serverError('operation_canceled', '操作已取消。');
      if (Date.now() - plan.at > 15 * 60 * 1000 || !isDeepStrictEqual(plan.before, { entries: this.entries, layout: this.layout }))
        throw serverError('server_plan_stale', '确认期间服务器资料或分类有变化，请重新读取并预览。');
      return structuredClone(plan.after.entries);
    }, () => serverLayout(plan.after.layout));
    for (const id of plan.removed) this.cache.delete(id);
    this.plans.delete(planId);
    return { applied: true, changes: plan.changes, added: plan.added, removed: plan.removed,
      skipped: plan.skipped, errors: plan.errors, servers, serverLayout: structuredClone(this.layout) };
  }
  async remove(id) {
    const list = await this.mutate(entries => entries.filter(e => e.id !== id), layout => ({
      groups: layout.groups.map(g => ({ ...g, serverIds: g.serverIds.filter(x => x !== id) })),
      loose: layout.loose.filter(x => x !== id),
    }));
    this.cache.delete(id);
    return list;
  }
  async slot(fn) {
    if (this.active >= 6) await new Promise(resolve => this.waiters.push(resolve));
    else this.active++;
    try { return await fn(); }
    finally { const next = this.waiters.shift(); if (next) next(); else this.active--; }
  }
  queryOne(entry) {
    if (this.inFlight.has(entry.id)) return this.inFlight.get(entry.id);
    const previous = this.cache.get(entry.id) ?? emptyObservation();
    this.cache.set(entry.id, { ...previous, status: 'querying' });
    const task = this.slot(async () => {
      if (!this.entries.some(e => e.id === entry.id)) return;
      const observed = await this.probe(entry);
      if (this.entries.some(e => e.id === entry.id)) this.cache.set(entry.id, { ...observed, lastSeen: observed.lastSeen ?? previous.lastSeen, name: observed.name || previous.name });
    }).finally(() => this.inFlight.delete(entry.id));
    this.inFlight.set(entry.id, task);
    return task;
  }
  async query(ids) {
    await this.ready;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')))
      throw serverError('invalid_argument', '请提供服务器 ID 列表。');
    const wanted = ids === undefined ? this.entries : this.entries.filter(e => ids.includes(e.id));
    await Promise.all(wanted.map(e => this.queryOne(e)));
    return this.list();
  }
  async connectTarget(id, mode = 'development') {
    const spec = launchSpec(mode);
    const server = typeof id === 'string' && id.startsWith('friend:') ? await this.friends.forJoin(id)
      : (await this.query([id])).find(e => e.id === id);
    if (!server) throw serverError('server_missing', '服务器已从列表移除。');
    if (server.status !== 'online') throw serverError('server_unavailable', server.error || '请先刷新服务器状态。');
    if (server.vac && spec.vacMode === 'insecure') throw serverError('server_vac_secure', '当前启动参数包含 -insecure。请选择「L4N 平台启动」或「纯净对抗」，或复制连接命令到已运行的游戏。');
    return server.connectAddr;
  }
  async close() { await this.writes; await Promise.allSettled(this.inFlight.values()); }
}
