import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFixture, peFixture } from './fixtures.mjs';
import { zip } from './platforms-fixtures.mjs';
import { ExternalPlatforms } from '../platforms/manager.mjs';
import { PlatformLifecycle } from '../platforms/lifecycle.mjs';
import { digest, inspectPackage } from '../platforms/releases.mjs';
import { patchSettings, modulePolicy } from '../platforms/settings.mjs';
import { assertPlatformLaunch } from '../platforms/launch.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { createPlatform } from '../core.mjs';
import { environmentPlan } from '../quick-test/environment.mjs';
import { withZip, detectPlatformPackage } from '../platforms/packages.mjs';

const approval = { approved: true, source: 'user' };
const context = () => ({ signal: new AbortController().signal, progress() {}, commit: fn => fn() });
async function put(root, name, data) { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); return file; }
function releasePackage(version = '2.2.19', manual = false) {
  const core = peFixture(['SkeetoBootstrapQuery', 'necola_export']); core.write(`SkeetoInstalledSemver=${version}\0`, 3000);
  const tool = Buffer.from('fixture script: must never run');
  const files = { 'skeeto.dll': core, 'bin/wininet.dll': peFixture(['SkeetoWininetProxyIdentity']),
    'Skeeto/Maintain.ps1': tool, 'VERSION.txt': Buffer.from(`Skeeto ${version}\nsemver=${version}\n`),
    'SKEETO_WORKSHOP.txt': Buffer.from(`SkeetoWorkshopPackage=1\ninstall_layout=2\nupdate_protocol=1\nengine_sha256=${digest(tool)}\n`),
    'Skeeto/README.txt': Buffer.from('<script>author text</script>'), 'Skeeto_更新日志.txt': Buffer.from(`version ${version}`) };
  const manifest = { schema: 1, product: 'Skeeto', install_layout: 2, update_protocol: 1, semver: version, requires_manual_migrate: manual,
    files: Object.entries(files).map(([relative, data]) => ({ relative, role: relative === 'skeeto.dll' ? 'core' : relative.endsWith('.dll') ? 'proxy' : relative.endsWith('.ps1') ? 'tool' : relative.startsWith('Skeeto') ? 'document' : 'marker', hash: digest(data) })) };
  return { manifest, files, bytes: zip({ ...files, 'Skeeto/Manifest.json': JSON.stringify(manifest) }) };
}
async function fixture(options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-platform-lifecycle-')), f = await createFixture(base);
  let running = [];
  const api = createPlatform({ getProcesses: async () => running }), manager = new ExternalPlatforms();
  // Reconstruct a pre-retirement installation so cleanup/recovery coverage remains usable.
  // Production source-ports gates are covered in dll-collections.test.mjs.
  const originalAdapter = manager.adapter.bind(manager);
  manager.adapter = id => ({ ...originalAdapter(id), distribution: undefined });
  const dataDir = path.join(base, 'data'), lifecycle = new PlatformLifecycle({ dataDir, readOnly: manager, inspectGame: api.inspectGame, ...options });
  manager.managed = lifecycle;
  const cache = async (version = '2.2.19', manual = false) => {
    const pkg = releasePackage(version, manual), folder = lifecycle.release('skeeto').folder(version);
    await put(folder, 'package.zip', pkg.bytes); await put(folder, 'release.json', JSON.stringify({ id: 'skeeto', version })); return pkg;
  };
  const preview = (op, params = {}) => lifecycle.preview(f.gameRoot, 'skeeto', op, params);
  const apply = async (op, params = {}) => { const p = await preview(op, params); return lifecycle.execute(f.gameRoot, 'skeeto', op, p.planId, params, approval); };
  return { ...f, base, dataDir, lifecycle, manager, api, cache, preview, apply, setRunning: value => running = value };
}
async function inventory(root, prefix = '') {
  const files = {};
  for (const e of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix + e.name;
    if (e.isDirectory()) Object.assign(files, await inventory(root, name + '/'));
    else if (name !== 'skeeto_setting.ini') files[name] = await fs.readFile(path.join(root, name));
  }
  return files;
}

