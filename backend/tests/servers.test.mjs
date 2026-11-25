import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import { parseServerAddress } from '../servers/address.mjs';
import { queryServer, emptyObservation } from '../servers/query.mjs';
import { ServerManager } from '../servers/manager.mjs';
import { defaultGameSettings } from '../game-settings.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { createPlatform } from '../core.mjs';
import { createFixture } from './fixtures.mjs';

const approval = { approved: true, source: 'user' };
const z = text => Buffer.from(`${text}\0`);
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const player = (index, name, score, seconds) => {
  const values = Buffer.alloc(8); values.writeInt32LE(score); values.writeFloatLE(seconds, 4);
  return Buffer.concat([Buffer.from([index]), z(name), values]);
};
const packet = (type, ...data) => Buffer.concat([Buffer.from([255, 255, 255, 255, type]), ...data]);

test('A2S actual UDP: challenge, out-of-order split, EDF, rules, wrong game and timeout', async t => {
  const socket = dgram.createSocket('udp4');
  await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  t.after(() => socket.close());
  let appId = 550, quiet = false, rules = true, players = true, population = 3, challenges = 0, playerQueries = 0;
  socket.on('message', (request, peer) => {
    if (quiet) return;
    const send = bytes => socket.send(bytes, peer.port, peer.address);
    const challenge = Buffer.from([1, 2, 3, 4]);
    if (!request.subarray(-4).equals(challenge)) { challenges++; send(packet(0x41, challenge)); return; }
    if (request[4] === 0x54) {
      const info = packet(0x49, Buffer.from([17]), z('离线 Fixture'), z('c2m1_highway'), z('left4dead2'), z('Left 4 Dead 2'), u16(appId),
        Buffer.from([population, 8, 1, 100, 108, 1, 0]), z('2.2.4.3'), Buffer.from([0xa0]), u16(27019), z('coop,fixture'));
      const mid = Math.floor(info.length / 2);
      for (const index of [1, 0]) {
        const header = Buffer.alloc(12); header.writeInt32LE(-2); header.writeUInt32LE(42, 4); header[8] = 2; header[9] = index; header.writeUInt16LE(1248, 10);
        send(Buffer.concat([header, index ? info.subarray(mid) : info.subarray(0, mid)]));
      }
    } else if (request[4] === 0x55) {
      playerQueries++;
      if (players) send(population ? packet(0x44, Buffer.from([3]), player(0, '玩家\n甲', -3, 125.5), player(1, '', 0, 0), player(2, 'Bot', 9, -1)) : packet(0x44, Buffer.from([0])));
    } else if (request[4] === 0x56 && rules) send(packet(0x45, u16(1), z('mp_gamemode'), z('realism')));
  });
  const entry = { addr: `127.0.0.1:${socket.address().port}`, gamePort: null };
  const options = { socketTimeout: 150, attemptTimeout: 1000 };
  const observed = await queryServer(entry, options);
  assert.equal(observed.status, 'online'); assert.ok(challenges > 0);
  assert.equal(observed.mode, '写实'); assert.equal(observed.players, 3); assert.equal(observed.bots, 1);
  assert.equal(observed.maxPlayers, 8); assert.equal(observed.vac, false); assert.equal(observed.password, true);
  assert.equal(observed.connectAddr, '127.0.0.1:27019'); assert.ok(observed.ping >= 0);
  assert.ok(playerQueries > 0);
  assert.deepEqual(observed.playerList, [{ name: '玩家甲', seconds: 125.5, score: -3 }, { name: '', seconds: 0, score: 0 }, { name: 'Bot', seconds: 0, score: 9 }]);
  rules = false; players = false;
  const optional = await queryServer({ ...entry, gamePort: 27020 }, options);
  assert.equal(optional.status, 'online'); assert.equal(optional.mode, '战役'); assert.equal(optional.connectAddr, '127.0.0.1:27020');
  assert.equal(optional.playerList, null); assert.equal(optional.players, 3);
  players = true; population = 0;
  assert.deepEqual((await queryServer(entry, options)).playerList, []);
  appId = 440;
  assert.equal((await queryServer(entry, options)).status, 'wrong-game');
  quiet = true;
  const timeout = await queryServer(entry, options);
  assert.equal(timeout.status, 'timeout'); assert.equal(timeout.players, null); assert.equal(timeout.ping, null);
  assert.equal(timeout.playerList, null);
});

