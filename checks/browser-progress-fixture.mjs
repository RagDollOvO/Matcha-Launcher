// Local, throttled browser downloads. The game files are non-executable metadata fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createFixture } from '../backend/tests/fixtures.mjs';
import { zipFixture } from '../backend/tests/browser-fixtures.mjs';

const project = path.resolve(import.meta.dirname, '..');
const base = await fs.mkdtemp(path.join(project, 'checks/.artifacts/browser-progress-desktop-'));
const { gameRoot } = await createFixture(base);
const dataDir = path.join(base, 'data');
await fs.mkdir(dataDir);
await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
  version: 1, gameRoot, profiles: [{ id: 'default', name: '下载进度离线验证', modIds: [], pluginIds: [] }],
  activeProfileId: 'default', categories: [], assignments: {}, modMeta: {},
}));
const content = zipFixture({ 'progress-fixture.txt': Buffer.alloc(2 * 1024 * 1024, 'x') });
let requests = 0;
const streams = new Set();
const server = http.createServer((req, res) => {
  if (req.url === '/known.zip' || req.url === '/unknown.zip' || req.url === '/broken.zip') {
    const mode = req.url.slice(1, -4), number = ++requests;
    console.log(JSON.stringify({ event: 'request', mode, number }));
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${mode}.zip"`,
      'Cache-Control': 'no-store', ...(mode === 'unknown' ? {} : { 'Content-Length': String(content.length) }) });
    let offset = 0;
    streams.add(res);
    const timer = setInterval(() => {
      if (mode === 'broken' && offset >= 256 * 1024) { res.destroy(); return; }
      const end = Math.min(content.length, offset + 64 * 1024);
      res.write(content.subarray(offset, end)); offset = end;
      if (offset === content.length) res.end();
    }, 200);
    res.once('close', () => {
      clearInterval(timer); streams.delete(res);
      console.log(JSON.stringify({ event: 'closed', mode, number, sent: offset, complete: offset === content.length }));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="zh-CN"><title>网页下载进度验证</title><meta charset="utf-8">
    <style>body{margin:48px;font:16px/1.8 system-ui;background:#f5f2eb;color:#292722}a{display:inline-block;margin:16px 12px 0 0;padding:10px 20px;background:#e5ded0;color:inherit}small{display:block;margin-top:24px}</style>
    <h1>网页下载进度验证</h1><p>每个 ZIP 约 2 MiB，分块缓慢传输，仅用于观察「下载」页。下载后保留文件，不导入游戏。</p>
    <a href="/known.zip">下载已知大小</a><a href="/unknown.zip">下载未知大小</a><a href="/broken.zip">模拟传输中断</a>
    <small>已知大小可重复点击，验证同一地址的多个下载分别更新。</small></html>`);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5194, '127.0.0.1', resolve); });
const record = path.join(project, 'checks/.artifacts/browser-progress/desktop.json');
await fs.writeFile(record, JSON.stringify({ base, dataDir, gameRoot, url: 'http://127.0.0.1:5194' }, null, 2));
console.log(await fs.readFile(record, 'utf8'));
await new Promise(resolve => {
  const close = () => { for (const stream of streams) stream.destroy(); server.close(resolve); };
  process.stdin.once('data', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
});
