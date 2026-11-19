import { randomBytes } from 'node:crypto';
import { DesktopService, prepareDataDir } from './service.mjs';
import { errorRecord } from '../core.mjs';
import { MAX_BRIDGE_BYTES } from '../pi/limits.mjs';

// Development-only, same-origin adapter. Production uses Tauri's IPC and JSONL child.
export function beaconBridge(options = {}) {
  let cleanup;
  return {
    name: 'beacon-local-bridge',
    async closeBundle() { await cleanup?.(); },
    async configureServer(server) {
      await prepareDataDir({ dataDir: options.dataDir }).catch(error => console.error('[Matcha 改名] 失败，继续用旧名字：', error));
      const service = new DesktopService(options), token = randomBytes(32).toString('hex'), clients = new Set();
      service.on('event', event => {
        const message = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of clients) res.write(message);
      });
      let closed = false;
      cleanup = async () => { if (closed) return; closed = true; for (const res of clients) res.end(); clients.clear(); await service.close(); };
      server.httpServer?.once('close', () => void cleanup());
      server.middlewares.use('/__beacon', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        const host = req.headers.host;
        if (!host || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
          return send(403, { ok: false, error: { code: 'origin_rejected', message: '仅接受本机同源页面。' } });
        }
        if (req.method === 'GET' && req.url === '/session') return send(200, { token });
        if (req.method === 'GET' && req.url === '/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(': connected\n\n'); clients.add(res);
          const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
          res.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
          return;
        }
        if (req.method !== 'POST' || req.url !== '/call' || req.headers['x-beacon-token'] !== token) return send(403, { ok: false, error: { code: 'bridge_rejected', message: '请刷新页面后重试。' } });
        try {
          let size = 0; const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > MAX_BRIDGE_BYTES) throw new Error('Request exceeds 32 MiB'); chunks.push(chunk); }
          const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof request.command !== 'string') throw new Error('Missing command');
          const result = await service.dispatch(request.command, request.params, request.confirmation);
          send(200, { ok: true, result: result ?? null });
        } catch (e) { send(200, { ok: false, error: errorRecord(e) }); }
      });
    },
  };
}