test('managed lifecycle: preview, install, cache docs, restore foreign proxy, update disabled, uninstall round trip', async () => {
  const f = await fixture(); const pkg = await f.cache();
  const foreign = peFixture(['OtherProxy']);
  await put(f.gameRoot, 'bin/wininet.dll', foreign); await put(f.gameRoot, 'Skeeto_更新日志.txt', 'original log');
  await put(f.gameRoot, 'skeeto_setting.ini', '; 用户设置\r\nworkshop_update=1\r\nclient_hold_semiauto_aac=1\r\ncustom_value=42\r\n');
  const before = await inventory(f.gameRoot);
  const plan = await f.preview('install', { version: '2.2.19' });
  assert.ok(plan.warnings.some(s => s.includes('已有代理'))); assert.equal(plan.files.at(-1).path, 'bin/wininet.dll');
  await assert.rejects(f.lifecycle.execute(f.gameRoot, 'skeeto', 'install', plan.planId, { version: '2.2.19' }), { code: 'confirmation_required' });
  assert.deepEqual(await inventory(f.gameRoot), before);
  await f.lifecycle.execute(f.gameRoot, 'skeeto', 'install', plan.planId, { version: '2.2.19' }, approval);
  assert.deepEqual(await fs.readFile(path.join(f.gameRoot, 'skeeto.dll')), pkg.files['skeeto.dll']);
  assert.equal(await fs.access(path.join(f.gameRoot, 'Skeeto/Maintain.ps1')).then(() => true, () => false), false);
  let snapshot = (await f.manager.snapshot(f.gameRoot, await f.api.inspectGame(f.gameRoot)))[0];
  assert.equal(snapshot.state, 'enabled'); assert.equal(snapshot.integrity.state, 'match'); assert.equal(snapshot.update.channel, 'flare');
  assert.equal(snapshot.update.selfUpdate, false); assert.equal(snapshot.verification.state, 'unverified');
  assert.equal((await f.manager.doc(f.gameRoot, 'skeeto', 'Skeeto/README.txt')).text, '<script>author text</script>');
  await f.apply('set-enabled', { enabled: false });
  assert.deepEqual(await fs.readFile(path.join(f.gameRoot, 'bin/wininet.dll')), foreign);
  snapshot = (await f.manager.snapshot(f.gameRoot, await f.api.inspectGame(f.gameRoot)))[0];
  assert.equal(snapshot.state, 'disabled'); assert.equal(snapshot.integrity.state, 'match');
  await f.apply('set-enabled', { enabled: true });
  await f.cache('2.2.20'); await f.apply('install', { version: '2.2.20' });
  assert.equal((await f.lifecycle.find(f.gameRoot, 'skeeto')).enabled, false);
  await assert.rejects(f.preview('set-enabled', { enabled: true }), { code: 'platform_policy_version' });
  await f.apply('uninstall');
  assert.deepEqual(await inventory(f.gameRoot), before);
  const settings = await fs.readFile(path.join(f.gameRoot, 'skeeto_setting.ini'), 'utf8');
  assert.match(settings, /custom_value=42/); assert.match(settings, /workshop_update=0/); assert.match(settings, /; 用户设置\r\n/);
  assert.equal(await f.lifecycle.find(f.gameRoot, 'skeeto'), null);
});

test('existing identical Skeeto is backed up, disabled, enabled and restored on uninstall', async () => {
  const f = await fixture(), pkg = await f.cache();
  await put(f.gameRoot, 'skeeto.dll', pkg.files['skeeto.dll']); await put(f.gameRoot, 'bin/wininet.dll', pkg.files['bin/wininet.dll']);
  const before = await inventory(f.gameRoot);
  await f.apply('install', { version: '2.2.19' }); await f.apply('set-enabled', { enabled: false });
  await assert.rejects(fs.stat(path.join(f.gameRoot, 'bin/wininet.dll')), { code: 'ENOENT' });
  await f.apply('set-enabled', { enabled: true }); await f.apply('uninstall');
  assert.deepEqual(await inventory(f.gameRoot), before);
});

test('stale plan, running game, manual migration and external edits preserve files', async () => {
  const f = await fixture(); await f.cache(); const params = { version: '2.2.19' };
  let p = await f.preview('install', params); await put(f.gameRoot, 'skeeto_setting.ini', 'my_setting=9\n');
  await assert.rejects(f.lifecycle.execute(f.gameRoot, 'skeeto', 'install', p.planId, params, approval), { code: 'platform_plan_stale' });
  f.setRunning([{ pid: 123 }]); await assert.rejects(f.preview('install', params), { code: 'game_running' }); f.setRunning([]);
  await f.cache('2.2.19', true); p = await f.preview('install', params); assert.equal(p.requiresManualMigrate, true);
  await assert.rejects(f.lifecycle.execute(f.gameRoot, 'skeeto', 'install', p.planId, params, approval), { code: 'platform_manual_migrate' });
  await f.cache(); await f.apply('install', params); await put(f.gameRoot, 'skeeto.dll', 'external edit');
  await assert.rejects(f.preview('uninstall'), { code: 'platform_external_change' });
  assert.equal(await fs.readFile(path.join(f.gameRoot, 'skeeto.dll'), 'utf8'), 'external edit');
});

