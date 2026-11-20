import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import * as core from '../core.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { TaskManager } from '../mods/tasks.mjs';
import { steamAssetUrl } from '../mods/workshop.mjs';
import { createFixture } from './fixtures.mjs';
import { vpkFixture, addonInfo } from './mods-fixtures.mjs';
const approval = { approved: true, source: 'user' };
async function setup(extra = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-p2-')), game = await createFixture(base);
  const desktop = path.join(base, 'redirected-desktop'); await fs.mkdir(desktop);
  let running = [];
  const api = { ...core, ...core.createPlatform({ getProcesses: async () => running }), discover: async () => ({ games: [], warnings: [] }) };
  const service = new DesktopService({ dataDir: path.join(base, 'settings'), desktopDir: desktop, core: api, ...extra });
  await service.dispatch('select-game', { gameRoot: game.gameRoot });
  return { ...game, base, desktop, service, api, addons: path.join(game.gameRoot, 'left4dead2/addons'), running: value => { running = value; } };
}
async function finished(service, id) {
  const current = (await service.dispatch('task-list')).find(t => t.taskId === id);
  if (['done', 'failed', 'canceled'].includes(current?.state)) return current;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { service.off('event', listener); reject(new Error('task timed out')); }, 10000);
    const listener = e => { if (e.type === 'task_progress' && e.taskId === id && ['done', 'failed', 'canceled'].includes(e.state)) { clearTimeout(timer); service.off('event', listener); resolve(e); } };
    service.on('event', listener);
  });
}
function wav(tag, channels, block, samplesPerBlock) {
  const fmt = Buffer.alloc(tag === 2 ? 50 : tag === 17 ? 20 : 16);
  fmt.writeUInt16LE(tag, 0); fmt.writeUInt16LE(channels, 2); fmt.writeUInt32LE(8000, 4);
  fmt.writeUInt32LE(tag === 1 ? channels * 16000 : 8000, 8); fmt.writeUInt16LE(tag === 1 ? channels * 2 : block.length, 12); fmt.writeUInt16LE(tag === 1 ? 16 : 4, 14);
  if (tag !== 1) { fmt.writeUInt16LE(fmt.length - 18, 16); fmt.writeUInt16LE(samplesPerBlock, 18); }
  if (tag === 2) {
    fmt.writeUInt16LE(7, 20);
    [[256,0],[512,-256],[0,0],[192,64],[240,0],[460,-208],[392,-232]].flat().forEach((n, i) => fmt.writeInt16LE(n, 22 + i * 2));
  }
  const chunk = (name, body) => { const h = Buffer.alloc(8); h.write(name); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body, ...(body.length % 2 ? [Buffer.alloc(1)] : [])]); };
  const rest = Buffer.concat([chunk('fmt ', fmt), chunk('data', block)]), head = Buffer.alloc(12);
  head.write('RIFF'); head.writeUInt32LE(rest.length + 4, 4); head.write('WAVE', 8); return Buffer.concat([head, rest]);
}

test('P2 extraction: split/preload, redirected desktop, unique output and safe-path rejection', async () => {
  const f = await setup();
  try {
    const payload = Buffer.from('model'.repeat(300));
    await vpkFixture(path.join(f.addons, 'split_dir.vpk'), { 'addoninfo.txt': addonInfo('解包'), 'Models/Weapon.mdl': payload }, { split: true, version: 2 });
    await assert.rejects(f.service.dispatch('extract-mod', { id: 'split_dir.vpk' }), e => e.code === 'confirmation_required');
    const task = await f.service.dispatch('extract-mod', { id: 'split_dir.vpk' }, approval);
    const result = await finished(f.service, task.taskId); assert.equal(result.state, 'done', JSON.stringify(result.error));
    assert.equal(path.dirname(result.dir), f.desktop);
    assert.deepEqual(await fs.readFile(path.join(result.dir, 'Models/Weapon.mdl')), payload);
    const second = await finished(f.service, (await f.service.dispatch('extract-mod', { id: 'split_dir.vpk' }, approval)).taskId);
    assert.equal(path.basename(second.dir), '解包 (2)');
    await vpkFixture(path.join(f.addons, 'unsafe.vpk'), { 'models/CON.txt': 'bad' });
    const bad = await finished(f.service, (await f.service.dispatch('extract-mod', { id: 'unsafe.vpk' }, approval)).taskId);
    assert.equal(bad.error.code, 'unsafe_path');
    assert.equal((await fs.readdir(f.desktop)).some(n => n.startsWith('.flare-')), false);
  } finally { await f.service.close(); }
});

