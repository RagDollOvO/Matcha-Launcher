import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { createPlatform, inspectPe, validateManifest, validatePlugin, validateActionParameters, orderPlugins, parseKeyValues } from '../core.mjs';
import { createFixture, pluginFixture, manifest, peFixture } from './fixtures.mjs';

const confirmation = { approved: true, source: 'user' };
const code = (expected) => (error) => error.code === expected;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'l4p-core-fixture-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('l4p-core-fixture-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, ...(await createFixture(root,{l4n:true})) };
}

test('deployment plan, backup, restoration, ownership and explicit confirmation', async (t) => {
  const f = await fixture(t); let running = [];
  const core = createPlatform({ getProcesses: async () => running });
  const plan = await core.planInstall(f);
  await assert.rejects(core.applyInstall(plan), code('confirmation_required'));
  const result = await core.applyInstall(plan, { confirmation });
  assert.equal(result.status, 'installed');
  assert.deepEqual(await fs.readFile(path.join(f.bin,'dxvk_d3d9.dll')),f.original);
  assert.ok((await inspectPe(f.bridge)).exports.includes('GetL4NPluginInstance'));
  assert.equal((await core.listPlugins(f.gameRoot))[0].enabled, true);
  const configPath = path.join(f.runtime, 'plugins/demo.hello/config.json'); await fs.writeFile(configPath, '{"greeting":"user draft"}');
  running = [{ pid: 123, name: 'left4dead2' }];
  await assert.rejects(core.restore(f.gameRoot, { confirmation }), code('game_running'));
  await assert.rejects(core.setPluginEnabled({ gameRoot: f.gameRoot, pluginId: 'demo.hello', enabled: false, confirmation }), code('game_running'));
  running = [];
  const owned = await fs.readFile(f.bridge);
  await fs.appendFile(f.bridge, 'external change');
  await assert.rejects(core.restore(f.gameRoot, { confirmation }), code('external_change'));
  await fs.writeFile(f.bridge, owned);
  assert.equal((await core.restore(f.gameRoot, { confirmation })).status, 'restored');
  assert.deepEqual(await fs.readFile(path.join(f.bin, 'dxvk_d3d9.dll')), f.original);
  assert.equal(await fs.readFile(configPath, 'utf8'), '{"greeting":"user draft"}');
  await assert.rejects(core.planInstall(f), code('existing_platform'));
  await assert.rejects(core.resumeRuntime(f.gameRoot), code('confirmation_required'));
  running = [{ pid: 123, name: 'left4dead2' }];
  await assert.rejects(core.resumeRuntime(f.gameRoot, { confirmation }), code('game_running'));
  running = [];
  await fs.writeFile(f.bridge,'foreign');
  await assert.rejects(core.resumeRuntime(f.gameRoot,{confirmation}),code('existing_bridge'));
  await fs.unlink(f.bridge);
  assert.equal((await core.resumeRuntime(f.gameRoot,{confirmation})).status,'installed');
  assert.deepEqual(await fs.readFile(f.bridge),owned);
  assert.equal(await fs.readFile(configPath, 'utf8'), '{"greeting":"user draft"}');
  assert.equal((await core.listPlugins(f.gameRoot))[0].enabled, true);
});

test('stale plans, unknown platform paths and interrupted installation recovery', async (t) => {
  const f = await fixture(t), core = createPlatform({ getProcesses: async () => [] });
  let plan = await core.planInstall(f);
  await fs.appendFile(path.join(f.distRoot,'bin/neko/plugins/MatchaRuntime.dll'),'changed');
  await assert.rejects(core.applyInstall(plan,{confirmation}),code('stale_plan'));
  await fs.mkdir(f.runtime); await fs.writeFile(path.join(f.runtime, 'user.txt'), 'preserve');
  await assert.rejects(core.planInstall(f), code('existing_platform'));
  await fs.unlink(path.join(f.runtime, 'user.txt')); await fs.rmdir(f.runtime);
  plan = await core.planInstall(f); await core.applyInstall(plan, { confirmation });
  const ledger = path.join(f.runtime, 'platform-state.json'); const state = JSON.parse(await fs.readFile(ledger, 'utf8'));
  state.status = 'installing'; await fs.writeFile(ledger, JSON.stringify(state));
  const result = await core.recover(f.gameRoot, { confirmation });
  assert.equal(result.status, 'restored'); assert.deepEqual(await fs.readFile(path.join(f.bin, 'dxvk_d3d9.dll')), f.original);
});