test('failure rolls back, interrupted recovery survives restart with a new confirmed plan', async () => {
  let failWrite = true;
  const f = await fixture({ beforeWrite: async i => { if (i === 1 && failWrite) throw new Error('injected write failure'); } });
  await f.cache(); const before = await inventory(f.gameRoot);
  await assert.rejects(f.apply('install', { version: '2.2.19' }), /injected/);
  assert.deepEqual(await inventory(f.gameRoot), before);
  // Simulate a process starting between file writes: rollback must wait for it to exit.
  f.lifecycle.store.beforeWrite = async i => { if (i === 1) { f.setRunning([{ pid: 321 }]); throw new Error('game started'); } };
  await assert.rejects(f.apply('install', { version: '2.2.19' }), { code: 'platform_recovery_required' });
  assert.equal((await f.lifecycle.find(f.gameRoot, 'skeeto')).pending, true); f.setRunning([]);
  const resumed = new PlatformLifecycle({ dataDir: f.dataDir, readOnly: f.manager, inspectGame: f.api.inspectGame });
  const p = await resumed.preview(f.gameRoot, 'skeeto', 'recover');
  assert.ok(p.recovery.files.length);
  await resumed.execute(f.gameRoot, 'skeeto', 'recover', p.planId, {}, approval);
  assert.deepEqual(await inventory(f.gameRoot), before);
  assert.equal(await resumed.find(f.gameRoot, 'skeeto'), null);
});

test('download verifies official URL and every hashed file, and never runs tools', async () => {
  const pkg = releasePackage(), calls = [], progress = [];
  const meta = { tag_name: 'v2.2.19', published_at: '2026-11-15T05:06:41Z', body: 'notes', assets: [{ id: 123, name: 'Skeeto_2.2.19.zip', size: pkg.bytes.length, browser_download_url: 'https://github.com/regoists/Skeeto/releases/download/v2.2.19/Skeeto_2.2.19.zip' }] };
  const f = await fixture({ fetch: async url => { calls.push(url); return url.includes('/releases/assets/') ? new Response(pkg.bytes) : Response.json(meta); } });
  const release = f.lifecycle.release('skeeto');
  await f.lifecycle.checkUpdate(f.gameRoot, 'skeeto'); assert.equal(calls.length, 1);
  await release.download('2.2.19', { ...context(), progress: x => progress.push(x) });
  assert.equal((await release.cached('2.2.19')).manifest.semver, '2.2.19'); assert.ok(progress.some(x => x.done === pkg.bytes.length));
  assert.equal(await fs.access(path.join(f.gameRoot, 'skeeto.dll')).then(() => true, () => false), false);
  const bad = { ...pkg.files, 'skeeto.dll': Buffer.from('changed'), 'Skeeto/Manifest.json': JSON.stringify(pkg.manifest) };
  await assert.rejects(inspectPackage(await put(f.base, 'bad.zip', zip(bad)), f.manager.adapter('skeeto')), { code: 'platform_hash_mismatch' });
  const g = await fixture({ fetch: async url => !url.includes('/releases/assets/') ? Response.json(meta) : new Response(null, { status: 302, headers: { location: 'https://unrelated.example/payload' } }) });
  await assert.rejects(g.lifecycle.release('skeeto').download('2.2.19', context()), { code: 'platform_download_origin' });
  await assert.rejects(inspectPackage(await put(f.base, 'unsafe.zip', zip({ '../escape': 'x', 'Skeeto/Manifest.json': '{}' })), f.manager.adapter('skeeto')), { code: 'unsafe_path' });
  const legacy = zip({ '中文.txt': 'legacy name', 'SKEETO_WORKSHOP.txt': 'SkeetoWorkshopPackage=1\n' }, {
    flags: 0, encodeName: name => name === '中文.txt' ? Buffer.concat([Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('.txt')]) : Buffer.from(name),
  });
  const legacyFile = await put(f.base, 'legacy.vpk', legacy);
  assert.equal(await withZip(legacyFile, async z => (await z.read('中文.txt')).toString(), { legacyEncoding: 'gb18030' }), 'legacy name');
  assert.equal((await detectPlatformPackage(legacyFile)).kind, 'platform-package');
});

