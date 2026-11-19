import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeHTML } from 'entities';
import { PlatformError } from './core.mjs';
import { createWorkshopNetwork as createNetwork } from './mods/workshop-network.mjs';

const API = 'https://api.bilibili.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://search.bilibili.com/', Accept: 'application/json',
};
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const fail = (code, message, details) => { throw new PlatformError(code, message, details); };
const blocked = upstreamCode => fail('bilibili_blocked', 'B站暂时拦截了请求，请稍后再试，或在浏览器里查看。', { upstreamCode });
const invalidId = () => fail('bilibili_not_found', '请填写有效的 BV 号、av 号或 B站视频链接。');
const malformed = () => fail('bilibili_response', 'B站返回的数据格式已变化，请稍后重试。');
const bv = value => typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value);
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const iso = value => { const date = new Date(Number(value) * 1000); return Number.isFinite(date.getTime()) ? date.toISOString() : ''; };
const cookieValue = value => typeof value === 'string' && /^[A-Za-z0-9._%+/=-]{1,256}$/.test(value);

// Percent-encode the exact sorted string that is hashed (spaces are %20, not +).
export function signWbi(params, imgKey, subKey, timestamp) {
  if (!/^[a-f0-9]{32}$/i.test(imgKey) || !/^[a-f0-9]{32}$/i.test(subKey)) malformed();
  const raw = imgKey + subKey, key = MIXIN.map(i => raw[i]).join('').slice(0, 32);
  const values = { ...params, wts: timestamp };
  const query = Object.keys(values).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(values[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${createHash('md5').update(query + key).digest('hex')}`;
}

export function plainText(value) {
  return decodeHTML(String(value ?? '').slice(0, 60000)
    .replace(/<br\s*\/?\s*>|<\/(?:p|div)>/gi, '\n')
    .replace(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi, '')).trim();
}

export function videoRef(value) {
  if (typeof value !== 'string' || value.length > 2048) invalidId();
  const id = value.trim();
  if (bv(id)) return { key: id, params: { bvid: id } };
  const av = id.match(/^av([1-9][0-9]{0,15})$/i);
  if (av && Number.isSafeInteger(Number(av[1]))) return { key: `av${av[1]}`, params: { aid: av[1] } };
  let url;
  try { url = new URL(/^(?:www\.|m\.)?bilibili\.com\/|^b23\.tv\//i.test(id) ? `https://${id}` : id); } catch { invalidId(); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) invalidId();
  if (url.hostname === 'b23.tv' && /^\/[A-Za-z0-9]+\/?$/.test(url.pathname)) return { key: `https://b23.tv${url.pathname.replace(/\/$/, '')}`, short: true };
  if (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) {
    const part = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av[1-9][0-9]{0,15})\/?$/i)?.[1];
    if (part) return videoRef(part);
  }
  invalidId();
}

