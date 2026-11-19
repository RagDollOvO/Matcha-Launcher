import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createFixture } from '../backend/tests/fixtures.mjs';
import { vpkFixture, addonInfo } from '../backend/tests/mods-fixtures.mjs';
import { zipFixture } from '../backend/tests/browser-fixtures.mjs';
const base = await fs.mkdtemp(path.resolve('checks/.artifacts/browser-desktop-'));
const fixture = await createFixture(base), dataDir = path.join(base, 'data'); await fs.mkdir(dataDir);
await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({ version: 1, gameRoot: fixture.gameRoot, profiles: [{ id: 'default', name: '浏览器离线验证', modIds: [], pluginIds: [], modsInitialized: true }], activeProfileId: 'default', categories: [], assignments: {}, modMeta: {} }));
const file = await vpkFixture(path.join(base, 'browser-demo.vpk'), { 'addoninfo.txt': addonInfo('浏览器下载验证'), 'scripts/browser.txt': 'fixture' });
const vpk = await fs.readFile(file), zip = zipFixture({ 'browser-zip.vpk': vpk });
const server = http.createServer((req, res) => {
  if (req.url === '/download.vpk' || req.url === '/download.zip') { const zipped = req.url.endsWith('zip'); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="browser-${zipped ? 'pack.zip' : 'demo.vpk'}"` }); res.end(zipped ? zip : vpk); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'flare_fixture=persistent; Max-Age=3600; Path=/' });
  res.end(`<!doctype html><html><head><title>Flare 浏览器验证</title><style>body{font:18px system-ui;padding:48px;color:#343025;background:#f8f6ef}a,button{display:inline-block;margin:12px;padding:12px}input{padding:10px}</style></head><body><h1>浏览器接入验证</h1><p>仅使用离线游戏夹具</p><input placeholder="标签页保留草稿" value="保留这段文字"><p><a href="/second" target="_blank">打开新标签页</a><a href="/download.vpk">下载 VPK</a><a href="/download.zip">下载 ZIP</a></p><p id="isolation">验证网页权限…</p><p id="cookie"></p><script>document.querySelector('#cookie').textContent='持久 Cookie：'+document.cookie; (async()=>{try{if(!window.__TAURI_INTERNALS__)throw Error('no bridge');await window.__TAURI_INTERNALS__.invoke('beacon_call',{command:'snapshot'});document.querySelector('#isolation').textContent='FAIL: remote bridge accessible';}catch{document.querySelector('#isolation').textContent='PASS: 网页与 Flare 操作权限隔离';}})();</script></body></html>`);
});
server.listen(5177, '127.0.0.1');
await fs.writeFile('checks/.artifacts/browser-desktop-current.json', JSON.stringify({ base, dataDir, gameRoot: fixture.gameRoot, url: 'http://127.0.0.1:5177' }, null, 2));
console.log(JSON.stringify({ base, dataDir, gameRoot: fixture.gameRoot, url: 'http://127.0.0.1:5177' }));
await new Promise(resolve => { process.stdin.once('data', resolve); process.stdin.once('end', resolve); process.once('SIGINT', resolve); });
server.close(); process.stdin.pause();
