import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DllIntake } from '../dll-intake.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { createPlatform } from '../core.mjs';
import { createFixture, manifest, peFixture } from './fixtures.mjs';
import { zipFixture } from './browser-fixtures.mjs';
import { dllHost } from '../pi/dll-host.mjs';
import { platformTools } from '../pi/platform-extension.mjs';

const confirmation = { approved: true, source: 'user' };
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-dll-intake-')), f = await createFixture(base,{l4n:true});
  let running = false;
  const core = createPlatform({ getProcesses: async () => running ? [{ pid: 12, path: path.join(f.gameRoot, 'left4dead2.exe') }] : [] });
  await core.applyInstall(await core.planInstall(f), { confirmation });
  const service = new DesktopService({ dataDir: path.join(base, 'data'), distRoot: f.distRoot,
    core: { ...core, discover: async () => ({ games: [], warnings: [] }) } });
  t.after(() => service.close()); await service.ready; service.settings.gameRoot = f.gameRoot;
  const host = dllHost(service, f.gameRoot), tools = new Map(platformTools(f.gameRoot, { modRequest: host }).map(t => [t.name, t]));
  const run = (name, params, confirm = async () => true) => tools.get(name).execute('fixture', params, new AbortController().signal, undefined,
    { hasUI: true, ui: { confirm } });
  return { ...f, base, core, service, run, setRunning: value => { running = value; } };
}
async function archive(base, files, name = 'package.zip') {
  const file = path.join(base, name); await fs.writeFile(file, zipFixture(files)); return file;
}

test('a complete SDK ZIP imports directly, preserving the author package and disabled default', async t => {
  const f = await fixture(t), m = manifest('test.standard');
  const bytes = zipFixture({ 'AuthorPackage/manifest.json': JSON.stringify(m), 'AuthorPackage/plugin.dll': peFixture(['L4P_GetPluginApi']),
    'AuthorPackage/README.md': '# Original author documentation' });
  const file = path.join(f.base, 'standard.zip'); await fs.writeFile(file, bytes);
  const validated = await f.service.dispatch('validate-plugin', { pluginDirectory: file });
  assert.equal(validated.manifest.id, m.id);
  const plan = await f.service.dispatch('plugin-intake-import-preview', validated);
  await assert.rejects(f.service.dispatch('plugin-intake-import', { planId: plan.planId }), { code: 'confirmation_required' });
  await f.service.dispatch('plugin-intake-import', { planId: plan.planId }, confirmation);
  const installed = (await f.core.listPlugins(f.gameRoot)).find(p => p.manifest.id === m.id);
  assert.equal(installed.enabled, false); assert.deepEqual(installed.manifest, m);
  assert.deepEqual(await fs.readFile(file), bytes);
  const legacyDirectory = path.join(f.distRoot, 'bin/l4p/plugins/demo.hello');
  assert.equal((await f.service.dispatch('validate-plugin', { pluginDirectory: legacyDirectory })).preparedDirectory, legacyDirectory);
});

