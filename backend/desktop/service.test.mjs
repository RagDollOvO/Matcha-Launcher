import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as core from '../core.mjs';
import { createFixture, pluginFixture } from '../tests/fixtures.mjs';
import { addonInfo, vpkFixture } from '../tests/mods-fixtures.mjs';
import { readVpk, readResource } from '../mods/vpk.mjs';
import { DesktopService } from './service.mjs';
import { createServer } from 'vite';
import { beaconBridge } from './vite-plugin.mjs';

test('desktop: missing game, confirmed deployment, plugin acknowledgement and running guard', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'beacon-desktop-'));
  const fixture = await createFixture(base,{l4n:true});
  // The bundled demo is intentionally hidden from the desktop plugin list.
  const pluginId = 'fixture.desktop-hello';
  await pluginFixture(path.join(fixture.distRoot, 'bin/l4p/plugins', pluginId), pluginId);
  await fs.writeFile(path.join(fixture.distRoot, 'bin/l4p/enabled.txt'), `${pluginId}\n`);
  let running = [];
  const api = { ...core, ...core.createPlatform({ getProcesses: async () => running }), discover: async () => ({ games: [], warnings: [] }) };
  const service = new DesktopService({ dataDir: path.join(base, 'settings'), distRoot: fixture.distRoot, core: api });
  const approval = { approved: true, source: 'user' };
  try {
    let view = await service.dispatch('snapshot');
    assert.equal(view.game.installed, false);
    assert.equal(view.plugins.length, 0);
    assert.equal(view.capabilities.mods, true);
    await service.dispatch('select-game', { gameRoot: fixture.gameRoot });
    await assert.rejects(service.dispatch('select-game', { gameRoot: path.join(base, 'missing') }));
    assert.equal((await service.dispatch('snapshot')).game.root, fixture.gameRoot);
    const plan = await service.dispatch('plan-install');
    await assert.rejects(service.dispatch('apply-install', { planId: plan.id }), e => e.code === 'confirmation_required');
    await service.dispatch('apply-install', { planId: plan.id }, approval);
    view = await service.dispatch('snapshot');
    assert.equal(view.runtime.installed, true);
    assert.equal(view.runtime.connected, false);
    assert.equal(view.dxvk.enabled, false);
    assert.equal(view.plugins.find(p => p.id === pluginId)?.runtimeState, 'unobserved');
    await service.dispatch('set-plugin-enabled', { pluginId, enabled: false }, approval);
    assert.equal((await service.dispatch('snapshot')).plugins.find(p => p.id === pluginId)?.enabled, false);
    running = [{ pid: 99, path: path.join(fixture.gameRoot, 'left4dead2.exe'), name: 'fixture' }];
    await assert.rejects(service.dispatch('set-plugin-enabled', { pluginId, enabled: true }, approval), e => e.code === 'game_running');
    running = [];
    await service.dispatch('restore', {}, approval);
    const restored = new DesktopService({ dataDir: path.join(base, 'settings'), core: api });
    assert.equal((await restored.dispatch('snapshot')).runtime.status, 'restored');
    await restored.close();
  } finally { await service.close(); }
});

