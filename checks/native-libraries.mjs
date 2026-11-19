// One isolated cross-layer check; never starts a game or maps L4N code.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPlatform } from '../backend/core.mjs';
import { createFixture } from '../backend/tests/fixtures.mjs';
import { NativeLibraries } from '../backend/native-libraries.mjs';
import { DesktopService } from '../backend/desktop/service.mjs';

const base = await fs.mkdtemp(path.resolve('checks/.artifacts/native-libraries-'));
const f = await createFixture(base), build = path.resolve('native/build-x86');
const originalExe = await fs.readFile(path.join(f.gameRoot, 'left4dead2.exe'));
let running = false;
const core = createPlatform({ getProcesses: async () => running ? [{ pid: 123, name: 'offline' }] : [] });
const confirmation = { approved: true, source: 'user' };
const libraries = new NativeLibraries({ dataDir: path.join(base, 'settings'), inspectGame: core.inspectGame, distRoot: path.join(build, 'dist') });
const operate = async (id, enabled) => libraries.apply(f.gameRoot, (await libraries.preview(f.gameRoot, id, enabled)).planId, confirmation);
await assert.rejects(libraries.preview(f.gameRoot,'dxvk',true),{code:'renderer_read_only'});
const config = path.join(f.gameRoot, 'left4dead2/neko/config.vdf');
await fs.mkdir(path.dirname(config), { recursive: true });
await fs.writeFile(config, 'user custom settings');
await operate('l4n', true);
assert.ok((await fs.readFile(path.join(f.gameRoot, 'left4dead2.exe'))).includes(Buffer.from('left4neko.dll')));
await operate('l4n', false);
assert.deepEqual(await fs.readFile(path.join(f.gameRoot, 'left4dead2.exe')), originalExe);
assert.equal(await fs.stat(path.join(f.gameRoot, 'bin/left4neko.dll')).then(()=>true,()=>false), false);
assert.equal(await fs.readFile(config, 'utf8'), 'user custom settings');
assert.equal((await core.inspectGame(f.gameRoot)).platform.status, 'absent');
await operate('l4n', true);
await core.applyInstall(await core.planInstall(f), { confirmation });
assert.deepEqual(await fs.readFile(path.join(f.bin,'dxvk_d3d9.dll')),f.original);
await core.restore(f.gameRoot,{confirmation});
await core.resumeRuntime(f.gameRoot,{confirmation});
running = true;
await assert.rejects(libraries.preview(f.gameRoot, 'l4n', false), { code: 'game_running' });
running = false;

const service = new DesktopService({ core, dataDir: path.join(base, 'ui'), distRoot: path.join(build, 'dist') });
try {
  await service.ready;
  service.settings.gameRoot = f.gameRoot;
  const intake = await service.inspectDllIntake(path.join(build, 'fixtures/dxvk.dll'));
  const prepared = await service.dllIntake.prepare(intake.intakeId, { mode: 'library', name: 'Offline fake DLL', summary: 'Offline fixture only',
    mappings: [{ source: 'dxvk.dll', target: 'plugin.dll' }] });
  assert.equal(prepared.manifest.loadKind, 'library');
  await core.installPlugin({ gameRoot: f.gameRoot, pluginDirectory: prepared.preparedDirectory, confirmation });
  await core.setPluginEnabled({ gameRoot: f.gameRoot, pluginId: prepared.manifest.id, enabled: true, confirmation });
  const snapshot = await service.snapshot();
  assert.equal(snapshot.plugins.some(p => /^(beacon\.|skeeto\.|demo\.)/.test(p.id)), false);
  assert.equal(snapshot.availablePlugins.some(p => /^(beacon\.|skeeto\.|demo\.)/.test(p.id)), false);
  assert.equal(snapshot.platforms.length, 0);
  await assert.rejects(service.dispatch('platform-check-update', { id: 'skeeto' }), { code: 'platform_retired' });
  console.log(JSON.stringify({ root: base, l4n: 'install-off-on', dxvk:'read-only', gameStarted: false }));
} finally { await service.close(); }
