import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import { ModManager } from '../mods/manager.mjs';
import { readVpk, readResource, verifyVpk } from '../mods/vpk.mjs';
import { parseAddonList, readAddonList, updateAddonList } from '../mods/addonlist.mjs';
import { vpkFixture, addonInfo } from './mods-fixtures.mjs';
import { createFixture } from './fixtures.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { acquireMod } from '../pi/mod-acquire.mjs';
import * as core from '../core.mjs';

const approval = { approved: true, source: 'user' };
const gbkAddonList = Buffer.from('224164646f6e4c697374220a7b0a0922a1bec8fdb7bdcdbca1bfc7b9b5ea6d6f64b2e2cad4cdbc2e76706b2209092231220a7d0a', 'hex');
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-mods-'));
  const game = await createFixture(base), addons = path.join(game.gameRoot, 'left4dead2', 'addons');
  await vpkFixture(path.join(addons, 'local.vpk'), { 'addoninfo.txt': addonInfo('本地武器'), 'Models/weapon.mdl': 'FIRST model data', 'materials/only.vmt': 'material' });
  await vpkFixture(path.join(addons, 'workshop/123.vpk'), { 'addoninfo.txt': addonInfo('工坊武器'), 'models/WEAPON.mdl': 'SECOND model data' }, { version: 2 });
  const list = path.join(game.gameRoot, 'left4dead2', 'addonlist.txt');
  const text = '\ufeff"AddonList"\r\n{\r\n // 玩家注释\r\n "local.vpk" "1"\r\n "workshop\\123.vpk" "0"\r\n "uninstalled.vpk" "1" // 保留\r\n}\r\n';
  await fs.writeFile(list, text);
  let running = [];
  const api = { ...core, ...core.createPlatform({ getProcesses: async () => running }), discover: async () => ({ games: [], warnings: [] }) };
  return { ...game, base, addons, list, text, api, setRunning: p => { running = p; }, manager: new ModManager({ inspectGame: api.inspectGame }) };
}

test('VPK: v1/v2 preload, external archives and malformed tree bounds', async () => {
  const f = await fixture();
  for (const file of ['local.vpk', 'workshop/123.vpk']) {
    const v = await readVpk(path.join(f.addons, file)); assert.match(v.title, /武器/); assert.ok(v.resources.includes('models/weapon.mdl'));
    assert.equal(v.resources.includes('addoninfo.txt'), false);
  }
  const split = await vpkFixture(path.join(f.base, 'split_dir.vpk'), { 'addoninfo.txt': addonInfo('分卷'), 'models/a.mdl': 'a'.repeat(80) }, { split: true });
  assert.equal((await readVpk(split)).files.length, 2);
  await fs.truncate(split.replace('_dir', '_000'), 2);
  await assert.rejects(readVpk(split), e => e.code === 'invalid_vpk');
  const bad = path.join(f.base, 'truncated.vpk'); await fs.writeFile(bad, Buffer.from([1, 2]));
  await assert.rejects(readVpk(bad), e => e.code === 'invalid_vpk');
});

