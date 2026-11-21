import test from 'node:test';
import assert from 'node:assert/strict';
import { browseUrl, parseBrowse } from '../mods/workshop-browse.mjs';
import { Workshop } from '../mods/workshop.mjs';
import { TaskManager } from '../mods/tasks.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModLibrary } from '../mods/library.mjs';
import sharp from 'sharp';

// Minimal public SSR shape observed on Steam's L4D2 browse page, 2026-11-16.
const raw = { publishedfileid: '123', result: 1, consumer_appid: 550, consumer_app_id: 550, creator: '456', file_type: 0,
  title: '<script>title</script>', short_description: '作品', file_size: '100', time_updated: 1700000000,
  file_url: 'https://cdn.steamusercontent.com/ugc/sample', preview_url: 'https://images.steamusercontent.com/ugc/sample', tags: [{ tag: 'Weapons' }] };
function html(results = [raw], overrides = {}) {
  return `<script type="application/json" id="valve-ssr-data">${JSON.stringify({ renderContext: { queryData: JSON.stringify({ queries: [
    { queryKey: ['workshop_browse', { appid: 550 }, 1], state: { data: { eresult: 1, current_page: 2, total_pages: 3, total_count: 65, results, ...overrides } } },
    { queryKey: ['PlayerLinkDetails', '456'], state: { data: { public_data: { steamid: '456', persona_name: '作者' } } } },
  ] }) } }).replace(/</g, '\\u003c')}</script>`;
}

test('browse query preserves search, category, sort, pagination and collection; malformed pages fail visibly', () => {
  const url = new URL(browseUrl({ search: 'AK & 中文', tag: 'Weapons', sort: 'mostrecent', page: 2, kind: 'collection' }));
  assert.equal(url.origin, 'https://steamcommunity.com');
  for (const [k, v] of Object.entries({ appid: '550', searchtext: 'AK & 中文', 'requiredtags[]': 'Weapons', p: '2', section: 'collections', browsesort: 'mostrecent' })) assert.equal(url.searchParams.get(k), v);
  assert.equal(new URL(browseUrl({ search: ' tank hp ', sort: 'textsearch' })).searchParams.get('browsesort'), 'textsearch');
  assert.equal(new URL(browseUrl({ search: ' ', sort: 'textsearch' })).searchParams.get('browsesort'), 'trend');
  assert.throws(() => browseUrl({ page: -1 }), { code: 'invalid_argument' });
  const page = parseBrowse(html()); assert.equal(page.page, 2); assert.equal(page.authors.get('456'), '作者');
  assert.equal(parseBrowse(html([], { total_count: 0, total_pages: 0 })).total, 0);
  assert.throws(() => parseBrowse('<html>sign in</html>'), { code: 'workshop_page_changed' });
  assert.throws(() => parseBrowse(html([{ ...raw, consumer_appid: 440 }])), { code: 'workshop_page_changed' });
});