test('layout and update bridge persist together, preserve cached observations and prune removals', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-server-layout-'));
  const core = { discover: async () => ({ games: [], warnings: [] }) };
  let calls = 0, finish;
  const observed = { ...emptyObservation(), status: 'online', name: '原始名称', players: 1,
    playerList: [{ name: '玩家', seconds: 42, score: 3 }], reportedGamePort: 27019, connectAddr: 'localhost:27019' };
  const service = new DesktopService({ dataDir, core, queryServer: async () => { calls++; return observed; } });
  const events = [];
  service.on('event', e => events.push(e.type));
  try {
    assert.deepEqual((await service.dispatch('snapshot')).serverLayout, { groups: [], loose: [] });
    const [a] = await service.dispatch('add-server', { address: 'localhost' });
    const [, b] = await service.dispatch('add-server', { address: 'localhost:27016' });
    const layout = { groups: [{ id: 'group-a', name: '战役', serverIds: [b.id, a.id] }, { id: 'empty', name: '空合集', serverIds: [] }], loose: [] };
    await service.dispatch('favorite-server', { id: a.id, favorite: true });
    await service.dispatch('query-servers', { ids: [a.id] });
    await Promise.all([
      service.dispatch('save-server-layout', { layout }),
      service.dispatch('update-server', { id: a.id, label: ' 新备注 ', gamePort: 27020 }),
    ]);
    const snapshot = await service.dispatch('snapshot');
    const row = snapshot.servers[0];
    assert.deepEqual(snapshot.serverLayout, layout);
    assert.equal(row.id, a.id); assert.equal(row.addr, a.addr); assert.equal(row.favorite, true);
    assert.equal(row.label, '新备注'); assert.equal(row.name, '新备注'); assert.equal(row.connectAddr, 'localhost:27020');
    assert.equal(row.status, 'online'); assert.deepEqual(row.playerList, observed.playerList); assert.equal(calls, 1);
    const [cleared] = await service.dispatch('update-server', { id: a.id, label: '', gamePort: null });
    assert.equal(cleared.name, '原始名称'); assert.equal(cleared.connectAddr, 'localhost:27019');
    await assert.rejects(service.dispatch('update-server', { id: 'missing', label: '', gamePort: null }), { code: 'server_missing' });
    await assert.rejects(service.dispatch('update-server', { id: a.id, label: 'x'.repeat(81) }), { code: 'server_label_invalid' });
    await assert.rejects(service.dispatch('update-server', { id: a.id, label: '', gamePort: 0 }), { code: 'server_address_invalid' });
    await assert.rejects(service.dispatch('save-server-layout', { layout: { ...layout, loose: [a.id] } }), { code: 'server_layout_invalid' });
    const restored = new ServerManager({ dataDir });
    try {
      assert.deepEqual((await restored.snapshot()).serverLayout, layout);
      const [saved] = await restored.list();
      assert.equal(saved.id, a.id); assert.equal(saved.favorite, true); assert.equal(saved.label, '');
      assert.equal(saved.status, 'unqueried'); assert.equal(saved.playerList, null);
    } finally { await restored.close(); }
    service.serverManager.probe = async () => { await new Promise(r => finish = r); return observed; };
    const pending = service.dispatch('query-servers', { ids: [a.id] });
    await new Promise(r => setImmediate(r));
    const [updated] = await service.dispatch('update-server', { id: a.id, label: '查询中改名', gamePort: 27021 });
    assert.equal(updated.status, 'querying'); assert.deepEqual(updated.playerList, observed.playerList);
    finish(); await pending;
    const [fresh] = await service.dispatch('list-servers');
    assert.equal(fresh.name, '查询中改名'); assert.equal(fresh.connectAddr, 'localhost:27021');
    await service.dispatch('remove-server', { id: a.id });
    assert.deepEqual((await service.dispatch('snapshot')).serverLayout.groups[0].serverIds, [b.id]);
    await service.dispatch('save-server-layout', { layout: { groups: [], loose: [b.id] } });
    await service.dispatch('remove-server', { id: b.id });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'servers.json'), 'utf8')).serverLayout, { groups: [], loose: [] });
    assert.ok(events.includes('servers_changed'));
  } finally { finish?.(); await service.close(); }
});

