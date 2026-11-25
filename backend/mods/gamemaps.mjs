import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkshopNetwork } from './workshop-network.mjs';
import { fail, directory, writeJson, stamp } from './files.mjs';
import { regular, identity } from './vpk.mjs';
import { listVpkArchive, archiveImportFiles, releaseExtracted } from './browser-downloads.mjs';

const HOME = 'https://www.gamemaps.com';
const categories = {
  maps: ['', 'campaign', 'co-op', 'survival', 'versus', 'scavenge', 'mutation', 'mission', 'other'],
  mods: ['', 'weapons', 'survivors', 'infected', 'sounds', 'textures', 'gui-ui', 'scripts', 'items', 'effects', 'skins', 'packs'],
};
export function gameMapsId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,11}$/.test(value)) fail('invalid_argument', 'GameMaps 条目标识无效。');
  return value;
}
export function browseUrl({ section = 'maps', category = '', sort = 'recent', page = 1, q = '' } = {}) {
  if (!Object.hasOwn(categories, section) || !categories[section].includes(category) || !['recent', 'popular', 'rviews'].includes(sort) ||
      !Number.isInteger(page) || page < 1 || page > 1000 || typeof q !== 'string' || q.length > 200) fail('invalid_argument', '请检查 GameMaps 分类、排序、页码或搜索词。');
  const base = q.trim() ? '/search/l4d2' : category ? `/l4d2/${section === 'mods' ? 'mods/' : ''}${category}/` : `/l4d2/${section}`;
  const url = new URL(base, HOME);
  url.searchParams.set('page', String(page));
  if (q.trim()) { url.searchParams.set('provider', 'gamemaps'); url.searchParams.set('q', q.trim()); }
  return url.href;
}
function numeric(value) {
  const m = String(value ?? '').trim().replaceAll(',', '').match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
  return m ? Math.round(Number(m[1]) * ({ K: 1000, M: 1000000, B: 1000000000 }[m[2]?.toUpperCase()] ?? 1)) : undefined;
}
function text($, node) {
  const copy = $(node).clone(); copy.find('script,style,noscript').remove();
  copy.find('br').replaceWith('\n'); copy.find('p,div,li,pre,h1,h2,h3,h4').append('\n');
  return copy.text().replace(/\r/g, '').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function htmlDocument(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > 4 * 1024 * 1024) fail('gamemaps_response', 'GameMaps 页面内容需要检查。');
  if (/sorry, you have been blocked|<title>\s*(?:just a moment|attention required)|cf-chl-/i.test(html)) fail('gamemaps_blocked', 'GameMaps 暂时拦截了请求，请在内置浏览器查看页面提示，稍后再试。');
  return load(html);
}
function imageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const url = new URL(value, HOME); if (url.protocol === 'https:' && url.hostname === 'www.gamemaps.com') return url.href; } catch {}
  return '';
}
function imageFrom(img) {
  return imageUrl(img.attr('data-src')) || imageUrl(img.attr('src'));
}
// 列表卡片的站点标记：footer `ul.states li.new|updated|archived`，标题旁 `span.status.beta`。
const STATES = ['new', 'updated', 'archived'];
function flags(r) {
  const found = STATES.filter(state => r.find(`.states li.${state}`).length);
  if (r.find('header .status.beta').length) found.push('beta');
  return found;
}
function item($, row) {
  const r = $(row), id = gameMapsId(r.attr('data-id') ?? r.attr('data-item-id'));
  const title = r.find('header .title,header h3').first().text().trim();
  if (!title) fail('gamemaps_response', 'GameMaps 条目标题读取失败。');
  return { id, title, image: imageFrom(r.find('.thumbnail img,.thumb img').first()), typeLabel: r.find('.type').first().text().trim(),
    summary: text($, r.find('.content > p')), author: r.find('.byline').text().trim().replace(/^By\s+/, '') || undefined,
    views: numeric(r.find('.views .value').text()), updatedAt: r.find('time').attr('datetime'), flags: flags(r), url: `${HOME}/details/${id}` };
}
export function parseBrowse(html, page = 1) {
  const $ = htmlDocument(html), rows = $('.paged-list .item-list article.list-item-file');
  const items = rows.toArray().map(row => item($, row));
  let totalPages = page;
  $('.paged-list a[href*="page="]').each((_, a) => { try { const n = Number(new URL($(a).attr('href'), HOME).searchParams.get('page')); if (Number.isInteger(n) && n <= 1000) totalPages = Math.max(totalPages, n); } catch {} });
  if (!items.length && !/no (?:results|files|items|matches|content)|0 results|nothing (?:found|to show)/i.test($('body').text())) fail('gamemaps_response', 'GameMaps 列表结构已变化，请在原页面查看。');
  return { items, page, totalPages };
}
export function parseDetail(html, id) {
  gameMapsId(id); const $ = htmlDocument(html);
  const title = $('.title-row h1').first().text().trim();
  if (!title || !/for Left 4 Dead 2\s*-\s*GameMaps/i.test($('title').text()) || ($('.developers ul[data-file-id]').length && $('.developers ul[data-file-id]').attr('data-file-id') !== id)) fail('gamemaps_not_found', '请选择仍可访问的 Left 4 Dead 2 条目。');
  const authors = $('.developers .username').toArray().map(e => ({ name: $(e).find('.username-val').text().trim(), role: $(e).find('p').text().trim() })).filter(a => a.name);
  const tags = $('section.tags .bubble-button').toArray().map(e => $(e).text().trim());
  const screenshots = $('section.media-carousel img').toArray().map(e => imageFrom($(e))).filter(url => url && new URL(url).pathname.includes('/ss/'));
  const linked = $('section.linked article.shortrow-item').toArray().filter(e => $(e).find('.game a[href="/l4d2/"]').length).map(e => item($, e));
  const description = text($, $('section.desc > pre'));
  const instructionSection = $('h2,h3').filter((_, e) => $(e).text().trim().toLowerCase() === 'instructions').first().closest('section');
  const instructions = text($, instructionSection.clone().find('h2,h3').remove().end());
  const card = $('section.details .info-card').not('.changelog').first();
  const name = card.find('p[title]').attr('title'), date = card.find('time').attr('datetime');
  const size = card.text().match(/\(([\d,.]+)\s*(B|KB|MB|GB)\)/i);
  const sizeBytes = size ? Math.round(Number(size[1].replaceAll(',', '')) * ({ B: 1, KB: 1000, MB: 1000000, GB: 1000000000 }[size[2].toUpperCase()])) : undefined;
  const version = $('section.details .changelog p').last().text().trim().replace(/^Version\s+/i, '');
  // Only an explicit Steam destination is surfaced; no speculative workshop ID.
  let workshopId;
  $('a[href*="steamcommunity.com/"]').each((_, e) => {
    try { const u = new URL($(e).attr('href')); if (u.hostname === 'steamcommunity.com' && /^\/(?:sharedfiles|workshop)\/filedetails\/?$/.test(u.pathname)) workshopId = u.searchParams.get('id')?.match(/^[1-9][0-9]{0,19}$/)?.[0] ?? workshopId; } catch {}
  });
  return { id, title, image: imageFrom($('.title-block > img.thumbnail').first()), typeLabel: $('.title-row .item-typelabel').text().trim(),
    authors, author: authors[0]?.name, description, ...(instructions ? { instructions } : {}), tags, screenshots: [...new Set(screenshots)], linked,
    views: numeric($('.statsrow > .views').first().text()), likes: numeric($('.statsrow .rating .value').first().text()), updatedAt: date, sizeBytes,
    ...(name && date && sizeBytes !== undefined ? { file: { name, date, sizeBytes, ...(version ? { version } : {}) } } : {}),
    ...(workshopId ? { workshopId } : {}), url: `${HOME}/details/${id}` };
}