test('prepared ownership journal recovers intact original before backup publication', async (t) => {
  const f = await fixture(t), core = createPlatform({ getProcesses: async () => [] });
  await core.applyInstall(await core.planInstall(f), { confirmation });
  const ledger = path.join(f.runtime, 'platform-state.json'); const state = JSON.parse(await fs.readFile(ledger, 'utf8'));
  state.status = 'installing'; await fs.writeFile(ledger, JSON.stringify(state));
  await fs.writeFile(path.join(f.bin, 'dxvk_d3d9.dll'), f.original);
  await fs.unlink(f.bridge);await fs.unlink(path.join(f.runtime, 'backups/MatchaRuntime.dll'));
  const result = await core.recover(f.gameRoot, { confirmation });
  assert.equal(result.status, 'restored');
  assert.deepEqual(await fs.readFile(path.join(f.bin, 'dxvk_d3d9.dll')), f.original);
});

test('manifest, static ABI, dependency ordering and plugin enable transactions', async (t) => {
  const f = await fixture(t), core = createPlatform({ getProcesses: async () => [] });
  const p = await validatePlugin(path.join(f.distRoot, 'bin/l4p/plugins/demo.hello')); assert.equal(p.pe.architecture, 'x86');
  for (const modification of [{ entry: '../plugin.dll' }, { apiVersion: 2 }, { id: 'con' }, { phase: 'dllmain' }]) assert.throws(() => validateManifest({ ...manifest(), ...modification }));
  assert.throws(() => validateActionParameters(manifest().actions[1], { amount: 4 }), code('invalid_parameter'));
  assert.throws(() => validateActionParameters(manifest().actions[0], { unlisted: true }), code('invalid_parameter'));
  assert.deepEqual(validateActionParameters(manifest().actions[0], {}), { name: 'survivor' });
  const bad = await pluginFixture(path.join(f.root, 'bad'));
  await fs.writeFile(path.join(bad, 'plugin.dll'), peFixture(['L4P_GetPluginApi'], { architecture: 'x64' }));
  await assert.rejects(validatePlugin(bad), code('wrong_architecture'));
  await fs.writeFile(path.join(bad, 'plugin.dll'), peFixture(['unrelated']));
  await assert.rejects(validatePlugin(bad), code('missing_export'));
  const a = { manifest: manifest('dep.a') }, b = { manifest: manifest('dep.b', [{ id: 'dep.a', version: '0.1.0' }]) };
  assert.deepEqual(orderPlugins([b, a], ['dep.b', 'dep.a']), ['dep.a', 'dep.b']);
  assert.throws(() => orderPlugins([b, a], ['dep.b']), code('dependency_missing'));
  a.manifest.dependencies = [{ id: 'dep.b', version: '0.1.0' }];
  assert.throws(() => orderPlugins([b, a], ['dep.b', 'dep.a']), code('dependency_cycle'));
  await core.applyInstall(await core.planInstall(f), { confirmation });
  const imported = await pluginFixture(path.join(f.root, 'import'), 'extra.plugin', [{ id: 'demo.hello', version: '0.1.0' }]);
  await core.installPlugin({ gameRoot: f.gameRoot, pluginDirectory: imported, confirmation });
  assert.equal((await core.listPlugins(f.gameRoot)).find((v) => v.manifest.id === 'extra.plugin').enabled, false);
  const enabled = await core.setPluginEnabled({ gameRoot: f.gameRoot, pluginId: 'extra.plugin', enabled: true, confirmation });
  assert.deepEqual(enabled.enabled, ['demo.hello', 'extra.plugin']);
  await assert.rejects(core.setPluginEnabled({ gameRoot: f.gameRoot, pluginId: 'demo.hello', enabled: false, confirmation }), code('dependency_missing'));
  assert.equal(await fs.readFile(path.join(f.runtime, 'enabled.txt'), 'utf8'), 'demo.hello\nextra.plugin\n');
  await core.setPluginEnabled({ gameRoot: f.gameRoot, pluginId: 'extra.plugin', enabled: false, confirmation });
  // Model a copied, disabled plugin whose final ledger commit was interrupted.
  const marker = JSON.parse(await fs.readFile(path.join(f.runtime, 'plugins/extra.plugin/.l4p-package.json'), 'utf8'));
  const ledger = path.join(f.runtime, 'platform-state.json'), state = JSON.parse(await fs.readFile(ledger, 'utf8'));
  state.pluginTransaction = { id: marker.transactionId, pluginId: 'extra.plugin', stage: `.plugin-stage-${marker.transactionId}` };
  delete state.plugins['extra.plugin']; await fs.writeFile(ledger, JSON.stringify(state));
  assert.deepEqual((await core.recover(f.gameRoot, { confirmation })).cleaned, ['plugin:extra.plugin']);
  assert.equal((await core.listPlugins(f.gameRoot)).length, 1);
});

