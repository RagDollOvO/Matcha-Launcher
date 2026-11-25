import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseBrowse, parseDetail, browseUrl, GameMaps } from '../mods/gamemaps.mjs';
import { GameMapsBrowser } from '../desktop/gamemaps-browser.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { createPlatform } from '../core.mjs';
import { createFixture } from './fixtures.mjs';
import { vpkFixture, addonInfo } from './mods-fixtures.mjs';
import { zipFixture } from './browser-fixtures.mjs';

// Reduced markup from the live /l4d2/maps, /details/22803 and /details/4746 DOM,
// observed 2026-11-17. Instructions/Steam link below exercise optional fields.
const card = (id, title, { states = '', status = '' } = {}) => `<article class="list-item list-item-file" data-type="file" data-id="${id}"><div class="thumbnail"><img src="/img/card.jpg"></div><span class="type">3 Maps</span><div class="content"><header><a href="/details/${id}"><div class="title">${title}</div></a>${status}<span class="rating">8.9</span></header><p>Description</p><div class="byline">By PlayGamesTB</div><footer><ul class="states">${states}</ul><time datetime="2026-11-17T04:03:39"></time><span class="views"><span class="value">11,529</span></span></footer></div></article>`;
const listing = `<ul class="item-slide-list-items"><li>${card('27469', 'Featured')}</li></ul><div class="paged-list"><ul class="item-list itemlist-view-rows"><li>${card('36646', 'Blood Medal v0.4')}</li></ul><a rel="last" href="?page=77">77</a></div>`;
const detail = (id, name = 'COD5.zip') => `<title>Bloody Pacific (Map) for Left 4 Dead 2 - GameMaps.com</title><div class="title-block"><img class="thumbnail" src="/img/bloody.jpg"><div class="title-row"><aside class="item-typelabel">4 Maps</aside><h1>Bloody Pacific</h1></div></div>
<ul class="statsrow"><li class="views">81.9K</li><li class="rating"><button>Like</button></li></ul>
<section class="desc"><h2>Description</h2><pre>First line<br>Second &amp; third<script>bad()</script></pre></section>
<section class="instructions"><div><h2>Instructions</h2></div><pre>sv_consistency 0</pre></section>
<section class="developers"><ul data-file-id="${id}"><li><div class="username"><div class="username-val">Splinks</div></div></li><li><div class="username"><a class="username-val">PlayGamesTB</a><p>Design / Vscripts</p></div></li></ul></section>
<section class="details"><div class="info-card"><div><p title="${name}">${name.slice(0,5)}...</p><p><time datetime="2026-10-29T02:59:43">October 29</time> (199 MB)</p></div></div><div class="info-card changelog"><p>View Changelog</p><p>Version 1.0 Beta</p></div></section>
<section class="tags"><a class="bubble-button">Campaign</a></section><section class="media-carousel"><img src="/img/addons/l4d2/ss/a.jpg"></section>
<section class="linked"><article class="shortrow-item" data-item-id="4746"><div class="thumb"><img src="/img/a.jpg"><span class="type">Mod</span></div><header><h3>Minecraft Special Infected</h3></header><div class="game"><a href="/l4d2/">Left 4 Dead 2</a></div></article></section><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=123456">Steam</a>`;

