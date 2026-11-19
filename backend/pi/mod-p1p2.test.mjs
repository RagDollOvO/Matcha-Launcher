import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as core from '../core.mjs';
import { createFixture } from '../tests/fixtures.mjs';
import { vpkFixture, addonInfo } from '../tests/mods-fixtures.mjs';
import { zipFixture } from '../tests/browser-fixtures.mjs';
import { readVpk } from '../mods/vpk.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { modHost } from './mod-host.mjs';
import { platformTools } from './platform-extension.mjs';

async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-mod-p1p2-')), game = await createFixture(base);
  const addons = path.join(game.gameRoot, 'left4dead2/addons'), dataDir = path.join(base, 'data');
  await vpkFixture(path.join(addons, 'weapon_dir.vpk'), { 'addoninfo.txt': addonInfo('武器'), 'models/weapons/rifle.mdl': Buffer.alloc(160000, 65), 'scripts/test.cfg': Buffer.concat([Buffer.from([255,254]), Buffer.from('音量 0.5', 'utf16le')]) }, { split: true });
  await vpkFixture(path.join(addons, 'music.vpk'), { 'addoninfo.txt': addonInfo('音乐'), 'sound/music/test.mp3': 'fixture music' });
  await fs.writeFile(path.join(game.gameRoot, 'left4dead2/addonlist.txt'), '"AddonList" { "weapon_dir.vpk" "1" "music.vpk" "0" }');
  let running = [];
  const api = { ...core, ...core.createPlatform({ getProcesses: async () => running }), discover: async () => ({ games: [], warnings: [] }) };
  const service = new DesktopService({ dataDir, core: api, ...options });
  t.after(() => service.close());
  await service.dispatch('select-game', { gameRoot: game.gameRoot });
  await service.dispatch('save-profile', { profile: { ...service.settings.profiles[0], modIds: ['weapon_dir.vpk'], modsInitialized: true, modsGameRoot: game.gameRoot, note: '个人备注', pluginIds: ['keep.plugin'], launchOptions: '-novid' } });
  await service.dispatch('save-mod-meta', { patch: { 'music.vpk': { inbox: true } } });
  function toolsFor(owner) {
    const host = modHost(owner, game.gameRoot), tools = new Map(platformTools(game.gameRoot, { modRequest: host }).map(tool => [tool.name, tool]));
    return { host, run: async (name, params = {}, confirm = async () => true) => (await tools.get(name).execute('fixture', params, new AbortController().signal, undefined, { hasUI: true, ui: { confirm } })).details };
  }
  return { base, ...game, addons, dataDir, api, service, ...toolsFor(service), toolsFor, setRunning: value => { running = value; } };
}

test('Mod P1 inspection compares actual bytes across preload/split layouts and paginates', async t => {
  const f = await fixture(t);
  const resources = { 'addoninfo.txt': addonInfo('另一个说明'), 'models/weapons/rifle.mdl': Buffer.alloc(160000, 65), 'scripts/test.cfg': Buffer.concat([Buffer.from([255,254]), Buffer.from('音量 0.5', 'utf16le')]) };
  await vpkFixture(path.join(f.addons, 'same.vpk'), resources, { preload: 0 });
  const info = await f.run('mod_inspect', { modId: 'weapon_dir.vpk', limit: 1, resource: 'scripts/test.cfg' });
  assert.equal(info.resources.length, 1); assert.equal(info.nextOffset, 1); assert.equal(info.files.length, 2); assert.equal(info.resource.text, '音量 0.5');
  await assert.rejects(f.run('mod_inspect', { modId: 'weapon_dir.vpk', resource: '../settings.json' }), { code: 'resource_scope' });
  const same = await f.run('mod_compare', { a: 'weapon_dir.vpk', b: 'same.vpk' });
  assert.equal(same.sameGameResources, true); assert.equal(same.same.length, 2);
  const page = await f.run('mod_compare', { a: 'weapon_dir.vpk', b: 'same.vpk', limit: 1 });
  assert.equal(page.nextOffset, 1); assert.equal(page.sameGameResources, null);
  // Keep the VPK's indexed CRC unchanged while changing real resource bytes.
  const vpk = await readVpk(path.join(f.addons, 'same.vpk'), { includeEntries: true }), entry = vpk.entries.get('models/weapons/rifle.mdl');
  const h = await fs.open(entry.archiveFile, 'r+');
  try { await h.write(Buffer.from('B'), 0, 1, entry.dataOffset + 70000); } finally { await h.close(); }
  await assert.rejects(f.run('mod_compare', { a: 'weapon_dir.vpk', b: 'same.vpk', offset: 1, expectedVersion: page.sourceVersion }), { code: 'file_changed' });
  const changed = await f.run('mod_compare', { a: 'weapon_dir.vpk', b: 'same.vpk' });
  assert.equal(changed.sameGameResources, false); assert.deepEqual(changed.different, ['models/weapons/rifle.mdl']);
});