test('module settings preserve bytes, duplicate keys and numeric off values; all selected restrictions map', async () => {
  const a = new ExternalPlatforms().adapter('skeeto'), policy = modulePolicy(a, { remote: true, modeId: 'scavenge', managed: true });
  assert.deepEqual(policy.unresolved, []); assert.equal(policy.changes.local_lerp, -1); assert.equal(policy.changes.local_aa, 10);
  assert.equal(policy.changes.supply_radar_enabled, 0); assert.equal(policy.changes.escmenu_cvar_remember, 0);
  assert.ok(!policy.modules.some(m => a.modules.find(x => x.id === m.id)?.online === 'review'));
  const old = Buffer.concat([Buffer.from('; GBK:'), Buffer.from([0xd6, 0xd0]), Buffer.from('\r\nclient_hold_semiauto_aac=1\r\nclient_hold_semiauto_aac=1\r\nkeep=7\r\n')]);
  const patched = patchSettings(old, policy.changes);
  assert.ok(patched.subarray(0, 9).equals(old.subarray(0, 9))); assert.match(patched.toString('latin1'), /keep=7\r\n/);
  assert.equal((patched.toString().match(/client_hold_semiauto_aac=0/g) ?? []).length, 2);
  assert.deepEqual(patchSettings(patched, policy.changes), patched);
  assert.equal(patchSettings(Buffer.from('CLIENT_HOLD_SEMIAUTO_AAC=0\nclient_hold_semiauto_aac=1\n'), { client_hold_semiauto_aac: 0 }).toString(), 'client_hold_semiauto_aac=0\nclient_hold_semiauto_aac=0\n');
  assert.equal(modulePolicy(a, { remote: true, modeId: 'custom-mutation' }).unknownMode, true);
  assert.throws(() => patchSettings(Buffer.from([0xff, 0xfe]), policy.changes), { code: 'platform_settings_encoding' });
});

async function finished(service, taskId) {
  // Wait for the task's event; no polling and no game execution in these fixtures.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { service.off('event', check); reject(new Error('task timeout')); }, 10000);
    function check(e) { if (e.taskId === taskId && ['done', 'failed', 'canceled'].includes(e.state)) { clearTimeout(timer); service.off('event', check); resolve(e); } }
    service.on('event', check); check(service.tasks.view(service.tasks.get(taskId)));
  });
}
test('desktop tasks and A2S-bound launch preview prevent stale launches before applying Mod profiles', async t => {
  const f = await fixture(); await f.cache();
  const launches = [], events = []; let profiles = 0, modeId = 'versus';
  const api = { ...f.api, discover: async () => ({ games: [await f.api.inspectGame(f.gameRoot)], warnings: [] }), launch: async p => {
    await assertPlatformLaunch({ gameRoot: p.gameRoot, connect: p.connect, modeId: p.serverModeId, dataDir: p.platformDataDir, inspectGame: f.api.inspectGame });
    launches.push(p); return { status: 'requested', pid: 999 };
  } };
  const service = new DesktopService({ core: api, dataDir: f.dataDir }); t.after(() => service.close()); service.on('event', e => events.push(e));
  service.externalPlatforms.adapter = f.manager.adapter;
  await service.ready;
  let p = await service.dispatch('platform-preview-install', { id: 'skeeto', version: '2.2.19' });
  const installed = await finished(service, (await service.dispatch('platform-install', { id: 'skeeto', planId: p.planId }, approval)).taskId);
  assert.equal(installed.state, 'done', installed.error?.message);
  service.serverManager.connectTarget = async () => '203.0.113.8:27015'; service.serverManager.list = async () => [{ id: 'test', modeId }];
  service.applyModProfile = async () => { profiles++; };
  p = await service.dispatch('platform-preview-launch', { serverId: 'test' });
  assert.ok(p.modules.some(m => m.id === 'hud-intel')); modeId = 'coop';
  let result = await finished(service, (await service.dispatch('connect-server', { id: 'test', platformPlanId: p.planId }, approval)).taskId);
  assert.equal(result.state, 'failed'); assert.equal(profiles, 0); assert.equal(launches.length, 0);
  await assert.rejects(service.dispatch('task-retry', { taskId: result.taskId }, approval), { code: 'platform_plan_required' });
  modeId = 'scavenge'; p = await service.dispatch('platform-preview-launch', { serverId: 'test' });
  result = await finished(service, (await service.dispatch('connect-server', { id: 'test', platformPlanId: p.planId }, approval)).taskId);
  assert.equal(result.state, 'done', result.error?.message); assert.equal(profiles, 1); assert.equal(launches.length, 1);
  assert.ok(events.some(e => e.type === 'objects_changed'));
  await put(f.gameRoot, 'skeeto_setting.ini', 'client_hold_semiauto_aac=1\n');
  await assert.rejects(assertPlatformLaunch({ gameRoot: f.gameRoot, dataDir: f.dataDir, inspectGame: f.api.inspectGame }), { code: 'platform_launch_preview_required' });
  await put(f.gameRoot, 'left4dead2/cfg/config_default.cfg', '// fixture');
  assert.ok(!(await environmentPlan(f.gameRoot, [])).files.some(f => /wininet/i.test(f.target)));
});
