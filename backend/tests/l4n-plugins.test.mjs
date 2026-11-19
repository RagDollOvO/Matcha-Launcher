import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { L4nPlugins } from '../l4n-plugins.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { createFixture, peFixture } from './fixtures.mjs';

const confirmation = { approved: true, source: 'user' };
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-l4n-plugins-'));
  const f = await createFixture(base);
  let running = false;
  const inspectGame = async () => ({ gameRoot: f.gameRoot, platform: { status: 'absent' },
    processes: running ? [{ pid: 123, path: path.join(f.gameRoot, 'left4dead2.exe') }] : [] });
  const manager = new L4nPlugins({ dataDir: path.join(base, 'settings'), inspectGame });
  const source = path.join(base, '物资雷达.DLL');
  const bytes = peFixture(['GetL4NPluginInstance']);
  await fs.writeFile(source, bytes);
  await fs.appendFile(path.join(f.gameRoot, 'left4dead2.exe'), 'left4neko.dll');
  await fs.writeFile(path.join(f.bin, 'left4neko.dll'), peFixture([]));
  const operate = async request => manager.apply(f.gameRoot, (await manager.preview(f.gameRoot, request)).planId, confirmation);
  return { ...f, base, manager, source, bytes, inspectGame, operate, setRunning: value => { running = value; } };
}

test('L4N SDK import, whole-DLL switches, host state and live module evidence; no code execution', async () => {
  const f = await fixture();
  await f.operate({ operation: 'import', file: f.source });
  let list = await f.manager.snapshot(f.gameRoot);
  const plugin = list.plugins[0];
  assert.equal(plugin.enabled, false); assert.equal(plugin.loadStatus.state, 'disabled');
  assert.equal(plugin.file, '物资雷达.DLL'); assert.equal(list.hostEnabled, true);
  const active = path.join(f.gameRoot, plugin.entry), parked = path.join(f.gameRoot, plugin.parkedPath);
  assert.deepEqual(await fs.readFile(parked), f.bytes);
  await assert.rejects(fs.access(active), { code: 'ENOENT' });
  const ini = path.join(f.gameRoot, 'left4dead2', 'radar.ini'); await fs.writeFile(ini, 'user configuration');
  await f.operate({ operation: 'set-enabled', pluginId: plugin.id, enabled: true });
  assert.deepEqual(await fs.readFile(active), f.bytes);
  assert.equal((await f.manager.snapshot(f.gameRoot)).plugins[0].loadStatus.state, 'pending');
  f.setRunning(true);
  list = await f.manager.snapshot(f.gameRoot, { runtime: { externalModules: {
    observed: true, l4nLoaded: true, l4nPlugins: [active.toUpperCase()],
  } } });
  assert.equal(list.plugins[0].loadStatus.state, 'loaded');
  assert.equal(list.plugins[0].loadStatus.initialized, null);
  await assert.rejects(f.manager.preview(f.gameRoot, { operation: 'set-enabled', pluginId: plugin.id, enabled: false }), { code: 'game_running' });
  f.setRunning(false);
  await fs.writeFile(path.join(f.gameRoot, 'left4dead2.exe'), peFixture([], { dll: false }));
  assert.equal((await f.manager.snapshot(f.gameRoot)).plugins[0].loadStatus.state, 'host-disabled');
  await f.operate({ operation: 'set-enabled', pluginId: plugin.id, enabled: false });
  assert.deepEqual(await fs.readFile(parked), f.bytes);
  assert.equal(await fs.readFile(ini, 'utf8'), 'user configuration');
  assert.deepEqual(await fs.readFile(f.source), f.bytes);
});

test('existing L4N plugins are adopted on confirmation; other DLLs and config stay in place', async () => {
  const f = await fixture(), folder = path.join(f.bin, 'neko/plugins');
  await fs.mkdir(folder, { recursive: true });
  await fs.copyFile(f.source, path.join(folder, 'ThirdParty.dll'));
  await fs.writeFile(path.join(folder, 'dependency.dll'), peFixture([]));
  await fs.writeFile(path.join(folder, 'settings.ini'), 'keep');
  const list = await f.manager.snapshot(f.gameRoot), p = list.plugins[0];
  assert.equal(list.plugins.length, 1); assert.equal(p.managed, false);
  const plan = await f.manager.preview(f.gameRoot, { operation: 'set-enabled', pluginId: p.id, enabled: false });
  await assert.rejects(f.manager.apply(f.gameRoot, plan.planId), { code: 'confirmation_required' });
  await f.manager.apply(f.gameRoot, plan.planId, confirmation);
  await f.operate({ operation: 'set-enabled', pluginId: p.id, enabled: true });
  const restored = (await f.manager.snapshot(f.gameRoot)).plugins[0];
  assert.equal(restored.id, p.id); assert.equal(restored.managed, true);
  assert.deepEqual(await fs.readFile(path.join(folder, 'ThirdParty.dll')), f.bytes);
  assert.equal(await fs.readFile(path.join(folder, 'settings.ini'), 'utf8'), 'keep');
  assert.deepEqual(await fs.readFile(path.join(folder, 'dependency.dll')), peFixture([]));
});

