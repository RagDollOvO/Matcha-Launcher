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

test('favorite collections share desktop and assistant writes, retain stars and survive restart', async t => {
  const f = await fixture(t), ids = ['music.vpk', 'weapon_dir.vpk'];
  const edit = p => f.service.dispatch('edit-favorite-collection', p);
  const group = await edit({action:'create', name:'音效', modIds:[ids[0]]});
  const find = () => f.run('mod_favorite_collections', {collectionId:group.id});
  assert.deepEqual((await find()).favorites.map(m => m.id), [ids[0]]);
  assert.equal((await f.run('mod_favorite_collection', {action:'add', collectionId:group.id, modIds:[ids[1]]}, async () => false)).applied, false);
  await f.run('mod_favorite_collection', {action:'add', collectionId:group.id, modIds:[ids[1]]});
  const other = await f.run('mod_favorite_collection', {action:'create', name:'常用', modIds:ids});
  assert.deepEqual((await f.service.snapshot()).favoriteCollections.map(c => c.modIds), [ids, ids]);
  const renamed = await f.run('mod_favorite_collection', {action:'rename', collectionId:other.collectionId, name:'周末'});
  await f.run('mod_undo', {historyId:renamed.historyId});
  assert.equal((await find()).collections[1].name, '常用');
  await edit({action:'remove', collectionId:group.id, modIds:[ids[0]]});
  assert.equal(f.service.settings.modMeta[ids[0]].favorite, true);
  await f.service.dispatch('save-mod-meta', {patch:{[ids[1]]:null}});
  assert.equal((await find()).favorites.length, 0);
  await f.service.close();
  const reopened = new DesktopService({dataDir:f.dataDir, core:f.api}); t.after(() => reopened.close()); await reopened.ready;
  const {run} = f.toolsFor(reopened);
  assert.deepEqual((await run('mod_favorite_collections', {collectionId:other.collectionId})).favorites.map(m => m.id), [ids[0]]);
  await run('mod_favorite_collection', {action:'delete', collectionId:other.collectionId});
  assert.deepEqual((await run('mod_favorite_collections')).favorites[0].collectionIds, []);
  assert.deepEqual(reopened.settings.profiles[0].modIds, [ids[1]]);
});

test('bookmark drops and assistant collections leave installed files and both Mod switches alone', async t => {
  const f = await fixture(t);
  const folder = path.join(f.base, 'materials'), installed = path.join(f.addons, 'music.vpk');
  await fs.mkdir(folder);await fs.writeFile(path.join(folder,'a.txt'),'material');
  const external = await vpkFixture(path.join(f.base, 'music.vpk'), { 'addoninfo.txt': addonInfo('收藏的另一套音乐'), 'sound/test.wav': 'sample' });
  const addonlist = path.join(f.gameRoot, 'left4dead2/addonlist.txt');
  const files = await fs.readdir(f.addons), switches = await fs.readFile(addonlist), orig = await fs.readFile(installed);
  const profiles = structuredClone(f.service.settings.profiles), categories = structuredClone(f.service.settings.assignments);
  f.setRunning([{ pid: 42 }]);
  const group = await f.service.dispatch('edit-favorite-collection', { action:'create', name:'备选音效' });
  const drop = paths => f.service.dispatch('bookmark-files', { paths, collectionId:group.id });
  await drop([installed]);
  assert.deepEqual(f.service.settings.modMeta['music.vpk'], {inbox:true,favorite:true});
  const refs=()=>Object.values(f.service.settings.favoriteRefs??{}), id=refs()[0].id, first=refs()[0].vaultKey;
  const p={paths:[external],collectionId:group.id};
  const preview=await f.service.dispatch('preview-bookmark-files',p);
  assert.equal(preview.duplicates[0].previous,installed);
  await assert.rejects(drop([external]),{code:'confirmation_required'});
  assert.equal(refs()[0].vaultKey,first);
  await f.service.dispatch('bookmark-files',{...p,expected:preview.expected},{approved:true,source:'user'});
  assert.deepEqual(refs().map(m=>m.id),[id]);assert.notEqual(refs()[0].vaultKey,first);
  assert.equal(refs()[0].absolutePath,external);
  const inGroup=()=>f.run('mod_favorite_collections',{collectionId:group.id});
  assert.deepEqual((await inGroup()).favorites.map(m=>m.id),[id]);
  const beforeUndo=refs()[0].vaultKey;
  const updated=await f.run('mod_mark',{modIds:[id],favorite:true});
  assert.notEqual(refs()[0].vaultKey,beforeUndo);
  await f.run('mod_undo',{historyId:updated.historyId});assert.equal(refs()[0].vaultKey,beforeUndo);
  const args = { paths:[folder], collectionId:group.id };
  assert.equal((await f.run('mod_bookmark_files', args, async () => false)).applied, false);
  const saved = await f.run('mod_bookmark_files', args);
  assert.equal((await inGroup()).favorites.filter(m => m.referenceKind === 'folder').length, 1);
  await f.run('mod_undo', { historyId:saved.historyId });
  assert.deepEqual(refs().map(m => m.id), [id]);
  await f.run('mod_favorite_collection', { action:'remove', collectionId:group.id, modIds:[id] });
  assert.equal((await f.run('mod_favorite_collections')).favorites.find(m => m.id === id).collectionIds.length, 0);
  await f.service.dispatch('save-mod-meta', { patch:{ [id]:null } });
  assert.deepEqual(refs(), []);
  assert.ok((await fs.stat(external)).isFile());
  assert.ok((await fs.stat(folder)).isDirectory());
  assert.deepEqual(await fs.readdir(f.addons), files);
  assert.deepEqual(await fs.readFile(installed), orig);
  assert.deepEqual(await fs.readFile(addonlist), switches);
  assert.deepEqual(f.service.settings.profiles, profiles);
  assert.deepEqual(f.service.settings.assignments, categories);
});

