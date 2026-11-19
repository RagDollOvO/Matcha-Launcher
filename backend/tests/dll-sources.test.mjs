import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createPlatform } from '../core.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { dllHost } from '../pi/dll-host.mjs';
import { platformTools } from '../pi/platform-extension.mjs';
import { createFixture, manifest, peFixture } from './fixtures.mjs';
import { zipFixture } from './browser-fixtures.mjs';
import { DLL_SKILL, readSkill } from '../pi/skill-files.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;','binary');
const approved = { approved: true, source: 'user' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-dll-source-')), f = await createFixture(base,{l4n:true});
  const m = { ...manifest('author.feature'), author: 'Original Author', presentation: { schema: 1, summary: 'Author summary',
    cover: 'images/cover.png', hero: { image: 'images/cover.png' }, page: [{ type: 'text', text: 'Author custom page' },
      { type: 'gallery', items: ['images/detail.gif'] }] } };
  const archive = zipFixture({ 'manifest.json': JSON.stringify(m), 'plugin.dll': peFixture(['L4P_GetPluginApi']),
    'images/cover.png': png, 'images/detail.gif': gif, 'README.md': '# Original package README' });
  // This checksum is the simulated publisher's transfer-integrity requirement.
  const digest = 'sha256:' + createHash('sha256').update(archive).digest('hex');
  const state = { version: 'v1.0.0', creator: '76561190000000001', stamp: 1794800000, corrupt: false, badRedirect: false, requests: [] };
  const fetch = async (input, options = {}) => {
    const url = String(input); state.requests.push({ url, method: options.method ?? 'GET' });
    if (url === 'https://api.github.com/repos/Author/Pack') return json({ id: 101, full_name: 'Author/Pack', description: 'Author project', owner: { id: 7, login: 'Author' }, default_branch: 'main', html_url: 'https://github.com/Author/Pack' });
    if (url === 'https://api.github.com/repos/Author/Pack/releases/latest') return json({ tag_name: state.version, html_url: `https://github.com/Author/Pack/releases/tag/${state.version}`,
      published_at: '2026-11-15T00:00:00Z', body: 'Author release notes', assets: [{ id: 11, state: 'uploaded', name: 'feature.zip', size: archive.length,
        digest, browser_download_url: 'https://github.com/Author/Pack/releases/download/v1.0.0/feature.zip' },
      { id: 12, state: 'uploaded', name: 'cover.png', size: png.length, browser_download_url: 'https://github.com/Author/Pack/releases/download/v1.0.0/cover.png' }] });
    if (url === 'https://api.github.com/repos/Author/Pack/readme') return json({ path: 'README.md', encoding: 'base64', content: Buffer.from('# Readme\n![Cover](./cover.png)').toString('base64'),
      html_url: 'https://github.com/Author/Pack/blob/main/README.md', download_url: 'https://raw.githubusercontent.com/Author/Pack/main/README.md' });
    if (url === 'https://api.github.com/repos/Author/Pack/releases/assets/11') return new Response(null, { status: 302, headers: {
      location: state.badRedirect ? 'http://127.0.0.1/private.zip' : 'https://release-assets.githubusercontent.com/fixture/feature.zip' } });
    if (url === 'https://release-assets.githubusercontent.com/fixture/feature.zip') {
      const data = Buffer.from(archive); if (state.corrupt) data[data.length - 1] ^= 1;
      return new Response(data, { headers: { 'content-length': String(data.length) } });
    }
    if (url === 'https://api.github.com/repos/Author/Pack/releases/assets/12') return new Response(png, { headers: { 'content-length': String(png.length) } });
    if (url === 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/') return json({ response: { publishedfiledetails: [{
      publishedfileid: '3558049615', result: 1, consumer_app_id: 550, file_type: 0, creator: state.creator, time_updated: state.stamp,
      title: 'Workshop feature', description: '[b]Author workshop description[/b]', filename: 'feature.zip', file_size: String(archive.length),
      file_url: 'https://cdn.steamusercontent.com/fixture/feature.zip', preview_url: 'https://images.steamusercontent.com/fixture/cover.png',
    }] } });
    if (url === 'https://cdn.steamusercontent.com/fixture/feature.zip') return new Response(archive, { headers: { 'content-length': String(archive.length) } });
    if (url === 'https://images.steamusercontent.com/fixture/cover.png') return new Response(png);
    throw new Error(`Unexpected public-data request: ${url}`);
  };
  const core = createPlatform({ getProcesses: async () => [] }); await core.applyInstall(await core.planInstall(f), { confirmation: approved });
  const service = new DesktopService({ dataDir: path.join(base, 'data'), core: { ...core, discover: async () => ({ games: [], warnings: [] }) },
    distRoot: f.distRoot, workshopFetch: fetch, dllSourceFetch: fetch });
  t.after(() => service.close()); await service.ready; service.settings.gameRoot = f.gameRoot;
  const host = dllHost(service, f.gameRoot), tools = new Map(platformTools(f.gameRoot, { modRequest: host }).map(t => [t.name, t]));
  const run = (tool, params, confirm = async () => true) => tools.get(tool).execute('fixture', params, new AbortController().signal, undefined,
    { hasUI: true, ui: { confirm } });
  const install = async () => {
    const source = (await run('dll_source_fetch', { type: 'github', url: 'https://github.com/Author/Pack' })).details;
    const downloaded = (await run('dll_source_fetch', { sourceId: source.sourceId, assetId: '11' })).details;
    await run('dll_package_import', downloaded.intake); return { source, downloaded };
  };
  return { ...f, base, m, archive, state, service, run, install };
}

