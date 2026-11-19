import fs from 'node:fs/promises';
import path from 'node:path';
import { readVpk, verifyVpk } from './vpk.mjs';
import { libraryId, workshopId } from './library.mjs';
import { fail, taskDirectory, removeTaskDirectory } from './files.mjs';
import { createWorkshopNetwork } from './workshop-network.mjs';
import { browseUrl, parseBrowse, descriptionText } from './workshop-browse.mjs';
import sharp from 'sharp';

const API = 'https://api.steampowered.com/ISteamRemoteStorage/';
const MAX_DOWNLOAD = 8 * 1024 ** 3;
const PREVIEW_SIZE = { card: [320, 200], detail: [640, 480] };
const MAX_CARD_PREVIEW = 1024 * 1024;
function checkPreviewRequest(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) fail('invalid_argument', '工坊预览请求标识无效。');
}
export function steamAssetUrl(raw) {
  let u; try { u = new URL(raw); } catch { fail('download_unavailable', '该条目尚未提供可用的官方下载地址。'); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !(
    host === 'cdn.steamusercontent.com' || host === 'images.steamusercontent.com' || /^cloud-[0-9]+\.steamusercontent\.com$/.test(host) ||
    host === 'steamusercontent-a.akamaihd.net' || host === 'steamuserimages-a.akamaihd.net')) fail('download_origin', '下载地址来源需要核实，请通过 Steam 打开该条目。');
  return u.href;
}
async function boundedBody(response, limit) {
  if (!response.ok) { await response.body?.cancel(); fail('workshop_http', `Steam 请求失败（HTTP ${response.status}），请稍后重试。`); }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    fail('response_too_large', 'Steam 返回的数据超过限制。');
  }
  let size = 0; const chunks = [];
  for await (const b of response.body) { size += b.length; if (size > limit) fail('response_too_large', 'Steam 返回的数据超过限制。'); chunks.push(b); }
  return Buffer.concat(chunks);
}
function selectedIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !workshopId(id))) fail('invalid_argument', '每次请选择 1–100 个有效工坊 ID。');
  return [...new Set(ids)];
}
export class Workshop {
  constructor(manager, { fetch: fetchImpl, community } = {}) {
    this.manager = manager;
    this.network = fetchImpl ? null : createWorkshopNetwork({ community });
    this.fetch = fetchImpl ?? this.network.fetch;
    this.pages = new Map(); this.metadata = new Map(); this.previews = new Map(); this.previewPending = new Map();
    this.previewRequests = new Map(); this.canceledPreviews = new Set();
  }
  async close() { for (const request of this.previewRequests.values()) request.abort(); await this.network?.close(); }
  remember(raw) {
    const id = String(raw.publishedfileid);
    this.metadata.delete(id); this.metadata.set(id, raw);
    while (this.metadata.size > 300) this.metadata.delete(this.metadata.keys().next().value);
  }
  async known(root) { return new Set(root ? (await this.manager.scan(root)).mods.map(m => m.workshopId).filter(Boolean) : []); }
  async browse(root, params) {
    const url = browseUrl(params);
    let cached = this.pages.get(url);
    if (!cached || Date.now() - cached.at > 120000) {
      let html;
      try {
        const response = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
        html = (await boundedBody(response, 4 * 1024 * 1024)).toString('utf8');
      } catch (e) {
        if (e.code) throw e;
        fail('workshop_network', '连接 Steam 创意工坊超时或中断，请检查网络和系统代理后重试。');
      }
      cached = { at: Date.now(), data: parseBrowse(html) };
      this.pages.set(url, cached);
      while (this.pages.size > 10) this.pages.delete(this.pages.keys().next().value);
    }
    const known = await this.known(root), { raws, authors, ...paging } = cached.data;
    const items = raws.map(raw => {
      const normalized = { ...raw, result: 1, consumer_app_id: raw.consumer_appid };
      this.remember(normalized);
      return { ...this.describe(normalized, known), authorName: authors.get(raw.creator) || '',
        description: descriptionText(raw.short_description), tags: (raw.tags ?? []).map(t => String(t.tag)).slice(0, 30),
        subscriptions: Number(raw.subscriptions) || 0, childCount: Number(raw.num_children) || 0, hasPreview: !!raw.preview_url };
    });
    return { items, ...paging, workshopUrl: url };
  }
  async detail(root, id) {
    selectedIds([id]);
    const raw = (await this.api('GetPublishedFileDetails', [id])).find(r => String(r.publishedfileid) === id) ?? { publishedfileid: id, result: 9 };
    const item = this.describe(raw, await this.known(root));
    this.remember(raw);
    if (item.kind === 'collection' && !item.error) {
      const collection = (await this.api('GetCollectionDetails', [id]))[0];
      if (collection?.result !== 1) fail('workshop_collection', '合集内容读取失败，请重试。');
      item.children = (collection.children ?? []).map(c => String(c.publishedfileid)).filter(workshopId);
    }
    return { ...item, description: descriptionText(raw.description), tags: (raw.tags ?? []).map(t => String(t.tag)).slice(0, 30), hasPreview: !!raw.preview_url };
  }
  cancelPreview(requestId) {
    checkPreviewRequest(requestId);
    const active = this.previewRequests.get(requestId);
    if (active) active.abort();
    else {
      // The cancel message can reach the service before its invoke on a rapid tab switch.
      this.canceledPreviews.add(requestId);
      if (this.canceledPreviews.size > 128) this.canceledPreviews.delete(this.canceledPreviews.values().next().value);
    }
  }
  async preview(id, { size = 'detail', requestId } = {}) {
    selectedIds([id]);
    if (typeof size !== 'string' || !Object.hasOwn(PREVIEW_SIZE, size)) fail('invalid_argument', '工坊预览尺寸无效。');
    if (requestId === undefined) return this.thumbnail(id, size);
    checkPreviewRequest(requestId);
    if (this.canceledPreviews.delete(requestId)) throw new DOMException('工坊预览已取消。', 'AbortError');
    if (this.previewRequests.has(requestId)) fail('invalid_argument', '工坊预览请求已存在。');
    const request = new AbortController();
    this.previewRequests.set(requestId, request);
    try { return await this.thumbnail(id, size, request.signal); }
    finally { this.previewRequests.delete(requestId); }
  }
  async thumbnail(id, size, signal) {
    let raw = this.metadata.get(id);
    if (!raw) {
      raw = (await this.api('GetPublishedFileDetails', [id], signal))[0];
    }
    signal?.throwIfAborted();
    if (raw?.result !== 1 || Number(raw.consumer_app_id) !== 550) return { dataUrl: null };
    this.remember(raw);
    if (!raw.preview_url) return { dataUrl: null };
    const url = new URL(steamAssetUrl(raw.preview_url));
    const [width, height] = PREVIEW_SIZE[size];
    // Steam's image CDN uses this policy for renditions; bare imw/imh can return the full original.
    for (const [name, value] of Object.entries({ ima: 'fit', impolicy: 'Letterbox', imcolor: '#000000',
      imw: String(width), imh: String(height), letterbox: 'false' })) url.searchParams.set(name, value);
    const key = url.href;
    if (this.previews.has(key)) return this.previews.get(key);
    const load = async () => {
      const timeout = AbortSignal.timeout(15000);
      const response = await this.asset(key, signal ? AbortSignal.any([signal, timeout]) : timeout);
      const limit = size === 'card' ? MAX_CARD_PREVIEW : 12 * 1024 * 1024;
      let body;
      try { body = await boundedBody(response, limit); }
      catch (e) {
        // Some animated covers ignore CDN sizing. Leave those originals to the detail view.
        if (size === 'card' && e.code === 'response_too_large' && !signal?.aborted) {
          return this.rememberPreview(key, { dataUrl: null, detailOnly: true });
        }
        throw e;
      }
      signal?.throwIfAborted();
      const mime = body[0] === 0xff && body[1] === 0xd8 ? 'image/jpeg'
        : body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
        : /^GIF8[79]a$/.test(body.toString('ascii', 0, 6)) ? 'image/gif'
        : body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
      // Static, bounded thumbnails keep animated workshop covers from retaining whole GIFs in the webview.
      const thumbnail = mime ? await sharp(body, { animated: false, limitInputPixels: 16777216 })
        .resize(width, height, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer().catch(() => null) : null;
      signal?.throwIfAborted();
      const dataUrl = thumbnail ? `data:image/jpeg;base64,${thumbnail.toString('base64')}` : null;
      return dataUrl ? this.rememberPreview(key, { dataUrl }) : { dataUrl };
    };
    // Cancellable calls have independent lifetimes; the UI deduplicates its subscribers.
    if (signal) return load();
    if (!this.previewPending.has(key)) this.previewPending.set(key, load().finally(() => this.previewPending.delete(key)));
    return this.previewPending.get(key);
  }
  rememberPreview(key, result) {
    this.previews.set(key, result);
    while (this.previews.size > 32 || [...this.previews.values()].reduce((n, v) => n + (v.dataUrl?.length ?? 0), 0) > 24 * 1024 * 1024) {
      this.previews.delete(this.previews.keys().next().value);
    }
    return result;
  }
  async api(method, ids, signal) {
    const collection = method === 'GetCollectionDetails', body = new URLSearchParams({ [collection ? 'collectioncount' : 'itemcount']: String(ids.length) });
    ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));
    const response = await this.fetch(`${API}${method}/v1/`, { method: 'POST', body, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    const data = JSON.parse((await boundedBody(response, 8 * 1024 * 1024)).toString('utf8'));
    const items = data.response?.[collection ? 'collectiondetails' : 'publishedfiledetails'];
    if (!Array.isArray(items)) fail('workshop_response', 'Steam 返回的条目数据需要检查。');
    return items;
  }
  async asset(raw, signal, headers = {}) {
    let url = steamAssetUrl(raw);
    for (let n = 0; n < 5; n++) {
      const response = await this.fetch(url, { headers, redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) fail('download_origin', 'Steam 下载跳转缺少目标地址。');
        url = steamAssetUrl(new URL(location, url).href); continue;
      }
      return response;
    }
    fail('download_origin', 'Steam 下载跳转次数过多。');
  }
  describe(raw, known) {
    const id = String(raw.publishedfileid), size = Number(raw.file_size ?? 0);
    const item = { id, kind: Number(raw.file_type) === 2 ? 'collection' : 'item', appId: Number(raw.consumer_app_id),
      title: String(raw.title ?? id), author: String(raw.creator ?? ''), sizeBytes: Number.isSafeInteger(size) ? size : 0,
      preview: null, updatedAt: raw.time_updated ? new Date(raw.time_updated * 1000).toISOString() : '',
      inLibrary: known.has(id), downloadable: false, workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` };
    if (raw.result !== 1) item.error = item.reason = '条目已移除、私密或当前访问受限，请在 Steam 查看。';
    else if (item.appId !== 550) item.error = item.reason = '请选择 Left 4 Dead 2（550）的工坊条目。';
    else if (item.kind === 'collection') item.reason = '请选择合集里的具体条目。';
    else if (item.inLibrary) item.reason = '此条目已在库中。';
    else if (size > MAX_DOWNLOAD) item.reason = '单项下载超过 8 GiB 限制。';
    else {
      try { steamAssetUrl(raw.file_url); item.downloadable = true; } catch (e) { item.reason = e.message; }
    }
    return item;
  }
  async resolve(root, ids) {
    const pending = selectedIds(ids), visited = new Set(), items = [];
    const signal = AbortSignal.timeout(45000);
    const known = new Set((await this.manager.scan(root)).mods.map(m => m.workshopId).filter(Boolean));
    while (pending.length) {
      signal.throwIfAborted();
      const batch = pending.splice(0, 50).filter(id => !visited.has(id));
      if (!batch.length) continue;
      batch.forEach(id => visited.add(id));
      const raws = await this.api('GetPublishedFileDetails', batch, signal);
      for (const id of batch) {
        const raw = raws.find(x => String(x.publishedfileid) === id) ?? { publishedfileid: id, result: 9 };
        const item = this.describe(raw, known); items.push(item);
        if (item.kind === 'collection' && !item.error) {
          const details = (await this.api('GetCollectionDetails', [id], signal))[0];
          if (details?.result !== 1) { item.error = '合集内容暂时读取失败。'; continue; }
          item.children = [...new Set((details.children ?? []).map(x => String(x.publishedfileid)).filter(workshopId))];
          const unseen = item.children.filter(x => !visited.has(x) && !pending.includes(x));
          if (visited.size + pending.length + unseen.length > 1000) fail('collection_too_large', '展开条目超过 1000 个，请选择更小的合集。');
          pending.push(...unseen);
        }
        // Thumbnails are optional; bound work to the initially requested items.
        if (ids.slice(0, 16).includes(id) && raw.preview_url) {
          try {
            const body = await boundedBody(await this.asset(raw.preview_url, AbortSignal.any([signal, AbortSignal.timeout(5000)])), 2 * 1024 * 1024);
            const mime = body[0] === 0xff && body[1] === 0xd8 ? 'image/jpeg' : body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : null;
            if (mime) item.preview = `data:${mime};base64,${body.toString('base64')}`;
          } catch { /* Text metadata stays usable when preview is unavailable. */ }
        }
      }
    }
    return { items };
  }
  async download(request, ctx, commit) {
    const { gameRoot, id } = request;
    const known = new Set((await this.manager.scan(gameRoot)).mods.map(m => m.workshopId).filter(Boolean));
    const raw = (await this.api('GetPublishedFileDetails', [id], ctx.signal)).find(x => String(x.publishedfileid) === id);
    if (!raw) fail('workshop_missing', '工坊条目已不存在。');
    const item = this.describe(raw, known);
    if (!item.downloadable) fail(item.inLibrary ? 'already_in_library' : 'download_unavailable', item.reason);
    const base = await this.manager.library.base(gameRoot, true);
    const stage = await taskDirectory(base, ctx.taskId, 'download'); let published = false;
    // A deliberately slow transfer can take hours. Bound stalls rather than its lifetime.
    const idle = new AbortController();
    const timer = setTimeout(() => idle.abort(new DOMException('工坊下载等待超时。', 'TimeoutError')), 30 * 60 * 1000);
    try {
      const signal = AbortSignal.any([ctx.signal, idle.signal]);
      const response = await this.asset(raw.file_url, signal, { 'Accept-Encoding': 'identity' });
      if (!response.ok) { await response.body?.cancel(); fail('workshop_http', `下载失败（HTTP ${response.status}）。`); }
      const length = Number(response.headers.get('content-length')) || 0, total = item.sizeBytes || length || null;
      if (length > MAX_DOWNLOAD) { await response.body?.cancel(); fail('resource_too_large', '下载超过 8 GiB 限制。'); }
      const file = path.join(stage, 'mod.vpk'), h = await fs.open(file, 'wx'); let done = 0; const start = Date.now();
      try {
        for await (const chunk of response.body) {
          if (done + chunk.length > MAX_DOWNLOAD || (total && done + chunk.length > total)) fail('download_size', '下载大小与工坊记录不符，请刷新后重试。');
          for (let offset = 0; offset < chunk.length;) {
            signal.throwIfAborted();
            const length = ctx.takeBytes ? await ctx.takeBytes(chunk.length - offset, signal) : chunk.length - offset;
            await h.writeFile(chunk.subarray(offset, offset + length));
            offset += length; done += length; timer.refresh();
            ctx.progress({ title: item.title, state: 'running', done, total, unit: 'bytes', bytesPerSecond: Math.round(done * 1000 / Math.max(1, Date.now() - start)) });
          }
        }
        await h.sync();
      } finally { await h.close(); }
      clearTimeout(timer);
      if (!done || (total && done !== total)) fail('download_size', '下载文件长度不完整，请重试。');
      ctx.progress({ state: 'verifying', done: 0 });
      const vpk = await readVpk(file, { includeEntries: true });
      await verifyVpk(vpk, ctx.signal, values => ctx.progress(values));
      if (raw.preview_url) {
        this.remember(raw);
        try {
          const { dataUrl } = await this.thumbnail(id, 'detail', ctx.signal);
          if (dataUrl) await fs.writeFile(path.join(stage, 'mod.jpg'), Buffer.from(dataUrl.split(',')[1], 'base64'), { flag: 'wx' });
        } catch {
          ctx.signal.throwIfAborted(); // A later library thumbnail request retries an unavailable cover.
        }
      }
      const result = await ctx.commit(() => commit(async () => {
        if ((await this.manager.scan(gameRoot)).mods.some(m => m.workshopId === id)) fail('already_in_library', '此条目已由另一项操作加入库中。');
        await this.manager.library.publish(gameRoot, stage, item); published = true;
        await fs.unlink(path.join(await this.manager.library.folder(gameRoot, id), '.flare-task.json'));
        return { modId: libraryId(id), done, total: done, unit: 'bytes' };
      }, item));
      return result;
    } finally { clearTimeout(timer); if (!published) await removeTaskDirectory(stage, ctx.taskId); }
  }
}