test('browse/detail/preview share trusted metadata, refresh library status, and keep remote text inert', async () => {
  let known = [], requests = 0, oversizedCanceled = false;
  const imageRequests = [];
  const preview = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#aaaaaa' } }).png().toBuffer();
  const workshop = new Workshop({ scan: async () => ({ mods: known }) }, { fetch: async (url) => {
    requests++;
    if (url.startsWith('https://steamcommunity.com/')) return new Response(html());
    if (url.includes('GetPublishedFileDetails')) return Response.json({ response: { publishedfiledetails: [{ ...raw, result: 1, consumer_app_id: 550, description: '[b]介绍[/b]\n[url=https://example.com]来源[/url]' }] } });
    const asset = new URL(url);
    assert.equal(asset.hostname, 'images.steamusercontent.com');
    imageRequests.push(asset.searchParams);
    if (asset.pathname === '/ugc/oversized') {
      return new Response(new ReadableStream({ cancel() { oversizedCanceled = true; } }), { headers: { 'Content-Length': String(5 * 1024 ** 2) } });
    }
    return new Response(preview);
  } });
  const query = { page: 2 };
  assert.equal((await workshop.browse('fixture', query)).items[0].downloadable, true);
  known = [{ workshopId: '123' }];
  const page = await workshop.browse('fixture', query);
  assert.equal(requests, 1); assert.equal(page.items[0].inLibrary, true); assert.equal(page.items[0].downloadable, false);
  assert.equal(page.items[0].title, '<script>title</script>'); assert.equal(page.items[0].authorName, '作者');
  const dataUrl = (await workshop.preview('123')).dataUrl;
  assert.match(dataUrl, /^data:image\/jpeg;base64,/);
  const image = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata();
  assert.equal(image.width, 640); assert.equal(image.height, 480);
  await workshop.preview('123'); assert.equal(requests, 2);
  const card = await workshop.preview('123', { size: 'card' });
  const cardImage = await sharp(Buffer.from(card.dataUrl.split(',')[1], 'base64')).metadata();
  assert.equal(cardImage.height, 200);
  assert.ok(cardImage.width <= 320);
  assert.deepEqual(imageRequests.map(u => [u.get('imw'), u.get('imh'), u.get('impolicy'), u.get('letterbox')]), [
    ['640', '480', 'Letterbox', 'false'], ['320', '200', 'Letterbox', 'false'],
  ]);
  const detail = await workshop.detail('', '123'); assert.equal(detail.inLibrary, false); assert.match(detail.description, /来源 \(https:\/\/example.com\)/);
  workshop.metadata.set('124', { ...raw, preview_url: 'https://127.0.0.1/private' });
  await assert.rejects(workshop.preview('124'), { code: 'download_origin' });
  workshop.metadata.set('125', { ...raw, preview_url: 'https://images.steamusercontent.com/ugc/oversized' });
  assert.deepEqual(await workshop.preview('125', { size: 'card' }), { dataUrl: null, detailOnly: true });
  assert.equal(oversizedCanceled, true);
  const before = requests;
  await workshop.preview('125', { size: 'card' });
  assert.equal(requests, before);
  const task = TaskManager.prototype.view({ taskId: 'test', kind: 'download', request: { id: '123', gameRoot: 'fixture' } });
  assert.equal(task.workshopId, '123'); assert.equal(task.request, undefined);
  await workshop.close();
});

test('canceling a workshop preview interrupts its transfer, including an early cancel', async () => {
  let requests = 0, seen;
  const workshop = new Workshop(null, { fetch: async (_url, { signal }) => {
    requests++;
    seen = signal;
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  workshop.remember(raw);
  const early = '10000000-1111-4111-8111-100000000000';
  workshop.cancelPreview(early);
  await assert.rejects(workshop.preview('123', { size: 'card', requestId: early }), { name: 'AbortError' });
  assert.equal(requests, 0);
  const requestId = '20000000-2222-4222-8222-200000000000';
  const pending = workshop.preview('123', { size: 'card', requestId });
  assert.equal(requests, 1);
  workshop.cancelPreview(requestId);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(seen.aborted);
  assert.equal(workshop.previewRequests.size, 0);
  assert.equal(workshop.previews.size, 0);
  await workshop.close();
});

test('Windows library publication waits out a transient sharing violation', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-publish-'));
  await fs.mkdir(path.join(root, 'left4dead2'));
  const library = new ModLibrary(), stage = path.join(await library.base(root, true), 'stage');
  await fs.mkdir(stage); await fs.writeFile(path.join(stage, 'mod.vpk'), 'fixture');
  const rename = fs.rename; let attempts = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from === stage && attempts++ < 1) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
    return rename(from, to);
  });
  assert.equal(await library.publish(root, stage, { id: '123', title: 'test', author: 'author' }), 'library:workshop:123');
  assert.equal(attempts, 2);
  assert.equal(await fs.readFile(path.join(root, 'left4dead2/.matcha-library/workshop/123/mod.vpk'), 'utf8'), 'fixture');
});