test('favorite copies into multiple drafts stay independent; external sources import to the library first', async t => {
  const f=await fixture(t), svc=f.service, ok={approved:true,source:'user'};
  const cmd=(name,p)=>svc.dispatch(name,p,ok);
  const base=structuredClone(svc.settings.profiles[0]);
  for(const id of ['a','b']) await cmd('save-profile',{profile:{...base,id,name:id}});
  const folder=path.join(f.base,'Sea'),file=await vpkFixture(path.join(f.base,'extra.vpk'),{'scripts/a.txt':'a'});
  await fs.mkdir(path.join(folder,'materials'),{recursive:true});await fs.writeFile(path.join(folder,'materials/a.txt'),'a');
  await cmd('bookmark-files',{paths:[file,folder]});
  const refs=Object.values(svc.settings.favoriteRefs), ids=refs.map(r=>r.id), group=await cmd('edit-favorite-collection',{action:'create',name:'收藏',modIds:ids});
  const args={favoriteIds:ids,profileIds:['a','b'],gameRoot:f.gameRoot};
  await assert.rejects(cmd('favorite-to-profiles',args),{code:'favorite_unavailable'});
  await cmd('import-mod',{favoriteId:ids[0],file,gameRoot:f.gameRoot});
  const input=await cmd('preview-mod-input',{file:folder,replaceExisting:true});
  const {taskId}=await cmd('pack-mod-folder',{favoriteId:ids[1],file:folder,sourceStamp:input.sourceStamp,gameRoot:f.gameRoot});
  let task;for(let i=0;i<180;i++){task=svc.tasks.list().find(t=>t.taskId===taskId);if(['done','failed'].includes(task?.state))break;await delay(25);}
  assert.equal(task.state,'done',task.error?.message);assert.equal(task.favoriteImport,true);
  const profiles=()=>svc.settings.profiles, memberIds=()=>profiles().map(p=>p.modIds);
  assert.deepEqual(memberIds(),[base.modIds,base.modIds,base.modIds]);
  const list=path.join(f.gameRoot,'left4dead2/addonlist.txt'), before=await fs.readFile(list);
  assert.equal((await cmd('favorite-to-profiles',args)).added,4);
  assert.equal((await cmd('favorite-to-profiles',args)).added,0);
  assert.deepEqual(memberIds()[0],base.modIds);assert.deepEqual(memberIds()[1],memberIds()[2]);
  assert.deepEqual(await fs.readFile(list),before);assert.equal(svc.settings.activeProfileId,base.id);
  await cmd('save-profile',{profile:{...profiles().find(p=>p.id==='a'),modIds:[]}});
  await cmd('delete-profile',{id:'b'});
  assert.deepEqual(svc.settings.favoriteCollections.find(c=>c.id===group.id).modIds,ids);
  await f.run('mod_favorites_to_profiles',{favoriteIds:ids,profileIds:['a']});
  const kept=structuredClone(profiles().find(p=>p.id==='a').modIds);
  await cmd('save-mod-meta',{patch:{[ids[0]]:null}});
  assert.deepEqual(profiles().find(p=>p.id==='a').modIds,kept);
  await cmd('edit-favorite-collection',{action:'add',collectionId:group.id,modIds:['music.vpk']});
  const {trashed}=await cmd('delete-mods',{ids:['music.vpk']});
  assert.equal(svc.settings.favoriteRefs['music.vpk'].title,'音乐');
  assert.ok(svc.settings.favoriteCollections[0].modIds.includes('music.vpk'));
  await cmd('save-mod-meta',{patch:{'music.vpk':null}});
  await cmd('restore-mods',{trashIds:[trashed[0].trashId]});
  assert.ok(!svc.settings.modMeta['music.vpk']?.favorite);
  assert.ok(!svc.settings.favoriteCollections[0].modIds.includes('music.vpk'));
});

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

test('manual display names share the assistant override and reject a stale editor', async t => {
  const f = await fixture(t), id = 'music.vpk', sourceTitle = '音乐';
  const save = (title, name, gameRoot = f.gameRoot) => f.service.dispatch('rename-mod',
    { gameRoot, id, name, expected: { title, sourceTitle } }, { approved: true, source: 'user' });
  const current = async () => (await f.run('mod_inventory')).mods.find(m => m.id === id).title;
  await assert.rejects(save(sourceTitle, '片尾曲', f.base), { code: 'game_changed' });
  f.setRunning([{ pid: 101, name: 'offline-fixture' }]);
  await save(sourceTitle, '  片尾曲  ');
  assert.equal(await current(), '片尾曲');
  await f.run('mod_rename', { items: [{ modId: id, name: '战役配乐' }] });
  await assert.rejects(save('片尾曲', null), { code: 'mod_name_changed' });
  assert.equal(await current(), '战役配乐');
  const reset = await save('战役配乐', null);
  assert.equal(await current(), sourceTitle);
  await f.run('mod_undo', { historyId: reset.historyId });
  assert.equal(await current(), '战役配乐');
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
  await f.service.dispatch('storage-set', { deleteArchivesAfterImport: false });
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
