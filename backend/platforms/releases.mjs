import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { withZip } from './packages.mjs';
import { validateManifest } from './manager.mjs';
import { fail, platformPath, readBytes } from './files.mjs';
import { directory, writeJson } from '../mods/files.mjs';

const LIMIT = 128 * 1024 * 1024;
export const digest = b => createHash('sha256').update(b).digest('hex');
export const versionString = v => {
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) fail('platform_version_invalid', '请选择精确发布版本。');
  return v;
};
async function body(response, limit) {
  if (!response.ok) { await response.body?.cancel(); fail('platform_http', `GitHub 请求失败（HTTP ${response.status}），请稍后重试。`); }
  const chunks = []; let size = 0;
  for await (const b of response.body) { size += b.length; if (size > limit) fail('platform_response_too_large', '下载响应超过大小限制。'); chunks.push(b); }
  return Buffer.concat(chunks);
}
export async function inspectPackage(file, adapter) {
  return withZip(file, async zip => {
    const manifests = [...zip.entries.keys()].filter(n => n === 'skeeto/manifest.json' || n.endsWith('/skeeto/manifest.json'));
    if (manifests.length !== 1) fail('platform_manifest_invalid', '安装包需要唯一的 Skeeto/Manifest.json。');
    const prefix = manifests[0].slice(0, -'skeeto/manifest.json'.length);
    const manifest = validateManifest(JSON.parse((await zip.read(manifests[0], 1024 * 1024)).toString('utf8').replace(/^\uFEFF/, '')), adapter);
    if (typeof manifest.requires_manual_migrate !== 'boolean' || manifest.update_protocol !== 1) fail('platform_manifest_invalid', '安装包迁移声明或更新协议无效。');
    const files = new Map(); let bytes = 0;
    for (const entry of manifest.files) {
      // The installer may write only explicitly supported layout paths. Package tools remain in cache.
      if (!adapter.packageFiles.some(f => f.path === entry.relative && f.role === entry.role)) fail('platform_layout_unsupported', `此版本新增了待适配的文件：${entry.relative}`);
      const data = await zip.read(prefix + entry.relative.toLowerCase(), 64 * 1024 * 1024);
      if (!data) { if (entry.role === 'document') continue; fail('platform_package_missing', `安装包缺少：${entry.relative}`); }
      bytes += data.length; if (bytes > LIMIT) fail('platform_response_too_large', '安装包解压总量超过 128 MiB。');
      if (entry.hash && digest(data) !== entry.hash) fail('platform_hash_mismatch', `安装包文件与作者清单有差异：${entry.relative}`);
      files.set(entry.relative, data);
    }
    const marker = files.get('SKEETO_WORKSHOP.txt')?.toString('utf8');
    if (!/^SkeetoWorkshopPackage=1\r?$/m.test(marker ?? '') || !/^install_layout=2\r?$/m.test(marker ?? '') || !/^update_protocol=1\r?$/m.test(marker ?? '') ||
      marker.match(/^engine_sha256=([a-f0-9]{64})\r?$/m)?.[1] !== digest(files.get('Skeeto/Maintain.ps1') ?? Buffer.alloc(0)) ||
      files.get('VERSION.txt')?.toString('utf8').match(/^semver=(\d+\.\d+\.\d+)\r?$/m)?.[1] !== manifest.semver) fail('platform_manifest_invalid', '安装包的版本、更新信封与维护器清单有差异。');
    return { manifest, files, bytes };
  }, { legacyEncoding: adapter.release.legacyZipNameEncoding ?? 'utf-8' });
}