test('Agent same-ID import updates with explicit versions, preserving settings, enabled state, overlays and the old package', async t => {
  const f = await fixture(t), old = manifest('test.agent-upgrade'), source = {
    type: 'github', url: 'https://github.com/Author/Feature', label: 'Author/Feature', version: 'v0.1.0',
  }, publisher = { type: 'github', repositoryId: '101', ownerId: '7' };
  const first = await f.service.dispatch('plugin-intake-inspect', { file: await archive(f.base, {
    'manifest.json': JSON.stringify(old), 'plugin.dll': peFixture(['L4P_GetPluginApi']), 'README.md': 'Original documentation',
  }, 'old.zip') });
  await f.service.dllIntake.origin(first.intakeId, source, publisher);
  const initial = await f.service.dispatch('plugin-intake-import-preview', first);
  assert.equal(initial.operation, 'install'); assert.equal(initial.previousVersion, null); assert.equal(initial.enabled, false);
  await f.service.dispatch('plugin-intake-import', { planId: initial.planId }, confirmation);
  await f.core.setPluginEnabled({ gameRoot: f.gameRoot, pluginId: old.id, enabled: true, confirmation });
  const destination = path.join(f.runtime, 'plugins', old.id), config = '{"greeting":"我的配置"}\n';
  await fs.writeFile(path.join(destination, 'config.json'), config);
  const data = path.join(f.runtime, 'data', old.id); await fs.mkdir(data, { recursive: true });
  await fs.writeFile(path.join(data, 'settings.ini'), 'keep-game-settings');
  await f.service.dispatch('plugin-overlay-save', { id: old.id, fields: { summary: '我的资料' } });
  const next = { ...old, version: '0.2.0' }, dll = Buffer.concat([peFixture(['L4P_GetPluginApi']), Buffer.from('new binary')]);
  const second = (await f.run('dll_package_inspect', { file: await archive(f.base, {
    'manifest.json': JSON.stringify(next), 'plugin.dll': dll, 'config.json': '{"greeting":"发行默认值"}', 'README.md': 'New documentation',
  }, 'new.zip') })).details;
  await f.service.dllIntake.origin(second.intakeId, { ...source, version: 'v0.2.0' }, publisher);
  const plan = await f.service.dispatch('plugin-intake-import-preview', second);
  assert.equal(plan.operation, 'update'); assert.equal(plan.previousVersion, old.version); assert.equal(plan.version, next.version); assert.equal(plan.enabled, true);
  const marker = await fs.readFile(path.join(destination, '.l4p-package.json'));
  assert.equal((await f.run('dll_package_import', second, async () => false)).details.applied, false);
  assert.deepEqual(await fs.readFile(path.join(destination, '.l4p-package.json')), marker);
  let prompt;
  const result = (await f.run('dll_package_import', second, async (title, text) => { prompt = { title, text }; return true; })).details;
  assert.equal(prompt.title, '更新 DLL 模组'); assert.match(prompt.text, /从 v0\.1\.0 更新到 v0\.2\.0/); assert.match(prompt.text, /保留配置和启停状态（启用）/);
  assert.equal(result.status, 'updated'); assert.equal(result.operation, 'update'); assert.equal(result.enabled, true);
  assert.deepEqual(await fs.readFile(path.join(destination, 'plugin.dll')), dll);
  assert.equal(await fs.readFile(path.join(destination, 'config.json'), 'utf8'), config);
  assert.equal(await fs.readFile(path.join(data, 'settings.ini'), 'utf8'), 'keep-game-settings');
  assert.deepEqual(await fs.readFile(path.join(result.previousDirectory, 'plugin.dll')), peFixture(['L4P_GetPluginApi']));
  assert.equal(await fs.readFile(path.join(result.previousDirectory, 'README.md'), 'utf8'), 'Original documentation');
  const item = (await f.service.snapshot()).plugins.find(p => p.id === old.id);
  assert.equal(item.presentation.summary, '我的资料'); assert.equal(item.source.version, 'v0.2.0'); assert.equal(item.enabled, true);
});

test('Agent update rechecks installed identity and switches after confirmation, including same-version replacements', async t => {
  const f = await fixture(t), m = manifest('test.stale-update');
  const file = await archive(f.base, { 'manifest.json': JSON.stringify(m), 'plugin.dll': peFixture(['L4P_GetPluginApi']) }, 'initial.zip');
  await f.run('dll_package_import', (await f.run('dll_package_inspect', { file })).details);
  const next = await f.service.dispatch('plugin-intake-inspect', { file: await archive(f.base, {
    'manifest.json': JSON.stringify({ ...m, version: '0.2.0' }), 'plugin.dll': peFixture(['L4P_GetPluginApi']),
  }, 'next.zip') });
  await assert.rejects(f.run('dll_package_import', next, async () => {
    await f.core.setPluginEnabled({ gameRoot: f.gameRoot, pluginId: m.id, enabled: true, confirmation }); return true;
  }), { code: 'plugin_update_stale' });
  assert.equal((await f.core.listPlugins(f.gameRoot)).find(p => p.manifest.id === m.id).manifest.version, m.version);
  for (let i = 0; i < 2; i++) await assert.rejects(f.run('dll_package_import', next, async () => {
    await f.core.updatePlugin({ gameRoot: f.gameRoot, pluginDirectory: next.preparedDirectory, confirmation }); return true;
  }), { code: 'plugin_update_stale' });
  assert.equal((await f.core.listPlugins(f.gameRoot)).find(p => p.manifest.id === m.id).manifest.version, '0.2.0');
});