test('legacy server files load with an empty layout; invalid saved layouts stay intact', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-server-legacy-'));
  const file = path.join(dataDir, 'servers.json');
  await fs.writeFile(file, JSON.stringify({ version: 1, servers: [{ id: 'old', addr: 'localhost:27015', label: '旧备注', favorite: true, gamePort: null }] }));
  const legacy = new ServerManager({ dataDir });
  try {
    assert.deepEqual((await legacy.snapshot()).serverLayout, { groups: [], loose: [] });
    await legacy.saveLayout({ groups: [], loose: ['old'] });
    assert.equal((await legacy.list())[0].label, '旧备注');
  } finally { await legacy.close(); }
  const corrupt = JSON.stringify({ version: 1, servers: [], serverLayout: { groups: null, loose: [] } });
  await fs.writeFile(file, corrupt);
  const invalid = new ServerManager({ dataDir });
  try {
    await assert.rejects(invalid.saveLayout({ groups: [], loose: [] }), { code: 'servers_invalid' });
    assert.equal(await fs.readFile(file, 'utf8'), corrupt);
  } finally { await invalid.close(); }
});

test('address validation, persisted favorites, deduplicated query, stale removal and VAC guard', async () => {
  assert.equal(parseServerAddress(' connect DXNYA.NEKOIDC.TOP:20080 ').addr, 'dxnya.nekoidc.top:20080');
  assert.equal(parseServerAddress('example.com').port, 27015);
  for (const bad of ['host:0', 'host:65536', '127.999.0.1', 'host:27015;quit', 'host:27015 +exec x', 'steam://connect/user@host']) assert.throws(() => parseServerAddress(bad));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-servers-'));
  let finish, calls = 0;
  const manager = new ServerManager({ dataDir, query: async () => { calls++; await new Promise(r => finish = r); return { ...emptyObservation(), status: 'online', name: 'Fixture', vac: true, players: 0, connectAddr: 'localhost:27015' }; } });
  let rows = await manager.add({ address: 'localhost' });
  const id = rows[0].id;
  await assert.rejects(manager.add({ address: 'connect localhost:27015' }), { code: 'server_exists' });
  await manager.favorite(id, true);
  const restored = new ServerManager({ dataDir });
  rows = await restored.list(); assert.equal(rows[0].favorite, true); assert.equal(rows[0].status, 'unqueried');
  const a = manager.query([id]), b = manager.query([id]);
  await new Promise(r => setImmediate(r)); assert.equal(calls, 1);
  finish(); await Promise.all([a, b]);
  manager.probe = async () => ({ ...emptyObservation(), status: 'online', vac: true, connectAddr: 'localhost:27015' });
  await assert.rejects(manager.connectTarget(id), { code: 'server_vac_secure' });
  assert.equal(await manager.connectTarget(id, 'modded'), 'localhost:27015');
  await assert.rejects(manager.connectTarget(id, 'modded', { ...defaultGameSettings(), extraArgs: '-insecure' }), { code: 'server_vac_secure' });
  manager.probe = async () => { await new Promise(r => finish = r); return { ...emptyObservation(), status: 'online' }; };
  const pending = manager.query([id]); await new Promise(r => setImmediate(r));
  await manager.remove(id); finish(); await pending;
  assert.deepEqual(await manager.list(), []); assert.equal(manager.cache.has(id), false);
  await manager.close(); await restored.close();
});

