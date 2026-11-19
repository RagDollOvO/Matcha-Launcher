import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DesktopService } from '../desktop/service.mjs';
import { ServerManager } from '../servers/manager.mjs';
import { emptyObservation } from '../servers/query.mjs';
import { serverHost } from './server-host.mjs';
import { platformTools, platformToolCatalog } from './platform-extension.mjs';
import { SERVER_SKILL, readSkill } from './skill-files.mjs';
import { PiTransport } from './transport.mjs';

const approval = { approved: true, source: 'user' };
async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-server-agent-'));
  let queries = 0, running = false, online = true, launches = 0;
  const core = { discover: async () => ({ games: [], warnings: [] }),
    inspectGame: async root => ({ gameRoot: root, platform: { status: 'absent' }, processes: running ? [{ pid: 42, path: path.join(root, 'left4dead2.exe') }] : [] }),
    launch: async () => { launches++; throw new Error('game launch should remain with the user'); } };
  const service = new DesktopService({ dataDir, core, queryServer: async entry => {
    queries++;
    return { ...emptyObservation(), name: `服 ${entry.addr}`, status: online ? 'online' : 'timeout', players: online ? 3 : null,
      maxPlayers: online ? 8 : null, bots: online ? 1 : null, ping: online ? 12 : null, mode: '战役', modeId: 'coop',
      password: online ? false : null, vac: online ? true : null, checkedAt: new Date().toISOString(),
      reportedGamePort: online ? 27019 : undefined, connectAddr: online ? 'localhost:27019' : null };
  } });
  t.after(() => service.close()); await service.ready;
  const tools = new Map(platformTools('', { modRequest: serverHost(service) }).map(tool => [tool.name, tool]));
  const run = async (name, params = {}, confirm = async () => true) => (await tools.get(name).execute('fixture', params,
    new AbortController().signal, undefined, { hasUI: true, ui: { confirm } })).details;
  const seed = async () => {
    const result = await run('server_add', { items: [{ address: 'localhost', label: '战役服' }, { address: 'localhost:27016', label: '对抗服' }, { address: 'localhost:27017', label: '死门服' }] });
    return result.servers;
  };
  return { service, tools, run, seed, dataDir, counts: () => ({ queries, launches }), setRunning: v => { running = v; }, setOnline: v => { online = v; } };
}

test('server Agent batch add confirms normalized endpoints and reports duplicates and partial input errors', async t => {
  const f = await fixture(t);
  const [old] = await f.service.dispatch('add-server', { address: 'localhost', label: '保留备注', gamePort: 27020 });
  await f.service.dispatch('favorite-server', { id: old.id, favorite: true });
  const file = path.join(f.dataDir, 'servers.json'), original = await fs.readFile(file);
  assert.equal((await f.run('server_add', { items: [{ address: 'localhost:27016' }] }, async () => false)).applied, false);
  assert.deepEqual(await fs.readFile(file), original);
  let confirmation;
  const result = await f.run('server_add', { items: [
    { address: 'connect LOCALHOST:27015', label: '覆盖旧备注' },
    { address: 'steam://connect/localhost:27016', label: '新服' },
    { address: 'connect localhost:27016' }, { address: 'localhost:27017;quit' },
  ] }, async (title, text) => { confirmation = { title, text }; return true; });
  assert.equal(confirmation.title, '添加服务器'); assert.match(confirmation.text, /localhost:27016/);
  assert.equal(result.added.length, 1); assert.equal(result.skipped.length, 2); assert.equal(result.errors.length, 1);
  assert.equal(result.servers.length, 2);
  const kept = result.servers.find(s => s.id === old.id);
  assert.equal(kept.label, '保留备注'); assert.equal(kept.favorite, true); assert.equal(kept.gamePort, 27020);
  assert.equal(f.counts().queries, 0); assert.equal(f.counts().launches, 0);
  assert.equal(platformToolCatalog().find(t => t.name === 'server_inventory').write, false);
  assert.equal(platformToolCatalog().find(t => t.name === 'server_category').write, true);
  assert.match((await readSkill({ path: SERVER_SKILL })).content[0].text, /server_organize/);
  const transport = new PiTransport({ configDir: path.join(f.dataDir, 'pi'), piEntry: path.join(f.dataDir, 'fake-pi.mjs') });
  const args = transport.buildArgs(); assert.ok(args.includes(SERVER_SKILL));
});