test('folder pack: stream loose assets through the desktop queue into a disabled, categorized VPK', async t => {
  const f = await fixture(), service = new DesktopService({ dataDir: path.join(f.base, 'settings'), core: f.api });
  t.after(() => service.close());
  await service.ready; service.settings.gameRoot = f.gameRoot;
  await service.dispatch('save-categories', { categories: [{ id: 'skins', name: '涂装' }], assignments: {} });
  const pack = async (folder, replaceExisting = false) => {
    const input = await service.dispatch('preview-mod-input', { file: folder, replaceExisting: true });
    assert.equal(input.targetExists, replaceExisting);
    const request = { ...input, replaceExisting: input.targetExists, categoryId: 'skins', gameRoot: f.gameRoot };
    await assert.rejects(service.dispatch('pack-mod-folder', request), { code: 'confirmation_required' });
    const finished = new Promise(resolve => {
      const onEvent = e => {
        if (e.kind === 'pack' && ['done', 'failed'].includes(e.state)) { service.off('event', onEvent); resolve(e); }
      };
      service.on('event', onEvent);
    });
    await service.dispatch('pack-mod-folder', request, approval);
    const result = await finished;
    assert.equal(result.state, 'done', result.error?.message);
    return readVpk(path.join(f.addons, input.name), { includeEntries: true });
  };
  const folder = path.join(f.base, '桌面', '海风涂装'), mats = path.join(folder, 'materials');
  await fs.mkdir(mats, { recursive: true });
  const bytes = Buffer.alloc(700000, 0x9d); // crosses the streaming buffer
  await fs.writeFile(path.join(mats, '涂装.vtf'), bytes);
  const info = addonInfo('原作标题'); await fs.writeFile(path.join(folder, 'addoninfo.txt'), info);
  let v = await pack(folder);
  await verifyVpk(v);
  assert.equal(v.title, '原作标题');
  assert.deepEqual(await readResource(v.entries.get('materials/涂装.vtf'), bytes.length), bytes);
  assert.deepEqual(await fs.readFile(path.join(mats, '涂装.vtf')), bytes);
  const mod = (await service.dispatch('snapshot')).mods.find(m => m.id === '海风涂装.vpk');
  assert.equal(mod.categoryId, 'skins'); assert.equal(mod.enabled, false);
  await assert.rejects(service.dispatch('preview-mod-input', { file: folder }), { code: 'file_exists' });

  await fs.writeFile(path.join(folder, 'addoninfo.txt'), addonInfo('新版标题'));
  const profile = (await service.dispatch('snapshot')).profiles[0];
  await service.dispatch('save-profile', { profile: { ...profile, modIds: profile.modIds.filter(id => id !== mod.id) } });
  assert.equal((await pack(folder, true)).title, '新版标题');
  assert.ok((await service.dispatch('snapshot')).profiles[0].modIds.includes(mod.id));

  // A raw materials directory retains its game prefix, including when no addoninfo was supplied.
  v = await pack(mats);
  assert.equal(v.title, 'materials'); assert.deepEqual(v.resources, ['materials/涂装.vtf']);
  await assert.rejects(fs.access(path.join(mats, 'addoninfo.txt')), { code: 'ENOENT' });
  const other = path.join(f.base, 'another'); await fs.mkdir(other);
  const input = await service.dispatch('preview-mod-input', { file: other });
  f.setRunning([{ pid: 7 }]);
  await assert.rejects(service.dispatch('pack-mod-folder', { ...input, gameRoot: f.gameRoot }, approval), { code: 'game_running' });
});

test('addonlist: preserve BOM/comments/unknown keys and UTF-16; reject malformed data', async () => {
  const f = await fixture(), d = await readAddonList(f.list);
  const updated = updateAddonList(d, [['workshop/123.vpk', true], ['new.vpk', false]]).toString('utf8');
  assert.ok(updated.startsWith('\ufeff')); assert.ok(updated.includes('// 玩家注释')); assert.ok(updated.includes('"uninstalled.vpk" "1" // 保留'));
  assert.equal(parseAddonList(updated).values.get('workshop/123.vpk').enabled, true);
  assert.equal(parseAddonList(updated).values.get('new.vpk').enabled, false);
  await fs.writeFile(f.list, Buffer.from(f.text, 'utf16le'));
  const u16 = await readAddonList(f.list); assert.equal(u16.encoding, 'utf16le');
  assert.equal(updateAddonList(u16, []).toString('utf16le'), f.text);
  assert.throws(() => parseAddonList('"AddonList" { "x.vpk" "1" "X.VPK" "0" }'), e => e.code === 'invalid_addonlist');
});