test('GameMaps live DOM structure: main list, metadata, instructions and strict inputs', () => {
  const page = parseBrowse(listing);
  assert.equal(page.items.length, 1); assert.equal(page.items[0].id, '36646'); assert.equal(page.totalPages, 77);
  assert.equal(page.items[0].views, 11529); assert.equal(page.items[0].likes, undefined); assert.equal(page.items[0].author, 'PlayGamesTB');
  assert.equal(page.items[0].image, 'https://www.gamemaps.com/img/card.jpg');
  assert.equal(parseBrowse(listing.replaceAll('src="/img/card.jpg"', 'src="/img/placeholder.jpg" data-src="/img/card.jpg"')).items[0].image, page.items[0].image);
  assert.equal(parseBrowse(listing.replaceAll('src="/img/card.jpg"', '')).items[0].image, '');
  assert.deepEqual(page.items[0].flags, []);
  // Site markers observed on /l4d2/maps and /l4d2/mods, 2026-11-25.
  const marked = parseBrowse(`<div class="paged-list"><ul class="item-list">${[
    card('36797', 'Ink', { states: '<li class="new">New</li>', status: '<span class="status beta">Beta</span>' }),
    card('36793', 'Reality', { states: '<li class="updated">Updated</li>' }),
    card('30001', 'Old', { states: '<li class="archived">Archived</li><li class="hot">Hot</li>' }),
  ].map(c => `<li>${c}</li>`).join('')}</ul></div>`);
  assert.deepEqual(marked.items.map(i => i.flags), [['new', 'beta'], ['updated'], ['archived']]);
  const d = parseDetail(detail('22803'), '22803');
  assert.equal(d.title, 'Bloody Pacific'); assert.equal(d.file.name, 'COD5.zip'); assert.equal(d.file.sizeBytes, 199000000); assert.equal(d.file.version, '1.0 Beta');
  assert.equal(d.description, 'First line\nSecond & third'); assert.equal(d.instructions, 'sv_consistency 0'); assert.equal(d.views, 81900);
  assert.deepEqual(d.authors, [{ name: 'Splinks', role: '' }, { name: 'PlayGamesTB', role: 'Design / Vscripts' }]);
  assert.equal(d.linked[0].id, '4746'); assert.equal(d.screenshots.length, 1); assert.equal(d.workshopId, '123456');
  assert.throws(() => parseDetail(detail('22803'), '1234'), { code: 'gamemaps_not_found' });
  assert.throws(() => parseBrowse('<title>Just a moment...</title>'), { code: 'gamemaps_blocked' });
  assert.throws(() => parseBrowse('<h1>Unexpected</h1>'), { code: 'gamemaps_response' });
  assert.deepEqual(parseBrowse('<h1>No results found</h1>').items, []);
  assert.throws(() => browseUrl({ category: '../evil' }), { code: 'invalid_argument' });
  assert.match(browseUrl({ section: 'mods', category: 'weapons', page: 2 }), /l4d2\/mods\/weapons\/\?page=2/);
  assert.equal(new URL(browseUrl({ q: 'a & b' })).searchParams.get('q'), 'a & b');
});

test('GameMaps query cache deduplicates, expires at five minutes, and POSTs sort with one-second spacing', async () => {
  let now = 0; const calls = [], sleeps = [];
  const gm = new GameMaps({ now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; }, fetch: async (url, options) => {
    calls.push({ url, options, at: now }); return new Response(listing);
  } });
  try {
    await Promise.all([gm.browse({ sort: 'popular' }), gm.browse({ sort: 'popular' })]);
    assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.body, 'sort=popular');
    await gm.browse({ sort: 'rviews' }); assert.equal(calls[1].at - calls[0].at, 1000);
    now = 299999; await gm.browse({ sort: 'popular' }); assert.equal(calls.length, 2);
    now = 300000; await gm.browse({ sort: 'popular' }); assert.equal(calls.length, 3);
  } finally { await gm.close(); }
  const blocked = new GameMaps({ fetch: async () => new Response('blocked', { status: 403 }) });
  try { await assert.rejects(blocked.browse(), { code: 'gamemaps_blocked' }); } finally { await blocked.close(); }
});

