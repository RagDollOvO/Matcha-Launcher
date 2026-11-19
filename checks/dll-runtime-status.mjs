// Isolated x86 host: our own SDK example and fake DLLs, no game or L4N code.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const build = path.resolve('native/build-x86');
const root = await fs.mkdtemp(path.resolve('checks/.artifacts/dll-status-'));
const bin = path.join(root, 'bin'), platform = path.join(bin, 'l4p');
await fs.mkdir(path.join(platform, 'plugins'), { recursive: true });
await fs.copyFile(path.join(build, 'dist/bin/l4p/l4p_runtime.dll'), path.join(platform, 'l4p_runtime.dll'));
await fs.cp(path.join(build, 'dist/bin/l4p/plugins/demo.hello'), path.join(platform, 'plugins/demo.hello'), { recursive: true });
const fake = path.join(build, 'fixtures/dxvk.dll');
for (const name of ['left4neko.dll', 'neko/plugins/offline-child.dll']) {
  const file = path.join(bin, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(fake, file);
}
for (const [id, loadKind, dependencies] of [
  ['local.library', 'library', []],
  ['local.bad-api', 'sdk', []],
  ['local.dependent', 'library', [{ id: 'local.library', version: '1.0.0' }]],
]) {
  const folder = path.join(platform, 'plugins', id); await fs.mkdir(folder);
  await fs.copyFile(fake, path.join(folder, 'plugin.dll'));
  await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id, name: id, version: '1.0.0',
    apiVersion: 1, architecture: 'x86', phase: 'render-init', entry: 'plugin.dll', loadKind, dependencies, config: [], actions: [] }));
}
await fs.writeFile(path.join(platform, 'enabled.txt'), 'local.library\nlocal.dependent\ndemo.hello\nlocal.bad-api\n');
const output = execFileSync(path.join(build, 'fixtures/runtime_status_smoke.exe'), [platform],
  { windowsHide: true, timeout: 10000, encoding: 'utf8' });
const observed = JSON.parse(output);
const get = id => observed.plugins.find(p => p.id === id);
assert.equal(get('local.library').state, 'loaded'); assert.equal(get('local.library').mapped, true);
assert.equal(get('local.library').loadKind, 'library');
assert.equal(get('local.dependent').state, 'loaded');
assert.equal(get('demo.hello').state, 'initialized');
assert.equal(get('local.bad-api').state, 'failed'); assert.equal(get('local.bad-api').mapped, true);
assert.equal(get('local.bad-api').errorCode, 'abi_mismatch'); assert.equal(get('local.bad-api').stage, 'abi');
assert.equal(observed.externalModules.observed, true); assert.equal(observed.externalModules.l4nLoaded, true);
assert.deepEqual(observed.externalModules.l4nPlugins.map(p => path.resolve(p).toLowerCase()),
  [path.join(bin, 'neko/plugins/offline-child.dll').toLowerCase()]);
console.log(JSON.stringify({ directory: root, sdk: 'initialized', raw: 'loaded', failedApi: 'mapped but failed', l4nObservation: 'fake modules only' }));