test('addonlist: read GBK Chinese filenames and retain lossless GB18030 writes', async () => {
  const f = await fixture(); await fs.writeFile(f.list, gbkAddonList);
  const document = await readAddonList(f.list), oldName = '【三方图】枪店mod测试图.vpk', newName = '新增_𠀀.vpk';
  assert.equal(document.encoding, 'gb18030'); assert.equal(document.values.get(oldName).enabled, true);
  assert.deepEqual(updateAddonList(document, []), gbkAddonList);
  const updated = updateAddonList(document, [[oldName, false], [newName, false]]);
  const expected = document.text.replace('"1"', '"0"').replace('}\n', `\t"${newName}"\t\t"0"\n}\n`);
  assert.deepEqual(updated, iconv.encode(expected, 'gb18030'));
  await fs.writeFile(f.list, updated);
  const after = await readAddonList(f.list);
  assert.equal(after.values.get(oldName).enabled, false); assert.equal(after.values.get(newName).enabled, false);
  await fs.writeFile(f.list, Buffer.concat([Buffer.from('"AddonList" { "'), Buffer.from([0xff]), Buffer.from('" "1" }')]));
  await assert.rejects(readAddonList(f.list), { code: 'invalid_addonlist' });
});

test('Mods import: GBK addonlist keeps existing Chinese entries and registers the new VPK disabled', async () => {
  const f = await fixture(); await fs.writeFile(f.list, gbkAddonList);
  const file = await vpkFixture(path.join(f.base, 'source/中文导入.vpk'), { 'addoninfo.txt': addonInfo('中文导入'), 'models/example.mdl': 'model' });
  const original = await fs.readFile(file);
  const result = await f.manager.import({ gameRoot: f.gameRoot, file, confirmation: approval });
  assert.equal(result.enabled, false); assert.deepEqual(await fs.readFile(result.backup), gbkAddonList);
  const document = await readAddonList(f.list);
  assert.equal(document.encoding, 'gb18030');
  assert.equal(document.values.get('【三方图】枪店mod测试图.vpk').enabled, true);
  assert.equal(document.values.get('中文导入.vpk').enabled, false);
  assert.deepEqual(await fs.readFile(file), original);
  const inventory = await f.manager.scan(f.gameRoot);
  assert.equal(inventory.writable, true); assert.deepEqual(inventory.issues, []);
  assert.equal(inventory.mods.find(m => m.id === result.id).enabled, false);
});

test('Mods: true inventory, overlaps, apply with backup, process guard and invalid addon isolation', async () => {
  const f = await fixture(); let s = await f.manager.scan(f.gameRoot);
  assert.equal(s.mods.length, 2); assert.equal(s.mods[0].enabled, true);
  assert.deepEqual(s.conflicts[0].paths, ['models/weapon.mdl']); assert.equal(s.conflicts[0].winner, undefined);
  await assert.rejects(f.manager.apply({ gameRoot: f.gameRoot, enabledIds: [] }), e => e.code === 'confirmation_required');
  f.setRunning([{ pid: 7, name: 'left4dead2' }]);
  await assert.rejects(f.manager.apply({ gameRoot: f.gameRoot, enabledIds: [], confirmation: approval }), e => e.code === 'game_running');
  assert.equal(await fs.readFile(f.list, 'utf8'), f.text); f.setRunning([]);
  const result = await f.manager.apply({ gameRoot: f.gameRoot, enabledIds: ['workshop/123.vpk'], confirmation: approval });
  assert.equal(await fs.readFile(result.backup, 'utf8'), f.text);
  s = await f.manager.scan(f.gameRoot); assert.deepEqual(s.mods.map(m => m.enabled), [false, true]);
  await f.manager.setEnabled({ gameRoot: f.gameRoot, modIds: ['local.vpk'], enabled: true, confirmation: approval });
  s = await f.manager.scan(f.gameRoot); assert.deepEqual(s.mods.map(m => m.enabled), [true, true]);
  await fs.writeFile(path.join(f.addons, 'broken.vpk'), 'bad');
  s = await f.manager.scan(f.gameRoot); assert.equal(s.mods.length, 3); assert.ok(s.mods.find(m => m.id === 'broken.vpk').error);
  await assert.rejects(f.manager.apply({ gameRoot: f.gameRoot, enabledIds: ['broken.vpk'], confirmation: approval }), e => e.code === 'invalid_vpk');
});