test('P2 audio: actual native MS-ADPCM mono/stereo and IMA decoding, PCM/MP3, sound counts', async () => {
  const f = await setup();
  try {
    const mono = Buffer.alloc(8); mono.writeInt16LE(16, 1); mono.writeInt16LE(1000, 3); mono.writeInt16LE(900, 5);
    const stereo = Buffer.alloc(15); stereo.writeInt16LE(16, 2); stereo.writeInt16LE(16, 4); stereo.writeInt16LE(1000, 6); stereo.writeInt16LE(-1000, 8); stereo.writeInt16LE(900, 10); stereo.writeInt16LE(-900, 12);
    const ima = Buffer.alloc(8); ima.writeInt16LE(1200, 0);
    const pcm = Buffer.alloc(8), mp3 = Buffer.from([0x49,0x44,0x33,1,2,3]);
    await vpkFixture(path.join(f.addons, 'sound_dir.vpk'), { 'sound/weapons/mono.wav': wav(2, 1, mono, 4), 'sound/weapons/stereo.wav': wav(2, 2, stereo, 3), 'sound/ima.wav': wav(17, 1, ima, 9), 'sound/pcm.wav': wav(1, 1, pcm), 'sound/test.mp3': mp3 }, { split: true });
    const s = await f.service.dispatch('snapshot'); assert.equal(s.mods[0].soundCount, 5);
    assert.equal((await f.service.dispatch('mod-sounds', { id: 'sound_dir.vpk' })).length, 5);
    for (const [name, expected] of [['weapons/mono', 900], ['weapons/stereo', 900], ['ima', 1200]]) {
      const out = await f.service.dispatch('mod-sound', { id: 'sound_dir.vpk', path: `sound/${name}.wav` });
      const bytes = Buffer.from(out.base64, 'base64'); assert.equal(out.mime, 'audio/wav');
      assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readInt16LE(44), expected);
      if (name.includes('stereo')) assert.equal(bytes.readInt16LE(46), -900);
    }
    assert.equal((await f.service.dispatch('mod-sound', { id: 'sound_dir.vpk', path: 'sound/pcm.wav' })).mime, 'audio/wav');
    assert.equal((await f.service.dispatch('mod-sound', { id: 'sound_dir.vpk', path: 'sound/test.mp3' })).base64, mp3.toString('base64'));
    await assert.rejects(f.service.dispatch('mod-sound', { id: 'sound_dir.vpk', path: '../other.wav' }), e => e.code === 'invalid_argument');
  } finally { await f.service.close(); }
});

