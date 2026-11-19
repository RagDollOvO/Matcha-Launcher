// Refresh the two upstream packages without changing a game installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { withZip } from '../backend/platforms/packages.mjs';
import { createWorkshopNetwork } from '../backend/mods/workshop-network.mjs';
import { safeResourcePath } from '../backend/mods/files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'vendor');
const network = createWorkshopNetwork();
const headers = { 'User-Agent': 'Matcha', Accept: 'application/vnd.github+json' };
async function get(url, options = {}) {
  const r = await network.fetch(url, { headers, signal: AbortSignal.timeout(120000), ...options }).catch(e => { throw new Error(`Download failed: ${url}`, { cause: e }); });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}
async function download(url, file, size, sha256) {
  const s = await fs.stat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (!s || size !== undefined && s.size !== Number(size)) {
    const body = Buffer.from(await (await get(url)).arrayBuffer());
    if (body.length > 128 * 1024 * 1024 || size !== undefined && body.length !== Number(size)) throw new Error('Download size differs from upstream metadata');
    if (sha256 && createHash('sha256').update(body).digest('hex') !== sha256) throw new Error('Release asset integrity mismatch');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  } else if (sha256 && createHash('sha256').update(await fs.readFile(file)).digest('hex') !== sha256) throw new Error('Cached release asset integrity mismatch');
}
const compare = (a, b) => a.split('.').map(Number).reduce((n, v, i) => n || Math.sign(v - Number(b.split('.')[i])), 0);
const versionOf = readme => readme.match(/^\[(\d+\.\d+\.\d+)\]/m)?.[1];
const tar = args => execFileSync('tar', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
async function workshopCandidate() {
  const body = new URLSearchParams({ itemcount: '1', 'publishedfileids[0]': '3558049615' });
  const w = (await (await get('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', { method: 'POST', body })).json()).response.publishedfiledetails[0];
  if (w.result !== 1 || w.consumer_app_id !== 550 || w.creator !== '76561198859761739' || new URL(w.file_url).hostname !== 'cdn.steamusercontent.com') throw new Error('Unexpected L4N workshop origin');
  // The content handle changes even when two releases have the same byte size.
  const key = new URL(w.file_url).pathname.match(/\/ugc\/(\d+)\//)?.[1];
  if (!key) throw new Error('Workshop content handle missing');
  const file = path.join(vendor, `l4n/archives/workshop-${key}.zip`);
  const legacy = path.join(vendor, 'l4n/3558049615.zip');
  const old = await fs.readFile(path.join(vendor, 'l4n/workshop.json'), 'utf8').then(s => JSON.parse(s.replace(/^\uFEFF/, ''))).catch(() => null);
  if (old?.file_url === w.file_url && !await fs.stat(file).catch(() => null) && (await fs.stat(legacy).catch(() => null))?.size === Number(w.file_size)) {
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.copyFile(legacy, file);
  }
  await download(w.file_url, file, w.file_size);
  const version = await withZip(file, async zip => versionOf((await zip.read('readme_l4n.txt', 1024 * 1024)).toString('utf8')));
  if (!version) throw new Error('Workshop package version missing');
  return { version, file, sourceKind: 'author-workshop', source: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3558049615', downloadUrl: w.file_url,
    publishedAt: new Date(w.time_updated * 1000).toISOString() };
}
async function archiveCandidate() {
  const base = 'https://github.com/STC214/l4n-releases';
  // Public release pages remain usable when the public GitHub API is rate limited.
  const page = await get(`${base}/releases/latest`);
  const tag = new URL(page.url).pathname.match(/^\/STC214\/l4n-releases\/releases\/tag\/(L4N_v\d+\.\d+\.\d+)$/)?.[1];
  if (!tag) throw new Error('L4N archive latest tag missing');
  await page.body?.cancel();
  const html = await (await get(`${base}/releases/expanded_assets/${tag}`)).text();
  const asset = [...html.matchAll(/href="(\/STC214\/l4n-releases\/releases\/download\/[^"<>]+\.(?:7z|zip))"/g)][0]?.[1];
  const plain = html.replace(/<[^>]*>/g, ' '), sha256 = plain.match(/sha256:\s*([a-f0-9]{64})/)?.[1];
  if (!asset || !sha256 || !asset.startsWith(`/STC214/l4n-releases/releases/download/${tag}/`)) throw new Error('L4N original release asset or checksum missing');
  const file = path.join(vendor, 'l4n/archives', path.basename(asset));
  await download(`https://github.com${asset}`, file, undefined, sha256);
  const releaseVersion = tag.slice('L4N_v'.length).split('.').map(Number).join('.');
  let version;
  if (file.endsWith('.zip')) version = await withZip(file, async z => versionOf((await z.read('readme_l4n.txt', 1024 * 1024)).toString('utf8')));
  else {
    for (const entry of tar(['-tf', file]).trim().split(/\r?\n/)) safeResourcePath(entry.replace(/\/$/, ''));
    if (tar(['-tvf', file]).trim().split(/\r?\n/).some(s => !/^[-d]/.test(s))) throw new Error('Linked or special L4N archive entry');
    version = versionOf(tar(['-xOf', file, 'readme_l4n.txt']));
  }
  if (version !== releaseVersion) throw new Error(`L4N release ${releaseVersion} contains ${version ?? 'no version'}`);
  return { version, file, sourceKind: 'release-archive', source: `${base}/releases/tag/${tag}`, downloadUrl: `https://github.com${asset}`, sha256 };
}
async function publishL4n(candidate) {
  const folder = path.join(vendor, 'l4n', candidate.version), files = [];
  await fs.mkdir(folder, { recursive: true });
  if (candidate.file.endsWith('.zip')) {
    await withZip(candidate.file, async zip => {
      for (const name of zip.entries.keys()) {
        if (name.endsWith('/')) continue;
        const data = await zip.read(name, 64 * 1024 * 1024), file = path.join(folder, ...name.split('/'));
        await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); files.push(name);
      }
    });
  } else {
    tar(['-xf', candidate.file, '-C', folder]);
    async function walk(dir) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Linked L4N resource');
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile()) files.push(path.relative(folder, file).replaceAll('\\', '/'));
        else throw new Error('Special L4N resource');
      }
    }
    await walk(folder);
  }
  for (const name of ['readme_l4n.txt', 'bin/left4neko.dll', 'left4dead2.exe']) if (!files.includes(name)) throw new Error(`L4N package missing ${name}`);
  if (versionOf(await fs.readFile(path.join(folder, 'readme_l4n.txt'), 'utf8')) !== candidate.version) throw new Error('Extracted L4N version differs');
  const { file, ...origin } = candidate;
  return { ...origin, sizeBytes:(await fs.stat(file)).size,sha256:origin.sha256??createHash('sha256').update(await fs.readFile(file)).digest('hex'), folder: `l4n/${candidate.version}`, files, author: 'Starfelll / nekonacho' };
}
try {
  const catalogFile = path.join(vendor, 'native-libraries.json');
  const previous = await fs.readFile(catalogFile, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  const candidates = [], sourceChecks = [];
  for (const [source, lookup] of [['author-workshop', workshopCandidate], ['release-archive', archiveCandidate]]) {
    try { const c = await lookup(); candidates.push(c); sourceChecks.push({ source, version: c.version }); }
    catch (e) { sourceChecks.push({ source, error: e.message }); console.error(`${source}: ${e.message}`); }
  }
  candidates.sort((a, b) => compare(b.version, a.version));
  if (!candidates.length) throw new Error('No verified L4N package is available');
  if (previous && compare(candidates[0].version, previous.l4n.version) < 0) throw new Error('Available L4N sources are older than the selected local package; keep the current version');
  const l4n = await publishL4n(candidates[0]);
  const configFile = path.join(root, 'src-tauri/tauri.conf.json'), config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  for (const source of Object.keys(config.bundle.resources)) if (/^\.\.\/vendor\/l4n\/\d+\.\d+\.\d+\/$/.test(source) || /^\.\.\/vendor\/dxvk\/\d+\.\d+\.\d+\//.test(source)) delete config.bundle.resources[source];
  // Portable packages ship the pinned catalog and license only; keep the author's feature notes when refreshing this release.
  if(previous?.l4n.version===l4n.version)l4n.features=previous.l4n.features;
  await fs.writeFile(catalogFile, JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), sourceChecks, l4n }, null, 2) + '\n');
  await fs.writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
  console.log(JSON.stringify({ l4n: l4n.version, source: l4n.source, gameFilesChanged: false }));
} finally { await network.close(); }