test('Mods import: copy split package, default disabled, preserve source and refuse collisions', async () => {
  const f = await fixture();
  const file = await vpkFixture(path.join(f.base, 'source/demo_dir.vpk'), { 'addoninfo.txt': addonInfo('导入测试'), 'sound/example.wav': 'a'.repeat(90) }, { split: true });
  const original = await fs.readFile(file);
  const result = await f.manager.import({ gameRoot: f.gameRoot, file, confirmation: approval });
  assert.equal(result.enabled, false); assert.deepEqual(await fs.readFile(file), original);
  let s = await f.manager.scan(f.gameRoot); assert.equal(s.mods.length, 3); assert.equal(s.mods.find(m => m.id === 'demo_dir.vpk').enabled, false);
  await assert.rejects(f.manager.import({ gameRoot: f.gameRoot, file, confirmation: approval }), e => e.code === 'file_exists');
  const oldList = await fs.readFile(f.list);
  const update = await vpkFixture(path.join(f.base, 'update/demo_dir.vpk'), { 'addoninfo.txt': addonInfo('新版'), 'models/new.mdl': 'new content' });
  f.setRunning([{pid:42}]);
  await assert.rejects(f.manager.import({ gameRoot:f.gameRoot, file:update, confirmation:approval, replaceExisting:true }), {code:'game_running'});
  f.setRunning([]);
  const replacement = await f.manager.import({ gameRoot:f.gameRoot, file:update, confirmation:approval, replaceExisting:true });
  assert.equal(replacement.replaced, true);
  assert.equal((await readVpk(result.file)).title, '新版');
  assert.equal((await readVpk(path.join(replacement.backup,'demo_dir.vpk'))).title, '导入测试');
  await assert.rejects(fs.access(path.join(f.addons,'demo_000.vpk')), {code:'ENOENT'});
  assert.deepEqual(await fs.readFile(f.list), oldList);
  const current = await fs.readFile(f.list); await fs.writeFile(f.list, 'bad');
  s = await f.manager.scan(f.gameRoot); assert.equal(s.writable, false);
  await assert.rejects(f.manager.apply({ gameRoot: f.gameRoot, enabledIds: [], confirmation: approval }), e => e.code === 'invalid_addonlist');
  assert.equal(await fs.readFile(f.list, 'utf8'), 'bad'); await fs.writeFile(f.list, current);
});

test('desktop Mod contract: initial actual selection, persistent drafts, explicit apply and launch ordering', async () => {
  const f = await fixture(); let launchCalled = false;
  const service = new DesktopService({ dataDir: path.join(f.base, 'settings'), core: { ...f.api, launch: async () => {
    launchCalled = true; assert.equal((await readAddonList(f.list)).values.get('local.vpk').enabled, false); return { status: 'requested' };
  } } });
  try {
    await service.dispatch('select-game', { gameRoot: f.gameRoot });
    const s = await service.dispatch('snapshot'); assert.equal(s.capabilities.mods, true); assert.deepEqual(s.profiles[0].modIds, ['local.vpk']);
    await service.dispatch('save-profile', { profile: { ...s.profiles[0], modsInitialized: true, modsGameRoot: f.gameRoot, modIds: ['workshop/123.vpk'] } });
    assert.equal(await fs.readFile(f.list, 'utf8'), f.text);
    assert.deepEqual((await service.dispatch('snapshot')).profiles[0].modIds, ['workshop/123.vpk']);
    await assert.rejects(service.dispatch('launch', { profileId: 'default' }), e => e.code === 'confirmation_required'); assert.equal(launchCalled, false);
    await service.dispatch('launch', { profileId: 'default' }, approval); assert.equal(launchCalled, true);
    const after = await service.dispatch('snapshot'); assert.equal(after.mods.find(m => m.id === 'workshop/123.vpk').enabled, true);
  } finally { await service.close(); }
});

