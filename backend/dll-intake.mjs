import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import * as core from './core.mjs';
import { directory, safeResourcePath, writeJson } from './mods/files.mjs';
import { regular, identity, crc32Update } from './mods/vpk.mjs';
import { platformPath, readBytes } from './platforms/files.mjs';
import { verifyRelease } from './releases.mjs';
import { DllScreen, allowScreen } from './platforms/dll-screen.mjs';
import { declaredPluginAssets } from './plugin-assets.mjs';

const fail = (code, message) => { throw new core.PlatformError(code, message); };
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
const maxFiles = 4096, maxBytes = 2 * 1024 ** 3, maxFile = 256 * 1024 ** 2;
const slash = name => safeResourcePath(name).join('/');
const finding = (code, message, file) => ({ code, message, ...(file ? { file } : {}) });

async function filesIn(root) {
  const result = []; let bytes = 0, entries = 0;
  async function walk(folder, prefix = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const relative = slash(prefix + entry.name), file = path.join(root, relative);
      if (++entries > maxFiles) fail('archive_limit', '模组包文件与目录超过 4096 项。');
      if (entry.isSymbolicLink()) fail('unsafe_path', '模组资料里包含链接文件，请核对来源。');
      if (entry.isDirectory()) await walk(file, relative + '/');
      else {
        const stat = await regular(file);
        if (stat.size > maxFile || (bytes += stat.size) > maxBytes || result.length >= maxFiles)
          fail('archive_limit', '模组包超过本地整理上限（4096 文件、总计 2 GiB、单文件 256 MiB）。');
        result.push({ path: relative, bytes: stat.size, identity: identity(stat) });
      }
    }
  }
  await directory(root); await walk(root);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
async function copyFiles(source, target, mappings, signal) {
  const seen = new Set();
  for (const mapping of mappings) {
    signal?.throwIfAborted();
    const from = slash(mapping.source), to = slash(mapping.target);
    if (seen.has(to.toLowerCase())) fail('archive_duplicate', '整理清单包含重复目标文件。');
    seen.add(to.toLowerCase());
    const file = await platformPath(source, from);
    if (!file) fail('file_missing', `整理所需文件缺失：${from}`);
    const before = identity(await regular(file)), destination = path.join(target, to);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(file, destination, fs.constants.COPYFILE_EXCL);
    if (identity(await regular(file)) !== before) fail('file_changed', `整理期间文件有变化：${from}`);
  }
}
async function extractZip(file, target, signal) {
  const before = identity(await regular(file));
  const zip = await yauzl.openPromise(file, { strictFileNames: true, autoClose: true, validateEntrySizes: true });
  let count = 0, bytes = 0; const names = new Set();
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      if (++count > maxFiles) fail('archive_limit', '模组包文件与目录超过 4096 项。');
      const name = slash(entry.fileName.replace(/\/$/, ''));
      const type = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (type && ![0x4000, 0x8000].includes(type)) fail('unsafe_path', '压缩包含链接或特殊文件，请核对来源。');
      if (entry.fileName.endsWith('/')) continue;
      if (entry.uncompressedSize > maxFile || (bytes += entry.uncompressedSize) > maxBytes)
        fail('archive_limit', '模组包超过本地整理上限（4096 文件、总计 2 GiB、单文件 256 MiB）。');
      if (entry.isEncrypted()) fail('archive_encrypted', '压缩包已加密，需要作者提供可读取的发行包。');
      if (names.has(name.toLowerCase())) fail('archive_duplicate', '压缩包含重复文件名，请核对发行包。');
      names.add(name.toLowerCase());
      const destination = path.join(target, name); await fs.mkdir(path.dirname(destination), { recursive: true });
      let crc = 0xffffffff;
      const check = new Transform({ transform(chunk, _, done) { crc = crc32Update(crc, chunk); done(null, chunk); } });
      await pipeline(await zip.openReadStreamPromise(entry), check, createWriteStream(destination, { flags: 'wx' }), { signal });
      if (((crc ^ 0xffffffff) >>> 0) !== (entry.crc32 >>> 0)) fail('archive_corrupt', `压缩包文件校验失败：${name}`);
    }
  } finally { zip.close(); }
  if (identity(await regular(file)) !== before) fail('file_changed', '解压期间来源文件有变化，请重新选择。');
}
const publicFiles = files => files.map(({ path, bytes }) => ({ path, bytes }));