// Shared by every Bilibili client in this process, including bootstrap and redirects.
export class RequestGate {
  constructor({ now = () => performance.now(), sleep = delay } = {}) {
    this.now = now; this.sleep = sleep; this.last = -Infinity; this.queue = Promise.resolve();
  }
  run(fn) {
    const result = this.queue.then(async () => {
      while (this.now() - this.last < 1000) await this.sleep(1000 - (this.now() - this.last));
      try { return await fn(); }
      finally { this.last = this.now(); }
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
const processGate = new RequestGate();

function searchQuery({ keyword, order = 'totalrank', page = 1 } = {}) {
  if (typeof keyword !== 'string' || !keyword.trim() || [...keyword.trim()].length > 100 || !keyword.isWellFormed() ||
      !['totalrank', 'pubdate', 'click', 'stow'].includes(order) || !Number.isInteger(page) || page < 1 || page > 50) {
    fail('invalid_argument', '请检查B站搜索条件：关键词 1–100 字，页码 1–50。');
  }
  return { search_type: 'video', keyword: keyword.trim(), order, page, page_size: 20 };
}
function video(raw, detail = false) {
  if (!bv(raw?.bvid)) malformed();
  const seconds = Math.floor(count(raw.duration));
  const rich = Array.isArray(raw.desc_v2) ? raw.desc_v2.map(p => p.type === 2 ? `@${p.raw_text ?? ''} ` : p.raw_text ?? '').join('') : '';
  return {
    bvid: raw.bvid, title: plainText(raw.title), cover: String(raw.pic ?? ''),
    author: plainText(detail ? raw.owner?.name : raw.author), mid: count(detail ? raw.owner?.mid : raw.mid),
    duration: detail ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : plainText(raw.duration),
    play: count(detail ? raw.stat?.view : raw.play), favorites: count(detail ? raw.stat?.favorite : raw.favorites),
    danmaku: count(detail ? raw.stat?.danmaku : raw.video_review), pubdate: iso(raw.pubdate),
    description: plainText(detail ? rich || raw.desc : raw.description),
    ...(!detail && typeof raw.tag === 'string' ? { tags: raw.tag.split(',').map(plainText).filter(Boolean) } : {}),
    url: `https://www.bilibili.com/video/${raw.bvid}`,
  };
}

export class Bilibili {
  constructor({ dataDir, fetch: fetchImpl, gate = processGate, now = Date.now } = {}) {
    this.cookieFile = path.join(dataDir, 'bilibili-anonymous.json');
    this.network = fetchImpl ? null : createNetwork();
    this.fetch = fetchImpl ?? this.network.fetch;
    this.gate = gate; this.now = now;
    this.cookies = {}; this.cache = new Map(); this.pending = new Map(); this.stop = new AbortController();
  }
  async close() {
    this.stop.abort();
    await Promise.allSettled([...this.pending.values()]);
    await this.network?.close();
  }
  remember(key, data, ttl) {
    this.cache.delete(key); this.cache.set(key, { data, until: this.now() + ttl });
    while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
    return data;
  }
  cached(key, ttl, fn) {
    this.stop.signal.throwIfAborted();
    const saved = this.cache.get(key);
    if (saved && saved.until > this.now()) return Promise.resolve(saved.data);
    if (!this.pending.has(key)) this.pending.set(key, Promise.resolve().then(fn)
      .then(data => this.remember(key, data, ttl)).finally(() => this.pending.delete(key)));
    return this.pending.get(key);
  }
  async request(url, { redirect = false, anonymous = true } = {}) {
    return this.gate.run(async () => {
      this.stop.signal.throwIfAborted();
      const cookie = anonymous ? Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') : '';
      try {
        const response = await this.fetch(url, { headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
          redirect: 'manual', credentials: 'omit', signal: AbortSignal.any([this.stop.signal, AbortSignal.timeout(15000)]) });
        if ([403, 412, 429].includes(response.status)) { await response.body?.cancel(); blocked(response.status); }
        if (redirect) {
          const location = response.headers.get('location'); await response.body?.cancel();
          if (![301, 302, 303, 307, 308].includes(response.status) || !location) invalidId();
          return location;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404) fail('bilibili_not_found', '视频已删除或暂时不可见。');
          fail('bilibili_http', `B站请求失败（HTTP ${response.status}），请稍后重试。`);
        }
        let size = 0; const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) fail('bilibili_response', 'B站返回的数据超过大小限制。');
          chunks.push(chunk);
        }
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { malformed(); }
        if (!result || typeof result.code !== 'number') malformed();
        return result;
      } catch (error) {
        if (error instanceof PlatformError) throw error;
        fail('bilibili_network', '连接B站超时或中断，请检查网络和系统代理后重试。');
      }
    });
  }
  async api(endpoint, query = '', { nav = false } = {}) {
    const result = await this.request(`${API}${endpoint}${query ? `?${query}` : ''}`);
    if ([-352, -412, -403].includes(result.code) || result.data?.v_voucher) blocked(result.data?.v_voucher ? 'v_voucher' : result.code);
    if ([-404, 62002, 62004, 62012].includes(result.code)) fail('bilibili_not_found', '视频已删除或暂时不可见。');
    if (result.code !== 0 && !(nav && result.code === -101)) fail('bilibili_api', `B站请求失败（${result.code}），请稍后重试。`, { upstreamCode: result.code });
    return result.data;
  }
  async anonymous() {
    this.anonymousPending ??= (async () => {
      let saved;
      try { saved = JSON.parse(await fs.readFile(this.cookieFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      // Only these two public device identifiers are ever loaded or sent.
      for (const name of ['buvid3', 'buvid4']) if (cookieValue(saved?.[name])) this.cookies[name] = saved[name];
      if (this.cookies.buvid3 && this.cookies.buvid4) return;
      const data = await this.api('/x/frontend/finger/spi');
      if (!cookieValue(data?.b_3) || !cookieValue(data?.b_4)) malformed();
      this.cookies = { buvid3: data.b_3, buvid4: data.b_4 };
      await fs.mkdir(path.dirname(this.cookieFile), { recursive: true });
      const temp = `${this.cookieFile}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temp, JSON.stringify(this.cookies, null, 2), { flag: 'wx' }); await fs.rename(temp, this.cookieFile); }
      finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    })().catch(error => { this.anonymousPending = undefined; throw error; });
    return this.anonymousPending;
  }
  async keys(refresh = false) {
    if (!refresh && this.wbi && this.wbi.until > this.now()) return this.wbi;
    this.keysPending ??= (async () => {
      const data = await this.api('/x/web-interface/nav', '', { nav: true });
      const extract = url => typeof url === 'string' ? url.match(/\/([a-f0-9]{32})\.png(?:\?.*)?$/i)?.[1] : undefined;
      const img = extract(data?.wbi_img?.img_url), sub = extract(data?.wbi_img?.sub_url);
      if (!img || !sub) malformed();
      return this.wbi = { img, sub, until: this.now() + 6 * 60 * 60 * 1000 };
    })().finally(() => { this.keysPending = undefined; });
    return this.keysPending;
  }
  async signedSearch(query) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const keys = await this.keys(attempt > 0);
      try { return await this.api('/x/web-interface/wbi/search/type', signWbi(query, keys.img, keys.sub, Math.floor(this.now() / 1000))); }
      catch (error) {
        if (attempt || error.code !== 'bilibili_blocked' || ![-352, -403, 'v_voucher'].includes(error.details?.upstreamCode)) throw error;
      }
    }
  }
  search(params) {
    const query = searchQuery(params);
    return this.cached(`search:${JSON.stringify(query)}`, 5 * 60 * 1000, async () => {
      await this.anonymous();
      const data = await this.signedSearch(query);
      if (!data || !Number.isFinite(Number(data.numResults)) || (data.result !== undefined && !Array.isArray(data.result)) ||
          (!data.result && count(data.numResults) > 0) || data.result?.length > 100) malformed();
      return { items: (data.result ?? []).map(raw => video(raw)), page: query.page,
        total: count(data.numResults), totalPages: Math.min(50, Math.max(1, count(data.numPages) || Math.ceil(count(data.numResults) / 20))) };
    });
  }
  detail(id) {
    const ref = videoRef(id);
    return this.cached(`detail:${ref.key}`, 10 * 60 * 1000, async () => {
      if (ref.short) {
        const location = await this.request(ref.key, { redirect: true, anonymous: false });
        let target;
        try { target = new URL(location, ref.key); } catch { invalidId(); }
        if (target.hostname !== 'bilibili.com' && !target.hostname.endsWith('.bilibili.com')) invalidId();
        // Parse the one redirect; fetch only the fixed API origin, never its target page.
        return this.detail(target.href);
      }
      await this.anonymous();
      const data = await this.api('/x/web-interface/view', new URLSearchParams(ref.params).toString());
      const item = video(data, true);
      if (Number.isSafeInteger(data.aid) && data.aid > 0) {
        try {
          const comments = await this.api('/x/v2/reply/main', new URLSearchParams({ type: '1', oid: String(data.aid), mode: '3' }).toString());
          const pinned = plainText(comments?.top?.upper?.content?.message);
          if (pinned) item.pinnedComment = pinned;
        } catch { /* Comments are optional: the video still opens when comments are unavailable. */ }
        this.remember(`detail:av${data.aid}`, item, 10 * 60 * 1000);
      }
      this.remember(`detail:${item.bvid}`, item, 10 * 60 * 1000);
      return item;
    });
  }
}