test('development adapter: origin guard and shutdown with a live event stream', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'beacon-bridge-'));
  const server = await createServer({ configFile: false, root: base, cacheDir: path.join(base, 'cache'),
    plugins: [beaconBridge({ dataDir: path.join(base, 'settings'), core: { discover: async () => ({ games: [], warnings: [] }) } })],
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__beacon`;
  const { token } = await (await fetch(`${url}/session`)).json();
  const stream = await fetch(`${url}/events`);
  const reader = stream.body.getReader();
  await reader.read();
  const rejected = await fetch(`${url}/call`, { method: 'POST', headers: { Origin: 'https://example.com', 'X-Beacon-Token': token }, body: JSON.stringify({ command: 'snapshot' }) });
  assert.equal(rejected.status, 403);
  let timer;
  try {
    await Promise.race([server.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE shutdown did not finish')), 3000); })]);
    // Vite destroys open sockets in createServerCloseFn; EOF or that explicit
    // socket termination both establish that the persistent SSE client is closed.
    try { assert.equal((await reader.read()).done, true); }
    catch (e) { assert.equal(e.cause?.code, 'UND_ERR_SOCKET'); }
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); await server.close(); }
});

test('desktop shortcuts: shell drops preserve sources and split VPK clipboard includes volumes', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-vpk-shortcuts-'));
  const desktopDir = path.join(base, 'desktop'), dataDir = path.join(base, 'settings');
  await fs.mkdir(desktopDir);
  const source = await vpkFixture(path.join(base, '测试包_dir.vpk'), { 'addoninfo.txt': addonInfo('包内名称'), 'materials/demo.vmt': 'split data' }, { split: true });
  const shard = source.replace('_dir.vpk', '_000.vpk');
  const folder = path.join(desktopDir, '素材');
  await fs.mkdir(path.join(folder, 'materials'), { recursive: true });
  await fs.writeFile(path.join(folder, 'materials', 'sample.vmt'), 'loose data');
  await fs.mkdir(path.join(desktopDir, '测试包'));
  const existing = path.join(desktopDir, '素材.vpk');
  await fs.writeFile(existing, 'keep me');
  const coreApi = { ...core.createPlatform({ getProcesses: async () => [] }), discover: async () => ({ games: [], warnings: [] }) };
  const approval = { approved: true, source: 'user' }, service = new DesktopService({ core: coreApi, dataDir, desktopDir });
  try {
    const drop = await service.dispatch('vpk-drop', { paths: [shard, source, folder] }, approval);
    assert.deepEqual(drop, { queued: 2, errors: [] });
    const jobs = await service.dispatch('task-list');
    const results = await Promise.all(jobs.map(job => service.tasks.completed(job.taskId)));
    const dir = results.find(job => job.kind === 'extract').dir;
    assert.equal(dir, path.join(desktopDir, '测试包 (2)'));
    assert.equal(await fs.readFile(path.join(dir, 'materials/demo.vmt'), 'utf8'), 'split data');
    const file = results.find(job => job.kind === 'pack').output;
    assert.equal(file, path.join(desktopDir, '素材 (2).vpk'));
    const packed = await readVpk(file, { includeEntries: true });
    assert.equal((await readResource(packed.entries.get('materials/sample.vmt'), 1024)).toString(), 'loose data');
    assert.equal(await fs.readFile(existing, 'utf8'), 'keep me');
    assert.equal((await service.dispatch('snapshot')).game.installed, false);

    const { gameRoot } = await createFixture(base);
    const addons = path.join(gameRoot, 'left4dead2', 'addons');
    await fs.mkdir(addons);
    const installed = [source, shard].map(file => path.join(addons, path.basename(file)));
    await Promise.all([source, shard].map((file, i) => fs.copyFile(file, installed[i])));
    await service.dispatch('select-game', { gameRoot });
    const clipboard = await service.dispatch('copy-mod-files', { ids: ['测试包_dir.vpk'], gameRoot });
    assert.deepEqual(clipboard.paths, installed);
  } finally { await service.close(); }
});

test('desktop shortcuts: force stop requires approval and the observed game instance', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-stop-game-'));
  const { gameRoot } = await createFixture(base);
  const selected = { pid: 251, path: path.join(gameRoot, 'left4dead2.exe'), startedAt: '134200000000000000' };
  const unrelated = { ...selected, path: path.join(base, 'other', 'left4dead2.exe') };
  let processes = [selected];
  const stopped = [];
  const api = core.createPlatform({ getProcesses: async () => processes, stopGameProcess: async target => {
    stopped.push(target); processes = []; return { status: 'stopped' };
  } });
  const service = new DesktopService({ dataDir: path.join(base, 'settings'), core: { ...api, discover: async () => ({ games: [], warnings: [] }) } });
  const approval = { approved: true, source: 'user' }, params = { gameRoot, pid: selected.pid, startedAt: selected.startedAt };
  try {
    const { game } = await service.dispatch('select-game', { gameRoot });
    assert.equal(game.startedAt, selected.startedAt);
    await assert.rejects(service.dispatch('stop-game', params), { code: 'confirmation_required' });
    processes = [{ ...selected, startedAt: '134200000000000001' }];
    await assert.rejects(service.dispatch('stop-game', params, approval), { code: 'game_process_changed' });
    processes = [unrelated];
    assert.deepEqual(await service.dispatch('stop-game', params, approval), { status: 'exited' });
    assert.deepEqual(stopped, []);
    processes = [selected];
    assert.deepEqual(await service.dispatch('stop-game', params, approval), { status: 'stopped' });
    assert.deepEqual(stopped, [selected]);
    assert.equal((await service.dispatch('snapshot')).game.running, false);
  } finally { await service.close(); }
});
