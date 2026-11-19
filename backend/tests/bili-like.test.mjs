import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const script = await fs.readFile(new URL('../../src-tauri/src/browser/bili-like.js', import.meta.url), 'utf8');
const bvid = 'BV1xx411c7mD', video = 'https://www.bilibili.com/video/' + bvid;
const api = 'https://api.bilibili.com/x/web-interface/archive/';
async function click(replies, cookie = 'DedeUserID=fixture; bili_jct=fixture-csrf', url = video) {
  const requests = [], window = {};
  const fetch = async (url, init) => {
    requests.push({ url, init });
    const json = replies[requests.length - 1];
    return { ok: !!json, json: () => json };
  };
  await vm.runInNewContext(script, { window, document: { cookie }, location: new URL(url), fetch, URLSearchParams })(bvid);
  return { ...window.__matchaBiliLikeResult, requests };
}
test('B站卡片：登录、已赞、成功、拒绝；只对当前视频发出一次点赞', async () => {
  for (const [replies, cookie, url, status, count] of [
    [[], '', video, 'login', 0], [[], 'bili_jct=fixture', video + 'x', 'failed', 0],
    [[{ code:-101 }], undefined, video, 'login', 1], [[{ code:0, data:1 }], undefined, video, 'already', 1],
    [[{ code:0, data:null }], undefined, video, 'failed', 1], [[{ code:0, data:0 }, { code:65006 }], undefined, video, 'already', 2],
  ]) {
    const r = await click(replies, cookie, url); assert.equal(r.status, status); assert.equal(r.requests.length, count);
  }
  const r = await click([{ code:0, data:0 }, { code:0 }]);
  assert.equal(r.status, 'voted');
  assert.deepEqual(r.requests.map(x => [x.url, x.init.method ?? 'GET', x.init.credentials, x.init.redirect]), [
    [api + 'has/like?bvid=' + bvid, 'GET', 'include', 'error'], [api + 'like', 'POST', 'include', 'error'],
  ]);
  assert.deepEqual(Object.fromEntries(r.requests[1].init.body), { bvid, like:'1', csrf:'fixture-csrf' });
  const refused = await click([{ code:0, data:0 }, { code:-412, message:'请稍后再试' }]);
  assert.equal(refused.status, 'failed'); assert.equal(refused.message, '请稍后再试'); assert.equal(refused.requests.length, 2);
});
