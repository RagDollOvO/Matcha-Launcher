import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { zip } from './platforms-fixtures.mjs';
import { ExternalPlatforms } from '../platforms/manager.mjs';
import { detectPlatformPackage } from '../platforms/packages.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { ModManager } from '../mods/manager.mjs';
import { createPlatform } from '../core.mjs';
import { createFixture, peFixture } from './fixtures.mjs';
import { vpkFixture, addonInfo } from './mods-fixtures.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-platform-'));
  return { base, ...await createFixture(base) };
}
async function put(root, file, bytes) {
  const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes); return target;
}
const inspection = root => ({ gameRoot: root, platform: { status: 'absent' }, processes: [] });
async function installFixture(root, manifest = true) {
  const core = peFixture(['SkeetoBootstrapQuery', 'necola_export']); core.write('SkeetoInstalledSemver=2.2.19\0', 3000);
  const proxy = peFixture(['SkeetoWininetProxyIdentity']);
  await put(root, 'skeeto.dll', core); await put(root, 'bin/wininet.dll', proxy);
  if (manifest) await put(root, 'Skeeto/Manifest.json', JSON.stringify({ schema: 1, product: 'Skeeto', install_layout: 2, semver: '2.2.19',
    files: [{ relative: 'skeeto.dll', role: 'core', hash: hash(core) }, { relative: 'bin\\wininet.dll', role: 'proxy', hash: hash(proxy) }, { relative: 'Skeeto/README.txt', role: 'document' }] }));
}

test('read-only inventory: absent, occupied proxy, official layout without manifest, saved module switches', async () => {
  const { gameRoot } = await fixture(), manager = new ExternalPlatforms();
  const read = async () => (await manager.snapshot(gameRoot, inspection(gameRoot)))[0];
  let p = await read();
  assert.equal(p.state, 'not-installed'); assert.equal(p.modules.length, 49);
  assert.equal(p.modules.filter(m => m.online === 'review').length, 8);
  assert.equal(p.runtime.loaded, null);
  await put(gameRoot, 'bin/wininet.dll', peFixture(['ForeignProxy']));
  p = await read(); assert.equal(p.state, 'not-installed'); assert.equal(p.loader.owned, false); assert.match(p.loader.foreign, /未知代理/);
  await installFixture(gameRoot, false);
  const saved = 'workshop_update=1\r\nworkshop_update=0\r\nplugin_platform=0\r\nclient_hold_semiauto_aac=0\r\nclient_thirdperson_aim_aac=1\r\nclient_hold_semiauto_fire=0\r\nclient_force_fog=0\r\n';
  await put(gameRoot, 'skeeto_setting.ini', saved);
  p = await read(); assert.equal(p.state, 'enabled'); assert.equal(p.version, '2.2.19');
  assert.equal(p.integrity.state, 'unknown'); assert.equal(p.identity.verified, false); assert.equal(p.verification.state, 'unverified');
  assert.equal(p.update.selfUpdate, null); assert.equal(p.subPlugins.platformOn, false);
  assert.equal(p.modules.find(m => m.id === 'anti-anti-cheat').state, 'on');
  assert.equal(p.modules.find(m => m.id === 'auto-semiauto').state, 'off');
  assert.equal(p.modules.find(m => m.id === 'forced-cvars').state, 'unknown');
  assert.equal(p.modules.find(m => m.id === 'forced-cvars').switchable, true);
  assert.equal(await fs.readFile(path.join(gameRoot, 'skeeto_setting.ini'), 'utf8'), saved);
});

test('manifest integrity, missing/unhashed docs, disabled and modified runtime files', async () => {
  const { gameRoot } = await fixture(), manager = new ExternalPlatforms(); await installFixture(gameRoot);
  const read = async () => (await manager.snapshot(gameRoot, inspection(gameRoot)))[0];
  let p = await read(); assert.equal(p.loader.owned, true); assert.equal(p.integrity.state, 'match');
  assert.equal(p.integrity.files.find(f => f.role === 'document').reason, 'missing');
  await put(gameRoot, 'Skeeto/README.txt', '作者说明');
  p = await read(); assert.equal(p.integrity.files.find(f => f.role === 'document').reason, 'hash_not_provided');
  await fs.unlink(path.join(gameRoot, 'bin/wininet.dll')); p = await read(); assert.equal(p.state, 'disabled'); assert.equal(p.integrity.state, 'mismatch');
  await fs.appendFile(path.join(gameRoot, 'skeeto.dll'), 'modified'); p = await read(); assert.equal(p.state, 'broken');
  const manifest = JSON.parse(await fs.readFile(path.join(gameRoot, 'Skeeto/Manifest.json'), 'utf8'));
  manifest.files.push({ relative: '../outside.txt', role: 'document' }); await put(gameRoot, 'Skeeto/Manifest.json', JSON.stringify(manifest));
  p = await read(); assert.equal(p.integrity.state, 'unknown'); assert.ok(p.issues.some(i => i.code === 'unsafe_path'));
});