test('JSONL pipe client framing, id matching, errors, timeouts and action confirmation', async (t) => {
  const f = await fixture(t); const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\l4p-core-test.${randomUUID()}` : path.join(f.root, 'runtime.sock');
  let mode = 'success', received;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8'); if (!data.includes('\n')) return;
      received = JSON.parse(data.split('\n')[0]);
      if (mode === 'timeout') return;
      if (mode === 'error') { socket.end(`${JSON.stringify({ id: received.id, ok: false, error: { code: 'plugin_error', message: 'plugin rejected' } })}\n`); return; }
      const reply = Buffer.from(`${JSON.stringify({ id: mode === 'wrong-id' ? 'wrong' : received.id, ok: true, result: { text: '你好', params: received.params } })}\n`);
      socket.write(reply.subarray(0, reply.length - 3)); setTimeout(() => socket.end(reply.subarray(reply.length - 3)), 5);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); });
  const core = createPlatform({ getProcesses: async () => [], pipePath: () => pipe });
  const response = await core.runtimeRequest(321, { type: 'status' }); assert.equal(response.result.text, '你好');
  mode = 'wrong-id'; await assert.rejects(core.runtimeRequest(321, { type: 'status' }), code('response_mismatch'));
  mode = 'error'; await assert.rejects(core.runtimeRequest(321, { type: 'status' }), code('plugin_error'));
  mode = 'timeout'; await assert.rejects(core.runtimeRequest(321, { type: 'status' }, { timeoutMs: 30 }), code('runtime_timeout'));
  mode = 'success'; await core.applyInstall(await core.planInstall(f), { confirmation });
  const running = createPlatform({ getProcesses: async () => [{ pid: 321, name: 'left4dead2', path: path.join(f.gameRoot, 'left4dead2.exe') }], pipePath: () => pipe });
  const request = { gameRoot: f.gameRoot, pid: 321, pluginId: 'demo.hello', actionId: 'change', args: { amount: 2 } };
  await assert.rejects(running.invokePlugin(request), code('confirmation_required'));
  await running.invokePlugin({ ...request, confirmation });
  assert.deepEqual(received.confirmation, confirmation); assert.deepEqual(received.params, { amount: 2 });
});

test('Steam KeyValues and AppID 550 discovery stay read-only', async (t) => {
  const f = await fixture(t); const steam = path.join(f.root, 'Steam'), library = path.join(f.root, 'Library');
  await fs.mkdir(path.join(steam, 'steamapps'), { recursive: true }); await fs.mkdir(path.join(library, 'steamapps/common'), { recursive: true });
  const installed = path.join(library, 'steamapps/common/Left 4 Dead 2'); await fs.rename(f.gameRoot, installed);
  const quote = (p) => p.replaceAll('\\', '\\\\');
  await fs.writeFile(path.join(steam, 'steamapps/libraryfolders.vdf'), `"libraryfolders" { "0" { "path" "${quote(steam)}" } "1" { "path" "${quote(library)}" } }`);
  await fs.writeFile(path.join(library, 'steamapps/appmanifest_550.acf'), '"AppState" { "appid" "550" "installdir" "Left 4 Dead 2" "buildid" "12345" }');
  const core = createPlatform({ getProcesses: async () => [] }); const result = await core.discover({ steamRoots: [steam] });
  assert.equal(result.games.length, 1); assert.equal(result.games[0].gameRoot, installed); assert.equal(result.games[0].steamBuildId, '12345');
  assert.equal(parseKeyValues('"root" { // comment\n "x" "a\\\\b" }').root.x, 'a\\b');
});