test('server bridge queries do not hold the core queue; unavailable servers stop before Mod writes or launch', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-server-bridge-'));
  const coreWrite = Promise.withResolvers(), probe = Promise.withResolvers();
  const peer = { name: '好友', ip: '93.184.216.34', port: 27016, query: 27015, lobby: '0' };
  const observed = { ...emptyObservation(), status: 'online', vac: true, connectAddr: 'localhost:27015' };
  const launchSteps = [], events = [];
  let querying = false, pending;
  const service = new DesktopService({ dataDir,
    core: { discover: async () => ({ games: [], warnings: [] }),
      launch: async request => { launchSteps.push(request); return { status: 'requested', pid: 42 }; } },
    readFriends: async () => [peer],
    queryServer: async () => { querying = true; await probe.promise; return observed; } });
  service.on('event', ({ type }) => { if (type === 'servers_changed') events.push(type); });
  try {
    const [server] = await service.dispatch('add-server', { address: 'localhost' });
    void service.serial(() => coreWrite.promise);
    pending = service.dispatch('query-servers', { ids: [server.id] });
    await new Promise(r => setImmediate(r));
    assert.ok(querying, 'probe must start while a core write is pending');
    coreWrite.resolve();
    const snapshot = await service.dispatch('snapshot');
    assert.equal(snapshot.capabilities.servers, true); assert.equal(snapshot.servers[0].status, 'querying');
    probe.resolve(); await pending;

    const beforeFriend = events.length;
    const [friend] = await service.dispatch('friend-servers');
    assert.equal((await service.dispatch('friend-server-info', { id: friend.id })).connectAddr, peer.ip + ':27016');
    assert.equal(events.length, beforeFriend);
    const [, savedFriend] = await service.dispatch('favorite-friend-server', { id: friend.id });
    assert.equal(savedFriend.favorite, true);
    assert.equal(savedFriend.gamePort, 27016);
    assert.equal(events.length, beforeFriend + 1);
    assert.deepEqual((await service.dispatch('server-state')).servers, await service.dispatch('list-servers'));

    await assert.rejects(service.dispatch('connect-server', { id: server.id }), { code: 'confirmation_required' });
    service.settings.gameRoot = 'D:\\offline-only';
    service.applyGameSettings = async (...args) => { launchSteps.push(['settings', ...args]); };
    service.applyModProfile = async (...args) => { launchSteps.push(['profile', ...args]); };
    service.serverManager.probe = async () => ({ ...emptyObservation(), status: 'offline' });
    await assert.rejects(service.dispatch('connect-server', { id: server.id, mode: 'modded' }, approval), { code: 'server_unavailable' });
    assert.deepEqual(launchSteps, []);

    const gameRoot = service.settings.gameRoot, connect = 'localhost:27015';
    service.serverManager.probe = async () => observed;
    assert.deepEqual(await service.dispatch('connect-server', { id: server.id, mode: 'clean' }, approval), { status: 'requested', pid: 42 });
    assert.deepEqual(launchSteps.splice(0), [{ gameRoot, mode: 'clean', connect, confirmation: approval }]);
    await service.dispatch('connect-server', { id: server.id, mode: 'modded' }, approval);
    assert.deepEqual(launchSteps, [
      ['settings', gameRoot, true],
      ['profile', 'default', approval],
      { gameRoot, mode: 'modded', connect, gameSettings: service.gameSettings(), confirmation: approval },
    ]);
  } finally {
    coreWrite.resolve(); probe.resolve();
    await pending?.catch(() => {});
    await service.close();
  }
});

test('Steam argument capture preserves default launch and safely appends connect, no game process starts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-connect-launch-'));
  const fixture = await createFixture(root, { l4n: true }), steam = path.join(root, 'Steam');
  const gameRoot = path.join(steam, 'steamapps/common/Left 4 Dead 2');
  await fs.mkdir(path.dirname(gameRoot), { recursive: true }); await fs.rename(fixture.gameRoot, gameRoot);
  const steamExe = path.join(steam, 'steam.exe'); await fs.writeFile(steamExe, 'fixture only');
  await fs.writeFile(path.join(steam, 'steamapps/appmanifest_550.acf'), '"AppState" { "appid" "550" "installdir" "Left 4 Dead 2" "buildid" "12345" }');
  let args, running = [];
  const core = createPlatform({ getProcesses: async () => running, launchSteam: async (_, captured) => { args = captured; } });
  await core.applyInstall(await core.planInstall({ gameRoot, distRoot: fixture.distRoot }), { confirmation: approval });
  await core.launch({ gameRoot, steamExe, confirmation: approval });
  assert.deepEqual(args, ['-applaunch', '550', '-insecure']);
  await core.launch({ gameRoot, steamExe, confirmation: approval, connect: 'example.com:20080' });
  assert.deepEqual(args, ['-applaunch', '550', '-insecure', '+connect', 'example.com:20080']);
  await assert.rejects(core.launch({ gameRoot, steamExe, confirmation: approval, connect: 'example.com;quit' }), { code: 'server_address_invalid' });
  running = [{ pid: 42, name: 'left4dead2' }];
  await assert.rejects(core.launch({ gameRoot, steamExe, confirmation: approval, connect: 'example.com' }), { code: 'game_running' });
});