test('GitHub metadata is cached; download is separately confirmed and reaches the existing intake', async t => {
  const f = await fixture(t), params = { type: 'github', url: 'https://github.com/Author/Pack' };
  const first = (await f.run('dll_source_fetch', params)).details;
  assert.match(first.readme.text, /Readme/); assert.equal(first.assets[0].name, 'feature.zip');
  assert.equal((await f.run('dll_source_fetch', params)).details.sourceId, first.sourceId);
  assert.equal(f.state.requests.length, 3);
  const declined = await f.run('dll_source_fetch', { sourceId: first.sourceId, assetId: '11' }, async () => false);
  assert.equal(declined.details.applied, false); assert.equal(f.state.requests.length, 3);
  const downloaded = (await f.run('dll_source_fetch', { sourceId: first.sourceId, assetId: '11' })).details;
  assert.equal(downloaded.integrity, 'matched-published-sha256'); assert.equal(downloaded.intake.outcome, 'sdk-ready');
  assert.deepEqual(await fs.readFile(downloaded.file), f.archive);
  await f.run('dll_package_import', downloaded.intake);
  const item = (await f.service.snapshot()).plugins.find(p => p.id === f.m.id);
  assert.equal(item.source.type, 'github'); assert.equal(item.source.version, 'v1.0.0'); assert.equal(item.enabled, false);
  assert.deepEqual(item.presentation.page, f.m.presentation.page);
});

test('author/Agent/user metadata precedence persists, clears correctly, and never edits the author package', async t => {
  const f = await fixture(t), { source } = await f.install();
  const file = path.join(f.runtime, 'plugins', f.m.id, 'manifest.json'), before = await fs.readFile(file);
  await assert.rejects(f.run('dll_overlay_write', { id: f.m.id, fields: { summary: 'Agent replacement' }, basis: 'README' }), { code: 'developer_field_locked' });
  await f.run('dll_overlay_write', { id: f.m.id, fields: { description: 'Agent explanation', tags: ['HUD'], modes: ['coop'],
    hotkeys: [{ keys: 'Ctrl+F8', label: 'Toggle' }] }, basis: 'GitHub README 与 v1.0.0 Release', sourceId: source.sourceId });
  let item = (await f.service.snapshot()).plugins.find(p => p.id === f.m.id);
  assert.equal(item.provenance.fields.summary, 'developer'); assert.equal(item.provenance.fields.description, 'agent');
  await f.service.dispatch('plugin-overlay-save', { id: f.m.id, fields: { description: 'My explanation' } });
  item = (await f.service.snapshot()).plugins.find(p => p.id === f.m.id);
  assert.equal(item.presentation.description, 'My explanation'); assert.equal(item.provenance.fields.description, 'user');
  await f.service.dispatch('plugin-overlay-save', { id: f.m.id, fields: { description: '' } });
  item = (await f.service.snapshot()).plugins.find(p => p.id === f.m.id);
  assert.equal(item.presentation.description, 'Agent explanation');
  assert.deepEqual(await fs.readFile(file), before);
  const reread = await f.service.pluginOverlays.all(); assert.equal(reread[f.m.id].agent.description, 'Agent explanation');
  await assert.rejects(f.run('dll_overlay_write', { id: f.m.id, fields: { tags: ['new'] }, basis: 'README' }, async () => {
    await f.service.dispatch('plugin-overlay-save', { id: f.m.id, fields: { description: 'Edited while confirming' } });
    return true;
  }), { code: 'metadata_stale' });
  item = (await f.service.snapshot()).plugins.find(p => p.id === f.m.id);
  assert.equal(item.presentation.description, 'Edited while confirming');
  assert.deepEqual(item.presentation.tags, ['HUD']);
  assert.match((await readSkill({ path: DLL_SKILL })).content[0].text, /dll_source_fetch/);
});