test('Mod P1/P2 metadata saves preserve profile fields; undo persists across restart and rejects later edits', async t => {
  const f = await fixture(t), initial = await fs.readFile(path.join(f.gameRoot, 'left4dead2/addonlist.txt'));
  await f.run('mod_organize', { moves: [{ modId: 'music.vpk', categoryName: '声音' }] });
  const category = f.service.settings.categories.find(c => c.name === '声音');
  assert.equal((await f.run('mod_mark', { modIds: ['music.vpk'], favorite: true }, async () => false)).applied, false);
  await f.run('mod_mark', { modIds: ['music.vpk'], favorite: true });
  await f.run('mod_category', { action: 'rename', categoryId: category.id, name: '音乐' });
  await f.run('mod_profile_members', { action: 'add', profileId: 'default', modIds: ['music.vpk'] });
  assert.equal((await f.run('mod_history')).entries.length, 4);
  assert.deepEqual(await fs.readFile(path.join(f.gameRoot, 'left4dead2/addonlist.txt')), initial);
  await f.service.close();
  const reopened = new DesktopService({ dataDir: f.dataDir, core: f.api }); t.after(() => reopened.close()); await reopened.ready;
  const next = f.toolsFor(reopened);
  const list = (await next.run('mod_history')).entries;
  for (const entry of list) await next.run('mod_undo', { historyId: entry.id });
  assert.equal(reopened.settings.assignments['music.vpk'], undefined);
  assert.equal(reopened.settings.modMeta['music.vpk'].inbox, true);
  assert.equal(reopened.settings.categories.length, 1);
  assert.deepEqual(reopened.settings.profiles[0].modIds, ['weapon_dir.vpk']);
  assert.equal(reopened.settings.profiles[0].note, '个人备注'); assert.equal(reopened.settings.profiles[0].launchOptions, '-novid'); assert.deepEqual(reopened.settings.profiles[0].pluginIds, ['keep.plugin']);
  const saved = await next.run('mod_mark', { modIds: ['music.vpk'], favorite: true });
  await reopened.dispatch('save-mod-meta', { patch: { 'music.vpk': { inbox: true } } });
  await assert.rejects(next.run('mod_undo', { historyId: saved.historyId }), { code: 'mod_history_conflict' });
  assert.equal(reopened.settings.modMeta['music.vpk'].inbox, true);
});

test('Mod display names: batch, Workshop and managed files, restart, source refresh and undo', async t => {
  const f = await fixture(t);
  const workshop = path.join(f.addons, 'workshop'), stage = path.join(f.base, 'new-item');
  await fs.mkdir(workshop, { recursive: true }); await fs.mkdir(stage);
  const file = await vpkFixture(path.join(workshop, '123.vpk'), { 'scripts/fixture.txt': 'sample' });
  await vpkFixture(path.join(stage, 'mod.vpk'), { 'scripts/fixture.txt': 'sample' });
  const library = await f.service.modManager.library.publish(f.gameRoot, stage, { id:'456', title:'工坊原名', author:'test' });
  const lookup = async (run, id) => (await run('mod_inventory')).mods.find(m => m.id === id);
  const src = (await lookup(f.run, 'workshop/123.vpk')).sourceTitle, bytes = await fs.readFile(file);
  const items = [{ modId:'music.vpk', prefix:'[声音]' }, { modId:'workshop/123.vpk', name:'轮盘' }, { modId:library, prefix:'[武器] [近战]' }];
  assert.equal((await f.run('mod_rename', { items }, async () => false)).applied, false);
  await assert.rejects(f.run('mod_rename', {items:[...items, {modId:'gone.vpk', name:'错'}]}), {code:'mod_missing'});
  assert.equal((await lookup(f.run,'music.vpk')).title, '音乐');
  const saved = await f.run('mod_rename', { items }); assert.equal(saved.changeCount, 3);
  assert.equal((await f.run('mod_rename',{ items })).changeCount, 0);
  assert.equal((await lookup(f.run,library)).title, '[武器] [近战] 工坊原名');
  assert.equal((await f.service.snapshot()).mods.find(m=>m.id==='workshop/123.vpk').title,'轮盘');
  assert.deepEqual(await fs.readFile(file),bytes);
  assert.equal(f.service.settings.modMeta['music.vpk'].inbox, true);
  const plan = await f.host('metadata-preview', {kind:'rename', items:[{modId:'workshop/123.vpk',name:null}]});
  await vpkFixture(file, { 'addoninfo.txt':addonInfo('工坊更新后的标题'), 'scripts/fixture.txt':'updated' });
  await assert.rejects(f.host('metadata',{kind:'rename',items:[{modId:'workshop/123.vpk',name:null}],expected:plan.expected},{approved:true,source:'user'}),{code:'mod_plan_changed'});
  assert.equal((await lookup(f.run, 'workshop/123.vpk')).title,'轮盘');
  await f.service.close();
  const reopened = new DesktopService({dataDir:f.dataDir,core:f.api}); t.after(()=>reopened.close()); await reopened.ready;
  const {run} = f.toolsFor(reopened);
  assert.equal((await lookup(run,'music.vpk')).title,'[声音] 音乐');
  const reset = await run('mod_rename',{items:[{modId:'workshop/123.vpk',name:null}]});
  assert.notEqual(src,'工坊更新后的标题'); assert.equal((await lookup(run,'workshop/123.vpk')).title,'工坊更新后的标题');
  await run('mod_undo',{historyId:reset.historyId}); await run('mod_undo',{historyId:saved.historyId});
  assert.equal((await lookup(run,library)).title, '工坊原名'); assert.equal((await lookup(run,'music.vpk')).title, '音乐');
});