test('missing files produce an Agent handoff; file mappings repair layout without changing author metadata', async t => {
  const f = await fixture(t), m = { ...manifest('test.layout'), presentation: { schema: 1, cover: 'cover.png' } };
  const file = await archive(f.base, { 'manifest.json': JSON.stringify(m), 'bin/feature.dll': peFixture(['L4P_GetPluginApi']), 'media/picture.png': 'author asset' });
  const inspected = await f.service.dispatch('plugin-intake-inspect', { file });
  assert.equal(inspected.outcome, 'needs-agent'); assert.equal(inspected.agent.available, true);
  assert.deepEqual(inspected.issues.filter(i => i.code === 'file_missing').map(i => i.file), ['plugin.dll', 'cover.png']);
  await assert.rejects(f.service.dispatch('validate-plugin', { pluginDirectory: file }), e =>
    e.code === 'plugin_needs_agent' && e.details.issues.some(i => i.file === 'plugin.dll'));
  const prepared = (await f.run('dll_package_prepare', { intakeId: inspected.intakeId, mode: 'sdk', mappings: [
    { source: 'manifest.json', target: 'manifest.json' }, { source: 'bin/feature.dll', target: 'plugin.dll' }, { source: 'media/picture.png', target: 'cover.png' },
  ] })).details;
  assert.deepEqual(prepared.manifest, m);
  await f.run('dll_package_import', prepared);
  assert.equal((await f.core.listPlugins(f.gameRoot)).find(p => p.manifest.id === m.id).enabled, false);
});

test('external DLL bundles go through Agent preparation, approval and stale-candidate checks', async t => {
  const f = await fixture(t), file = await archive(f.base, { 'external.dll': peFixture([]), 'helper.dll': peFixture([]), 'config/settings.ini': 'keep', 'README.md': 'author docs' });
  const inspected = (await f.run('dll_package_inspect', { file })).details;
  assert.equal(inspected.outcome, 'needs-agent'); assert.equal(inspected.dlls[0].host, 'library');
  const prepared = (await f.run('dll_package_prepare', { intakeId: inspected.intakeId, mode: 'library', name: 'Author feature', summary: 'From author docs', mappings: [
    { source: 'external.dll', target: 'plugin.dll' }, { source: 'helper.dll', target: 'helper.dll' }, { source: 'config/settings.ini', target: 'config/settings.ini' }, { source: 'README.md', target: 'README.md' },
  ] })).details;
  assert.equal(prepared.manifest.loadKind, 'library');
  assert.equal((await f.run('dll_package_import', prepared, async () => false)).details.applied, false);
  assert.equal((await f.core.listPlugins(f.gameRoot)).some(p => p.manifest.id === prepared.manifest.id), false);
  f.setRunning(true);
  await assert.rejects(f.run('dll_package_import', prepared), { code: 'game_running' });
  f.setRunning(false);
  await f.run('dll_package_import', prepared);
  const installed = path.join(f.runtime, 'plugins', prepared.manifest.id);
  assert.equal(await fs.readFile(path.join(installed, 'config/settings.ini'), 'utf8'), 'keep');
  assert.deepEqual(await fs.readFile(path.join(installed, 'helper.dll')), peFixture([]));
  assert.equal((await f.core.listPlugins(f.gameRoot)).find(p => p.manifest.id === prepared.manifest.id).enabled, false);
  await fs.appendFile(path.join(prepared.preparedDirectory, 'plugin.dll'), 'changed');
  await assert.rejects(f.run('dll_package_import', prepared), { code: 'intake_stale' });
});