test('P2 workshop/library: official-origin validation, collection, verified download, joins the launch profile, deploy/recycle/restore', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-workshop-source-'));
  const file = await vpkFixture(path.join(folder, 'source.vpk'), { 'addoninfo.txt': addonInfo('下载样本'), 'addonimage.jpg': Buffer.from([255,216,255,217]), 'sound/test.mp3': 'test' });
  const payload = await fs.readFile(file);
  const fakeFetch = async (url, options = {}) => {
    if (url.includes('GetCollectionDetails')) return Response.json({ response: { collectiondetails: [{ result: 1, publishedfileid: '100', children: [{ publishedfileid: '101' }, { publishedfileid: '102' }] }] } });
    if (url.includes('GetPublishedFileDetails')) {
      const ids = [...options.body].filter(([key]) => key.startsWith('publishedfileids')).map(([, value]) => value);
      return Response.json({ response: { publishedfiledetails: ids.map(id => ({ result: 1, publishedfileid: id, consumer_app_id: id === '102' ? 440 : 550, file_type: id === '100' ? 2 : 0, title: '样本', file_size: String(payload.length), file_url: 'https://cdn.steamusercontent.com/test.vpk' })) } });
    }
    return new Response(payload, { headers: { 'content-length': String(payload.length) } });
  };
  const f = await setup({ workshopFetch: fakeFetch });
  try {
    assert.throws(() => steamAssetUrl('https://127.0.0.1/a'), e => e.code === 'download_origin');
    const resolve = await f.service.dispatch('workshop-resolve', { ids: ['100'] });
    assert.deepEqual(resolve.items[0].children, ['101', '102']); assert.equal(resolve.items[1].downloadable, true); assert.equal(resolve.items[2].downloadable, false);
    await assert.rejects(f.service.dispatch('workshop-download', { ids: ['101'] }), e => e.code === 'confirmation_required');
    f.running([{ pid: 9 }]); // Independent-library download is allowed while the game runs.
    const result = await finished(f.service, (await f.service.dispatch('workshop-download', { ids: ['101'] }, approval)).taskIds[0]);
    assert.equal(result.state, 'done', JSON.stringify(result.error)); const id = result.modId;
    let s = await f.service.dispatch('snapshot');
    assert.equal(s.mods[0].storage, 'library'); assert.equal(s.mods[0].enabled, false); assert.equal(s.modMeta[id].inbox, true);
    assert.deepEqual(s.profiles[0].modIds, [id]); assert.equal((await fs.readdir(f.addons).catch(() => [])).length, 0); // deployed on the next apply
    assert.match((await f.service.dispatch('mod-thumbnail', { id })).dataUrl, /^data:image\/jpeg/);
    const sidecar = path.join(f.gameRoot, 'left4dead2/.matcha-library/workshop/101/mod.jpg');
    await fs.writeFile(sidecar, Buffer.from([255,216,255,0,217]));
    assert.equal((await f.service.dispatch('snapshot')).mods[0].hasThumbnail, true);
    assert.equal((await f.service.dispatch('mod-sounds', { id })).length, 1);
    await f.service.dispatch('save-profile', { profile: { ...s.profiles[0], modIds: [id], modsInitialized: true, modsGameRoot: f.gameRoot } });
    assert.equal((await f.service.dispatch('snapshot')).modMeta[id].inbox, true); // already a member by default, so still unsorted
    await assert.rejects(f.service.dispatch('apply-mod-profile', { id: 'default' }, approval), e => e.code === 'game_running');
    f.running([]); await f.service.dispatch('apply-mod-profile', { id: 'default' }, approval);
    s = await f.service.dispatch('snapshot'); assert.equal(s.mods.length, 1); assert.equal(s.mods[0].id, id); assert.equal(s.mods[0].enabled, true);
    assert.deepEqual(await fs.readFile(path.join(f.addons, 'matcha_ws_101.vpk')), payload);
    const { trashed } = await f.service.dispatch('delete-mods', { ids: [id] }, approval);
    assert.equal((await f.service.dispatch('snapshot')).mods.length, 0);
    assert.equal(await fs.access(path.join(f.addons, 'matcha_ws_101.vpk')).then(() => true, () => false), false);
    assert.deepEqual((await f.service.dispatch('restore-mods', { trashIds: [trashed[0].trashId] }, approval)).restored, [id]);
    assert.deepEqual(await fs.readFile(sidecar), Buffer.from([255,216,255,0,217]));
    s = await f.service.dispatch('snapshot'); assert.equal(s.mods[0].enabled, false); assert.deepEqual(s.profiles[0].modIds, [id]);
    // A newly created user file at the deployment name is preserved before any addonlist write.
    await fs.writeFile(path.join(f.addons, 'matcha_ws_101.vpk'), 'user-owned');
    const list = path.join(f.gameRoot, 'left4dead2/addonlist.txt'), before = await fs.readFile(list);
    await assert.rejects(f.service.dispatch('apply-mod-profile', { id: 'default' }, approval), e => e.code === 'deployment_conflict');
    assert.deepEqual(await fs.readFile(list), before); assert.equal(await fs.readFile(path.join(f.addons, 'matcha_ws_101.vpk'), 'utf8'), 'user-owned');
  } finally { await f.service.close(); }
});