/** All author files remain untouched; extraction and repairs live in owned staging. */
export class DllIntake {
  constructor({ dataDir, validatePlugin = core.validatePlugin }) { this.base = path.join(dataDir, 'dll-intake'); this.validatePlugin = validatePlugin; this.screen = new DllScreen(dataDir); }
  folder(id) { if (!uuid(id)) fail('intake_invalid', '请使用本次模组检查返回的标识。'); return path.join(this.locations?.get(id)??this.base, id); }
  async record(id) {
    let folder=this.folder(id), file=await platformPath(folder,'state.json');
    if(!file)for(const base of this.legacyBases??[]){const old=await platformPath(base,id+'/state.json');if(old){this.locations.set(id,base);folder=this.folder(id);file=old;break;}}
    if (!file) fail('intake_missing', '暂存记录已变化，请重新检查来源。');
    const record = JSON.parse((await readBytes(file, 16 * 1024 * 1024)).toString('utf8'));
    if (record.owner !== 'flare-dll-intake' || record.id !== id) fail('intake_invalid', '模组暂存记录需要检查。');
    return record;
  }
  async screening(folder, policyPath, verification, fresh=false) {
    if (!verification) {
      try { verification=await verifyRelease(folder,policyPath); }
      catch(e){verification={state:'rejected',error:{message:e.message}};}
    }
    return this.screen.scan(folder,{verification,policyPath,fresh});
  }
  async rescreen(id,policyPath) {
    const record=await this.record(id), original=path.join(this.folder(id),'original');
    const checked=await this.assess(original,policyPath,true);
    if(checked.screening.tier==='blocked' || !record.candidate)return checked.screening;
    const candidate=await this.candidate(id,record.candidate.id);
    return this.screening(candidate.directory,policyPath,undefined,true);
  }
  async assess(folder, policyPath, fresh=false) {
    const files = await filesIn(folder), manifests = files.filter(f => path.posix.basename(f.path) === 'manifest.json');
    const issues = []; let preparedDirectory, manifest, host, verification;
    if (manifests.length !== 1) issues.push(finding(manifests.length ? 'multiple_packages' : 'manifest_missing',
      manifests.length ? '压缩包包含多个模组，请交给 Agent 分别整理。' : '缺少标准 manifest.json，请交给 Agent 识别并整理。', 'manifest.json'));
    else {
      preparedDirectory = path.dirname(path.join(folder, manifests[0].path));
      try {
        manifest = core.validateManifest(JSON.parse((await readBytes(await platformPath(preparedDirectory, 'manifest.json'))).toString('utf8').replace(/^\uFEFF/, '')));
        if (manifest.loadKind === 'library') issues.push(finding('agent_library_review', '这是整体 DLL 包，请由 Agent 核对加载方式。'));
        if (await platformPath(preparedDirectory, '.l4p-package.json')) issues.push(finding('installed_package_marker', '这是已安装目录的副本，请交给 Agent 整理为导入包。'));
        if (!await platformPath(preparedDirectory, manifest.entry)) issues.push(finding('file_missing', `缺少主 DLL：${manifest.entry}`, manifest.entry));
        for (const resource of declaredPluginAssets(manifest.presentation)) if (!await platformPath(preparedDirectory, resource))
          issues.push(finding('file_missing', `缺少声明的素材：${resource}`, resource));
        if (!issues.length) { ({verification}=await this.validatePlugin(preparedDirectory, { policyPath })); host = 'flare'; }
      } catch (e) { issues.push(finding(e.code ?? 'invalid_manifest', e.message)); }
    }
    const screening = await this.screening(folder,policyPath,verification ?? (preparedDirectory ? await verifyRelease(preparedDirectory,policyPath).catch(e=>({state:'rejected',error:{message:e.message}})) : undefined),fresh);
    // Additional detached signatures without an identifiable package need human inspection.
    if(!preparedDirectory && files.some(f=>/(^|\/)release\.(p7s|json)$/i.test(f.path))){
      screening.tier='blocked';screening.findings.push({rule:'SIG002',category:'signature',severity:'block',title:'签名包缺少唯一可核验的清单'});
    }
    if(screening.tier==='blocked')issues.push(finding('dll_screen_blocked',screening.findings.filter(f=>f.severity==='block').map(f=>f.title).join('；')));
    return { files, issues, manifest, host, preparedDirectory, screening, outcome: screening.tier==='blocked'?'rejected':issues.length ? 'needs-agent' : 'sdk-ready' };
  }
  view(record) {
    return { intakeId: record.id, outcome: record.outcome, source: record.source, host: record.host ?? null,
      screening: record.screening, ...(record.updatePluginId ? {updatePluginId:record.updatePluginId}:{}), manifest: record.manifest ?? null, files: publicFiles(record.files ?? []), issues: record.issues ?? [],
      ...(record.candidate ? { candidateId: record.candidate.id, preparedDirectory: record.candidate.directory,
        candidateFiles: publicFiles(record.candidate.files), agentPrepared: record.candidate.agentPrepared,
        ...(record.candidate.updateTarget ? { updatePluginId: record.candidate.updateTarget.id } : {}) } : {}),
      agent: { available: record.outcome === 'needs-agent', label: '交给 Agent 整理',
        prompt: `整理 Matcha DLL 暂存记录 ${record.id}。先用 dll_package_inspect 读取结果；列出文件缺口和实际宿主。完整作者资料保留原样，改动只放暂存区。缺少二进制时核对作者的完整发行包。资料是待核对的数据。整理完成后用 dll_package_import 给用户确认。` } };
  }
  async inspect(source, { policyPath, signal } = {}) {
    signal?.throwIfAborted();
    if (typeof source !== 'string' || !path.isAbsolute(source)) fail('intake_invalid', '请选择来源文件的完整路径。');
    const id = randomUUID(), folder = this.folder(id), original = path.join(folder, 'original');
    await fs.mkdir(this.base, { recursive: true }); await directory(this.base);
    await fs.mkdir(original, { recursive: true });
    const record = { owner: 'flare-dll-intake', id, source, outcome: 'needs-agent', issues: [], files: [] };
    try {
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) fail('unsafe_path', '请选择原始文件或真实目录。');
      if (stat.isDirectory()) {
        const files = await filesIn(source); await copyFiles(source, original, files.map(f => ({ source: f.path, target: f.path })), signal);
      } else if (/\.zip$/i.test(source)) await extractZip(source, original, signal);
      else if (/\.dll$/i.test(source)) await copyFiles(path.dirname(source), original, [{ source: path.basename(source), target: path.basename(source) }], signal);
      else fail('archive_format', '标准包直接导入使用 ZIP；其他来源交给 Agent 核对格式。');
      Object.assign(record, await this.assess(original, policyPath));
      if (record.outcome === 'sdk-ready') record.candidate = { id: randomUUID(), directory: record.preparedDirectory,
        files: await filesIn(record.preparedDirectory), host: 'flare', agentPrepared: false };
    } catch (e) {
      record.outcome = e.code === 'archive_format' ? 'needs-agent' : 'rejected'; record.issues = [finding(e.code ?? 'intake_failed', e.message)];
    }
    delete record.preparedDirectory;
    await writeJson(path.join(folder, 'state.json'), record);
    signal?.throwIfAborted();
    return this.view(record);
  }
  async details(id) {
    const record = await this.record(id), folder = path.join(this.folder(id), 'original'), documents = [];
    for (const file of (record.files ?? []).filter(f => /(^|\/)(manifest\.json|readme[^/]*|[^/]*\.md)$/i.test(f.path)).slice(0, 6)) {
      const handle = await fs.open(await platformPath(folder, file.path), 'r');
      try { const bytes = Buffer.alloc(Math.min(file.bytes, 16000)); await handle.read(bytes, 0, bytes.length, 0);
        documents.push({ path: file.path, text: bytes.toString('utf8'), truncated: file.bytes > bytes.length }); } finally { await handle.close(); }
    }
    const dlls = [];
    for (const file of (record.files ?? []).filter(f => /\.dll$/i.test(f.path)).slice(0, 32)) {
      try { const pe = await core.inspectPe(await platformPath(folder, file.path)); dlls.push({ path: file.path, architecture: pe.architecture,
        host: pe.exports.includes('GetL4NPluginInstance') ? 'l4n' : pe.exports.includes('L4P_GetPluginApi') ? 'flare-sdk' : 'library', exports: pe.exports.slice(0, 64) }); }
      catch (e) { dlls.push({ path: file.path, error: e.message }); }
    }
    return { ...this.view(record), ...(record.files?.length ? { originalDirectory: folder } : {}), documents, dlls };
  }
  async prepare(id, { mode, mappings, name, summary, updatePluginId }, { policyPath, signal, updateTarget } = {}) {
    signal?.throwIfAborted();
    const record = await this.record(id);
    if(record.screening?.findings.some(f=>f.category==='signature' && f.severity==='block'))
      fail('release_rejected','签名核验失败，已停止整理；请取得作者的完整发行包。');
    if(record.screening)allowScreen(record.screening);
    if (record.outcome === 'rejected') fail('intake_rejected', '来源检查尚未通过，请先核对完整发行包。');
    if (!['sdk', 'library', 'l4n'].includes(mode) || !Array.isArray(mappings) || !mappings.length || mappings.length > maxFiles)
      fail('intake_invalid', '请提供宿主类型与暂存文件整理清单。');
    if (updatePluginId !== undefined && (mode !== 'library' || !updateTarget || updateTarget.id !== updatePluginId))
      fail('dll_update_target_invalid', '请先通过 DLL 清单核对普通 DLL 的更新目标。');
    const authorManifests = record.files.filter(f => path.posix.basename(f.path) === 'manifest.json');
    if (updateTarget && authorManifests.length === 1 && !mappings.some(m => m.source === authorManifests[0].path && m.target === 'manifest.json'))
      fail('dll_update_manifest_required', '来源包带有作者声明，请将该 manifest.json 一并保留在更新包中。');
    const source = path.join(this.folder(id), 'original'), candidateId = randomUUID();
    if (JSON.stringify(await filesIn(source)) !== JSON.stringify(record.files)) fail('intake_stale', '原始暂存资料有变化，请重新检查来源。');
    const target = path.join(this.folder(id), 'prepared', candidateId); await fs.mkdir(target, { recursive: true });
    for (const mapping of mappings) if (!record.files.some(f => f.path === mapping.source)) fail('intake_invalid', '整理清单需使用本次暂存文件。');
    const signed = record.files.some(f => /(^|\/)release\.(json|p7s)$/.test(f.path));
    if (signed && ['release.json', 'release.p7s'].some(file => !mappings.some(m => m.target === file)))
      fail('release_rejected', '签名发行包需保留原始发布清单与签名，请核对完整发行包。');
    await copyFiles(source, target, mappings, signal);
    let host = 'flare', manifest, validation, generatedMetadata = false;
    if (mode === 'library') {
      if (record.manifest && record.manifest.loadKind !== 'library') fail('dll_sdk_manifest_required', '原包声明了 Matcha SDK，请保留该接口并核对文件。');
      const file = await platformPath(target, 'plugin.dll');
      if (!file) fail('file_missing', '整理包缺少 plugin.dll，请列出主 DLL 的真实来源。');
      const pe = await core.inspectPe(file);
      if (!pe.dll || pe.architecture !== 'x86') fail('invalid_plugin', '此加载器需要 Windows x86 DLL。');
      if (pe.exports.includes('GetL4NPluginInstance')) fail('l4n_plugin', '此 DLL 使用 L4N 接口，请按 L4N 子插件整理。');
      if (pe.exports.includes('L4P_GetPluginApi')) fail('dll_sdk_manifest_required', '此 DLL 使用 Matcha SDK，请保留作者的 SDK 声明。');
      const authorManifest = await platformPath(target, 'manifest.json');
      if (authorManifest) {
        manifest = core.validateManifest(JSON.parse((await readBytes(authorManifest)).toString('utf8').replace(/^\uFEFF/, '')));
        if (manifest.loadKind !== 'library') fail('dll_sdk_manifest_required', '请按作者的 Matcha SDK 接口整理。');
        if (updateTarget && manifest.id !== updateTarget.id) fail('dll_update_target_invalid', '作者声明的 ID 与更新目标不同，请核对同一模组的发行包。');
      } else if (updateTarget) {
        if (updateTarget.manifest.intake?.preparedBy !== 'agent')
          fail('dll_update_manifest_required', '更新目标使用作者声明，请提供保留该声明的同 ID 完整发行包。');
        generatedMetadata = true;
        manifest = structuredClone(updateTarget.manifest);
        await writeJson(path.join(target, 'manifest.json'), manifest);
      } else {
        generatedMetadata = true;
        if (typeof name !== 'string' || !name.trim() || name.length > 80 || typeof summary !== 'string' || !summary.trim() || summary.length > 160)
          fail('intake_invalid', '请根据真实来源提供名称（80 字内）与简介（160 字内）。');
        // Re-preparing the same intake keeps its generated identity; a separate update binds explicitly.
        record.generatedId ??= record.candidate?.generatedMetadata && !record.candidate.updateTarget ? record.manifest.id : `local.import.${record.id}`;
        manifest = { schemaVersion: 1, id: record.generatedId, name, version: '0.0.0', apiVersion: 1, architecture: 'x86',
          phase: 'render-init', entry: 'plugin.dll', loadKind: 'library', dependencies: [], config: [], actions: [],
          presentation: { schema: 1, summary }, intake: { preparedBy: 'agent' } };
        await writeJson(path.join(target, 'manifest.json'), manifest);
      }
      validation = await this.validatePlugin(target, { policyPath });
    } else if (mode === 'sdk') {
      const checked = await this.assess(target, policyPath);
      if (checked.outcome !== 'sdk-ready' || path.resolve(checked.preparedDirectory) !== path.resolve(target))
        throw new core.PlatformError('intake_needs_files', '整理后仍有文件或声明需要核对。', { issues: checked.issues });
      manifest = checked.manifest; validation = await this.validatePlugin(target, { policyPath });
    } else {
      const files = await filesIn(target);
      if (files.length !== 1 || !/\.dll$/i.test(files[0].path) || path.dirname(files[0].path) !== '.')
        fail('l4n_package_layout', 'L4N 子插件入口接收单个原名 DLL；请先核对配套文件的实际宿主和安装位置。');
      const pe = await core.inspectPe(path.join(target, files[0].path));
      if (!pe.dll || pe.architecture !== 'x86' || !pe.exports.includes('GetL4NPluginInstance')) fail('l4n_plugin_invalid', '请选择真实的 x86 L4N 子插件 DLL。');
      host = 'l4n';
    }
    record.screening=await this.screening(target,policyPath,validation?.verification,true); allowScreen(record.screening);
    record.candidate = { id: candidateId, directory: target, files: await filesIn(target), host, agentPrepared: true, generatedMetadata,
      ...(updateTarget ? { updateTarget } : {}) };
    signal?.throwIfAborted();
    record.host = host; record.manifest = manifest; record.outcome = 'prepared'; record.issues = [];
    await writeJson(path.join(this.folder(id), 'state.json'), record);
    return { ...this.view(record), verification: validation?.verification };
  }
  async candidate(id, candidateId) {
    const record = await this.record(id), candidate = record.candidate;
    if (!candidate || candidate.id !== candidateId) fail('intake_stale', '整理结果已变化，请重新检查并确认。');
    const relative = path.relative(this.folder(id), candidate.directory).replaceAll('\\', '/'); slash(relative);
    if (!['original', 'prepared'].includes(relative.split('/')[0])) fail('intake_invalid', '暂存目录需要检查。');
    await platformPath(this.folder(id), `${relative}/.flare-directory-check`);
    if (JSON.stringify(await filesIn(candidate.directory)) !== JSON.stringify(candidate.files))
      fail('intake_stale', '确认前暂存文件已有变化，请重新检查。');
    return { record, ...candidate };
  }
  async origin(id, source, publisher, updatePluginId, sdkUpdate) {
    const record = await this.record(id); record.sourceContext = { source, publisher }; if(updatePluginId){record.updatePluginId=updatePluginId;record.sdkUpdate=sdkUpdate;}
    await writeJson(path.join(this.folder(id), 'state.json'), record);
  }
  async forDirectory(directory) {
    const base=[this.base,...(this.legacyBases??[])].find(b=>{const r=path.relative(b,path.resolve(directory));return r&&!r.startsWith('..')&&!path.isAbsolute(r)});
    if(!base)return null;const relative=path.relative(base,path.resolve(directory));
    if (relative.startsWith('..') || path.isAbsolute(relative) || !uuid(relative.split(path.sep)[0])) return null;
    const record = await this.record(relative.split(path.sep)[0]);
    return record.candidate && path.resolve(record.candidate.directory).toLowerCase() === path.resolve(directory).toLowerCase()
      ? { record, ...record.candidate } : null;
  }
}