test('bare L4N DLLs require Agent intake and retain their native filename and host', async t => {
  const f = await fixture(t), file = path.join(f.base, 'L4nFeature.dll');
  await fs.writeFile(file, peFixture(['GetL4NPluginInstance']));
  await assert.rejects(f.service.dispatch('validate-plugin', { pluginDirectory: file }), { code: 'plugin_needs_agent' });
  const inspected = (await f.run('dll_package_inspect', { file })).details;
  assert.equal(inspected.dlls[0].host, 'l4n');
  const prepared = (await f.run('dll_package_prepare', { intakeId: inspected.intakeId, mode: 'l4n', mappings: [{ source: 'L4nFeature.dll', target: 'L4nFeature.dll' }] })).details;
  await f.run('dll_package_import', prepared);
  const p = (await f.service.dispatch('l4n-plugins-list')).plugins[0];
  assert.equal(p.file, 'L4nFeature.dll'); assert.equal(p.enabled, false);
  await f.service.dispatch('plugin-overlay-save', { id: p.id, fields: { name: '我的 L4N 功能' } });
  const inventory = (await f.run('dll_inventory', {})).details;
  assert.equal(inventory.l4nPlugins.plugins[0].name, '我的 L4N 功能');
  const focused = (await f.run('dll_inventory', { id: p.id })).details;
  assert.equal(focused.plugins.length, 0); assert.equal(focused.l4nPlugins.plugins.length, 1);
  assert.equal(focused.l4nPlugins.plugins[0].provenance.fields.name, 'user');
  assert.equal(focused.l4nPlugins.plugins[0].loadStatus.nextLaunchEnabled, false);
  assert.deepEqual(await fs.readFile(file), peFixture(['GetL4NPluginInstance']));
});