test('document allowlist, plain text, missing document and junction rejection', async () => {
  const { base, gameRoot } = await fixture(), manager = new ExternalPlatforms();
  await assert.rejects(manager.doc(gameRoot, 'skeeto', 'skeeto_setting.ini'), e => e.code === 'platform_doc_denied');
  await assert.rejects(manager.doc(gameRoot, 'skeeto', 'Skeeto/../skeeto_setting.ini'), e => e.code === 'platform_doc_denied');
  await assert.rejects(manager.doc(gameRoot, 'skeeto', 'Skeeto/README.txt'), e => e.code === 'platform_doc_missing');
  await put(gameRoot, 'Skeeto/README.txt', '<script>text only</script>');
  assert.deepEqual(await manager.doc(gameRoot, 'skeeto', 'Skeeto/README.txt'), { text: '<script>text only</script>' });
  const outside = path.join(base, 'outside'); await fs.mkdir(outside); await put(outside, 'Plugins_插件平台.txt', 'outside');
  await fs.symlink(outside, path.join(gameRoot, 'Skeeto/DIY'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(manager.doc(gameRoot, 'skeeto', 'Skeeto/DIY/Plugins_插件平台.txt'), e => e.code === 'unsafe_path');
});

test('module observation: loaded, absent, inaccessible, and another game installation', async () => {
  const { gameRoot } = await fixture(); await installFixture(gameRoot);
  const game = inspection(gameRoot); game.processes = [{ pid: 17, path: path.join(gameRoot, 'left4dead2.exe') }]; game.platform.status = 'installed';
  let modules = [path.join(gameRoot, 'skeeto.dll'), path.join(gameRoot, 'bin/l4p/l4p_runtime.dll')];
  const manager = new ExternalPlatforms({ getModules: async () => ({ path: game.processes[0].path, modules }) });
  assert.equal((await manager.snapshot(gameRoot, game))[0].runtime.loaded, true);
  assert.match((await manager.snapshot(gameRoot, game))[0].coexist.note, /同时加载/);
  modules = []; assert.equal((await manager.snapshot(gameRoot, game))[0].runtime.loaded, false);
  const denied = new ExternalPlatforms({ getModules: async () => { throw new Error('Access denied'); } });
  assert.equal((await denied.snapshot(gameRoot, game))[0].runtime.loaded, null);
  game.processes[0].path = path.join(gameRoot, 'other/left4dead2.exe');
  assert.equal((await manager.snapshot(gameRoot, game))[0].runtime.loaded, null);
});

test('ZIP-as-VPK is labeled and excluded from Mod writes/conflicts and desktop auto profiles', async () => {
  const { base, gameRoot } = await fixture(), api = createPlatform({ getProcesses: async () => [] });
  const bundle = zip({ 'SKEETO_WORKSHOP.txt': 'SkeetoWorkshopPackage=1\n', 'VERSION.txt': 'Skeeto 2.2.19\nsemver=2.2.19\n', 'materials/shared.vmt': 'payload' });
  await put(gameRoot, 'left4dead2/addons/workshop/3787239937.vpk', bundle);
  await put(gameRoot, 'left4dead2/addons/renamed.vpk', bundle);
  await vpkFixture(path.join(gameRoot, 'left4dead2/addons/normal.vpk'), { 'addoninfo.txt': addonInfo('normal'), 'materials/shared.vmt': 'VPK' });
  const original = '"AddonList"\n{\n"workshop/3787239937.vpk" "1"\n"normal.vpk" "1"\n}\n';
  await put(gameRoot, 'left4dead2/addonlist.txt', original);
  const mods = new ModManager({ inspectGame: api.inspectGame }), inventory = await mods.scan(gameRoot);
  assert.equal(inventory.mods.filter(m => m.kind === 'platform-package').length, 2); assert.equal(inventory.conflicts.length, 0);
  assert.ok(inventory.mods.every(m => !m.error));
  await mods.apply({ gameRoot, enabledIds: ['normal.vpk', 'renamed.vpk'], confirmation: { approved: true, source: 'user' } });
  assert.equal(await fs.readFile(path.join(gameRoot, 'left4dead2/addonlist.txt'), 'utf8'), original);
  await assert.rejects(mods.setEnabled({ gameRoot, modIds: ['renamed.vpk'], enabled: true, confirmation: { approved: true, source: 'user' } }), e => e.code === 'platform_package_readonly');
  const service = new DesktopService({ dataDir: path.join(base, 'settings'), core: { ...api, discover: async () => ({ games: [await api.inspectGame(gameRoot)], warnings: [] }) } });
  try {
    const snapshot = await service.dispatch('snapshot');
    assert.equal(snapshot.platforms[0].update.packageVersion, '2.2.19');
    assert.deepEqual(snapshot.profiles[0].modIds, ['normal.vpk']);
    assert.equal(snapshot.capabilities.platformManagement, false);
    assert.equal((await service.dispatch('test-options')).maps.length, 0);
    await put(gameRoot, 'Skeeto/README.txt', 'Author page');
    assert.deepEqual(await service.dispatch('platform-doc', { id: 'skeeto', path: 'Skeeto/README.txt' }), { text: 'Author page' });
  } finally { await service.close(); }
  const corrupted = await put(base, '3787239937.vpk', 'broken archive');
  const pkg = await detectPlatformPackage(corrupted); assert.equal(pkg.kind, 'platform-package'); assert.ok(pkg.warning);
  const oversize = await put(base, 'oversize.vpk', zip({ 'SKEETO_WORKSHOP.txt': 'x'.repeat(65537) }));
  await assert.rejects(detectPlatformPackage(oversize), e => e.code === 'invalid_platform_package');
});
