import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetch, Agent, ProxyAgent, EnvHttpProxyAgent } from 'undici';
import tls from 'node:tls';
import { steamHost } from '../community/manager.mjs';
import { steamImageUrl } from '../community/images.mjs';

const exec = promisify(execFile);
// Use the user's configured route, scoped to each public-data client. No OS settings are changed.
export function createWorkshopNetwork({ community, fetch: fetchImpl = fetch } = {}) {
  let dispatcher, key, checked = 0, pending, local, certificate;
  async function route() {
    if (Date.now() - checked < 30000) return dispatcher;
    pending ??= (async () => {
      let next = '';
      if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) next = 'environment';
      else if (process.platform === 'win32') {
        const base = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
        const read = name => exec('reg.exe', ['query', base, '/v', name], { windowsHide: true, timeout: 2000 }).then(r => r.stdout, () => '');
        if (/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(await read('ProxyEnable'))) {
          const server = (await read('ProxyServer')).match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim() ?? '';
          const address = server.includes('=') ? server.split(';').find(s => s.trim().startsWith('https='))?.split('=')[1] : server;
          if (address) {
            const url = new URL(address.includes('://') ? address : `http://${address}`);
            if (['http:', 'https:'].includes(url.protocol)) next = url.href;
          }
        }
      }
      if (next !== key) {
        const old = dispatcher;
        dispatcher = next === 'environment' ? new EnvHttpProxyAgent() : next ? new ProxyAgent(next) : undefined;
        key = next;
        void old?.close().catch(() => {});
      }
      checked = Date.now();
      return dispatcher;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return {
    fetch: async (url, options) => {
      const target = steamImageUrl(url, community?.active, options?.method);
      let selected;
      if (community?.active && steamHost(new URL(target).hostname)) {
        if (certificate !== community.ca) {
          void local?.close().catch(() => {});
          certificate = community.ca;
          local = new Agent({ connect: { ca: [...(tls.getCACertificates?.('default') ?? tls.rootCertificates), certificate], rejectUnauthorized: true } });
        }
        selected = local;
      } else selected = await route();
      return fetchImpl(target, { ...options, dispatcher: selected });
    },
    close: async () => { await pending; await Promise.all([dispatcher?.close(), local?.close()]); },
  };
}