test('P2 workshop cover: downloads persist a static JPEG beside a coverless VPK for offline use', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-cover-source-'));
  const payload = await fs.readFile(await vpkFixture(path.join(source, 'source.vpk'), { 'materials/test.vtf': 'texture' }));
  const preview = await sharp({ create: { width: 1000, height: 600, channels: 3, background: '#c9a754' } }).png().toBuffer();
  let imageRequests = 0, offline = false;
  const f = await setup({ workshopFetch: async (url, options = {}) => {
    assert.equal(offline, false, 'saved covers should load without Steam');
    if (url.includes('GetPublishedFileDetails')) return Response.json({ response: { publishedfiledetails: [{
      result: 1, publishedfileid: options.body.get('publishedfileids[0]'), consumer_app_id: 550, title: '无包内封面的 Mod',
      file_size: payload.length, file_url: 'https://cdn.steamusercontent.com/sample.vpk', preview_url: 'https://images.steamusercontent.com/ugc/cover',
    }] } });
    if (new URL(url).hostname === 'images.steamusercontent.com') { imageRequests++; return new Response(preview); }
    return new Response(payload);
  } });
  try {
    f.running([{ pid: 9 }]);
    const task = await finished(f.service, (await f.service.dispatch('workshop-download', { ids: ['701'] }, approval)).taskIds[0]);
    assert.equal(task.state, 'done', JSON.stringify(task.error));
    const folder = path.join(f.gameRoot, 'left4dead2/.matcha-library/workshop/701');
    const cover = await fs.readFile(path.join(folder, 'mod.jpg')), metadata = await sharp(cover).metadata();
    assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.width, 640); assert.equal(metadata.height, 384);
    assert.deepEqual(await fs.readFile(path.join(folder, 'mod.vpk')), payload);
    offline = true;
    assert.deepEqual(await f.service.dispatch('mod-thumbnail', { id: task.modId }), { dataUrl: `data:image/jpeg;base64,${cover.toString('base64')}` });
    assert.equal(imageRequests, 1);
    await f.service.modManager.library.cacheThumbnail(f.gameRoot, task.modId, Buffer.from('replacement'));
    assert.deepEqual(await fs.readFile(path.join(folder, 'mod.jpg')), cover);
    assert.deepEqual((await fs.readdir(folder)).sort(), ['item.json', 'mod.jpg', 'mod.vpk']);
    const snapshot = await f.service.dispatch('snapshot');
    assert.equal(snapshot.mods[0].hasThumbnail, true); assert.deepEqual(snapshot.profiles[0].modIds, [task.modId]);
    await assert.rejects(fs.access(f.addons), { code: 'ENOENT' });
  } finally { await f.service.close(); }
});

test('P2 workshop cover: a failed cover keeps the download usable and legacy entries backfill lazily', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-cover-legacy-'));
  const payload = await fs.readFile(await vpkFixture(path.join(source, 'source.vpk'), { 'materials/test.vtf': 'texture' }));
  const preview = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#5c8b9e' } }).png().toBuffer();
  let available = false, imageRequests = 0, releaseImage, imageStarted;
  const started = new Promise(resolve => { imageStarted = resolve; });
  const imageReady = new Promise(resolve => { releaseImage = resolve; });
  const f = await setup({ workshopFetch: async (url, options = {}) => {
    if (url.includes('GetPublishedFileDetails')) return Response.json({ response: { publishedfiledetails: [{
      result: 1, publishedfileid: options.body.get('publishedfileids[0]'), consumer_app_id: 550, title: '封面补齐',
      file_size: payload.length, file_url: 'https://cdn.steamusercontent.com/sample.vpk', preview_url: 'https://images.steamusercontent.com/ugc/legacy',
    }] } });
    if (new URL(url).hostname === 'images.steamusercontent.com') {
      imageRequests++;
      if (!available) return new Response('unavailable', { status: 503 });
      imageStarted(); await imageReady; return new Response(preview);
    }
    return new Response(payload);
  } });
  try {
    const task = await finished(f.service, (await f.service.dispatch('workshop-download', { ids: ['702'] }, approval)).taskIds[0]);
    assert.equal(task.state, 'done', JSON.stringify(task.error));
    const library = f.service.modManager.library, stage = path.join(await library.base(f.gameRoot), 'legacy-stage');
    await fs.mkdir(stage); await fs.writeFile(path.join(stage, 'mod.vpk'), payload);
    const id = await library.publish(f.gameRoot, stage, { id: '703', title: '旧条目', author: '' });
    const before = (await f.service.dispatch('snapshot')).mods.find(m => m.id === id);
    assert.equal(before.hasThumbnail, false);
    await assert.rejects(f.service.dispatch('mod-thumbnail', { id }), { code: 'workshop_http' });
    available = true;
    const requestsBefore = imageRequests;
    const pending = Promise.all([f.service.dispatch('mod-thumbnail', { id }), f.service.dispatch('mod-thumbnail', { id })]);
    await started;
    // A slow image transfer leaves inventory and other desktop actions responsive.
    await f.service.dispatch('snapshot');
    releaseImage();
    const [a, b] = await pending;
    assert.match(a.dataUrl, /^data:image\/jpeg;base64,/); assert.deepEqual(a, b);
    assert.equal(imageRequests, requestsBefore + 1);
    const after = (await f.service.dispatch('snapshot')).mods.find(m => m.id === id);
    assert.equal(after.hasThumbnail, true); assert.notEqual(after.updatedAt, before.updatedAt);
    assert.deepEqual(await fs.readFile(after.absolutePath), payload);
    assert.match((await f.service.dispatch('mod-thumbnail', { id: task.modId })).dataUrl, /^data:image\/jpeg;base64,/);
  } finally { releaseImage(); await f.service.close(); }
});