test('desktop new Mods: imports join the launch profile, keep inbox, and later saves clear only newly added IDs', async () => {
  const f = await fixture();
  const service = new DesktopService({ dataDir: path.join(f.base, 'settings'), core: f.api });
  try {
    await service.dispatch('select-game', { gameRoot: f.gameRoot });
    const source = (name, title) => vpkFixture(path.join(f.base, 'source', name), { 'addoninfo.txt': addonInfo(title), [`models/${name}.mdl`]: title });
    // An uninitialized profile keeps the game's own selection and gains the new Mod.
    const result = await service.dispatch('import-mod', { file: await source('fresh.vpk', '新武器') }, approval);
    assert.equal(result.enabled, true); assert.equal(result.applies, 'next-launch'); assert.equal(result.profileId, 'default');
    assert.equal((await readAddonList(f.list)).values.get('fresh.vpk').enabled, false, 'addonlist waits for the next launch');
    let s = await service.dispatch('snapshot');
    assert.deepEqual(s.profiles[0].modIds, ['local.vpk', 'fresh.vpk']);
    // A manual replacement enables even a previously disabled copy. Repeating it stays idempotent.
    await service.dispatch('save-profile', { profile: { ...s.profiles[0], modIds: ['local.vpk'] } });
    const update = { file: await source('fresh.vpk', '替换版'), replaceExisting: true };
    assert.equal((await service.dispatch('preview-mod-input', update)).targetExists, true);
    await assert.rejects(service.dispatch('import-mod', { ...update, replaceExisting: false }, approval), { code: 'file_exists' });
    for (let i = 0; i < 2; i++) {
      const r = await service.dispatch('import-mod', update, approval);
      assert.equal(r.replaced, true); assert.equal(r.enabled, true);
      assert.deepEqual((await service.dispatch('snapshot')).profiles[0].modIds, ['local.vpk', 'fresh.vpk']);
    }
    // The Chacha path goes through the same service import.
    const viaAgent = await acquireMod(service, f.gameRoot, 'import', { file: await source('agent.vpk', '茶茶导入') }, approval);
    assert.equal(viaAgent.enabled, true);
    s = await service.dispatch('snapshot');
    assert.deepEqual(s.profiles[0].modIds, ['local.vpk', 'fresh.vpk', 'agent.vpk']);
    // Saving the profile clears inbox only for IDs the player adds now.
    await service.dispatch('save-mod-meta', { patch: { 'fresh.vpk': { inbox: true }, 'workshop/123.vpk': { inbox: true } } });
    await service.dispatch('save-profile', { profile: { ...s.profiles[0], modIds: [...s.profiles[0].modIds, 'workshop/123.vpk'] } });
    s = await service.dispatch('snapshot');
    assert.equal(s.modMeta['fresh.vpk'].inbox, true); assert.equal(s.modMeta['workshop/123.vpk'].inbox, false);
    // A profile owned by another game directory is left alone.
    await service.dispatch('save-profile', { profile: { ...s.profiles[0], modsGameRoot: path.join(f.base, 'another-game') } });
    assert.equal((await service.dispatch('import-mod', { file: await source('other.vpk', '别处') }, approval)).enabled, false);
    assert.equal((await service.dispatch('snapshot')).profiles[0].modIds.includes('other.vpk'), false);
  } finally { await service.close(); }
});

