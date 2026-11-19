import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFixture } from './fixtures.mjs';
import { vpkFixture, addonInfo } from './mods-fixtures.mjs';
import { zipFixture } from './browser-fixtures.mjs';
import { listBrowserArchive, browserImportFiles, creatorFields } from '../mods/browser-downloads.mjs';
import { acquireMod } from '../pi/mod-acquire.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { createPlatform } from '../core.mjs';

test('browser download → VPK import on by default in the launch profile, provenance, ZIP selection/shards and unsafe path rejection', async () => {
  const base = await fs.mkdtemp(path.resolve('checks/.artifacts/browser-import-'));
  const fixture = await createFixture(base), dataDir = path.join(base, 'data');
  const direct = path.join(dataDir, 'browser/downloads/1-0/direct.vpk');
  await vpkFixture(direct, { 'addoninfo.txt': addonInfo('Browser direct'), 'scripts/test.txt': 'direct' });
  const split = path.join(base, 'source/split_dir.vpk');
  await vpkFixture(split, { 'addoninfo.txt': addonInfo('Browser ZIP split'), 'scripts/test.txt': 'split' }, { split: true });
  const zip = path.join(dataDir, 'browser/downloads/2-0/pack.zip'); await fs.mkdir(path.dirname(zip), { recursive: true });
  await fs.writeFile(zip, zipFixture({ 'folder/split_dir.vpk': await fs.readFile(split), 'folder/split_000.vpk': await fs.readFile(split.replace('_dir', '_000')), 'skip.vpk': await fs.readFile(direct), 'readme.txt': 'unused' }));
  const rows = [{ id: '1-0', path: direct }, { id: '2-0', path: zip }].map(r => ({ ...r, state: 'done', pageUrl: 'https://example.com/author', pageTitle: 'Fixture author', name: path.basename(r.path) }));
  const video = { source: 'bilibili', url: 'https://www.bilibili.com/video/BV1xx411c7mD', title: '演示', author: '原作者' };
  const work = { source: 'afdian', url: 'https://ifdian.net/p/example', title: '发布页' };
  rows[1].creators = [work, video];
  await fs.writeFile(path.join(dataDir, 'browser/downloads.json'), JSON.stringify(rows));
  assert.deepEqual((await listBrowserArchive(dataDir, '2-0')).items.map(i => i.name), ['folder/split_dir.vpk', 'skip.vpk']);
  const files = await browserImportFiles(dataDir, '2-0', ['folder/split_dir.vpk']);
  assert.equal(files.files.length, 1); await fs.access(files.files[0].replace('_dir', '_000'));
  await assert.rejects(fs.access(path.join(path.dirname(files.files[0]), '..', 'skip.vpk')));
  const core = createPlatform({ getProcesses: async () => [] }); core.discover = async () => ({ games: [await core.inspectGame(fixture.gameRoot)], warnings: [] });
  const service = new DesktopService({ dataDir, core });
  const confirmation = { approved: true, source: 'user' };
  try {
    await assert.rejects(service.dispatch('browser-import', { id: '1-0' }), /确认/);
    const directResult = await service.dispatch('browser-import', { id: '1-0', creators: [
      { ...video, url: 'https://www.bilibili.com.example.org/video/1' }, { ...video, title: ' 演示 ' }
    ] }, confirmation);
    const pi = (op, params) => acquireMod(service, fixture.gameRoot, op, params, confirmation);
    assert.deepEqual((await pi('browser-list', {})).downloads[1].creators, [work, video]);
    const selected = { downloadId: '2-0', selected: ['folder/split_dir.vpk'] };
    const plan = await pi('browser-preview', selected);
    assert.deepEqual(plan.download.creators, [work, video]);
    const zipResult = await pi('browser-import', { ...selected, expected: plan.expected });
    assert.equal(directResult.imported.length, 1); assert.equal(zipResult.imported.length, 1);
    const snap = await service.snapshot();
    assert.deepEqual(snap.mods.find(m => m.id === directResult.imported[0]).origin.creators, [video]);
    assert.deepEqual(snap.mods.find(m => m.id === zipResult.imported[0]).origin.creators, [work, video]);
    const saved = JSON.parse(await fs.readFile(service.settingsFile, 'utf8'));
    assert.deepEqual(saved.modOrigins[zipResult.imported[0]].creators, [work, video]);
    for (const id of [...directResult.imported, ...zipResult.imported]) {
      const mod = snap.mods.find(m => m.id === id); assert.equal(mod.enabled, false); assert.equal(mod.origin.pageUrl, rows[0].pageUrl); assert.equal(snap.modMeta[id].inbox, true);
      assert.equal(snap.profiles[0].modIds.includes(id), true); // addonlist stays off until the next launch applies the profile
    }
    await assert.rejects(service.dispatch('browser-import', { id: '1-0' }, confirmation), /同名/);
    await fs.writeFile(zip, zipFixture({ '../escape.vpk': await fs.readFile(direct) }));
    await assert.rejects(listBrowserArchive(dataDir, '2-0'), /invalid relative path|路径/);
    console.log(JSON.stringify({ fixture: base, imported: [...directResult.imported, ...zipResult.imported] }));
  } finally { await service.close(); }
});

test('only eligible creator links count toward the two sites, legacy origins omit creators', () => {
  const steam = { source: 'steam', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=123456', title: '🟢'.repeat(205), author: '字'.repeat(201) };
  const gm = { source: 'gamemaps', url: 'https://www.gamemaps.com/details/12', title: '地图' };
  const bad = [null, { ...gm, source: 'constructor' }, { ...gm, url:'https://someone@gamemaps.com/' }, { ...gm, url:'http://gamemaps.com/' }];
  assert.deepEqual(creatorFields(bad), {});
  assert.deepEqual(creatorFields(undefined), {});
  assert.deepEqual(creatorFields([...bad, steam, steam, gm, { ...gm, source: 'afdian', url: 'https://afdian.com/a/test' }]),
    { creators: [{ ...steam, title:'🟢'.repeat(200), author:'字'.repeat(200) }, gm] });
});
