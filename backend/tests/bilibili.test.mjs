import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Bilibili, RequestGate, plainText, signWbi, videoRef } from '../bilibili.mjs';
import { DesktopService } from '../desktop/service.mjs';

const img = '7cd084941338484aae1ad9425b84077c', sub = '4932caff0ff746eab6f01bf08b70ac45';
const bvid = 'BV17x411w7KC';
const nav = { code: -101, data: { isLogin: false, wbi_img: { img_url: `https://i0.hdslb.com/bfs/wbi/${img}.png`, sub_url: `https://i0.hdslb.com/bfs/wbi/${sub}.png` } } };
const searchResult = { numResults: 31, numPages: 2, result: [{ bvid, title: '<em class="keyword">武器</em> &amp; &#x4e2d; &copy;',
  author: '作者', mid: 42, duration: '4:32', play: 100, favorites: 3, video_review: 4, pubdate: 1700000000,
  pic: '//i0.hdslb.com/test.jpg', description: '下载：https://example.com/?x=1&amp;y=2<br>提取码 abcd', tag: 'MOD,求生之路2' }] };
const detailResult = { bvid, aid: 170001, title: '视频', pic: '//i0.hdslb.com/test.jpg', owner: { name: '作者', mid: 42 },
  duration: 272, pubdate: 1700000000, stat: { view: 100, favorite: 3, danmaku: 4 }, desc: '旧版简介',
  desc_v2: [{ raw_text: '来源 ' }, { type: 2, raw_text: '作者' }, { raw_text: '\nhttps://example.com/?x=1&y=2' }] };
const ok = data => Response.json({ code: 0, data });
async function fixture(t, handler = () => undefined, options = {}) {
  const dataDir = options.dataDir ?? await fs.mkdtemp(path.join(os.tmpdir(), 'flare-bilibili-'));
  let time = 1702204169000;
  const now = () => time, gate = new RequestGate({ now, sleep: async ms => { time += ms; } });
  const calls = [];
  const fetch = async (address, init) => {
    const url = new URL(address); calls.push({ url, init, at: time });
    assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.Referer, 'https://search.bilibili.com/');
    assert.match(init.headers['User-Agent'], /Chrome/);
    assert.doesNotMatch(init.headers.Cookie ?? '', /SESSDATA|bili_jct|DedeUserID/);
    const response = await handler(url, init, calls);
    if (response) return response;
    if (url.pathname === '/x/frontend/finger/spi') return ok({ b_3: 'anon-device-3', b_4: 'anon-device-4==' });
    assert.equal(init.headers.Cookie, 'buvid3=anon-device-3; buvid4=anon-device-4==');
    if (url.pathname === '/x/web-interface/nav') return Response.json(nav);
    if (url.pathname === '/x/web-interface/wbi/search/type') return ok(searchResult);
    if (url.pathname === '/x/web-interface/view') return ok(detailResult);
    if (url.pathname === '/x/v2/reply/main') return ok({ top: { upper: { content: { message: '下载 https://example.com/file?pwd=abcd' } } } });
    assert.fail(`Unexpected request: ${url}`);
  };
  const client = new Bilibili({ dataDir, fetch, gate, now });
  t.after(() => client.close());
  return { client, dataDir, fetch, calls, now, advance: ms => { time += ms; } };
}

test('WBI fixed vector, plain text and strict video identifiers', () => {
  assert.equal(signWbi({ foo: '114', bar: '514', zab: 1919810 }, img, sub, 1702204169),
    'bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
  const query = signWbi({ keyword: "中文 mod!'()*" }, img, sub, 1702204169);
  assert.match(query, /^keyword=%E4%B8%AD%E6%96%87%20mod&/); assert(!query.includes('+'));
  assert.equal(plainText('<em>武器</em> &amp; &#20013; &copy;<br>x'), '武器 & 中 ©\nx');
  for (const id of [bvid, `https://www.bilibili.com/video/${bvid}/?p=2`, `m.bilibili.com/video/${bvid}`]) assert.equal(videoRef(id).key, bvid);
  assert.equal(videoRef('AV170001').key, 'av170001');
  for (const id of ['', 'av0', 'BVbad', 'https://bilibili.com.evil/video/' + bvid, 'http://127.0.0.1/',
    'file:///etc/passwd', 'https://user:pass@b23.tv/a', 'https://b23.tv:8888/a', 'https://b23.tv/a/b']) {
    assert.throws(() => videoRef(id), { code: 'bilibili_not_found' });
  }
});

test('anonymous search: signed parameters, coalescing, 5-minute cache, persisted cookie whitelist, shared gate', async t => {
  const f = await fixture(t), q = { keyword: ' 求生之路2 mod ', page: 2, order: 'stow' };
  for (const bad of [{ keyword: '' }, { ...q, page: 51 }, { ...q, page: 1.5 }, { ...q, keyword: '文'.repeat(101) }, { ...q, order: 'bad' }]) {
    assert.throws(() => f.client.search(bad), { code: 'invalid_argument' });
  }
  assert.equal(f.calls.length, 0);
  const [result, same] = await Promise.all([f.client.search(q), f.client.search(q)]);
  assert.deepEqual(result, same); assert.equal(f.calls.length, 3);
  assert.equal(result.items[0].title, '武器 & 中 ©');
  assert.equal(result.items[0].description, '下载：https://example.com/?x=1&y=2\n提取码 abcd');
  assert.equal(result.items[0].pubdate, '2023-11-14T22:13:20.000Z');
  assert.deepEqual(result.items[0].tags, ['MOD', '求生之路2']);
  assert.equal(result.totalPages, 2); assert.equal(result.page, 2);
  const signed = f.calls[2].url;
  assert.equal(signed.searchParams.get('order'), 'stow'); assert.equal(signed.searchParams.get('page_size'), '20');
  assert.match(signed.searchParams.get('w_rid'), /^[0-9a-f]{32}$/);
  await f.client.search(q); assert.equal(f.calls.length, 3);
  f.advance(300001); await f.client.search(q); assert.equal(f.calls.length, 4);
  const file = path.join(f.dataDir, 'bilibili-anonymous.json');
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { buvid3: 'anon-device-3', buvid4: 'anon-device-4==' });
  await fs.writeFile(file, JSON.stringify({ buvid3: 'anon-device-3', buvid4: 'anon-device-4==', SESSDATA: 'must-never-send' }));
  const second = new Bilibili({ dataDir: f.dataDir, fetch: f.fetch, gate: f.client.gate, now: f.now }); t.after(() => second.close());
  await Promise.all([second.search(q), f.client.search({ ...q, page: 3 })]);
  assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/spi')).length, 1);
  for (let i = 1; i < f.calls.length; i++) assert(f.calls[i].at - f.calls[i - 1].at >= 1000);
});

