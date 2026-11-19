import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as core from '../core.mjs';
import { createFixture } from '../tests/fixtures.mjs';
import { DesktopService } from './service.mjs';
import { createServer } from 'vite';
import { beaconBridge } from './vite-plugin.mjs';

test('desktop: missing game, confirmed deployment, plugin acknowledgement and running guard', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'beacon-desktop-'));
  const fixture = await createFixture(base,{l4n:true});
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
    assert.equal(view.plugins[0].runtimeState, 'unobserved');
    await service.dispatch('set-plugin-enabled', { pluginId: 'demo.hello', enabled: false }, approval);
    assert.equal((await service.dispatch('snapshot')).plugins[0].enabled, false);
    running = [{ pid: 99, path: path.join(fixture.gameRoot, 'left4dead2.exe'), name: 'fixture' }];
    await assert.rejects(service.dispatch('set-plugin-enabled', { pluginId: 'demo.hello', enabled: true }, approval), e => e.code === 'game_running');
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