test('ordinary DLL updates bind the installed ID, preserve user state and show source versions', async t => {
  const f = await fixture(t), source = { type: 'github', url: 'https://github.com/Author/Raw', version: 'v1.0.0' };
  const publisher = { type: 'github', repositoryId: '123', ownerId: '7' };
  const initial = (await f.run('dll_package_inspect', { file: await archive(f.base, { 'raw.dll': peFixture([]) }, 'raw-old.zip') })).details;
  const input = { intakeId: initial.intakeId, mode: 'library', name: 'Author raw', summary: 'Author description', mappings: [{ source: 'raw.dll', target: 'plugin.dll' }] };
  const first = (await f.run('dll_package_prepare', input)).details;
  const repeated = (await f.run('dll_package_prepare', input)).details;
  assert.equal(repeated.manifest.id, first.manifest.id); assert.notEqual(repeated.candidateId, first.candidateId);
  await f.service.dllIntake.origin(initial.intakeId, source, publisher);
  await f.run('dll_package_import', repeated);
  const id = repeated.manifest.id, destination = path.join(f.runtime, 'plugins', id);
  await f.core.setPluginEnabled({ gameRoot: f.gameRoot, pluginId: id, enabled: true, confirmation });
  await fs.writeFile(path.join(destination, 'config.json'), '{}\n');
  const data = path.join(f.runtime, 'data', id); await fs.mkdir(data, { recursive: true });
  await fs.writeFile(path.join(data, 'settings.ini'), 'my-settings');
  await f.service.dispatch('plugin-overlay-save', { id, fields: { name: '我的名称', summary: '我的介绍' } });
  const dll = Buffer.concat([peFixture([]), Buffer.from('new library')]);
  const next = (await f.run('dll_package_inspect', { file: await archive(f.base, { 'new.dll': dll }, 'raw-next.zip') })).details;
  await f.service.dllIntake.origin(next.intakeId, { ...source, version: 'v1.1.0' }, publisher);
  const candidate = (await f.run('dll_package_prepare', { intakeId: next.intakeId, mode: 'library', updatePluginId: id,
    mappings: [{ source: 'new.dll', target: 'plugin.dll' }] })).details;
  assert.equal(candidate.updatePluginId, id); assert.equal(candidate.manifest.id, id); assert.equal(candidate.manifest.version, '0.0.0');
  assert.equal((await f.run('dll_package_import', candidate, async () => false)).details.applied, false);
  assert.deepEqual(await fs.readFile(path.join(destination, 'plugin.dll')), peFixture([]));
  let prompt;
  const updated = (await f.run('dll_package_import', candidate, async (title, text) => { prompt = { title, text }; return true; })).details;
  assert.equal(prompt.title, '更新 DLL 模组'); assert.ok(prompt.text.includes(id)); assert.match(prompt.text, /v1\.0\.0 → v1\.1\.0/);
  assert.equal(updated.id, id); assert.equal(updated.operation, 'update'); assert.equal(updated.enabled, true);
  assert.deepEqual(await fs.readFile(path.join(destination, 'plugin.dll')), dll);
  assert.equal(await fs.readFile(path.join(destination, 'config.json'), 'utf8'), '{}\n');
  assert.equal(await fs.readFile(path.join(data, 'settings.ini'), 'utf8'), 'my-settings');
  assert.deepEqual(await fs.readFile(path.join(updated.previousDirectory, 'plugin.dll')), peFixture([]));
  const inventory = (await f.run('dll_inventory', {})).details;
  assert.equal(inventory.plugins.length, 1); assert.equal(inventory.plugins[0].id, id);
  assert.equal(inventory.plugins[0].name, '我的名称'); assert.equal(inventory.plugins[0].presentation.summary, '我的介绍');
  assert.equal(inventory.plugins[0].source.version, 'v1.1.0'); assert.deepEqual(inventory.plugins[0].publisher, publisher);
  // An author-supplied declaration takes ownership of its fields on the next same-ID update.
  await f.service.dispatch('plugin-overlay-save', { id, fields: { name: '', summary: '' } });
  const authored = { ...repeated.manifest, version: '1.2.0' }; delete authored.intake;
  const authorPackage = (await f.run('dll_package_inspect', { file: await archive(f.base,
    { 'manifest.json': JSON.stringify(authored), 'plugin.dll': dll }, 'raw-author.zip') })).details;
  const authorCandidate = (await f.run('dll_package_prepare', { intakeId: authorPackage.intakeId, mode: 'library', updatePluginId: id,
    mappings: [{ source: 'manifest.json', target: 'manifest.json' }, { source: 'plugin.dll', target: 'plugin.dll' }] })).details;
  await f.run('dll_package_import', authorCandidate);
  const authorItem = (await f.run('dll_inventory', { id })).details.plugins[0];
  assert.equal(authorItem.provenance.fields.name, 'developer'); assert.equal(authorItem.provenance.fields.summary, 'developer');
  await assert.rejects(f.run('dll_overlay_write', { id, fields: { name: 'replacement' }, basis: 'fixture' }), { code: 'developer_field_locked' });
});