test('Mod P1 category move/merge/delete keep hierarchies and are reversible', async t => {
  const f = await fixture(t);
  const categories = [{ id: 'cat-none', name: '未分类', builtin: true }, { id: 'a', name: '来源' }, { id: 'child', name: '子分类', parentId: 'a' }, { id: 'b', name: '目标' }];
  await f.service.dispatch('save-categories', { categories, assignments: { 'music.vpk': 'a', 'weapon_dir.vpk': 'child' } });
  await assert.rejects(f.run('mod_category', { action: 'move', categoryId: 'a', parentId: 'child' }), { code: 'category_cycle' });
  const merged = await f.run('mod_category', { action: 'merge', categoryId: 'a', targetId: 'b' });
  assert.equal(f.service.settings.assignments['music.vpk'], 'b'); assert.equal(f.service.settings.categories.find(c => c.id === 'child').parentId, 'b');
  await f.run('mod_undo', { historyId: merged.historyId });
  assert.equal(f.service.settings.assignments['music.vpk'], 'a'); assert.equal(f.service.settings.categories.find(c => c.id === 'child').parentId, 'a');
  const deleted = await f.run('mod_category', { action: 'delete', categoryId: 'a' });
  assert.equal(f.service.settings.assignments['music.vpk'], 'cat-none'); assert.equal(f.service.settings.categories.find(c => c.id === 'child').parentId, undefined);
  await f.run('mod_undo', { historyId: deleted.historyId });
  assert.equal(f.service.settings.categories.find(c => c.id === 'child').parentId, 'a');
  assert.equal((await f.host('inventory')).mods.length, 2);
});

