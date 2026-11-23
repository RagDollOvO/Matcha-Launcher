import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectPe } from '../file-inspection.mjs';
import { errorRecord } from '../errors.mjs';
import { directory } from '../mods/files.mjs';
import { relativePath, platformPath, readBytes, readText, decodeText, fail, skeetoCoreVersion } from './files.mjs';
import { detectPlatformPackage } from './packages.mjs';

const descriptors = [JSON.parse(await fs.readFile(new URL('./skeeto.json', import.meta.url), 'utf8'))];
for (const d of descriptors) d.modules = JSON.parse(await fs.readFile(new URL(d.modulesFile, import.meta.url), 'utf8')).modules;
const samePath = (a, b) => a && b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateManifest(value, adapter) {
  const contract = adapter.detect;
  if (value?.schema !== 1 || value.product !== adapter.name || !/^\d+\.\d+\.\d+$/.test(value.semver) || value.install_layout !== contract.layout || !Array.isArray(value.files) || !value.files.length || value.files.length > 128) fail('platform_manifest_invalid', '平台 Manifest 格式或安装布局需要检查。');
  const seen = new Set();
  const files = value.files.map(e => {
    const relative = relativePath(e.relative), key = relative.toLowerCase();
    if (seen.has(key) || !['core', 'proxy', 'plugin', 'marker', 'tool', 'document'].includes(e.role) || (e.hash !== undefined && !/^[a-f0-9]{64}$/.test(e.hash)) || (e.role !== 'document' && !e.hash)) fail('platform_manifest_invalid', '平台 Manifest 含重复路径、无效角色或哈希。');
    seen.add(key); return { ...e, relative };
  });
  for (const [role, file] of [['core', contract.core], ['proxy', adapter.loader.file]]) {
    const matches = files.filter(f => f.role === role);
    if (matches.length !== 1 || matches[0].relative.toLowerCase() !== file.toLowerCase()) fail('platform_manifest_invalid', '平台 Manifest 加载路径与适配描述不一致。');
  }
  return { ...value, files };
}