export class PlatformReleases {
  constructor({ dataDir, adapter, fetch: fetchImpl = fetch }) { this.base = path.join(dataDir, 'platforms/cache', adapter.id); this.adapter = adapter; this.fetch = fetchImpl; }
  async release(version) {
    if (this.adapter.distribution === 'source-ports') fail('platform_retired', 'Skeeto 整包下载已撤下，请在 DLL 合集中选择源码移植模组。');
    if (version !== undefined) versionString(version);
    const url = `https://api.github.com/repos/${this.adapter.release.repo}/releases/${version ? 'tags/v' + version : 'latest'}`;
    const response = await this.fetch(url, { redirect: 'error', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Matcha' }, signal: AbortSignal.timeout(15000) });
    const r = JSON.parse((await body(response, 1024 * 1024)).toString('utf8'));
    const found = /^v(\d+\.\d+\.\d+)$/.exec(r.tag_name)?.[1];
    if (!found || r.draft || r.prerelease || (version && found !== version)) fail('platform_release_invalid', '请选择正式发布的精确版本。');
    const name = this.adapter.release.asset.replace('{version}', found), asset = r.assets?.find(a => a.name === name);
    const expected = `https://github.com/${this.adapter.release.repo}/releases/download/v${found}/${name}`;
    if (!asset || asset.browser_download_url !== expected || !Number.isSafeInteger(asset.id) || asset.id < 1 || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > LIMIT) fail('platform_release_invalid', '发布资产名称、来源或大小需要检查。');
    return { id: this.adapter.id, version: found, publishedAt: r.published_at, summary: String(r.body ?? '').slice(0, 4000), url: `https://github.com/${this.adapter.release.repo}/releases/tag/v${found}`,
      asset: { url: expected, apiUrl: `https://api.github.com/repos/${this.adapter.release.repo}/releases/assets/${asset.id}`, size: asset.size, name }, verification: { state: 'unverified' } };
  }
  folder(version) { return path.join(this.base, versionString(version)); }
  async cached(version) {
    let folder=this.folder(version),file=await platformPath(folder,'package.zip');
    if(!file)for(const old of this.legacyCaches??[]){const f=path.join(old,this.adapter.id,versionString(version));file=await platformPath(f,'package.zip');if(file){folder=f;break}}
    if (!file) fail('platform_download_required', '请先下载选定版本。');
    const recordFile = await platformPath(folder, 'release.json');
    if (!recordFile) fail('platform_cache_invalid', '缓存缺少发布记录，请检查下载任务。');
    const record = JSON.parse((await readBytes(recordFile)).toString('utf8'));
    if (record.version !== version || record.id !== this.adapter.id) fail('platform_cache_invalid', '缓存发布记录需要检查。');
    const pkg = await inspectPackage(file, this.adapter);
    if (pkg.manifest.semver !== version) fail('platform_version_mismatch', '包内版本与选定版本有差异。');
    return { ...pkg, release: record, folder };
  }
  async publish(stage, release, ctx) {
    // Revalidation can reuse a retained failed input after its adapter has been corrected.
    if (path.dirname(path.resolve(stage)).toLowerCase() !== path.resolve(this.base).toLowerCase() || !/^download-[0-9a-f-]{36}$/.test(path.basename(stage))) fail('platform_cache_invalid', '下载暂存目录超出本平台缓存。');
    await directory(stage);
    const file = await platformPath(stage, 'package.zip');
    if (!file || (await fs.stat(file)).size !== release.asset.size) fail('platform_download_size', '下载大小与发布记录有差异。');
    const pkg = await inspectPackage(file, this.adapter);
    if (pkg.manifest.semver !== release.version) fail('platform_version_mismatch', '下载包版本与发布记录有差异。');
    await writeJson(path.join(stage, 'release.json'), release);
    const rejection = await platformPath(stage, 'rejection.json'); if (rejection) await fs.unlink(rejection);
    await ctx.commit(() => fs.rename(stage, this.folder(release.version)));
    return pkg;
  }
  async download(version, ctx) {
    const release = await this.release(version), folder = this.folder(version);
    try { await directory(folder); await this.cached(version); return { version, cached: true, sizeBytes: (await fs.stat(path.join(folder, 'package.zip'))).size }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.mkdir(this.base, { recursive: true }); await directory(this.base);
    const stage = path.join(this.base, `download-${randomUUID()}`); await fs.mkdir(stage);
    let published = false, rejected = false;
    try {
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(5 * 60 * 1000)]);
      // GitHub's public release-asset API streams the binary or redirects to its asset CDN.
      let url = release.asset.apiUrl, response;
      for (let i = 0; i < 5; i++) {
        response = await this.fetch(url, { redirect: 'manual', signal, headers: { Accept: 'application/octet-stream', 'User-Agent': 'Matcha', 'X-GitHub-Api-Version': '2022-11-28' } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) fail('platform_download_origin', 'GitHub 下载跳转缺少目标。');
        const next = new URL(location, url);
        if (next.protocol !== 'https:' || next.username || next.password || next.port || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)) fail('platform_download_origin', '发布资产跳转到了未声明来源。');
        url = next.href; response = null;
      }
      if (!response?.ok) { await response?.body?.cancel(); fail('platform_http', `GitHub 资产下载失败（${response?.status ?? '跳转过多'}）。`); }
      const h = await fs.open(path.join(stage, 'package.zip'), 'wx'); let done = 0;
      try {
        for await (const b of response.body) { signal.throwIfAborted(); done += b.length; if (done > release.asset.size) fail('platform_download_size', '下载大小与发布记录有差异。'); await h.writeFile(b); ctx.progress({ state: 'running', done, total: release.asset.size, unit: 'bytes' }); }
        await h.sync();
      } finally { await h.close(); }
      if (done !== release.asset.size) fail('platform_download_size', '下载未完整结束。');
      ctx.progress({ state: 'verifying' });
      try {
        await this.publish(stage, release, ctx); published = true;
      } catch (error) {
        // Keep the rejected input for diagnosis; it is never published as an installable cache version.
        await writeJson(path.join(stage, 'rejection.json'), { version, error: { code: error.code, message: error.message } });
        rejected = true; error.details = { rejectedPackage: path.join(stage, 'package.zip') }; throw error;
      }
      return { version, sizeBytes: done, cached: false };
    } finally {
      if (!published && !rejected) { for (const name of ['package.zip', 'release.json']) await fs.unlink(path.join(stage, name)).catch(e => { if (e.code !== 'ENOENT') throw e; }); await fs.rmdir(stage); }
    }
  }
}