async function ended(service, taskId) {
  for (let n = 0; n < 500; n++) {
    const task = service.tasks.view(service.tasks.get(taskId));
    if (['done', 'failed', 'canceled'].includes(task.state)) return task;
    await delay(10);
  }
  assert.fail('fixture task timed out');
}
test('GameMaps task: ZIP/shards, disabled inbox/origin, game-running retry, retained RAR and cancellation', async () => {
  const base = await fs.mkdtemp(path.resolve('checks/.artifacts/gamemaps-'));
  const fixture = await createFixture(base), dataDir = path.join(base, 'data');
  const source = path.join(base, 'source/split_dir.vpk');
  await vpkFixture(source, { 'addoninfo.txt': addonInfo('GM split'), 'scripts/a.txt': 'external shard payload' }, { split: true });
  const direct = path.join(base, 'source/direct.vpk'); await vpkFixture(direct, { 'addoninfo.txt': addonInfo('GM direct'), 'scripts/b.txt': 'b' });
  const payload = zipFixture({ 'folder/split_dir.vpk': await fs.readFile(source), 'folder/split_000.vpk': await fs.readFile(source.replace('_dir', '_000')), 'direct.vpk': await fs.readFile(direct) });
  let running = true, downloads = 0;
  const core = createPlatform({ getProcesses: async () => running ? [{ pid: 999, name: 'left4dead2.exe', executablePath: path.join(fixture.gameRoot, 'left4dead2.exe') }] : [] });
  core.discover = async () => ({ games: [await core.inspectGame(fixture.gameRoot)], warnings: [] });
  const service = new DesktopService({ dataDir, core, gamemapsBrowser: { request: async (p, signal, progress) => {
    if (p.kind === 'page') return { html: detail(new URL(p.url).pathname.split('/').at(-1)) };
    downloads++; if (p.itemId === '13') { await delay(10000, undefined, { signal }); }
    const file = path.join(p.downloadRoot, p.taskId, randomUUID(), p.itemId === '12' ? 'pack.rar' : 'pack.zip');
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, payload);
    progress({ done: payload.length, total: payload.length, unit: 'bytes' });
    return { path: file, name: path.basename(file), size: payload.length };
  } } });
  service.gamemaps.sleep = async () => {};
  const approval = { approved: true, source: 'user' };
  try {
    await assert.rejects(service.dispatch('gamemaps-download', { id: '11' }), { code: 'confirmation_required' }); assert.equal(downloads, 0);
    const { taskId } = await service.dispatch('gamemaps-download', { id: '11' }, approval);
    const first = await ended(service, taskId);
    assert.equal(first.state, 'failed', JSON.stringify(first)); assert.equal(first.error.code, 'game_running'); assert.equal(first.source, 'gamemaps'); assert.equal(first.sourceId, '11'); assert.equal(first.workshopId, undefined);
    assert.match(first.error.message, /重试/); assert.equal(downloads, 1);
    assert.equal((await service.modManager.scan(fixture.gameRoot)).mods.length, 0);
    running = false; await service.tasks.retry(taskId); const done = await ended(service, taskId);
    assert.equal(done.state, 'done', JSON.stringify(done)); assert.equal(downloads, 1); assert.equal(done.imported.length, 2);
    const snap = await service.snapshot();
    for (const id of done.imported) { const mod = snap.mods.find(m => m.id === id); assert.equal(mod.enabled, false); assert.equal(mod.origin.pageUrl, 'https://www.gamemaps.com/details/11'); assert.equal(mod.origin.downloadId, taskId); assert.equal(snap.modMeta[id].inbox, true); }
    await fs.access(path.join(fixture.gameRoot, 'left4dead2/addons/split_000.vpk'));
    const rar = await service.dispatch('gamemaps-download', { id: '12' }, approval), failed = await ended(service, rar.taskId);
    assert.equal(failed.error.code, 'archive_format'); assert.match(failed.error.message, /手动解压/); await fs.access(failed.dir);
    const cancel = await service.dispatch('gamemaps-download', { id: '13' }, approval);
    while (downloads < 3) await delay(10);
    await service.tasks.cancel(cancel.taskId); assert.equal((await ended(service, cancel.taskId)).state, 'canceled');
    const legacy = service.tasks.view({ kind: 'download', request: { id: '11' } }); assert.equal(legacy.workshopId, '11'); assert.equal(legacy.source, 'workshop');
    console.log(`GameMaps fixture: ${base}`);
  } finally { await service.close(); }
});

test('private WebView transport forwards progress, errors and cancellation without leaked jobs', async () => {
  const sent = [], transport = new GameMapsBrowser(x => sent.push(x)), progress = [];
  const result = transport.request({ kind: 'page', url: 'https://www.gamemaps.com/l4d2/maps' }, undefined, x => progress.push(x));
  const id = sent[0].id; transport.receive({ type: 'gamemaps_progress', id, progress: { done: 42 } });
  transport.receive({ type: 'gamemaps_response', id, result: { html: listing } });
  assert.equal((await result).html, listing); assert.equal(progress[0].done, 42);
  const abort = new AbortController(), canceled = transport.request({ kind: 'download' }, abort.signal);
  abort.abort(); await assert.rejects(canceled, { name: 'AbortError' }); assert.equal(sent.at(-1).type, 'gamemaps_cancel');
  const blocked = transport.request({ kind: 'page' }); transport.receive({ type: 'gamemaps_response', id: sent.at(-1).id, error: { code: 'gamemaps_blocked', message: 'Blocked' } });
  await assert.rejects(blocked, { code: 'gamemaps_blocked' }); assert.equal(transport.pending.size, 0); transport.close();
});