test('P2 workshop cover: numeric imports and subscribed files backfill locally with verified L4D2 identity', async () => {
  const preview = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#527d99' } }).png().toBuffer();
  let imageRequests = 0, apiRequests = 0;
  const f = await setup({ workshopFetch: async (url, options = {}) => {
    if (url.includes('GetPublishedFileDetails')) {
      apiRequests++;
      const id = options.body.get('publishedfileids[0]');
      return Response.json({ response: { publishedfiledetails: [{ result: 1, publishedfileid: id,
        consumer_app_id: id === '777' ? 440 : 550, preview_url: 'https://images.steamusercontent.com/ugc/numeric-cover',
      }] } });
    }
    imageRequests++; return new Response(preview);
  } });
  try {
    const ids = ['1286233854.vpk', 'workshop/1286233854.vpk', '777.vpk', 'local-no-cover.vpk'];
    const payloads = new Map();
    for (const id of ids) {
      const file = await vpkFixture(path.join(f.addons, id), { 'materials/door.vtf': 'coverless texture' });
      payloads.set(id, await fs.readFile(file));
    }
    const list = path.join(f.gameRoot, 'left4dead2/addonlist.txt');
    const original = '"AddonList" { "1286233854.vpk" "0" "workshop/1286233854.vpk" "1" }';
    await fs.writeFile(list, original); f.running([{ pid: 9 }]);
    for (const id of ids.slice(0, 2)) {
      const image = await f.service.dispatch('mod-thumbnail', { id });
      assert.match(image.dataUrl, /^data:image\/jpeg;base64,/);
      assert.deepEqual(await fs.readFile(path.join(f.addons, id.replace(/\.vpk$/, '.jpg'))), Buffer.from(image.dataUrl.split(',')[1], 'base64'));
      assert.deepEqual(await fs.readFile(path.join(f.addons, id)), payloads.get(id));
      assert.deepEqual(await f.service.dispatch('mod-thumbnail', { id }), image);
    }
    assert.equal(imageRequests, 1);
    // Cached metadata is checked too, including records seen on another game's detail page.
    f.service.workshop.remember({ result: 1, publishedfileid: '777', consumer_app_id: 440, preview_url: 'https://images.steamusercontent.com/ugc/numeric-cover' });
    assert.deepEqual(await f.service.dispatch('mod-thumbnail', { id: '777.vpk' }), { dataUrl: null });
    assert.deepEqual(await f.service.dispatch('mod-thumbnail', { id: 'local-no-cover.vpk' }), { dataUrl: null });
    assert.equal(imageRequests, 1); assert.equal(apiRequests, 1);
    await assert.rejects(fs.access(path.join(f.addons, '777.jpg')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(list, 'utf8'), original);
    const inventory = await f.service.modManager.scan(f.gameRoot);
    assert.equal(inventory.mods.find(m => m.id === ids[0]).source, 'local');
    assert.equal(inventory.mods.find(m => m.id === ids[0]).enabled, false);
    assert.equal(inventory.mods.find(m => m.id === ids[1]).enabled, true);
  } finally { await f.service.close(); }
});

test('P2 workshop cover: canceling during cover retrieval removes staging and leaves the library unpublished', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-cover-cancel-'));
  const payload = await fs.readFile(await vpkFixture(path.join(source, 'source.vpk'), { 'materials/test.vtf': 'texture' }));
  let imageStarted;
  const started = new Promise(resolve => { imageStarted = resolve; });
  const f = await setup({ workshopFetch: async (url, options = {}) => {
    if (url.includes('GetPublishedFileDetails')) return Response.json({ response: { publishedfiledetails: [{
      result: 1, publishedfileid: '704', consumer_app_id: 550, title: '封面取消', file_size: payload.length,
      file_url: 'https://cdn.steamusercontent.com/sample.vpk', preview_url: 'https://images.steamusercontent.com/ugc/held',
    }] } });
    if (new URL(url).hostname === 'images.steamusercontent.com') {
      imageStarted();
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    return new Response(payload);
  } });
  try {
    const { taskIds: [taskId] } = await f.service.dispatch('workshop-download', { ids: ['704'] }, approval);
    await started; await f.service.dispatch('task-cancel', { taskId });
    assert.equal((await finished(f.service, taskId)).state, 'canceled');
    assert.deepEqual((await f.service.dispatch('snapshot')).mods, []);
    assert.equal((await fs.readdir(await f.service.modManager.library.base(f.gameRoot))).some(n => n.startsWith('.flare-download-')), false);
  } finally { await f.service.close(); }
});

test('P2 tasks: cancellation stays responsive, retry and restart expose accurate states', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-tasks-')); let attempts = 0;
  const tasks = new TaskManager({ dataDir: base, emit: () => {}, run: async (_kind, _request, ctx) => {
    attempts++;
    if (attempts === 1) await new Promise((resolve, reject) => { ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true }); });
    return { value: 1 };
  } });
  const { taskId } = await tasks.create('extract', { gameRoot: 'fixture', id: 'x' }, '任务');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tasks.list()[0].state, 'running'); await tasks.cancel(taskId); await tasks.live.get(taskId)?.promise;
  assert.equal(tasks.list()[0].state, 'canceled'); await tasks.retry(taskId); await new Promise(resolve => setImmediate(resolve)); await tasks.live.get(taskId)?.promise;
  assert.equal(tasks.list()[0].state, 'done'); await tasks.close();
  const file = path.join(base, 'tasks.json'), saved = JSON.parse(await fs.readFile(file, 'utf8')); saved.tasks[0].state = 'running'; await fs.writeFile(file, JSON.stringify(saved));
  const restarted = new TaskManager({ dataDir: base, emit: () => {}, run: async () => ({}) }); await restarted.ready;
  assert.equal(restarted.list()[0].error.code, 'task_interrupted'); await restarted.close();
});

