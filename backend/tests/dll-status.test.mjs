import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dllLoadStatus } from '../dll-status.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { createFixture, peFixture, manifest, pluginFixture } from './fixtures.mjs';
import { dllHost } from '../pi/dll-host.mjs';
import { platformTools, platformToolCatalog } from '../pi/platform-extension.mjs';

test('DLL state separates process mapping, SDK initialization and next-launch selection', () => {
  const context = { enabled: true, running: true, connected: true };
  const raw = dllLoadStatus({ ...context, loadKind: 'library', observed: { state: 'initialized' } });
  assert.equal(raw.state, 'loaded'); assert.equal(raw.initialized, null); assert.equal(raw.mapped, true);
  assert.equal(dllLoadStatus({ ...context, observed: { state: 'initialized', mapped: true } }).state, 'initialized');
  const failed = dllLoadStatus({ ...context, observed: { state: 'failed', mapped: true, stage: 'abi', errorCode: 'abi_mismatch', error: 'Missing API' } });
  assert.equal(failed.state, 'failed'); assert.equal(failed.mapped, true); assert.equal(failed.code, 'abi_mismatch');
  assert.equal(failed.stage, 'abi'); assert.equal(failed.detail, 'Missing API');
  assert.match(failed.message, /接口/);
  assert.match(dllLoadStatus({ ...context, observed: { state: 'failed', errorCode: 'dll_load_failed', nativeError: 126 } }).message, /依赖文件未找到/);
  const stopNext = dllLoadStatus({ ...context, enabled: false, observed: { state: 'initialized' } });
  assert.equal(stopNext.state, 'initialized'); assert.equal(stopNext.pendingChange, true); assert.equal(stopNext.nextLaunchEnabled, false);
  assert.equal(dllLoadStatus({ enabled: true }).state, 'pending');
  assert.equal(dllLoadStatus({ enabled: false }).state, 'disabled');
  assert.equal(dllLoadStatus({ enabled: true, host: 'l4n', hostEnabled: false }).state, 'host-disabled');
  assert.equal(dllLoadStatus({ enabled: true, running: true }).state, 'unobserved');
  assert.equal(dllLoadStatus({ ...context }).mapped, false);
  assert.equal(dllLoadStatus({ installed: false }).state, 'available');
  assert.equal(dllLoadStatus({ enabled: true, observed: { state: 'initialized' } }).state, 'pending');
});

test('desktop publishes truthful legacy-runtime states and detects the module-status upgrade', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-dll-status-')), f = await createFixture(base);
  const runtimeDir = path.join(f.bin, 'l4p'); await fs.mkdir(runtimeDir);
  const runtimeFile = path.join(runtimeDir, 'l4p_runtime.dll');
  await fs.writeFile(runtimeFile, peFixture(['L4P_RuntimeInitialize']));
  const inspection = { gameRoot: f.gameRoot, platform: { status: 'installed', version: '0.1.0' },
    dxvk: { exports: ['L4P_RenderBackendControlV1'] }, processes: [{ pid: 123, path: path.join(f.gameRoot, 'left4dead2.exe') }] };
  const raw = { ...manifest('local.raw'), loadKind: 'library', actions: [], config: [] }, sdk = manifest('local.sdk');
  const core = { discover: async () => ({ games: [inspection], warnings: [] }), inspectGame: async () => inspection,
    listPlugins: async () => [raw, sdk].map(m => ({ manifest: m, enabled: true, loadOrder: 0, verification: { state: 'unverified' } })),
    runtimeRequest: async () => ({ result: { plugins: [{ id: raw.id, state: 'initialized' },
      { id: sdk.id, state: 'failed', mapped: true, stage: 'init', errorCode: 'init_failed', error: 'Fixture SDK initialization failed' }] } }) };
  const service = new DesktopService({ dataDir: path.join(base, 'settings'), distRoot: f.distRoot, core });
  t.after(() => service.close());
  const snapshot = await service.dispatch('snapshot');
  assert.equal(snapshot.plugins.find(p => p.id === raw.id).runtimeState, 'loaded');
  assert.equal(snapshot.plugins.find(p => p.id === raw.id).loadStatus.state, 'loaded');
  assert.equal(snapshot.plugins.find(p => p.id === sdk.id).loadStatus.code, 'init_failed');
  assert.equal(snapshot.nativeLibraries.runtimeUpdateAvailable, true);
  await pluginFixture(path.join(f.distRoot, 'bin/l4p/plugins/local.available'), 'local.available');
  const source = { type: 'github', url: 'https://github.com/Author/Raw', version: 'v1.0.0' };
  const publisher = { type: 'github', repositoryId: '101', ownerId: '7' };
  await service.pluginOverlays.attach(raw, { source, publisher });
  await service.dispatch('plugin-overlay-save', { id: raw.id, fields: { summary: '我的说明' } });
  // A DLL read does not enumerate unrelated VPKs, trash or server lists.
  service.modManager.scan = async () => { throw new Error('unexpected VPK scan'); };
  service.modTrash.list = async () => { throw new Error('unexpected trash read'); };
  service.serverManager.snapshot = async () => { throw new Error('unexpected server read'); };
  const tool = platformTools(f.gameRoot, { modRequest: dllHost(service, f.gameRoot) }).find(t => t.name === 'dll_inventory');
  const result = (await tool.execute('query', {}, new AbortController().signal, undefined, { hasUI: false })).details;
  const item = result.plugins.find(p => p.id === raw.id);
  assert.equal(item.presentation.summary, '我的说明'); assert.equal(item.provenance.fields.summary, 'user');
  assert.deepEqual(item.source, source); assert.deepEqual(item.publisher, publisher);
  assert.deepEqual(item.loadStatus, snapshot.plugins.find(p => p.id === raw.id).loadStatus);
  assert.equal(result.plugins.find(p => p.id === sdk.id).loadStatus.code, 'init_failed');
  assert.equal(result.availablePlugins[0].id, 'local.available'); assert.equal(result.availablePlugins[0].loadStatus.state, 'available');
  assert.equal(result.game.pid, 123); assert.equal(result.runtime.connected, true);
  assert.equal(result.nativeLibraries.runtimeUpdateAvailable, true);
  assert.equal(result.issues.some(i => /unexpected/.test(i.message)), false);
  assert.equal(platformToolCatalog().find(t => t.name === 'dll_inventory').write, false);
  await assert.rejects(tool.execute('query', { id: 'local.missing' }, undefined), { code: 'plugin_missing' });
  await fs.writeFile(runtimeFile, peFixture(['L4P_RuntimeInitialize', 'L4P_RuntimeModuleStatusV1']));
  assert.equal((await service.nativeLibraries.snapshot(f.gameRoot, inspection)).runtimeUpdateAvailable, false);
});
