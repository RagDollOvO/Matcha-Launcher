import { DesktopService, prepareDataDir } from './service.mjs';
import { errorRecord } from '../core.mjs';
import { MAX_BRIDGE_BYTES } from '../pi/limits.mjs';
import { GameMapsBrowser } from './gamemaps-browser.mjs';

const output = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const gamemapsBrowser = process.env.FLARE_GAMEMAPS_WEBVIEW === '1' ? new GameMapsBrowser(output) : null;
const storageNative = gamemapsBrowser ? (action,p)=>gamemapsBrowser.request({kind:"storage",action,...p}) : null;
// 旧名字改名要经桌面壳改下载记录，所以先接上 stdin，命令等服务建好再处理。
const started = prepareDataDir({ native: storageNative })
  .catch(error => console.error('[Matcha 改名] 失败，继续用旧名字：', error))
  .then(() => {
    const service = new DesktopService({ gamemapsBrowser, storageNative, communityDesktop: true });
    service.on('event', event => output({ type: 'event', event }));
    void service.community.resume();
    return service;
  });
let closing = false;
async function close() { if (closing) return; closing = true; gamemapsBrowser?.close(); await (await started).close(); }
process.stdin.setEncoding('utf8');
let pending = '';
process.stdin.on('data', chunk => {
  pending += chunk;
  let index;
  while ((index = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, index); pending = pending.slice(index + 1);
    if (!line.trim()) continue;
    if (Buffer.byteLength(line) > MAX_BRIDGE_BYTES) { output({ id: null, ok: false, error: { code: 'request_too_large', message: 'Request exceeds 32 MiB' } }); continue; }
    void handle(line);
  }
  if (Buffer.byteLength(pending) > MAX_BRIDGE_BYTES) { process.stdin.destroy(); void close(); }
});
async function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
    if (['gamemaps_response', 'gamemaps_progress', 'gamemaps_budget'].includes(request.type)) { gamemapsBrowser?.receive(request); return; }
    if (typeof request.id !== 'string' || typeof request.command !== 'string') throw new Error('Expected id and command');
    const result = await (await started).dispatch(request.command, request.params, request.confirmation);
    output({ id: request.id, ok: true, result: result ?? null });
  } catch (error) { output({ id: request?.id ?? null, ok: false, error: errorRecord(error) }); }
}
process.stdin.once('end', () => void close());
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { process.stdin.destroy(); void close(); });