test('download controls: release slots, resume at tail, preserve paused tasks and history across restart', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-download-queue-'));
  const old = { kind: 'download', request: { id: '91' }, state: 'done', cancelable: false, updatedAt: '2026-01-01T00:00:00.000Z' };
  await fs.writeFile(path.join(dataDir, 'tasks.json'), JSON.stringify({ version: 1, tasks: Array.from({ length: 505 }, (_, i) => ({ ...old, taskId: 'old-' + i })) }));
  let service = new DesktopService({ dataDir }); const runs = [];
  const hold = (_kind, request, ctx) => new Promise((resolve, reject) => {
    runs.push(request.id); ctx.progress({ done: 12, total: 237 }); ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
  });
  service.runTask = hold;
  const call = (cmd, params) => service.dispatch(cmd, params);
  const make = async id => (await service.tasks.create('download', { id, gameRoot: 'fixture' }, id)).taskId;
  const state = id => service.tasks.view(service.tasks.get(id));
  try {
    assert.deepEqual(await call('download-settings-get'), { maxConcurrent: 2, speedLimit: 0 });
    await assert.rejects(call('download-settings-set', { maxConcurrent: 5 }), { code: 'invalid_argument' });
    const a = await make('a'), b = await make('b'), c = await make('c'), d = await make('d');
    assert.deepEqual(runs, ['a', 'b']);
    await call('download-settings-set', { maxConcurrent: 1 });
    assert.equal(state(b).state, 'running');
    const paused = await call('task-pause', { taskId: a });
    assert.equal(paused.state, 'paused'); assert.equal(paused.resumable, false); assert.equal(paused.done, 12);
    assert.equal(state(c).state, 'queued');
    await call('task-resume', { taskId: a }); assert.equal(state(a).done, 0);
    await call('task-pause', { taskId: b }); assert.equal(state(c).state, 'running');
    await call('download-settings-set', { maxConcurrent: 2, speedLimit: 17 });
    assert.deepEqual(runs, ['a', 'b', 'c', 'd']); assert.equal(state(a).state, 'queued');
    await call('task-pause', { taskId: a }); await call('task-cancel', { taskId: a });
    assert.ok(Date.parse(state(a).finishedAt));
    assert.deepEqual(await call('task-remove', { taskIds: ['old-0', b, a, c, d, a, 'missing'] }), { removed: ['old-0', a] });
    await service.close(); service = new DesktopService({ dataDir }); service.runTask = hold;
    const restored = await call('task-list');
    assert.equal(restored.length, 507); assert.equal(state(b).state, 'paused');
    assert.equal(state('old-1').finishedAt, old.updatedAt);
    assert.deepEqual(await call('download-settings-get'), { maxConcurrent: 2, speedLimit: 17 });
    assert.equal(restored.some(t => t.taskId === a || t.taskId === 'old-0'), false);
    await call('task-resume', { taskId: b }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(state(b).state, 'running'); assert.equal(runs.at(-1), 'b');
  } finally { await service.close(); }
});