test('detail-page images are declaration-scoped and include GIF; metadata covers stay outside the package', async t => {
  const f = await fixture(t), { source } = await f.install();
  assert.match((await f.service.dispatch('plugin-asset', { id: f.m.id, path: 'images/detail.gif' })).dataUrl, /^data:image\/gif/);
  await assert.rejects(f.service.dispatch('plugin-asset', { id: f.m.id, path: '../outside.png' }), { code: 'asset_not_declared' });
  await assert.rejects(f.service.dispatch('plugin-asset', { id: f.m.id, path: 'plugin.dll' }), { code: 'asset_not_declared' });
  const image = (await f.run('dll_source_fetch', { sourceId: source.sourceId, assetId: '12' })).details;
  // Use a module with no author cover so Agent supplementation is permitted.
  const imported = f.m.id, record = await f.service.pluginRecord(imported);
  await assert.rejects(f.run('dll_overlay_write', { id: imported, fields: { cover: image.file }, basis: 'Release image' }), { code: 'developer_field_locked' });
  const bare = path.join(f.base, 'bare.dll'); await fs.writeFile(bare, peFixture([]));
  const raw = (await f.run('dll_package_inspect', { file: bare })).details;
  const prepared = (await f.run('dll_package_prepare', { intakeId: raw.intakeId, mode: 'library', name: 'External feature', summary: 'Source summary', mappings: [{ source: 'bare.dll', target: 'plugin.dll' }] })).details;
  await f.run('dll_package_import', prepared);
  await f.run('dll_overlay_write', { id: prepared.manifest.id, fields: { cover: image.file }, basis: 'Author Release cover' });
  const p = (await f.service.snapshot()).plugins.find(p => p.id === prepared.manifest.id);
  assert.equal(p.provenance.fields.name, 'agent'); assert.match(p.presentation.cover, /^@overlay\//);
  assert.match((await f.service.dispatch('plugin-cover', { id: p.id, kind: 'module' })).dataUrl, /^data:image\/png/);
  assert.deepEqual((await f.service.pluginRecord(imported)).raw.presentation, record.raw.presentation);
});

test('version checks preserve the imported version and DLL bytes; publisher changes require confirmation', async t => {
  const f = await fixture(t); await f.install();
  const file = path.join(f.runtime, 'plugins', f.m.id, 'plugin.dll'), before = await fs.readFile(file);
  f.state.version = 'v1.1.0';
  const latest = (await f.run('dll_source_fetch', { type: 'github', url: 'https://github.com/Author/Pack', refresh: true })).details;
  await f.run('dll_source_record', { id: f.m.id, sourceId: latest.sourceId });
  let p = (await f.service.snapshot()).plugins.find(p => p.id === f.m.id);
  assert.equal(p.source.version, 'v1.0.0'); assert.equal(p.source.latest.version, 'v1.1.0');
  assert.deepEqual(await fs.readFile(file), before); assert.equal(p.enabled, false);
  const workshop = (await f.run('dll_source_fetch', { type: 'workshop', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3558049615' })).details;
  assert.equal(workshop.workshop.creator, f.state.creator); assert.equal(workshop.workshop.filename, 'feature.zip');
  let message;
  await f.run('dll_overlay_write', { id: f.m.id, fields: {}, basis: '用户指定的工坊来源', sourceId: workshop.sourceId }, async (_title, body) => { message = body; return true; });
  assert.match(message, /来源变更/);
  f.state.creator = '76561190000000002'; f.state.stamp++;
  const changed = (await f.run('dll_source_fetch', { type: 'workshop', url: workshop.source.url, refresh: true })).details;
  await assert.rejects(f.run('dll_source_record', { id: f.m.id, sourceId: changed.sourceId }), { code: 'source_publisher_changed' });
  assert.deepEqual(await fs.readFile(file), before);
});

test('bad redirects and published-checksum mismatches stop in staging', async t => {
  const f = await fixture(t), source = (await f.run('dll_source_fetch', { type: 'github', url: 'https://github.com/Author/Pack' })).details;
  f.state.badRedirect = true;
  await assert.rejects(f.run('dll_source_fetch', { sourceId: source.sourceId, assetId: '11' }), { code: 'source_invalid' });
  assert.equal(f.state.requests.some(r => r.url.includes('127.0.0.1')), false);
  f.state.badRedirect = false; f.state.corrupt = true;
  await assert.rejects(f.run('dll_source_fetch', { sourceId: source.sourceId, assetId: '11' }), { code: 'source_digest' });
  assert.equal((await f.service.core.listPlugins(f.gameRoot)).some(p => p.manifest.id === f.m.id), false);
});

test('a successful import with a metadata warning is repaired separately and clears the query warning', async t => {
  const f = await fixture(t), source = (await f.run('dll_source_fetch', { type: 'github', url: 'https://github.com/Author/Pack' })).details;
  const download = (await f.run('dll_source_fetch', { sourceId: source.sourceId, assetId: '11' })).details;
  const attach = f.service.pluginOverlays.attach;
  f.service.pluginOverlays.attach = async () => { throw Object.assign(new Error('fixture metadata write failed'), { code: 'fixture_metadata' }); };
  let result;
  try { result = (await f.run('dll_package_import', download.intake)).details; }
  finally { f.service.pluginOverlays.attach = attach; }
  assert.equal(result.operation, 'install'); assert.equal(result.metadataWarning.code, 'fixture_metadata');
  const before = (await f.run('dll_inventory', { id: result.id })).details;
  assert.equal(before.plugins[0].metadataWarning.code, 'fixture_metadata');
  assert.equal(before.issues.find(i => i.pluginId === result.id).code, 'fixture_metadata');
  const marker = await fs.readFile(path.join(f.runtime, 'plugins', result.id, '.l4p-package.json'));
  await f.run('dll_overlay_write', { id: result.id, fields: {}, basis: '来源登记重试', sourceId: source.sourceId });
  const after = (await f.run('dll_inventory', { id: result.id })).details;
  assert.equal(after.plugins[0].metadataWarning, undefined); assert.equal(after.plugins[0].source.url, source.source.url);
  assert.equal(after.issues.some(i => i.pluginId === result.id), false);
  assert.deepEqual(await fs.readFile(path.join(f.runtime, 'plugins', result.id, '.l4p-package.json')), marker);
  const rawFile = path.join(f.base, 'raw.dll'); await fs.writeFile(rawFile, peFixture([]));
  const raw = (await f.run('dll_package_inspect', { file: rawFile })).details;
  const generated = (await f.run('dll_package_prepare', { intakeId: raw.intakeId, mode: 'library', name: 'Raw', summary: 'Local author docs',
    mappings: [{ source: 'raw.dll', target: 'plugin.dll' }] })).details;
  f.service.pluginOverlays.attach = async () => { throw Object.assign(new Error('fixture metadata write failed'), { code: 'fixture_metadata' }); };
  let imported;
  try { imported = (await f.run('dll_package_import', generated)).details; }
  finally { f.service.pluginOverlays.attach = attach; }
  assert.equal((await f.run('dll_inventory', { id: imported.id })).details.plugins[0].provenance.fields.name, 'agent');
  await f.run('dll_overlay_write', { id: imported.id, fields: { name: 'Corrected raw name' }, basis: 'Local author docs', source: { type: 'local', label: 'raw.dll' } });
  const repaired = (await f.run('dll_inventory', { id: imported.id })).details.plugins[0];
  assert.equal(repaired.name, 'Corrected raw name'); assert.equal(repaired.provenance.fields.name, 'agent');
  assert.equal(repaired.metadataWarning, undefined);
});