test('detail: one safe short-link hop, rich description, optional pinned comment and 10-minute cache', async t => {
  const f = await fixture(t, (url, init) => {
    if (url.hostname === 'b23.tv') {
      assert.equal(init.headers.Cookie, undefined);
      return new Response(null, { status: 302, headers: { Location: `https://www.bilibili.com/video/${bvid}?from=share` } });
    }
  });
  const item = await f.client.detail('https://b23.tv/example');
  assert.equal(item.duration, '4:32'); assert.equal(item.description, '来源 @作者 \nhttps://example.com/?x=1&y=2');
  assert.match(item.pinnedComment, /pwd=abcd/);
  assert.equal(f.calls.length, 4); // redirect, anonymous device, view, optional comments
  await f.client.detail(bvid); await f.client.detail('av170001'); await f.client.detail('https://b23.tv/example');
  assert.equal(f.calls.length, 4);
  f.advance(600001); await f.client.detail(bvid); assert.equal(f.calls.length, 6);
  assert(f.calls.every(c => ['b23.tv', 'api.bilibili.com'].includes(c.url.hostname)));
  const noComments = await fixture(t, url => url.pathname.includes('/reply/') ? new Response('', { status: 412 }) : undefined);
  assert.equal((await noComments.client.detail(bvid)).pinnedComment, undefined);
  for (const target of ['http://127.0.0.1/private', 'https://bilibili.com.evil/video/' + bvid, 'https://b23.tv/second', 'https://user@bilibili.com/video/' + bvid]) {
    const unsafe = await fixture(t, () => new Response(null, { status: 302, headers: { Location: target } }));
    await assert.rejects(unsafe.client.detail('https://b23.tv/example'), { code: 'bilibili_not_found' });
    assert.equal(unsafe.calls.length, 1);
  }
});

test('risk control: refresh signing keys once, classify HTTP/API blocks, recover without caching failures', async t => {
  for (const response of [{ code: -352 }, { code: -403 }, { code: 0, data: { v_voucher: 'challenge' } }]) {
    let attempts = 0;
    const f = await fixture(t, url => url.pathname.includes('/wbi/search/') && ++attempts <= 2 ? Response.json(response) : undefined);
    await assert.rejects(f.client.search({ keyword: 'mod' }), { code: 'bilibili_blocked' });
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/nav')).length, 2);
    assert.equal(attempts, 2);
    assert.equal((await f.client.search({ keyword: 'mod' })).items.length, 1);
  }
  let signedAttempts = 0;
  const recovered = await fixture(t, url => url.pathname.includes('/wbi/search/') && ++signedAttempts === 1 ? Response.json({ code: -352 }) : undefined);
  assert.equal((await recovered.client.search({ keyword: 'mod' })).items.length, 1); assert.equal(signedAttempts, 2);
  for (const response of [() => new Response('', { status: 412 }), () => Response.json({ code: -412 })]) {
    const f = await fixture(t, response);
    await assert.rejects(f.client.search({ keyword: 'mod' }), { code: 'bilibili_blocked' }); assert.equal(f.calls.length, 1);
  }
  const missing = await fixture(t, url => url.pathname.endsWith('/view') ? Response.json({ code: -404 }) : undefined);
  await assert.rejects(missing.client.detail(bvid), { code: 'bilibili_not_found' });
  const network = await fixture(t, () => { throw new Error('network failed'); });
  await assert.rejects(network.client.search({ keyword: 'mod' }), { code: 'bilibili_network' });
});

test('DesktopService exposes both commands without a game or Pi connection', async t => {
  const f = await fixture(t);
  const service = new DesktopService({ dataDir: f.dataDir, bilibiliFetch: f.fetch }); t.after(() => service.close());
  service.bilibili.gate = f.client.gate;
  assert.equal((await service.dispatch('bilibili-search', { keyword: 'mod' })).items[0].bvid, bvid);
  assert.equal((await service.dispatch('bilibili-detail', { id: bvid })).bvid, bvid);
});