test('workshop transfer: change a live byte limit, pause without publishing and remove only the finished record', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-paced-mod-'));
  const bytes = await fs.readFile(await vpkFixture(path.join(source, 'test.vpk'), { 'materials/test.vtf': Buffer.alloc(64 * 1024, 7) }));
  let bodies = 0;
  const f = await setup({ workshopFetch: async url => url.includes('GetPublishedFileDetails')
    ? Response.json({ response: { publishedfiledetails: [{ publishedfileid: '704', result: 1, consumer_app_id: 550, file_size: bytes.length, file_url: 'https://cdn.steamusercontent.com/704' }] } })
    : (++bodies, new Response(bytes)) });
  const call = (cmd, p) => f.service.dispatch(cmd, p);
  const progress = () => new Promise(resolve => {
    const listen = e => { if (e.type === 'task_progress' && e.state === 'running' && e.done > 0) { f.service.off('event', listen); resolve(e); } };
    f.service.on('event', listen);
  });
  try {
    await call('download-settings-set', { speedLimit: 8192 });
    const first = progress();
    const { taskIds: [id] } = await f.service.dispatch('workshop-download', { ids: ['704'] }, approval);
    assert.ok((await first).done < bytes.length);
    const paused = await call('task-pause', { taskId: id });
    assert.ok(paused.done > 0 && paused.done < bytes.length); assert.equal(paused.state, 'paused');
    assert.deepEqual((await f.service.modManager.scan(f.gameRoot)).mods, []);
    const next = progress();
    assert.equal((await call('task-resume', { taskId: id })).taskId, id); await next;
    // At 1 B/s this file would take hours. Lifting that limit wakes the same reader.
    await call('download-settings-set', { speedLimit: 1 });
    await call('download-settings-set', { speedLimit: 0 });
    const result = await finished(f.service, id);
    assert.equal(result.state, 'done', JSON.stringify(result.error)); assert.equal(bodies, 2);
    await call('task-remove', { taskIds: [id] });
    const file = await f.service.modManager.resolve(f.gameRoot, result.modId);
    assert.deepEqual(await fs.readFile(file), bytes);
    assert.deepEqual(await call('task-list'), []);
  } finally { await f.service.close(); }
});