test('Mod P1 source links use existing Workshop/GameMaps downloads, then classify and add to a profile', async t => {
  let steamPayload, gamePayload, failSteam = true;
  const workshopFetch = async url => {
    if (String(url).includes('GetPublishedFileDetails')) return Response.json({ response: { publishedfiledetails: [{ result: 1, publishedfileid: '123', consumer_app_id: 550, file_type: 0, title: '工坊样本', file_size: String(steamPayload.length), file_url: 'https://cdn.steamusercontent.com/fixture.vpk' }] } });
    if (failSteam) { failSteam = false; return new Response('fixture failure', { status: 500 }); }
    return new Response(steamPayload);
  };
  const f = await fixture(t, { workshopFetch });
  const sourceFile = await vpkFixture(path.join(f.base, 'steam.vpk'), { 'addoninfo.txt': addonInfo('工坊样本'), 'models/weapons/download.mdl': 'Steam resource' });
  steamPayload = await fs.readFile(sourceFile);
  const gameFile = await vpkFixture(path.join(f.base, 'campaign.vpk'), { 'addoninfo.txt': addonInfo('地图样本'), 'missions/test.txt': 'fixture mission' });
  gamePayload = zipFixture({ 'campaign.vpk': await fs.readFile(gameFile) });
  f.service.gamemaps.browser = { request: async p => {
    if (p.kind === 'page') return { html: '<title>Fixture for Left 4 Dead 2 - GameMaps.com</title><div class="title-row"><h1>地图样本</h1></div><section class="instructions"><h2>Instructions</h2><pre>作者要求：查看说明</pre></section><section class="details"><div class="info-card"><p title="pack.zip">pack.zip</p><p><time datetime="2026-11-17">date</time> (1 MB)</p></div></section>' };
    const file = path.join(f.dataDir, 'gamemaps/downloads', p.taskId, 'pack.zip'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, gamePayload); return { path: file, name: 'pack.zip', size: gamePayload.length };
  } };
  f.service.gamemaps.sleep = async () => {};
  await assert.rejects(f.run('mod_source', { url: 'https://example.org/details/11' }), { code: 'download_origin' });
  const detail = await f.run('mod_source', { url: 'https://www.gamemaps.com/details/11' }); assert.match(detail.instructions, /作者要求/);
  const items = [{ url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=123' }, { source: 'gamemaps', id: '11' }];
  assert.equal((await f.run('mod_download', { items }, async () => false)).applied, false); assert.equal(f.service.tasks.list().length, 0);
  const start = await f.run('mod_download', { items }); assert.equal(start.errors.length, 0); assert.equal(start.taskIds.length, 2);
  let tasks = (await f.run('mod_tasks', { taskIds: start.taskIds, waitMs: 3000 })).tasks;
  const steam = tasks.find(task => task.source === 'workshop'); assert.equal(steam.state, 'failed'); assert.equal(tasks.find(task => task.source === 'gamemaps').state, 'done');
  await f.run('mod_task_control', { taskIds: [steam.taskId], action: 'retry' });
  tasks = (await f.run('mod_tasks', { taskIds: start.taskIds, waitMs: 3000 })).tasks;
  assert(tasks.every(task => task.state === 'done'), JSON.stringify(tasks));
  const modIds = tasks.flatMap(task => task.imported ?? [task.modId]); assert.equal(modIds.length, 2);
  await f.run('mod_organize', { moves: modIds.map(modId => ({ modId, categoryName: '下载测试' })) });
  await f.run('mod_profile_members', { action: 'add', profileId: 'default', modIds });
  const inventory = await f.host('inventory');
  for (const id of modIds) { assert.equal(inventory.mods.find(mod => mod.id === id).enabled, false); assert(f.service.settings.profiles[0].modIds.includes(id)); }
  assert.equal(inventory.mods.find(mod => mod.id === 'campaign.vpk').origin.pageUrl, 'https://www.gamemaps.com/details/11');
});

test('Mod P1 browser ZIP preview/import and extraction preserve sources and use the task queue', async t => {
  const f = await fixture(t), file = await vpkFixture(path.join(f.base, 'web_dir.vpk'), { 'addoninfo.txt': addonInfo('网页样本'), 'models/weapons/web.mdl': 'web source' }, { split: true });
  const payload = zipFixture({ 'folder/web_dir.vpk': await fs.readFile(file), 'folder/web_000.vpk': await fs.readFile(path.join(f.base, 'web_000.vpk')), 'unrelated.txt': 'keep' });
  const id = '1700000000000-1', folder = path.join(f.dataDir, 'browser/downloads', id), archive = path.join(folder, 'pack.zip');
  await fs.mkdir(folder, { recursive: true }); await fs.writeFile(archive, payload);
  await fs.writeFile(path.join(f.dataDir, 'browser/downloads.json'), JSON.stringify([{ id, name: 'pack.zip', path: archive, state: 'done', size: payload.length, pageUrl: 'https://www.gamemaps.com/details/99' }]));
  assert.equal((await f.run('mod_browser_downloads')).downloads.length, 1);
  const preview = await f.run('mod_browser_downloads', { downloadId: id }); assert.equal(preview.items.length, 1);
  assert.equal((await f.run('mod_browser_import', { downloadId: id }, async () => false)).applied, false);
  const imported = await f.run('mod_browser_import', { downloadId: id }); assert.deepEqual(imported.imported, ['web_dir.vpk']);
  assert.deepEqual(await fs.readFile(archive), payload);
  const target = path.join(f.base, 'exports'); await fs.mkdir(target);
  const { taskId } = await f.run('mod_extract', { modId: 'web_dir.vpk', target });
  const [done] = (await f.run('mod_tasks', { taskIds: [taskId], waitMs: 3000 })).tasks;
  assert.equal(done.state, 'done'); assert.equal(await fs.readFile(path.join(done.dir, 'models/weapons/web.mdl'), 'utf8'), 'web source');
  assert.equal((await f.host('inventory')).mods.find(mod => mod.id === 'web_dir.vpk').origin.pageUrl, 'https://www.gamemaps.com/details/99');
  // Active download cancellation uses the same task manager rather than blocking its commit queue.
  const original = f.service.tasks.run; f.service.tasks.run = async (_kind, _request, ctx) => { await delay(10000, undefined, { signal: ctx.signal }); return {}; };
  const pending = await f.service.tasks.create('download', { gameRoot: f.gameRoot, id: '456' }, '可取消样本');
  await f.run('mod_task_control', { action: 'cancel', taskIds: [pending.taskId] });
  const [canceled] = (await f.run('mod_tasks', { taskIds: [pending.taskId], waitMs: 1000 })).tasks; assert.equal(canceled.state, 'canceled');
  f.service.tasks.run = original;
});