export async function windowsModules(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) fail('invalid_argument', '游戏进程 ID 无效。');
  if (process.platform !== 'win32') fail('unsupported_os', '模块观测需要 Windows。');
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $p=Get-Process -Id ${pid}; $m=@($p.Modules | ForEach-Object { $_.FileName }); if (!$m.Count) { throw 'Empty process module inventory' }; @{path=$p.Path;modules=$m}|ConvertTo-Json -Compress`;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
  return JSON.parse(stdout.replace(/^\uFEFF/, ''));
}

export class ExternalPlatforms {
  constructor({ getModules = windowsModules } = {}) { this.getModules = getModules; }
  adapter(id) {
    const result = descriptors.find(d => d.id === id);
    if (!result) fail('platform_unknown', '未知外部平台。');
    return result;
  }
  async doc(gameRoot, id, requestedPath) {
    const adapter = this.adapter(id);
    // The request must be an exact declared path, before any normalization or IO.
    if (!adapter.docs.some(d => d.path === requestedPath)) fail('platform_doc_denied', '请选择平台声明的说明文件。');
    const cached = await this.managed?.cachedDoc(gameRoot, id, requestedPath);
    if (cached) {
      if (cached.length > 1024 * 1024) fail('platform_file_too_large', '说明文档超过 1 MiB。');
      return { text: decodeText(cached) };
    }
    const file = await platformPath(gameRoot, requestedPath);
    if (!file) fail('platform_doc_missing', '此安装未附带该说明文件。');
    return { text: await readText(file) };
  }
  async snapshot(gameRoot, inspection) {
    return Promise.all(descriptors.map(adapter => this.inspect(adapter, gameRoot, inspection)));
  }
  async inspect(adapter, gameRoot, inspection) {
    const { id, name, kind, source, loader, modules, docs } = adapter;
    const result = { id, name, kind, distribution: adapter.distribution, installed: false, version: null, state: 'not-installed', source,
      identity: { verified: false, claimed: adapter.source.author }, verification: { state: 'unverified' },
      loader: { kind: loader.kind, file: loader.file, present: false, owned: false },
      integrity: { state: 'unknown', scope: 'manifest-hashed-files', files: [] }, runtime: { loaded: null },
      update: { channel: adapter.update.channel, workshopId: adapter.update.workshopId, selfUpdate: null, packagePresent: false },
      subPlugins: { platformOn: null, items: [] }, modules: modules.map(m => ({ ...structuredClone(m),
        state: 'unknown', stateSource: 'saved-settings', switchable: adapter.moduleSwitches[m.id]?.coverage === 'complete',
        switchCoverage: adapter.moduleSwitches[m.id]?.coverage ?? 'unknown',
        switches: structuredClone(adapter.moduleSwitches[m.id]?.switches ?? []),
        switchNote: adapter.moduleSwitches[m.id]?.note })),
      docs: docs.map(d => ({ ...d, present: false })), coexist: { beacon: 'unknown', note: '共存情况待观测。' }, issues: [] };
    if (!gameRoot || !inspection) return result;
    const issue = (code, message) => result.issues.push({ code, message });
    const attempt = async fn => { try { return await fn(); } catch (e) { result.issues.push(errorRecord(e)); return null; } };
    const coreFile = await attempt(() => platformPath(gameRoot, adapter.detect.core));
    const proxyFile = await attempt(() => platformPath(gameRoot, loader.file));
    const manifestFile = await attempt(() => platformPath(gameRoot, adapter.detect.manifest));
    const managed = await attempt(() => this.managed?.find(gameRoot, id));
    result.managed = managed?.status === 'installed';
    result.pendingOperation = managed?.pending ?? false;
    if (managed?.pending) issue('platform_recovery_required', '上次平台操作中断，请先恢复。');
    if (result.managed) result.update.channel = 'flare';
    const cachedPackage = result.managed ? await attempt(() => this.managed.release(id).cached(managed.version)) : null;
    const manifest = result.managed
      ? await attempt(async () => validateManifest(managed.manifest, adapter))
      : manifestFile && await attempt(async () => validateManifest(JSON.parse((await readText(manifestFile)).replace(/^\uFEFF/, '')), adapter));
    result.loader.present = !!proxyFile;
    result.installed = !!(coreFile || manifestFile || result.managed);
    let coreIdentified = false, proxyIdentified = false;
    for (const [file, exports, role] of [[coreFile, adapter.detect.exports, 'core'], [proxyFile, loader.exports, 'proxy']]) {
      if (!file) continue;
      const pe = await attempt(async () => {
        if ((await fs.stat(file)).size > 64 * 1024 * 1024) fail('platform_file_too_large', '平台 DLL 超过 64 MiB。');
        return inspectPe(file);
      });
      const identified = !!pe && pe.dll && pe.architecture === 'x86' && exports.every(e => pe.exports.includes(e));
      if (role === 'core') coreIdentified = identified;
      else proxyIdentified = identified;
    }
    result.installed ||= proxyIdentified;
    if (coreIdentified) {
      result.version = await attempt(() => skeetoCoreVersion(coreFile)) ?? null;
    }
    if (manifest) {
      const entries = result.managed ? manifest.files.filter(e => managed.files.some(f => f.path === e.relative)) : manifest.files;
      if (result.managed) result.integrity.scope = 'managed-deployed-files';
      for (const entry of entries) {
        const checked = { path: entry.relative, role: entry.role, ok: false };
        try {
          if (result.managed && !managed.enabled && entry.role === 'proxy') {
            checked.reason = 'disabled'; checked.location = 'cache';
            const bytes = cachedPackage?.files.get(entry.relative);
            checked.ok = !!bytes && sha256(bytes) === entry.hash;
            if (!checked.ok) checked.reason = 'hash_mismatch';
            result.integrity.files.push(checked); continue;
          }
          const file = await platformPath(gameRoot, entry.relative);
          if (!file) checked.reason = 'missing';
          else if (!entry.hash) checked.reason = 'hash_not_provided';
          else {
            checked.ok = sha256(await readBytes(file, 64 * 1024 * 1024)) === entry.hash;
            if (!checked.ok) checked.reason = 'hash_mismatch';
          }
        } catch (e) { checked.reason = e.code ?? 'read_failed'; }
        result.integrity.files.push(checked);
      }
      const hashed = result.integrity.files.filter((_, i) => entries[i].hash);
      result.integrity.state = hashed.some(f => !f.ok) ? 'mismatch' : 'match';
      result.loader.owned = result.integrity.files.some(f => f.role === 'proxy' && f.ok && f.location !== 'cache');
      if (result.version && result.version !== manifest.semver) issue('platform_version_mismatch', `核心版本 ${result.version} 与清单版本 ${manifest.semver} 有差异。`);
      result.version ??= manifest.semver;
    } else if (result.installed) issue('platform_manifest_missing', '安装未附带有效 Manifest；文件完整性未知。');
    if (!result.version && result.installed) {
      const file = await attempt(() => platformPath(gameRoot, adapter.detect.version));
      const text = file && await attempt(() => readText(file));
      if (/^Skeeto\b/m.test(text ?? '')) result.version = text.match(/^semver=(\d+\.\d+\.\d+)\r?$/m)?.[1] ?? null;
    }
    if (proxyFile && !result.loader.owned) {
      result.loader.foreign = proxyIdentified ? '导出表标识为 Skeeto；清单归属待核对。' : '未知代理占用此入口；来源待确认。';
      if (!proxyIdentified) issue('platform_proxy_occupied', 'bin/wininet.dll 已被未知代理占用。');
    }
    if (result.installed) {
      const badRuntime = result.integrity.files.some(f => ['core', 'proxy'].includes(f.role) && !f.ok && !(f.role === 'proxy' && f.reason === 'missing'));
      result.state = !coreIdentified || badRuntime || (proxyFile && !proxyIdentified && !result.loader.owned) ? 'broken' : proxyFile ? 'enabled' : 'disabled';
      if (result.state === 'broken') issue('platform_load_files_invalid', '加载文件缺失、未识别或与清单有差异。');
    }
    if (result.managed && !managed.enabled) {
      const proxy = managed.files.find(f => f.path === loader.file);
      const expected = proxy?.originalIsSkeeto ? null : proxy?.original;
      const actual = proxyFile ? await attempt(async () => sha256(await readBytes(proxyFile, 64 * 1024 * 1024))) : null;
      result.state = coreIdentified && result.integrity.state === 'match' && actual === expected ? 'disabled' : 'broken';
      // A restored foreign proxy is the expected disabled state.
      if (result.state === 'disabled') result.issues = result.issues.filter(i => !['platform_proxy_occupied', 'platform_load_files_invalid'].includes(i.code));
    }
    if (managed?.pending) result.state = 'broken';
    const settings = await attempt(() => platformPath(gameRoot, adapter.settings.file));
    if (settings) {
      const text = await attempt(() => readText(settings));
      if (text !== null) {
        // Source paths differ in duplicate handling. Conflicting duplicates remain unknown.
        const saved = (key, aliases = [], numeric = false) => {
          const values = new Set();
          for (const line of text.split(/\r?\n/)) { const match = new RegExp(`^(?:${[key, ...aliases].join('|')})=\\s*([+-]?\\d+)`).exec(line); if (match) values.add(numeric ? Number(match[1]) : Number(match[1]) !== 0); }
          return values.size === 1 ? [...values][0] : null;
        };
        result.update.selfUpdate = saved(adapter.update.switch.key);
        result.subPlugins.platformOn = saved(adapter.subPlugins.switch.key);
        for (const m of result.modules) {
          const values = m.switches.map(s => saved(s.key, s.aliases, s.valueType === 'integer'));
          m.switches.forEach((s, i) => { s.value = values[i]; });
          const active = values.map((v, i) => v === null ? null : m.switches[i].valueType === 'integer' ? v !== m.switches[i].off : v);
          m.state = active.includes(true) ? 'on' : m.switchable && active.length && active.every(v => v === false) ? 'off' : 'unknown';
        }
      }
    }
    await attempt(async () => {
      const dir = path.join(gameRoot, adapter.subPlugins.dir);
      // Probe via a child path first so parent symlinks/junctions are rejected even when empty.
      await platformPath(gameRoot, `${adapter.subPlugins.dir}/.flare-read-probe`);
      try { await directory(dir); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
      for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!/\.dll$/i.test(entry.name)) continue;
        const relative = `${adapter.subPlugins.dir}/${entry.name}`;
        if (await platformPath(gameRoot, relative)) result.subPlugins.items.push({ file: relative });
      }
    });
    for (const doc of result.docs) doc.present = !!(result.managed ? cachedPackage?.files.has(doc.path) : await attempt(() => platformPath(gameRoot, doc.path)));
    await attempt(async () => {
      const file = await platformPath(gameRoot, `left4dead2/addons/workshop/${adapter.update.workshopId}.vpk`);
      result.update.packagePresent = !!file;
      if (!file) return;
      const pkg = await detectPlatformPackage(file, { workshopId: adapter.update.workshopId });
      if (pkg?.version) result.update.packageVersion = pkg.version;
      if (pkg?.warning) issue('platform_update_package_warning', pkg.warning);
    });
    const processes = (inspection.processes ?? []).filter(p => samePath(p.path, path.join(gameRoot, 'left4dead2.exe')));
    let beaconLoaded = false;
    if (processes.length) {
      const observed = await Promise.all(processes.map(p => attempt(async () => {
        const modules = await this.getModules(p.pid);
        if (!samePath(modules.path, p.path) || !Array.isArray(modules.modules)) fail('platform_runtime_unavailable', '游戏进程已变化或模块清单读取失败。');
        beaconLoaded ||= modules.modules.some(m => samePath(m, path.join(gameRoot, 'bin/l4p/l4p_runtime.dll')));
        return modules.modules.some(m => path.win32.basename(m).toLowerCase() === path.basename(adapter.detect.core).toLowerCase());
      })));
      result.runtime.loaded = observed.includes(true) ? true : observed.includes(null) ? null : false;
    }
    if (inspection.platform?.status === 'installed' && result.installed) result.coexist = { beacon: 'warn', note: 'Skeeto 使用 wininet 代理，Beacon 使用 DXVK 入口；双方 Hook 的兼容性待游戏实测。' };
    if (beaconLoaded && result.runtime.loaded) result.coexist = { beacon: 'warn', note: '已观测到 Skeeto 与 Beacon 同时加载；功能兼容性待游戏实测。' };
    return result;
  }
}