test('P2 download failure paths: cancel removes owned staging, retry succeeds, corrupt payload stays out of library', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-cancel-source-'));
  const file = await vpkFixture(path.join(source, 'source.vpk'), { 'addoninfo.txt': addonInfo('取消夹具'), 'models/test.mdl': 'data'.repeat(100) });
  const payload = await fs.readFile(file); let hold = true, damaged = false, started;
  const bodyStarted = new Promise(resolve => { started = resolve; });
  const fakeFetch = async (url, options = {}) => {
    if (url.includes('GetPublishedFileDetails')) {
      const id = options.body.get('publishedfileids[0]');
      return Response.json({ response: { publishedfiledetails: [{ publishedfileid: id, result: 1, consumer_app_id: 550, file_type: 0, title: '下载夹具', file_size: payload.length, file_url: 'https://cdn.steamusercontent.com/sample' }] } });
    }
    if (hold) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(payload.subarray(0, 12)); started();
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
    } }));
    const data = Buffer.from(payload); if (damaged) data[data.length - 1] ^= 255;
    return new Response(data);
  };
  const f = await setup({ workshopFetch: fakeFetch });
  try {
    const { taskIds: [id] } = await f.service.dispatch('workshop-download', { ids: ['201'] }, approval);
    await bodyStarted;
    assert.equal((await f.service.dispatch('snapshot')).mods.length, 0);
    await f.service.dispatch('task-cancel', { taskId: id });
    assert.equal((await finished(f.service, id)).state, 'canceled');
    const base = path.join(f.gameRoot, 'left4dead2/.matcha-library');
    assert.equal((await fs.readdir(base)).some(n => n.startsWith('.flare-download-')), false);
    hold = false;
    await f.service.dispatch('task-retry', { taskId: id }, approval);
    assert.equal((await finished(f.service, id)).state, 'done');
    damaged = true;
    const bad = await finished(f.service, (await f.service.dispatch('workshop-download', { ids: ['202'] }, approval)).taskIds[0]);
    assert.equal(bad.state, 'failed'); assert.equal(bad.error.code, 'invalid_vpk');
    assert.deepEqual((await f.service.dispatch('snapshot')).mods.map(m => m.workshopId), ['201']);
    assert.equal((await fs.readdir(base)).some(n => n.startsWith('.flare-download-')), false);
  } finally { await f.service.close(); }
});

test('favorite file tools export and preview original files independently of profiles', async () => {
  const f=await setup(), call=(cmd,p)=>f.service.dispatch(cmd,p,approval);
  try {
    const folder=path.join(f.base,'source'), file=path.join(f.base,'外部声音.vpk'), sample=Buffer.from('ID3test');
    await fs.mkdir(path.join(folder,'sound'),{recursive:true});
    await fs.writeFile(path.join(folder,'sound/test.mp3'),sample);
    await vpkFixture(file,{'sound/test.mp3':sample});
    await call('bookmark-files',{paths:[file,folder]});
    const refs=Object.values(f.service.settings.favoriteRefs), [vpk,material]=refs;
    const original=structuredClone(f.service.settings.profiles);
    assert.deepEqual((await call('mod-sounds',{id:vpk.id})).map(r=>r.path),['sound/test.mp3']);
    assert.equal((await call('mod-sound',{id:vpk.id,path:'sound/test.mp3'})).base64,sample.toString('base64'));
    let task=await finished(f.service,(await call('extract-mod',{id:vpk.id})).taskId);
    assert.deepEqual(await fs.readFile(path.join(task.dir,'sound/test.mp3')),sample);
    for(const name of ['source.vpk','source (2).vpk']){
      task=await finished(f.service,(await call('pack-favorite-folder',{id:material.id})).taskId);
      assert.equal(task.output,path.join(f.desktop,name),JSON.stringify(task.error));
      assert.equal((await f.service.modManager.cached(task.output)).soundCount,1);
    }
    const first=await call('edit-favorite-collection',{action:'create',name:'A',modIds:[vpk.id,material.id]});
    await call('edit-favorite-collection',{action:'create',name:'B',modIds:[vpk.id],fromCollectionId:first.id});
    assert.deepEqual(f.service.settings.favoriteCollections.map(c=>c.modIds),[[material.id],[vpk.id]]);
    const plan=await call('preview-recycle-favorites',{ids:[vpk.id]});
    assert.equal(plan[0].file,file);
    await assert.rejects(f.service.dispatch('recycle-favorite-files',{ids:[vpk.id],plan}),{code:'confirmation_required'});
    await fs.appendFile(file,'changed');
    await assert.rejects(call('recycle-favorite-files',{ids:[vpk.id],plan}),{code:'file_changed'});
    assert.deepEqual(f.service.settings.profiles,original);
    await assert.rejects(fs.stat(path.join(f.addons,'source.vpk')),{code:'ENOENT'});
  } finally { await f.service.close(); }
});
