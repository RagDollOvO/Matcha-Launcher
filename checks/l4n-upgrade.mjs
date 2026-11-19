// Old package -> newer package -> disable, entirely inside a synthetic game.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPlatform } from '../backend/core.mjs';
import { createFixture } from '../backend/tests/fixtures.mjs';
import { withZip } from '../backend/platforms/packages.mjs';
import { NativeLibraries } from '../backend/native-libraries.mjs';

const base = await fs.mkdtemp(path.resolve('checks/.artifacts/l4n-upgrade-'));
const vendor = path.join(base, 'vendor'), f = await createFixture(base);
const current = JSON.parse(await fs.readFile(path.resolve('vendor/native-libraries.json'), 'utf8'));
const old = await withZip(path.resolve(process.argv[2] ?? 'vendor/l4n/3558049615.zip'), async zip => {
  const version = (await zip.read('readme_l4n.txt', 1024 * 1024)).toString('utf8').match(/^\[(\d+\.\d+\.\d+)\]/m)[1];
  const files = [];
  for (const name of zip.entries.keys()) {
    if (name.endsWith('/')) continue;
    const file = path.join(vendor, 'l4n', version, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, await zip.read(name, 64 * 1024 * 1024)); files.push(name);
  }
  return { ...current, l4n: { ...current.l4n, version, folder: `l4n/${version}`, files, sourceKind: 'author-workshop' } };
});
assert.notEqual(old.l4n.version, current.l4n.version);
await fs.writeFile(path.join(vendor, 'native-libraries.json'), JSON.stringify(old));
const original = await fs.readFile(path.join(f.gameRoot, 'left4dead2.exe'));
const core = createPlatform({ getProcesses: async () => [] });
const confirmation = { approved: true, source: 'user' };
const libraries = new NativeLibraries({ dataDir: path.join(base, 'settings'), inspectGame: core.inspectGame, vendorRoot: vendor, distRoot: f.distRoot });
const operate = async enabled => libraries.apply(f.gameRoot, (await libraries.preview(f.gameRoot, 'l4n', enabled)).planId, confirmation);
await fs.mkdir(path.join(f.gameRoot, 'left4dead2/neko'), { recursive: true });
const config = path.join(f.gameRoot, 'left4dead2/neko/config.vdf');
await fs.writeFile(config, 'user layout and settings');
await operate(true);
const backend = await fs.readFile(path.join(f.bin, 'dxvk_d3d9.dll'));
await fs.cp(path.resolve('vendor', current.l4n.folder), path.join(vendor, current.l4n.folder), { recursive: true });
await fs.writeFile(path.join(vendor, 'native-libraries.json'), JSON.stringify(current));
// A newer bundled version must never prevent disabling the already installed one.
await operate(false);
assert.equal((await libraries.store.read(f.gameRoot, 'l4n')).version, old.l4n.version);
assert.deepEqual(await fs.readFile(path.join(f.gameRoot, 'left4dead2.exe')), original);
await operate(true);
assert.equal((await libraries.store.read(f.gameRoot, 'l4n')).version, current.l4n.version);
assert.deepEqual(await fs.readFile(path.join(f.gameRoot, 'bin/left4neko.dll')), await fs.readFile(path.resolve('vendor', current.l4n.folder, 'bin/left4neko.dll')));
const records = (await libraries.store.read(f.gameRoot, 'l4n')).files.map(f => f.path.toLowerCase());
assert.equal(new Set(records).size, records.length);
assert.equal(await fs.readFile(config, 'utf8'), 'user layout and settings');
assert.deepEqual(await fs.readFile(path.join(f.bin, 'dxvk_d3d9.dll')), backend);
await operate(false);
assert.deepEqual(await fs.readFile(path.join(f.gameRoot, 'left4dead2.exe')), original);
console.log(JSON.stringify({ from: old.l4n.version, to: current.l4n.version, preserved: ['original-exe', 'user-config', 'dxvk'], root: base, gameStarted: false }));