test('ordinary DLL update binding rejects wrong hosts, author IDs, changed targets and game directories', async t => {
  const f = await fixture(t), file = path.join(f.base, 'raw.dll'); await fs.writeFile(file, peFixture([]));
  const raw = (await f.run('dll_package_inspect', { file })).details;
  const prepare = { intakeId: raw.intakeId, mode: 'library', name: 'Raw', summary: 'Author docs', mappings: [{ source: 'raw.dll', target: 'plugin.dll' }] };
  await assert.rejects(f.run('dll_package_prepare', { ...prepare, updatePluginId: 'demo.hello' }), { code: 'dll_update_target_invalid' });
  await assert.rejects(f.run('dll_package_prepare', { ...prepare, updatePluginId: 'local.missing' }), { code: 'plugin_missing' });
  const first = (await f.run('dll_package_prepare', prepare)).details; await f.run('dll_package_import', first);
  const id = first.manifest.id, next = (await f.run('dll_package_inspect', { file })).details;
  const update = { ...prepare, intakeId: next.intakeId, updatePluginId: id };
  const candidate = (await f.run('dll_package_prepare', update)).details;
  const m = { ...manifest('author.other'), loadKind: 'library', config: [], actions: [] };
  const other = (await f.run('dll_package_inspect', { file: await archive(f.base, { 'manifest.json': JSON.stringify(m), 'plugin.dll': peFixture([]) }) })).details;
  await assert.rejects(f.run('dll_package_prepare', { intakeId: other.intakeId, mode: 'library', updatePluginId: id,
    mappings: [{ source: 'plugin.dll', target: 'plugin.dll' }] }), { code: 'dll_update_manifest_required' });
  await assert.rejects(f.run('dll_package_prepare', { intakeId: other.intakeId, mode: 'library', updatePluginId: id,
    mappings: [{ source: 'manifest.json', target: 'manifest.json' }, { source: 'plugin.dll', target: 'plugin.dll' }] }), { code: 'dll_update_target_invalid' });
  await f.core.updatePlugin({ gameRoot: f.gameRoot, pluginDirectory: first.preparedDirectory, confirmation });
  await assert.rejects(f.run('dll_package_import', candidate), { code: 'plugin_update_stale' });
  const refreshed = (await f.run('dll_package_prepare', update)).details;
  f.service.settings.gameRoot = path.join(f.base, 'other-game');
  await assert.rejects(f.run('dll_package_import', refreshed), { code: 'context_changed' });
  f.service.settings.gameRoot = f.gameRoot;
  f.service.core.listPlugins = async () => [];
  await assert.rejects(f.run('dll_package_import', refreshed), { code: 'dll_update_target_invalid' });
});

test('unsafe ZIP paths, case-fold duplicates and corrupt content stop before import', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-dll-zip-')), intake = new DllIntake({ dataDir: path.join(base, 'data') });
  const traversal = await archive(base, { '../escape.dll': 'untrusted' }, 'traversal.zip');
  assert.equal((await intake.inspect(traversal)).outcome, 'rejected');
  await assert.rejects(fs.access(path.join(base, 'escape.dll')), { code: 'ENOENT' });
  const duplicates = await archive(base, { 'A.dll': 'one', 'a.dll': 'two' }, 'duplicates.zip');
  assert.equal((await intake.inspect(duplicates)).issues[0].code, 'archive_duplicate');
  const corrupt = path.join(base, 'corrupt.zip'), bytes = zipFixture({ 'bad.dll': 'original payload' });
  bytes[30 + Buffer.byteLength('bad.dll')] ^= 1; await fs.writeFile(corrupt, bytes);
  assert.equal((await intake.inspect(corrupt)).issues[0].code, 'archive_corrupt');
});

test('Agent preparation preserves signed-release requirements and SDK identity', async t => {
  const f = await fixture(t), m = manifest('test.signed');
  const file = await archive(f.base, { 'manifest.json': JSON.stringify(m), 'plugin.dll': peFixture(['L4P_GetPluginApi']), 'release.json': '{}', 'release.p7s': 'fixture only' });
  const inspected = (await f.run('dll_package_inspect', { file })).details;
  assert.equal(inspected.outcome, 'rejected');
  assert.equal(inspected.screening.tier,'blocked');
  assert.ok(inspected.screening.findings.some(f=>f.category==='signature' && f.severity==='block'));
  await assert.rejects(f.run('dll_package_prepare', { intakeId: inspected.intakeId, mode: 'library', name: 'Changed', summary: 'Changed', mappings: [{ source: 'plugin.dll', target: 'plugin.dll' }] }), { code: 'release_rejected' });
});
