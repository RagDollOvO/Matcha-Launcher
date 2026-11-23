import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { PlatformError } from './errors.mjs';
import { directory, safeResourcePath, writeJson } from './mods/files.mjs';
import { steamAssetUrl } from './mods/workshop.mjs';
import { descriptionText } from './mods/workshop-browse.mjs';
import { imageData } from './plugin-assets.mjs';

const fail = (code, message, details) => { throw new PlatformError(code, message, details); };
const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Matcha-DLL-Source' };
const clip = value => String(value ?? '').slice(0, 16000);
const publicAsset = ({ id, name, size, url, kind, digest }) => ({ id, name, size, url, kind, ...(digest ? { digest } : {}) });
function sourceUrl(raw) {
  let u; try { u = new URL(raw); } catch { fail('source_invalid', '请选择 GitHub 仓库或工坊条目链接。'); }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) fail('source_invalid', '来源需要公开 HTTPS 链接。');
  return u;
}
export function githubSource(raw) {
  const u = sourceUrl(raw), parts = u.pathname.split('/').filter(Boolean);
  if (u.hostname !== 'github.com' || !/^[a-z0-9-]{1,39}$/i.test(parts[0] ?? '') || !/^[a-z0-9._-]{1,100}$/i.test(parts[1] ?? '') || ['.', '..'].includes(parts[1]))
    fail('source_invalid', '需要 GitHub 仓库、Release 或该仓库的附件链接。');
  const owner = parts[0], repo = parts[1].replace(/\.git$/i, '');
  let tag, assetName;
  if (parts.length > 2) {
    if (parts[2] !== 'releases' || parts[3] && !['latest', 'tag', 'download'].includes(parts[3])) fail('source_invalid', '请选择仓库或 Release 来源页。');
    if (parts[3] === 'tag' || parts[3] === 'download') {
      tag = decodeURIComponent(parts[4] ?? '');
      if (!tag) fail('source_invalid', 'Release 链接缺少版本标签。');
      if (parts[3] === 'download') assetName = decodeURIComponent(parts.slice(5).join('/'));
      if (parts[3] === 'download' && !assetName) fail('source_invalid', '附件链接缺少文件名。');
    }
  }
  return { owner, repo, tag, assetName, url: `https://github.com/${owner}/${repo}` };
}
function workshopSource(raw) {
  const u = sourceUrl(raw);
  const id = u.searchParams.get('id');
  if (u.hostname !== 'steamcommunity.com' || !/^\/(sharedfiles|workshop)\/filedetails\/?$/.test(u.pathname) || !/^[1-9][0-9]{5,19}$/.test(id ?? ''))
    fail('source_invalid', '请选择具体的 L4D2 工坊条目。');
  return { id, url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` };
}
function githubDownload(raw) {
  const u = sourceUrl(raw), host = u.hostname;
  if (!['api.github.com', 'github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
    'release-assets.githubusercontent.com', 'user-images.githubusercontent.com', 'github-production-release-asset-2e65be.s3.amazonaws.com'].includes(host))
    fail('download_origin', 'GitHub 附件跳转到了未登记的下载域名，请核对来源。');
  return u.href;
}
function filename(name) {
  if (typeof name !== 'string' || name !== path.basename(name)) fail('download_origin', '来源附件文件名需要核对。');
  safeResourcePath(name); return name;
}
async function body(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); fail('source_limit', '来源资料超过读取上限。'); }
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length; if (bytes > limit) { await response.body?.cancel().catch(() => {}); fail('source_limit', '来源资料超过读取上限。'); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
/** Public metadata only; binary and image transfers use a separately approved plan. */
export class DllSources {
  constructor({ dataDir, fetch, workshop }) {
    this.base = path.join(dataDir, 'dll-sources'); this.fetch = fetch; this.workshop = workshop;
    this.records = new Map(); this.cache = new Map(); this.plans = new Map();
  }
  async json(url, optional, signal) {
    const response = await this.fetch(url, { headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (optional && response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) {
      await response.body?.cancel();
      if ([403, 429].includes(response.status)) fail('source_rate_limited', 'GitHub 当前访问受限，请使用已缓存结果或稍后检查。', { resetAt: response.headers.get('x-ratelimit-reset') });
      fail('source_http', `GitHub 来源读取失败（HTTP ${response.status}）。`);
    }
    return JSON.parse((await body(response, 4 * 1024 * 1024)).toString('utf8'));
  }
  view(row) {
    return { sourceId: row.id, source: row.source, publisher: row.publisher, repository: row.repository,
      title: row.title, description: row.description, readme: row.readme, release: row.release,
      assets: row.assets.map(publicAsset), images: row.images.map(publicAsset), ...(row.workshop ? { workshop: row.workshop } : {}),
      ...(row.requestedAsset ? { requestedAsset: row.requestedAsset } : {}), ...(row.unavailable ? { unavailable: row.unavailable } : {}) };
  }
  row(id) {
    const row = this.records.get(id);
    if (!row || Date.now() - row.at > 15 * 60 * 1000) fail('source_stale', '来源检查已过期，请重新读取来源。');
    return row;
  }
  async inspect(params, signal) {
    signal?.throwIfAborted();
    if (!['github', 'workshop'].includes(params.type)) fail('source_invalid', '请选择 GitHub 或工坊来源。');
    const parsed = params.type === 'github' ? githubSource(params.url) : workshopSource(params.url);
    const cacheKey = `${params.type}:${parsed.url.toLowerCase()}:${parsed.tag ?? ''}:${parsed.assetName ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (!params.refresh && cached && Date.now() - cached.at < 5 * 60 * 1000) return this.view(cached);
    const checkedAt = new Date().toISOString(); let row;
    if (params.type === 'github') {
      const api = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
      const repository = await this.json(api, false, signal), latest = await this.json(`${api}/releases/latest`, true, signal);
      if (!Number.isSafeInteger(repository.id) || !Number.isSafeInteger(repository.owner?.id) ||
        String(repository.full_name).toLowerCase() !== `${parsed.owner}/${parsed.repo}`.toLowerCase())
        fail('source_identity_changed', '仓库身份与来源链接有变化，请先核对仓库。');
      const selected = parsed.tag ? await this.json(`${api}/releases/tags/${encodeURIComponent(parsed.tag)}`, false, signal) : latest;
      const readme = await this.json(`${api}/readme${parsed.tag ? `?ref=${encodeURIComponent(parsed.tag)}` : ''}`, true, signal);
      const readmeText = readme?.encoding === 'base64' ? clip(Buffer.from(readme.content ?? '', 'base64').toString('utf8')) : '';
      const assets = (selected?.assets ?? []).slice(0, 100).filter(a => a.state === 'uploaded' && Number.isSafeInteger(a.id) && Number.isSafeInteger(a.size) && a.size >= 0).map(a => ({
        id: String(a.id), name: String(a.name), size: a.size, url: a.browser_download_url, downloadUrl: `${api}/releases/assets/${a.id}`,
        digest: a.digest ?? undefined, kind: /\.(png|jpe?g|webp|gif)$/i.test(a.name) ? 'image' : 'binary' }));
      const images = assets.filter(a => a.kind === 'image');
      const seen = new Set(images.map(a => a.url));
      for (const match of readmeText.matchAll(/!\[[^\]]*\]\(([^\s)]+)[^)]*\)|<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
        if (images.length >= 12 || !readme?.download_url) break;
        try {
          const url = githubDownload(new URL(match[1] ?? match[2], readme.download_url).href);
          if (seen.has(url)) continue; seen.add(url);
          images.push({ id: `readme-image-${images.length}`, name: filename(path.posix.basename(new URL(url).pathname) || 'readme-image.png'), url, downloadUrl: url, size: null, kind: 'image' });
        } catch { /* Remote custom image hosts stay in README text, without auto-fetch. */ }
      }
      row = { title: repository.full_name, description: clip(repository.description), repository: { id: String(repository.id), owner: repository.owner?.login, defaultBranch: repository.default_branch, url: repository.html_url },
        publisher: { type: 'github', repositoryId: String(repository.id), ownerId: String(repository.owner?.id) },
        source: { type: 'github', url: `https://github.com/${repository.full_name}`, label: repository.full_name, ...(selected?.tag_name ? { version: selected.tag_name } : {}), checkedAt,
          latest: latest ? { version: latest.tag_name, publishedAt: latest.published_at, url: latest.html_url } : null },
        readme: readme ? { path: readme.path, text: readmeText, url: readme.html_url } : null,
        release: selected ? { version: selected.tag_name, publishedAt: selected.published_at, url: selected.html_url, notes: clip(selected.body) } : null,
        assets, images, ...(!selected ? { unavailable: '此仓库尚无公开 Release 附件，请核对作者提供的成品包。' } : {}), requestedAsset: parsed.assetName };
    } else {
      const raw = (await this.workshop.api('GetPublishedFileDetails', [parsed.id], signal)).find(r => String(r.publishedfileid) === parsed.id);
      if (!raw || raw.result !== 1 || Number(raw.consumer_app_id) !== 550 || Number(raw.file_type) === 2 || !/^[0-9]+$/.test(String(raw.creator ?? '')))
        fail('source_unavailable', '工坊条目当前不可读，或该链接尚未指向具体的 L4D2 条目。');
      if (!Number.isSafeInteger(Number(raw.time_updated)) || Number(raw.time_updated) <= 0) fail('source_response', '工坊更新时间需要核对。');
      const version = new Date(Number(raw.time_updated) * 1000).toISOString(), assets = [], images = [];
      if (raw.file_url) assets.push({ id: 'file', name: path.posix.basename(String(raw.filename || `workshop-${parsed.id}.zip`).replaceAll('\\', '/')), size: Number.isSafeInteger(Number(raw.file_size)) && Number(raw.file_size) > 0 ? Number(raw.file_size) : null,
        url: steamAssetUrl(raw.file_url), downloadUrl: steamAssetUrl(raw.file_url), kind: 'binary' });
      if (raw.preview_url) images.push({ id: 'preview', name: 'workshop-cover.jpg', size: null, url: steamAssetUrl(raw.preview_url), downloadUrl: steamAssetUrl(raw.preview_url), kind: 'image' });
      row = { title: String(raw.title ?? parsed.id), description: clip(descriptionText(raw.description)),
        workshop: { publishedfileid: parsed.id, creator: String(raw.creator), time_updated: Number(raw.time_updated), filename: raw.filename,
          file_url: raw.file_url, preview_url: raw.preview_url },
        publisher: { type: 'workshop', publishedFileId: parsed.id, creator: String(raw.creator) },
        source: { type: 'workshop', url: parsed.url, label: String(raw.title ?? parsed.id), version, checkedAt, latest: { publishedAt: version, url: parsed.url } },
        release: { publishedAt: version, url: parsed.url, notes: clip(descriptionText(raw.description)) }, readme: null, assets, images,
        ...(!assets.length ? { unavailable: '作者尚未提供可直接下载的 file_url，保留来源资料，等待可用发行包。' } : {}) };
    }
    row.id = randomUUID(); row.at = Date.now(); row.cacheKey = cacheKey;
    this.records.set(row.id, row); this.cache.set(cacheKey, row);
    while (this.records.size > 100) this.records.delete(this.records.keys().next().value);
    while (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
    return this.view(row);
  }
  preview({ sourceId, assetId }) {
    const row = this.row(sourceId), asset = [...row.assets, ...row.images].find(a => a.id === assetId);
    if (!asset) fail('source_asset_missing', '请选择本次来源检查返回的附件或图片。');
    filename(asset.name);
    if (asset.digest && !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) fail('source_digest', '附件校验格式需要核对。');
    const limit = asset.kind === 'image' ? 4 * 1024 * 1024 : 1024 ** 3;
    if (asset.size > limit) fail('source_limit', '该附件超过本地暂存下载上限。');
    const planId = randomUUID(); this.plans.set(planId, { row, asset, at: Date.now() });
    if (this.plans.size > 30) this.plans.delete(this.plans.keys().next().value);
    return { planId, sourceId, source: row.source, publisher: row.publisher, asset: publicAsset(asset), target: this.base };
  }
  async download(planId, confirmation, signal, progress) {
    if (confirmation?.approved !== true || confirmation.source !== 'user') fail('confirmation_required', '请确认来源附件下载到暂存区。');
    const plan = this.plans.get(planId);
    if (!plan || Date.now() - plan.at > 15 * 60 * 1000) fail('source_stale', '请重新检查来源附件并确认。');
    this.plans.delete(planId);
    const { row, asset } = plan, validate = row.source.type === 'workshop' ? steamAssetUrl : githubDownload;
    let url = validate(asset.downloadUrl), response;
    for (let hop = 0; hop < 5; hop++) {
      signal?.throwIfAborted();
      response = await this.fetch(url, { headers: row.source.type === 'github' ? { ...headers, Accept: 'application/octet-stream' } : {}, redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) fail('download_origin', '附件跳转缺少目标地址。');
      url = validate(new URL(location, url).href); response = undefined;
    }
    if (!response?.ok) { await response?.body?.cancel(); fail('source_http', `来源附件下载失败（HTTP ${response?.status ?? 'redirect'}）。`); }
    const limit = asset.kind === 'image' ? 4 * 1024 * 1024 : 1024 ** 3;
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); fail('source_limit', '来源附件超过暂存大小上限。'); }
    await fs.mkdir(this.base, { recursive: true }); await directory(this.base);
    const folder = path.join(this.base, randomUUID()); await fs.mkdir(folder);
    const file = path.join(folder, filename(asset.name)), handle = await fs.open(file, 'wx');
    const expected = asset.digest?.slice(7).toLowerCase(), hash = expected ? createHash('sha256') : null; let bytes = 0;
    try {
    try {
      for await (const chunk of response.body ?? []) {
        signal?.throwIfAborted(); bytes += chunk.length;
        if (bytes > limit) fail('source_limit', '来源附件超过暂存大小上限。');
        hash?.update(chunk); await handle.writeFile(chunk); progress?.({done:bytes,total:asset.size,unit:'bytes'});
      }
      await handle.sync();
    } finally { await handle.close(); }
    if (asset.size !== null && bytes !== asset.size) fail('source_size_changed', '附件大小与来源记录有变化，请重新检查发行包。');
    if (expected && hash.digest('hex') !== expected) fail('source_digest', '附件与来源公布的校验值不符，已停止导入。');
    } catch(e){await fs.unlink(file);throw e;}
    let image;
    if (asset.kind === 'image') image = { path: file, mime: (await imageData(file)).mime };
    const result = { sourceId: row.id, source: row.source, publisher: row.publisher, file, asset: publicAsset(asset),
      integrity: expected ? 'matched-published-sha256' : 'not-published', ...(image ? { image } : {}) };
    await writeJson(path.join(folder, 'source.json'), result);
    return result;
  }
}