export class GameMaps {
  constructor({ dataDir, browser, fetch: fetchImpl, now = Date.now, sleep = delay } = {}) {
    this.dataDir = dataDir; this.browser = browser; this.network = fetchImpl ? null : createWorkshopNetwork();
    this.fetch = fetchImpl ?? this.network.fetch; this.now = now; this.sleep = sleep;
    this.cache = new Map(); this.pending = new Map(); this.queue = Promise.resolve(); this.last = -Infinity; this.stop = new AbortController();
  }
  limit(fn) {
    const result = this.queue.then(async () => {
      const pause = 1000 - (this.now() - this.last); if (pause > 0) await this.sleep(pause, undefined, { signal: this.stop.signal });
      this.stop.signal.throwIfAborted();
      try { return await fn(); } finally { this.last = this.now(); }
    });
    this.queue = result.catch(() => {}); return result;
  }
  cached(key, fn) {
    const saved = this.cache.get(key); if (saved && this.now() - saved.at < 300000) return Promise.resolve(saved.data);
    if (!this.pending.has(key)) this.pending.set(key, Promise.resolve().then(fn).then(data => {
      this.cache.delete(key); this.cache.set(key, { data, at: this.now() });
      while (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value);
      return data;
    }).finally(() => this.pending.delete(key)));
    return this.pending.get(key);
  }
  async page(url, sort) {
    return this.limit(async () => {
      if (this.browser) return this.browser.request({ kind: 'page', url, ...(sort ? { sort } : {}) }, this.stop.signal);
      const response = await this.fetch(url, { redirect: 'error', signal: AbortSignal.any([this.stop.signal, AbortSignal.timeout(20000)]),
        ...(sort ? { method: 'POST', body: new URLSearchParams({ sort }).toString() } : {}),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'text/html', ...(sort ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) } });
      if ([403, 429, 503].includes(response.status)) { await response.body?.cancel(); fail('gamemaps_blocked', 'GameMaps 暂时拦截了请求，请在 Matcha 桌面版中使用浏览器通道。'); }
      if (response.status === 404) { await response.body?.cancel(); fail('gamemaps_not_found', 'GameMaps 条目已下架或地址已变化。'); }
      if (!response.ok) { await response.body?.cancel(); fail('gamemaps_http', `GameMaps 请求失败（HTTP ${response.status}）。`); }
      let size = 0; const chunks = [];
      for await (const chunk of response.body) { size += chunk.length; if (size > 4 * 1024 * 1024) fail('gamemaps_response', 'GameMaps 页面超过大小限制。'); chunks.push(chunk); }
      return { html: Buffer.concat(chunks).toString('utf8') };
    });
  }
  browse(params = {}) { const url = browseUrl(params), sort = params.sort ?? 'recent'; return this.cached(`${url}#${sort}`, async () => parseBrowse((await this.page(url, sort)).html, params.page ?? 1)); }
  detail(id) {
    gameMapsId(id); const url = `${HOME}/details/${id}`;
    return this.cached(url, async () => {
      const document = await this.page(url), detail = parseDetail(document.html, id);
      if (typeof document.workshopId === 'string' && /^[1-9][0-9]{0,19}$/.test(document.workshopId)) detail.workshopId = document.workshopId;
      return detail;
    });
  }
  async ownedFile(folder, file) {
    const relative = path.relative(path.resolve(folder), path.resolve(file));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('unsafe_path', 'GameMaps 下载路径需要检查。');
    await directory(folder);
    let parent = folder;
    for (const part of relative.split(path.sep).slice(0, -1)) { parent = path.join(parent, part); await directory(parent); }
    const stat = await regular(file);
    if (stat.size > 8 * 1024 ** 3) fail('archive_limit', '下载文件超过 8 GiB。');
    return stat;
  }
  async download({ id }, ctx, importFiles) {
    gameMapsId(id);
    const { taskId, signal, progress } = ctx;
    if (!/^[0-9a-f-]{36}$/.test(taskId)) fail('invalid_argument', '下载任务标识无效。');
    const roots=this.downloadRoots?.()??[path.join(this.dataDir,'gamemaps','downloads')];
    let folder=path.join(roots[0],taskId);
    for(const r of roots){const f=path.join(r,taskId);if(await fs.stat(path.join(f,'receipt.json')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e})){folder=f;break}}
    const receiptFile=path.join(folder,'receipt.json');
    let receipt;
    try { receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (receipt && (receipt.version !== 1 || receipt.id !== id || !Array.isArray(receipt.files) || !receipt.imported)) fail('gamemaps_receipt', '下载记录需要检查，原文件已保留。');
    if (!receipt) {
      if (!this.browser) fail('gamemaps_browser_required', '请在 Matcha 桌面版中下载 GameMaps 文件。');
      // Detail requests are shared with the browse UI. A paused task releases its
      // slot immediately, without canceling someone else's metadata lookup.
      signal.throwIfAborted();
      const item = await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        this.detail(id).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
      signal.throwIfAborted();
      progress({ title: item.title });
      const download = await this.browser.request({ kind: 'download', itemId: id, taskId, downloadRoot:roots[0], fileName: item.file?.name }, signal, progress, ctx.takeBytes);
      const stat = await this.ownedFile(folder, download.path);
      receipt = { version: 1, id, item, download, identity: identity(stat), downloadStamp:stamp(stat), files: [], imported: {} };
      await writeJson(receiptFile, receipt);
    }
    const saveReceipt = () => writeJson(receiptFile, receipt);
    if(receipt.result)return {...receipt.result,archiveCleaned:!!receipt.cleaned};
    const file = receipt.download.path, stat = await this.ownedFile(folder, file);
    if (receipt.downloadStamp ? stamp(stat)!==receipt.downloadStamp : identity(stat) !== receipt.identity) fail('file_changed', `下载文件发生变化，请检查：${file}`);
    progress({ state: 'verifying', title: receipt.item.title, dir: path.dirname(file), done: stat.size, total: stat.size, bytesPerSecond: 0 });
    signal.throwIfAborted();
    if (!/\.(zip|vpk)$/i.test(file)) fail('archive_format', `文件已下载，需要手动解压后导入：${file}`);
    if (!receipt.files.length) {
      const selected = /\.zip$/i.test(file) ? (await listVpkArchive(file, signal)).items.map(i => i.name) : undefined;
      if (selected && !selected.length) fail('archive_empty', `压缩包中没有可导入的 VPK，文件保留在：${file}`);
      receipt.files = await archiveImportFiles(file, selected, signal);
      await saveReceipt();
    }
    for (const f of receipt.files) await this.ownedFile(folder, f);
    const names = receipt.files.map(f => path.basename(f).toLowerCase());
    if (new Set(names).size !== names.length) fail('archive_duplicate', `压缩包包含同名 VPK，请手动整理后导入：${file}`);
    try {
      const result = await ctx.commit(() => importFiles(receipt, saveReceipt));
      receipt.result={...result,archiveName:receipt.download.name??path.basename(file),dir:path.dirname(file),done:stat.size,total:stat.size,bytesPerSecond:0};
      if(/\.zip$/i.test(file))receipt.archiveStamp=stamp(stat);
      await saveReceipt();
      try {
        if (receipt.archiveStamp) await releaseExtracted(file,receipt.files);
        if (receipt.archiveStamp && this.deleteArchives?.()) {
          if (stamp(await regular(file))!==receipt.archiveStamp) fail('storage_changed','压缩包已变化，保留原件。');
          receipt.cleanupPending=true;await saveReceipt();
          if (stamp(await regular(file))!==receipt.archiveStamp) fail('storage_changed','压缩包已变化，保留原件。');
          await fs.unlink(file);receipt.cleaned=true;delete receipt.cleanupPending;await saveReceipt();
        }
      } catch (e) {
        receipt.result.warning='Mod 已导入；清理下载文件时遇到问题：'+e.message;
        await saveReceipt();
      }
      return {...receipt.result,archiveCleaned:!!receipt.cleaned};
    } catch (e) {
      if (e.code === 'game_running') e.message = `下载已完成，退出游戏后点「重试」即可继续导入。文件：${file}`;
      throw e;
    }
  }
  async close() { this.stop.abort(); await this.queue; await this.network?.close(); }
}