test('previews reject changed imports and managed bytes, collisions, and writes while a game is running', async () => {
  const f = await fixture();
  const request = { operation: 'import', file: f.source }, preview = await f.manager.preview(f.gameRoot, request);
  await fs.appendFile(f.source, 'revision');
  await assert.rejects(f.manager.apply(f.gameRoot, preview.planId, confirmation), { code: 'l4n_plugin_plan_stale' });
  await fs.writeFile(f.source, f.bytes);
  const pending = await f.manager.preview(f.gameRoot, request);
  f.setRunning(true);
  await assert.rejects(f.manager.apply(f.gameRoot, pending.planId, confirmation), { code: 'game_running' });
  f.setRunning(false); await f.manager.apply(f.gameRoot, pending.planId, confirmation);
  const p = (await f.manager.snapshot(f.gameRoot)).plugins[0];
  await assert.rejects(f.manager.preview(f.gameRoot, request), { code: 'l4n_plugin_exists' });
  await fs.appendFile(path.join(f.gameRoot, p.parkedPath), 'external edit');
  await assert.rejects(f.manager.preview(f.gameRoot, { operation: 'set-enabled', pluginId: p.id, enabled: true }), { code: 'l4n_plugin_external_change' });
  assert.equal((await fs.readFile(path.join(f.gameRoot, p.parkedPath))).subarray(-13).toString(), 'external edit');
});

test('an interrupted DLL move keeps a recoverable journal and restores original bytes', async () => {
  const f = await fixture(), folder = path.join(f.bin, 'neko/plugins');
  await fs.mkdir(folder, { recursive: true }); await fs.copyFile(f.source, path.join(folder, 'original.dll'));
  const p = (await f.manager.snapshot(f.gameRoot)).plugins[0];
  f.manager.store.beforeWrite = index => { if (index === 1) { f.setRunning(true); throw new Error('offline interruption'); } };
  await assert.rejects(f.operate({ operation: 'set-enabled', pluginId: p.id, enabled: false }), { code: 'platform_recovery_required' });
  assert.equal((await f.manager.snapshot(f.gameRoot)).pending, true);
  f.setRunning(false); f.manager.store.beforeWrite = undefined;
  await f.manager.recover(f.gameRoot, confirmation);
  assert.deepEqual(await fs.readFile(path.join(folder, 'original.dll')), f.bytes);
  const list = await f.manager.snapshot(f.gameRoot);
  assert.equal(list.pending, false); assert.equal(list.plugins[0].enabled, true);
});

test('desktop exposes L4N child routes while regular import identifies the required host', async t => {
  const f = await fixture();
  const service = new DesktopService({ dataDir: path.join(f.base, 'desktop'), core: { inspectGame: f.inspectGame } });
  t.after(() => service.close()); await service.ready; service.settings.gameRoot = f.gameRoot;
  await assert.rejects(service.dispatch('validate-plugin', { pluginDirectory: f.source }), e =>
    e.code === 'plugin_needs_agent' && e.details.agent.available === true);
  const preview = await service.dispatch('l4n-plugin-preview', { operation: 'import', file: f.source });
  await service.dispatch('l4n-plugin-apply', { planId: preview.planId }, confirmation);
  const list = await service.dispatch('l4n-plugins-list');
  assert.equal(list.plugins.length, 1); assert.equal(list.plugins[0].enabled, false);
  const bad = path.join(f.base, 'other.dll'); await fs.writeFile(bad, peFixture(['GetL4NPluginInstance'], { architecture: 'x64' }));
  await assert.rejects(service.dispatch('l4n-plugin-preview', { operation: 'import', file: bad }), { code: 'l4n_plugin_invalid' });
});