test('custom server categories create, move, rename, reorder and delete with explicit member retention', async t => {
  const f = await fixture(t), [a, b, c] = await f.seed();
  await f.run('server_update', { updates: [{ id: b.id, favorite: true }, { id: c.id, label: '我的死门服', gamePort: 27022 }] });
  await f.run('server_query', { serverIds: [a.id, b.id, c.id] });
  let confirmations = 0;
  await f.run('server_organize', { moves: [
    { serverId: a.id, groupName: '战役' }, { serverId: b.id, groupName: '对抗' }, { serverId: c.id, groupName: '死门' },
  ] }, async () => { confirmations++; return true; });
  assert.equal(confirmations, 1);
  let state = await f.run('server_inventory');
  assert.deepEqual(state.serverLayout.groups.map(g => g.name), ['战役', '对抗', '死门']);
  const [coop, versus, death] = state.serverLayout.groups;
  assert.equal((await f.run('server_inventory', { groupId: death.id })).servers[0].id, c.id);
  assert.equal((await f.run('server_inventory', { favorite: true })).servers[0].id, b.id);
  await f.run('server_category', { action: 'rename', id: death.id, name: '死门专区' });
  await f.run('server_category', { action: 'reorder', groupIds: [death.id, coop.id, versus.id] });
  await f.run('server_organize', { moves: [{ serverId: c.id, groupId: coop.id, index: 0 }] });
  state = await f.run('server_inventory');
  assert.deepEqual(state.serverLayout.groups.find(g => g.id === coop.id).serverIds, [c.id, a.id]);
  await f.run('server_category', { action: 'delete', id: coop.id }, async (title, text) => {
    assert.equal(title, '删除服务器类别'); assert.match(text, /服务器保留在未分组/); return true;
  });
  state = await f.run('server_inventory');
  assert.equal(state.servers.length, 3); assert.deepEqual(state.serverLayout.loose, [c.id, a.id]);
  assert.equal(state.servers.find(s => s.id === c.id).gamePort, 27022);
  assert.equal(state.servers.find(s => s.id === c.id).modeId, 'coop');
  assert.equal(state.servers.find(s => s.id === b.id).favorite, true);
  const restored = new ServerManager({ dataDir: f.dataDir });
  try { assert.deepEqual((await restored.snapshot()).serverLayout, state.serverLayout); } finally { await restored.close(); }
  await f.run('server_organize', { moves: [{ serverId: a.id, groupId: death.id }] });
  let deletion;
  const removed = await f.run('server_category', { action: 'delete', id: death.id, removeServers: true }, async (title, text) => { deletion = { title, text }; return true; });
  assert.equal(deletion.title, '删除类别和其中的服务器'); assert.ok(deletion.text.includes(a.addr));
  assert.deepEqual(removed.removed, [a.id]); assert.equal(removed.servers.length, 2);
  await f.run('server_remove', { serverIds: [b.id] }, async (_title, text) => { assert.match(text, /已收藏/); assert.match(text, /对抗/); return true; });
  state = await f.run('server_inventory');
  assert.deepEqual(state.servers.map(s => s.id), [c.id]); assert.equal(state.servers[0].label, '我的死门服');
  assert.ok(state.serverLayout.groups.every(g => !g.serverIds.includes(a.id) && !g.serverIds.includes(b.id)));
  assert.equal(f.counts().launches, 0);
});

test('server plans reject confirmation-time metadata changes while observations stay independent', async t => {
  const f = await fixture(t), [a, b] = await f.seed();
  await assert.rejects(f.run('server_update', { updates: [{ id: a.id, label: '过时修改' }] }, async () => {
    await f.service.dispatch('favorite-server', { id: a.id, favorite: true }); return true;
  }), { code: 'server_plan_stale' });
  assert.equal((await f.run('server_inventory', { serverIds: [a.id] })).servers[0].label, a.label);
  const changed = await f.run('server_update', { updates: [{ id: a.id, label: '新备注' }] }, async () => {
    await f.run('server_query', { serverIds: [a.id] }); return true;
  });
  assert.equal(changed.applied, true); assert.equal(changed.servers[0].favorite, true); assert.equal(changed.servers[0].status, 'online');
  await f.run('server_category', { action: 'create', name: '自定义空类' });
  const baseline = (await f.service.serverManager.snapshot()).serverLayout;
  const group = baseline.groups[0];
  await assert.rejects(f.run('server_category', { action: 'rename', id: group.id, name: '待确认名称' }, async () => {
    await f.service.dispatch('save-server-layout', { layout: { ...baseline, groups: [{ ...group, serverIds: [b.id] }] } }); return true;
  }), { code: 'server_plan_stale' });
  await assert.rejects(f.service.dispatch('save-server-layout', { layout: baseline, expected: baseline }), { code: 'server_layout_stale' });
  const saved = (await f.service.serverManager.snapshot()).serverLayout;
  assert.deepEqual(saved.groups[0].serverIds, [b.id]); assert.equal(saved.groups[0].name, '自定义空类');
  const plan = await f.service.serverManager.previewChange('remove', { serverIds: [a.id] });
  await assert.rejects(f.service.serverManager.applyChange(plan.planId), { code: 'confirmation_required' });
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(f.service.serverManager.applyChange(plan.planId, approval, canceled.signal), { code: 'operation_canceled' });
  assert.ok((await f.service.serverManager.list()).some(s => s.id === a.id));
  await assert.rejects(f.run('server_category', { action: 'delete', id: 'loose' }), { code: 'server_group_missing' });
});

test('server connection guidance uses the current port and launch route without starting a game', async t => {
  const f = await fixture(t), [a] = await f.seed();
  f.service.settings.gameRoot = path.join(f.dataDir, 'synthetic-game-context');
  let result = await f.run('server_connection', { serverId: a.id });
  assert.equal(result.command, 'connect localhost:27019'); assert.equal(result.portSource, 'a2s');
  assert.equal(result.nextStep, 'confirm-on-server-page'); assert.equal(result.launch.mode, 'modded');
  await f.run('server_update', { updates: [{ id: a.id, gamePort: 27020 }] });
  f.setRunning(true); result = await f.run('server_connection', { serverId: a.id });
  assert.equal(result.command, 'connect localhost:27020'); assert.equal(result.portSource, 'manual'); assert.equal(result.nextStep, 'copy-command');
  f.setRunning(false); f.service.launchMode = 'development';
  result = await f.run('server_connection', { serverId: a.id }); assert.equal(result.nextStep, 'review-launch-mode');
  await f.run('server_update', { updates: [{ id: a.id, gamePort: null }] });
  f.setOnline(false); result = await f.run('server_connection', { serverId: a.id });
  assert.equal(result.command, 'connect localhost:27015'); assert.equal(result.portSource, 'query-fallback');
  assert.equal(result.server.status, 'timeout'); assert.equal(result.server.players, null);
  assert.equal(f.counts().launches, 0); assert.equal(f.service.launchMode, 'development');
});
