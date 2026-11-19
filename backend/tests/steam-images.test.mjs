import assert from 'node:assert/strict';
import { test } from 'node:test';
import { steamImageUrl } from '../community/images.mjs';
import { createWorkshopNetwork } from '../mods/workshop-network.mjs';

const source = 'https://images.steamusercontent.com/ugc/123/ABC/?imw=320&imh=200&imcolor=%23000000';
const target = source.replace('images.steamusercontent.com', 'steamuserimages-a.akamaihd.net');

test('Steam image route preserves UGC path and sizing, only while enabled', () => {
  assert.equal(steamImageUrl(source, true), target);
  assert.equal(steamImageUrl(source, true, 'HEAD'), target);
  assert.equal(steamImageUrl(new URL(source), true, 'get'), target);
  assert.equal(steamImageUrl(source, false), source);
  assert.equal(steamImageUrl(source, true, 'POST'), source);
  for (const url of ['http://images.steamusercontent.com/ugc/123/ABC/', 'https://images.steamusercontent.com:8443/ugc/123/ABC/',
    'https://user:secret@images.steamusercontent.com/ugc/123/ABC/', 'https://images.steamusercontent.com/login/',
    'https://images.steamusercontent.com.example.org/ugc/123/ABC/', 'https://www.gamemaps.com/ugc/123/ABC/']) {
    assert.equal(steamImageUrl(url, true), url);
  }
});

test('Workshop requests switch image origins with the live acceleration state', async () => {
  const requests = [];
  const community = { active: true, ca: 'test CA' };
  const network = createWorkshopNetwork({ community, fetch: async (url, options) => {
    requests.push({ url, options }); return new Response('image');
  } });
  const signal = AbortSignal.timeout(5000);
  try {
    await network.fetch(source, { signal, headers: { Accept: 'image/*' } });
    assert.equal(requests[0].url, target);
    assert.equal(requests[0].options.signal, signal);
    assert.equal(requests[0].options.headers.Accept, 'image/*');
    const accelerated = requests[0].options.dispatcher;
    assert.ok(accelerated);
    community.active = false;
    await network.fetch(source);
    assert.equal(requests[1].url, source);
    assert.notEqual(requests[1].options.dispatcher, accelerated);
    community.active = true;
    await network.fetch(source);
    assert.equal(requests[2].url, target);
    assert.equal(requests[2].options.dispatcher, accelerated);
    await network.fetch('https://www.gamemaps.com/ugc/123/ABC/');
    assert.equal(requests[3].url, 'https://www.gamemaps.com/ugc/123/ABC/');
    assert.notEqual(requests[3].options.dispatcher, accelerated);
  } finally { await network.close(); }
});