test('library P0: old settings migrate, metadata patches replace by ID, nested categories survive reload', async () => {
  const f = await fixture(), dataDir = path.join(f.base, 'settings');
  let service = new DesktopService({ dataDir, core: f.api });
  try {
    await service.dispatch('select-game', { gameRoot: f.gameRoot });
    const categories = [{ id: 'cat-none', name: '未分类' }, { id: 'outer', name: '外层' }, { id: 'inner', name: '内层', parentId: 'outer' }];
    await service.dispatch('save-categories', { categories, assignments: { 'local.vpk': 'inner' } });
    // Recreate the pre-feature settings shape to exercise load defaults.
    await service.close();
    const file = path.join(dataDir, 'settings.json'), saved = JSON.parse(await fs.readFile(file, 'utf8'));
    delete saved.modMeta; await fs.writeFile(file, JSON.stringify(saved));
    service = new DesktopService({ dataDir, core: f.api });
    assert.deepEqual((await service.dispatch('snapshot')).modMeta, {});
    await service.dispatch('save-mod-meta', { patch: { 'local.vpk': { favorite: true, inbox: true }, 'workshop/123.vpk': { favorite: true } } });
    await service.dispatch('save-mod-meta', { patch: { 'local.vpk': { inbox: true }, 'workshop/123.vpk': null } });
    await assert.rejects(service.dispatch('save-mod-meta', { patch: { 'local.vpk': { favorite: 'yes' } } }), e => e.code === 'invalid_argument');
    await service.close(); service = new DesktopService({ dataDir, core: f.api });
    const s = await service.dispatch('snapshot');
    assert.deepEqual(s.modMeta, { 'local.vpk': { inbox: true } });
    assert.deepEqual(s.categories, categories);
    assert.equal(s.mods.find(m => m.id === 'local.vpk').categoryId, 'inner');
  } finally { await service.close(); }
});

test('library thumbnails: embedded preload/split data, sidecar freshness and bounded JPEG-only URLs', async () => {
  const f = await fixture(), jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  for (const [name, options] of [['image.vpk', {}], ['image_dir.vpk', { split: true, version: 2 }]]) {
    await vpkFixture(path.join(f.addons, name), { 'addonimage.jpg': jpeg }, options);
    assert.equal((await f.manager.scan(f.gameRoot)).mods.find(m => m.id === name).hasThumbnail, true);
    assert.equal((await f.manager.thumbnail(f.gameRoot, name)).dataUrl, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
  }
  assert.deepEqual(await f.manager.thumbnail(f.gameRoot, 'local.vpk'), { dataUrl: null });
  const before = (await f.manager.scan(f.gameRoot)).mods.find(m => m.id === 'local.vpk').updatedAt;
  await fs.writeFile(path.join(f.addons, 'local.jpg'), jpeg);
  const after = (await f.manager.scan(f.gameRoot)).mods.find(m => m.id === 'local.vpk');
  assert.equal(after.hasThumbnail, true); assert.notEqual(after.updatedAt, before);
  assert.match((await f.manager.thumbnail(f.gameRoot, 'local.vpk')).dataUrl, /^data:image\/jpeg;base64,/);
  await fs.writeFile(path.join(f.addons, 'local.jpg'), '<svg onload="bad"/>');
  assert.deepEqual(await f.manager.thumbnail(f.gameRoot, 'local.vpk'), { dataUrl: null });
  await fs.truncate(path.join(f.addons, 'local.jpg'), 8 * 1024 * 1024 + 1);
  assert.deepEqual(await f.manager.thumbnail(f.gameRoot, 'local.vpk'), { dataUrl: null });
  await assert.rejects(f.manager.thumbnail(f.gameRoot, '../local.vpk'), e => e.code === 'invalid_argument');
});

test('library recycle: split files and JPG, confirmation/process guards, relationships, collision, restart and purge', async () => {
  const f = await fixture(), dataDir = path.join(f.base, 'settings');
  await vpkFixture(path.join(f.addons, 'split_dir.vpk'), { 'addoninfo.txt': addonInfo('分卷回收'), 'models/a.mdl': 'model'.repeat(20) }, { split: true });
  const cover = Buffer.from([255, 216, 255, 224, 20, 255, 217]);
  await fs.writeFile(path.join(f.addons, 'split_dir.jpg'), cover);
  let service = new DesktopService({ dataDir, core: f.api });
  try {
    await service.dispatch('select-game', { gameRoot: f.gameRoot });
    await service.dispatch('save-categories', { categories: [{ id: 'inner', parentId: 'outer', name: '内层' }], assignments: { 'split_dir.vpk': 'inner' } });
    await service.dispatch('save-mod-meta', { patch: { 'split_dir.vpk': { favorite: true } } });
    const p = (await service.dispatch('snapshot')).profiles[0];
    await service.dispatch('save-profile', { profile: { ...p, id: 'foreign', modIds: ['split_dir.vpk'], modsGameRoot: path.join(f.base, 'another-game') } });
    const preview = await service.dispatch('preview-delete-mods', { ids: ['split_dir.vpk'] });
    assert.deepEqual(preview.mods[0].files.map(x => x.file).sort(), ['split_000.vpk', 'split_dir.jpg', 'split_dir.vpk']);
    assert.deepEqual(preview.mods[0].profileIds, ['default']);
    await assert.rejects(service.dispatch('delete-mods', { ids: ['split_dir.vpk'] }), e => e.code === 'confirmation_required');
    f.setRunning([{ pid: 7 }]);
    await assert.rejects(service.dispatch('delete-mods', { ids: ['split_dir.vpk'] }, approval), e => e.code === 'game_running');
    f.setRunning([]);
    const { trashed } = await service.dispatch('delete-mods', { ids: ['split_dir.vpk', 'workshop/123.vpk'] }, approval);
    let s = await service.dispatch('snapshot');
    assert.deepEqual(s.mods.map(m => m.id), ['local.vpk']); assert.equal(s.conflicts.length, 0);
    assert.deepEqual(s.modMeta, {}); assert.equal(s.trash.length, 2);
    assert.deepEqual(s.profiles.find(p => p.id === 'default').modIds, ['local.vpk']);
    assert.deepEqual(s.profiles.find(p => p.id === 'foreign').modIds, ['split_dir.vpk']);
    await service.close(); service = new DesktopService({ dataDir, core: f.api });
    const trashId = trashed[0].trashId;
    assert.deepEqual(await service.dispatch('trash-thumbnail', { trashId }), { dataUrl: 'data:image/jpeg;base64,' + cover.toString('base64') });
    const fallback = await service.dispatch('trash-thumbnail', { trashId: trashed[1].trashId });
    assert.equal(fallback.dataUrl, null); assert.ok(fallback.dirs.includes('models'));
    await fs.writeFile(path.join(f.addons, 'split_000.vpk'), 'new download');
    let result = await service.dispatch('restore-mods', { trashIds: [trashId] }, approval);
    assert.equal(result.conflicts.length, 1); assert.equal(result.restored.length, 0);
    assert.equal(await fs.readFile(path.join(f.addons, 'split_000.vpk'), 'utf8'), 'new download');
    await fs.unlink(path.join(f.addons, 'split_000.vpk'));
    result = await service.dispatch('restore-mods', { trashIds: [trashId] }, approval);
    assert.deepEqual(result, { restored: ['split_dir.vpk'], conflicts: [] });
    s = await service.dispatch('snapshot');
    assert.equal(s.mods.find(m => m.id === 'split_dir.vpk').categoryId, 'inner');
    assert.equal(s.mods.find(m => m.id === 'split_dir.vpk').enabled, false);
    assert.equal(s.modMeta['split_dir.vpk'].favorite, true);
    assert.deepEqual(s.profiles.find(p => p.id === 'default').modIds.sort(), ['local.vpk', 'split_dir.vpk']);
    assert.equal(s.trash[0].workshopId, '123');
    await assert.rejects(service.dispatch('purge-trash', { trashIds: 'all' }), e => e.code === 'confirmation_required');
    f.setRunning([{ pid: 7 }]);
    await assert.rejects(service.dispatch('restore-mods', { trashIds: [s.trash[0].trashId] }, approval), e => e.code === 'game_running');
    await assert.rejects(service.dispatch('purge-trash', { trashIds: 'all' }, approval), e => e.code === 'game_running');
    f.setRunning([]);
    assert.deepEqual((await service.dispatch('purge-trash', { trashIds: 'all' }, approval)).purged, [trashed[1].trashId]);
    assert.deepEqual((await service.dispatch('snapshot')).trash, []);
  } finally { await service.close(); }
});

test('library recycle recovery: failed settings write rolls back; interrupted restore resumes safely', async () => {
  const f = await fixture(), service = new DesktopService({ dataDir: path.join(f.base, 'settings'), core: f.api });
  try {
    await service.dispatch('select-game', { gameRoot: f.gameRoot });
    const save = service.save.bind(service);
    service.save = async () => { throw new Error('simulated storage failure'); };
    await assert.rejects(service.dispatch('delete-mods', { ids: ['local.vpk'] }, approval), /simulated storage failure/);
    assert.equal((await service.dispatch('snapshot')).mods.length, 2);
    assert.deepEqual((await service.dispatch('snapshot')).trash, []);
    service.save = save;
    const { trashed } = await service.dispatch('delete-mods', { ids: ['local.vpk'] }, approval);
    const trashId = trashed[0].trashId;
    service.save = async () => { throw new Error('simulated restore interruption'); };
    await assert.rejects(service.dispatch('restore-mods', { trashIds: [trashId] }, approval), /simulated restore interruption/);
    assert.equal((await service.dispatch('snapshot')).trash[0].state, 'restoring');
    await assert.rejects(service.dispatch('purge-trash', { trashIds: [trashId] }, approval), e => e.code === 'trash_recovery_required');
    await assert.rejects(service.dispatch('apply-mod-profile', { id: 'default' }, approval), e => e.code === 'trash_recovery_required');
    service.save = save;
    assert.deepEqual(await service.dispatch('restore-mods', { trashIds: [trashId] }, approval), { restored: ['local.vpk'], conflicts: [] });
    assert.deepEqual((await service.dispatch('snapshot')).profiles[0].modIds, ['local.vpk']);
    assert.deepEqual((await service.dispatch('snapshot')).trash, []);
  } finally { await service.close(); }
});

test('library recycle interruption: moving manifest restores uninitialized profiles and deleted-category fallback', async () => {
  const f = await fixture(), dataDir = path.join(f.base, 'settings');
  await vpkFixture(path.join(f.addons, 'extra.vpk'), { 'models/extra.mdl': 'extra' });
  let service = new DesktopService({ dataDir, core: f.api });
  try {
    await service.dispatch('select-game', { gameRoot: f.gameRoot });
    await service.dispatch('save-categories', { categories: [{ id: 'old', name: '旧分类' }], assignments: { 'local.vpk': 'old' } });
    service.save = async () => { f.setRunning([{ pid: 7 }]); throw new Error('interruption before settings commit'); };
    await assert.rejects(service.dispatch('delete-mods', { ids: ['local.vpk'] }, approval), e => e.code === 'trash_recovery_required');
    await service.close(); f.setRunning([]);
    service = new DesktopService({ dataDir, core: f.api });
    const trash = (await service.dispatch('snapshot')).trash;
    assert.equal(trash[0].state, 'moving');
    await service.dispatch('save-categories', { categories: [], assignments: {} });
    await service.dispatch('restore-mods', { trashIds: [trash[0].trashId] }, approval);
    const s = await service.dispatch('snapshot');
    assert.deepEqual(s.profiles[0].modIds.sort(), ['extra.vpk', 'local.vpk']);
    assert.equal(s.mods.find(m => m.id === 'local.vpk').categoryId, 'cat-none');
    assert.deepEqual(s.trash, []);
  } finally { f.setRunning([]); await service.close(); }
});
