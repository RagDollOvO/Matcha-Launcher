import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { localL4n } from './local-render.mjs';
import { platformPath } from './platforms/files.mjs';
import { isFolder } from './legacy-names.mjs';
import { launchSpec } from './launch.mjs';
import { PlatformError, errorRecord } from './errors.mjs';
import { inspectPe, regularFile as regular } from './file-inspection.mjs';
import { parseKeyValues } from './keyvalues.mjs';
import { verifyRelease } from './release-verification.mjs';

export { PlatformError, errorRecord, inspectPe, parseKeyValues };

const execFile = promisify(execFileCallback);
const STATE_FILE = 'platform-state.json';
const MAX_JSON = 1024 * 1024;
const MAX_PIPE_REQUEST = 64 * 1024;
const MAX_PIPE_RESPONSE = 256 * 1024;
const SHIM_EXPORT = 'L4P_PlatformShimVersion';
const PLUGIN_EXPORT = 'L4P_GetPluginApi';
const BRIDGE = 'bin/neko/plugins/MatchaRuntime.dll';
const BRIDGE_COPY = 'backups/MatchaRuntime.dll';
const SAVED_SHIM = 'backups/flare_dxvk_d3d9.dll';
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

const fail = (code, message, details) => { throw new PlatformError(code, message, details); };
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = (data) => createHash('sha256').update(data).digest('hex');
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function assertId(id, label = 'id') {
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || reservedName.test(id)) fail('invalid_id', `${label} must be a portable lowercase identifier`, { value: id });
}
function requireConfirmation(confirmation) {
  if (!object(confirmation) || confirmation.approved !== true || confirmation.source !== 'user') fail('confirmation_required', 'Explicit user confirmation is required');
}
async function exists(file) { try { await fs.lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function directory(dir) {
  const stat = await fs.lstat(dir).catch((e) => { if (e.code === 'ENOENT') fail('directory_missing', 'Required directory is missing', { dir }); throw e; });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_path', 'Expected a real directory', { dir });
  return fs.realpath(dir);
}
async function readJson(file) {
  const stat = await regular(file);
  if (stat.size > MAX_JSON) fail('json_too_large', 'JSON file exceeds 1 MiB', { file });
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (e) { fail('invalid_json', 'Invalid JSON document', { file, reason: e.message }); }
}
async function atomicWrite(file, value) {
  if (await exists(file)) await regular(file);
  const temp = `${file}.l4p-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, 'wx');
    await handle.writeFile(value); await handle.sync(); await handle.close(); handle = undefined;
    await fs.rename(temp, file);
  } finally { await handle?.close(); await fs.rm(temp, { force: true }); }
}
const writeJson = (file, value) => atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
async function fileDigest(file) { await regular(file); return digest(await fs.readFile(file)); }
async function treeFiles(root) {
  await directory(root); const files = [];
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) fail('unsafe_path', 'Symbolic links are not allowed in platform packages', { file });
      if (item.name.endsWith('.') || item.name.endsWith(' ') || item.name.includes(':') || reservedName.test(item.name)) fail('unsafe_path', 'Unsupported package filename', { file });
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) files.push(file);
      else fail('unsafe_path', 'Unsupported package entry', { file });
    }
  }
  await walk(root); return files.sort();
}
async function copyTree(source, destination, { omitMarker = false } = {}) {
  const files = await treeFiles(source);
  await fs.mkdir(destination, { recursive: true });
  for (const file of files) {
    if (omitMarker && file === path.join(source, '.l4p-package.json')) continue;
    const target = path.join(destination, path.relative(source, file));
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL);
  }
}
async function removeOwnedTree(root, target) {
  const r = path.resolve(root), t = path.resolve(target), rel = path.relative(r, t);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail('unsafe_path', 'Refusing cleanup outside the operation workspace', { target });
  if (await exists(t)) { await directory(t); await fs.rm(t, { recursive: true }); }
}

async function requirePe(file, exports = [], dll = true) {
  const info = await inspectPe(file);
  if (info.architecture !== 'x86') fail('wrong_architecture', 'L4P v1 requires Windows x86 binaries', { file, actual: info.architecture });
  if (dll && !info.dll) fail('invalid_dll', 'Expected a PE DLL', { file });
  for (const name of exports) if (!info.exports.includes(name)) fail('missing_export', 'Required DLL export is missing', { file, name });
  return info;
}

function validateField(field, where, config = false) {
  if (!object(field) || !['string', 'boolean', 'integer', 'number', 'enum'].includes(field.type)) fail('invalid_manifest', 'Invalid field type', { where });
  if (field.required !== undefined && typeof field.required !== 'boolean') fail('invalid_manifest', 'required must be boolean', { where });
  if (field.type === 'enum' && (!Array.isArray(field.options) || !field.options.length || field.options.some((v) => typeof v !== 'string') || new Set(field.options).size !== field.options.length)) fail('invalid_manifest', 'enum options must be unique strings', { where });
  if (field.maxLength !== undefined && (field.type !== 'string' || !Number.isSafeInteger(field.maxLength) || field.maxLength < 0)) fail('invalid_manifest', 'Invalid maxLength', { where });
  for (const key of ['minimum', 'maximum']) if (field[key] !== undefined && (!['integer', 'number'].includes(field.type) || !Number.isFinite(field[key]))) fail('invalid_manifest', `Invalid ${key}`, { where });
  if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) fail('invalid_manifest', 'minimum exceeds maximum', { where });
  if (config) {
    assertId(field.id, `${where}.id`);
    if (typeof field.label !== 'string' || !field.label.trim() || !['immediate', 'next-launch'].includes(field.apply) || !Object.hasOwn(field, 'default')) fail('invalid_manifest', 'Config requires label, default and apply', { where });
  }
  if (Object.hasOwn(field, 'default')) validateValue(field.default, field, where);
}
function validateValue(value, field, where) {
  const good = field.type === 'string' ? typeof value === 'string'
    : field.type === 'boolean' ? typeof value === 'boolean'
    : field.type === 'integer' ? Number.isSafeInteger(value)
    : field.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : field.options.includes(value);
  if (!good) fail('invalid_parameter', 'Value has the wrong type or enum choice', { where, type: field.type });
  if (field.type === 'string' && field.maxLength !== undefined && [...value].length > field.maxLength) fail('invalid_parameter', 'String exceeds maxLength', { where });
  if (typeof value === 'number' && ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum))) fail('invalid_parameter', 'Number is outside the declared range', { where });
}
export function validateManifest(m) {
  if (!object(m)) fail('invalid_manifest', 'Manifest must be an object');
  if (m.schemaVersion !== 1 || m.apiVersion !== 1) fail('unsupported_version', 'L4P schemaVersion and apiVersion must both be 1');
  assertId(m.id);
  if (typeof m.name !== 'string' || !m.name.trim() || typeof m.version !== 'string' || !VERSION_PATTERN.test(m.version)) fail('invalid_manifest', 'Plugin name and exact x.y.z version are required');
  if (m.architecture !== 'x86' || m.phase !== 'render-init' || m.entry !== 'plugin.dll') fail('invalid_manifest', 'Expected x86 / render-init / plugin.dll');
  if (m.loadRole !== undefined && m.loadRole !== 'dependency') fail('invalid_manifest', 'Unknown plugin load role');
  if (m.launchScope !== undefined && m.launchScope !== 'insecure') fail('invalid_manifest', 'Unknown plugin launch scope');
  if (m.loadKind !== undefined && !['sdk', 'library'].includes(m.loadKind)) fail('invalid_manifest', 'Unknown DLL loading contract');
  if (m.loadKind === 'library' && (m.actions?.length || m.config?.length)) fail('invalid_manifest', 'Whole DLL packages use their own settings');
  for (const field of ['dependencies', 'config', 'actions']) if (!Array.isArray(m[field])) fail('invalid_manifest', `${field} must be an array`);
  const dependencies = new Set();
  for (const d of m.dependencies) {
    if (!object(d)) fail('invalid_manifest', 'Invalid dependency'); assertId(d.id, 'dependency.id');
    if (d.id === m.id || dependencies.has(d.id) || typeof d.version !== 'string' || !VERSION_PATTERN.test(d.version)) fail('invalid_manifest', 'Dependencies must be unique, non-self and exact-versioned', { dependency: d });
    dependencies.add(d.id);
  }
  const configIds = new Set();
  for (const field of m.config) { validateField(field, `config.${field?.id}`, true); if (configIds.has(field.id)) fail('invalid_manifest', 'Duplicate config id'); configIds.add(field.id); }
  const actionIds = new Set();
  for (const a of m.actions) {
    if (!object(a)) fail('invalid_manifest', 'Invalid action'); assertId(a.id, 'action.id');
    if (actionIds.has(a.id)) fail('invalid_manifest', 'Duplicate action id'); actionIds.add(a.id);
    if (typeof a.label !== 'string' || !a.label.trim() || typeof a.description !== 'string' || !['read', 'write'].includes(a.effect) || typeof a.requiresConfirmation !== 'boolean' || !object(a.parameters)) fail('invalid_manifest', 'Invalid action declaration', { action: a.id });
    for (const [name, field] of Object.entries(a.parameters)) { assertId(name, 'parameter name'); validateField(field, `actions.${a.id}.${name}`); }
  }
  if (m.presentation !== undefined) validatePresentation(m.presentation);
  return structuredClone(m);
}
// Optional catalog metadata; legacy plugin packages keep their existing contract.
export function validatePresentation(p) {
  if (!object(p) || p.schema !== 1) fail('invalid_manifest', 'presentation.schema must be 1');
  const text = (v, max, required = false) => v === undefined && !required || typeof v === 'string' && v.trim().length > 0 && [...v].length <= max;
  const cover = value => {
    if (value === undefined) return;
    if (typeof value !== 'string' || value.length > 240 || !/\.(png|jpe?g|webp|gif)$/i.test(value) || value.split('/').some(s => !s || s === '.' || s === '..' || /[<>:"|?*\\\x00-\x1f]|[ .]$/.test(s) || reservedName.test(s))) fail('invalid_manifest', 'Cover must be a package-relative PNG, JPEG, WebP or GIF path');
  };
  if (!text(p.summary, 160) || !text(p.description, 12000) || p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.length > 8 || p.tags.some(t => !text(t, 24, true)))) fail('invalid_manifest', 'Invalid presentation text');
  cover(p.cover);
  const collection = (c, where) => {
    if (!object(c)) fail('invalid_manifest', `Invalid ${where}`);
    assertId(c.id, `${where}.id`);
    if (!text(c.title, 80, true) || !text(c.author, 80, true) || !text(c.summary, 160, true) || !text(c.description, 12000)) fail('invalid_manifest', 'Collection requires title, author and summary');
    cover(c.cover);
  };
  if (p.collection !== undefined) collection(p.collection, 'presentation.collection');
  if (p.catalog !== undefined || p.collections !== undefined) {
    collection(p.catalog, 'presentation.catalog');
    if (!Array.isArray(p.collections) || !p.collections.length || p.collections.length > 16) fail('invalid_manifest', 'A catalog feature requires 1–16 subcollections');
    const ids = new Set();
    for (const c of p.collections) {
      collection(c, 'presentation.collections');
      if (ids.has(c.id)) fail('invalid_manifest', 'Subcollection IDs must be unique within a feature');
      ids.add(c.id);
    }
  }
  return p;
}
export function validateActionParameters(action, parameters = {}) {
  if (!object(parameters)) fail('invalid_parameter', 'Action parameters must be an object');
  const result = {};
  for (const name of Object.keys(parameters)) if (!Object.hasOwn(action.parameters, name)) fail('invalid_parameter', 'Undeclared action parameter', { name });
  for (const [name, field] of Object.entries(action.parameters)) {
    if (Object.hasOwn(parameters, name)) { validateValue(parameters[name], field, name); result[name] = parameters[name]; }
    else if (Object.hasOwn(field, 'default')) result[name] = field.default;
    else if (field.required) fail('invalid_parameter', 'Required action parameter is missing', { name });
  }
  return result;
}
export async function validatePlugin(pluginDirectory, { policyPath, expectedRelease = '' } = {}) {
  const root = await directory(path.resolve(pluginDirectory));
  await treeFiles(root);
  const manifest = validateManifest(await readJson(path.join(root, 'manifest.json')));
  const verification = await verifyRelease(root, policyPath, expectedRelease);
  const pe = await requirePe(path.join(root, 'plugin.dll'), manifest.loadKind === 'library' ? [] : [PLUGIN_EXPORT]);
  return { directory: root, manifest, pe, verification };
}
export function orderPlugins(plugins, enabledIds) {
  const byId = new Map(plugins.map((p) => [p.manifest.id, p]));
  if (byId.size !== plugins.length) fail('duplicate_plugin', 'Plugin identifiers must be unique');
  const enabled = new Set(enabledIds), visiting = new Set(), done = new Set(), result = [];
  function visit(id) {
    assertId(id); const p = byId.get(id);
    if (!p) fail('dependency_missing', 'Enabled plugin is missing', { id });
    if (visiting.has(id)) fail('dependency_cycle', 'Plugin dependency cycle detected', { id });
    if (done.has(id)) return;
    visiting.add(id);
    for (const d of [...p.manifest.dependencies].sort((a, b) => a.id.localeCompare(b.id))) {
      const found = byId.get(d.id);
      if (!found || !enabled.has(d.id)) fail('dependency_missing', 'Required dependency is absent or disabled', { pluginId: id, dependency: d });
      if (found.manifest.version !== d.version) fail('dependency_version', 'Dependency version does not match', { pluginId: id, dependency: d, actual: found.manifest.version });
      visit(d.id);
    }
    visiting.delete(id); done.add(id); result.push(id);
  }
  for (const id of [...enabled].sort()) visit(id);
  return result;
}
async function readEnabled(root) {
  const file = path.join(root, 'enabled.txt');
  if (!(await exists(file))) return [];
  await regular(file); const lines = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).map((v) => v.trim()).filter((v) => v && !v.startsWith('#'));
  lines.forEach((v) => assertId(v));
  if (new Set(lines).size !== lines.length) fail('invalid_enabled_list', 'enabled.txt contains duplicate plugin ids');
  return lines;
}
async function pluginInventory(root) {
  const folder = path.join(root, 'plugins'); if (!(await exists(folder))) return [];
  await directory(folder); const result = [];
  const state = await exists(path.join(root, STATE_FILE)) ? await readJson(path.join(root, STATE_FILE)) : {};
  for (const item of await fs.readdir(folder, { withFileTypes: true })) {
    if (!item.isDirectory() || item.isSymbolicLink()) fail('invalid_plugin_directory', 'Plugin entries must be real directories', { name: item.name });
    const pluginDir = path.join(folder, item.name);
    let p;
    try { p = await validatePlugin(pluginDir, { policyPath: path.join(root, 'release-trust.json'), expectedRelease: state.plugins?.[item.name]?.releaseSha256 ?? '' }); }
    catch (e) {
      if (e.code !== 'release_rejected') throw e;
      p = { directory: pluginDir, manifest: validateManifest(await readJson(path.join(pluginDir, 'manifest.json'))), pe: null,
        verification: { state: 'rejected', integrity: 'failed', error: errorRecord(e) } };
    }
    if (item.name !== p.manifest.id) fail('plugin_id_mismatch', 'Plugin folder must match manifest id', { directory: item.name, id: p.manifest.id });
    result.push(p);
  }
  return result.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}
function requireLoadable(plugins, ids) {
  for (const p of plugins) if (ids.includes(p.manifest.id) && p.verification.state === 'rejected') fail('release_rejected', p.verification.error.message, { pluginId: p.manifest.id });
}
async function requireReleaseRuntime(root, plugins) {
  if (!plugins.some(p => p.verification?.releaseSha256)) return;
  const pe = await inspectPe(path.join(root, 'l4p_runtime.dll'));
  if (!pe.exports.includes('L4P_RuntimeReleaseGateV1')) fail('runtime_upgrade_required', 'This runtime requires the Beacon release gate update before signed plugins can be used');
}

export async function windowsProcesses() {
  if (process.platform !== 'win32') fail('unsupported_os', 'Game operations require Windows');
  const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new();
    @(Get-Process -Name left4dead2,L4D2Bridge32,L4D2Bridge64 -ErrorAction SilentlyContinue |
      Select-Object Id,ProcessName,Path,@{n='StartedAt';e={try { $_.StartTime.ToFileTimeUtc().ToString() } catch {}}}) | ConvertTo-Json -Compress`;
  try {
    const { stdout } = await execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000, maxBuffer: MAX_JSON });
    const value = JSON.parse(stdout.trim() || '[]'); const list = Array.isArray(value) ? value : [value];
    return list.map((p) => ({ pid: p.Id, name: p.ProcessName, path: p.Path ?? null, ...(p.StartedAt && { startedAt: p.StartedAt }) }));
  } catch (e) { fail('process_probe_failed', 'Could not establish whether the game or Bridge is running', { reason: e.message }); }
}

async function forceStopProcess({ pid, path: executable, startedAt }) {
  if (process.platform !== 'win32') fail('unsupported_os', '强制停止游戏需要 Windows。');
  if (!Number.isInteger(pid) || pid < 1 || pid > 0x7fffffff || typeof startedAt !== 'string' || !/^\d{1,20}$/.test(startedAt) ||
      typeof executable !== 'string' || !path.isAbsolute(executable) || path.basename(executable).toLowerCase() !== 'left4dead2.exe')
    fail('game_process_changed', '游戏进程信息已变化，请刷新后再试。');
  // Cache the OS process handle before checking identity; Kill and WaitForExit
  // use that same handle so a recycled PID can never redirect the stop.
  const script = `
    $ErrorActionPreference = 'Stop'
    try { $game = [Diagnostics.Process]::GetProcessById([int]$env:MATCHA_STOP_PID) }
    catch [ArgumentException] { 'exited'; return }
    try {
      $null = $game.Handle
      if ($game.HasExited) { 'exited'; return }
      if ($game.StartTime.ToFileTimeUtc().ToString() -ne $env:MATCHA_STOP_STARTED -or
          ![string]::Equals($game.MainModule.FileName, $env:MATCHA_STOP_EXE, [StringComparison]::OrdinalIgnoreCase)) {
        'changed'; return
      }
      $game.Kill()
      if ($game.WaitForExit(5000)) { 'stopped' } else { 'timeout' }
    } catch {
      if ($game.HasExited) { 'exited' } else { throw }
    } finally { $game.Dispose() }`;
  let status;
  try {
    const { stdout } = await execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 10000, env: { ...process.env, MATCHA_STOP_PID: String(pid), MATCHA_STOP_STARTED: startedAt, MATCHA_STOP_EXE: executable },
    });
    status = stdout.trim();
  } catch (e) { fail('game_stop_failed', '强制停止游戏失败，请用任务管理器检查游戏进程。', { reason: e.message }); }
  if (status === 'changed') fail('game_process_changed', '游戏进程已变化，请刷新后再试。');
  if (status === 'timeout') fail('game_stop_timeout', '游戏已收到停止请求，进程仍在退出。');
  if (status !== 'stopped' && status !== 'exited') fail('game_stop_failed', '未收到游戏退出结果，请刷新后检查。');
  return { status };
}
export async function windowsSteamRoots() {
  const result = [];
  if (process.platform !== 'win32') return result;
  for (const [key, value] of [['HKCU\\Software\\Valve\\Steam', 'SteamPath'], ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath']]) {
    try {
      const { stdout } = await execFile('reg.exe', ['query', key, '/v', value], { windowsHide: true, timeout: 5000 });
      const match = stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/m); if (match) result.push(match[1].trim());
    } catch (e) { if (![1, 'ENOENT'].includes(e.code)) throw e; }
  }
  return result;
}
async function spawnSteam(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
export async function steamIsRunning(steamExe) {
  const script = "@((Get-Process -Name steam -ErrorAction SilentlyContinue) | Select-Object Path) | ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000, maxBuffer: MAX_JSON });
    const value = JSON.parse(stdout.trim() || '[]');
    return (Array.isArray(value) ? value : [value]).some(p => p.Path && samePath(p.Path, steamExe));
  } catch (e) { fail('steam_probe_failed', '检查 Steam 进程失败，请打开 Steam 后重试。', { reason: e.message }); }
}
async function spawnGame(file, args, cwd) {
  // A detached GUI process survives closing Matcha. No shell, console or DLL injection helper.
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: false, detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', () => { const pid = child.pid; child.unref(); resolve({ pid }); });
  });
}

export function createPlatform(options = {}) {
  // Dependency injection is for offline fixtures. CLI / Pi use the default OS probes.
  const processes = options.getProcesses ?? windowsProcesses;
  const pipeFor = options.pipePath ?? ((pid) => `\\\\.\\pipe\\l4p.${pid}`);
  const launchFile = options.launchSteam ?? spawnSteam;
  const launchGame = options.launchGame ?? spawnGame;
  const checkSteamRunning = options.isSteamRunning ?? steamIsRunning;
  async function idle() {
    const running = await processes();
    if (running.length) fail('game_running', 'Game or Bridge is running; apply changes after it exits', { processes: running });
  }
  async function context(gameRoot) {
    if (typeof gameRoot !== 'string' || !gameRoot.trim()) fail('game_root_required', 'An explicit gameRoot is required');
    const root = await directory(path.resolve(gameRoot));
    await requirePe(path.join(root, 'left4dead2.exe'), [], false);
    await directory(path.join(root, 'left4dead2'));
    const bin = await directory(path.join(root, 'bin'));
    const platform = path.join(bin, 'l4p');
    return { root, bin, platform, entry: path.join(bin, 'dxvk_d3d9.dll'), statePath: path.join(platform, STATE_FILE), lock: path.join(bin, '.l4p-operation.lock') };
  }
  async function loadState(c, installed = false) {
    await directory(c.platform); const state = await readJson(c.statePath);
    if (state.platform !== 'l4p' || ![1,2].includes(state.schemaVersion) || typeof state.gameRoot !== 'string' || !samePath(state.gameRoot, c.root) || (state.schemaVersion===1 ? !/^[0-9a-f]{64}$/.test(state.originalSha256) || !/^[0-9a-f]{64}$/.test(state.shimSha256) : !/^[0-9a-f]{64}$/.test(state.bridgeSha256)) || !object(state.plugins)) fail('unowned_platform', 'Existing bin/l4p has no valid L4P ownership record');
    if (installed && state.status !== 'installed') fail('platform_not_installed', 'Platform requires a completed installation', { status: state.status });
    return state;
  }
  async function lock(c, action, fn) {
    await idle(); const id = randomUUID(); let handle;
    try {
      handle = await fs.open(c.lock, 'wx');
      await handle.writeFile(JSON.stringify({ platform: 'l4p', id, pid: process.pid, action, createdAt: new Date().toISOString() })); await handle.sync();
    } catch (e) { await handle?.close(); if (e.code === 'EEXIST') fail('operation_in_progress', 'A platform operation lock exists; inspect and recover it before continuing', { lock: c.lock }); throw e; }
    await handle.close();
    try { return await fn(); }
    finally { const current = await readJson(c.lock).catch(() => null); if (current?.id === id) await fs.unlink(c.lock); }
  }
  async function inspectGame(gameRoot) {
    const c = await context(gameRoot);
    const result = { gameRoot: c.root, installed: true, architecture: 'x86', processes: await processes(), dxvk: null, platform: { status: 'absent' }, pendingOperations: [] };
    if (await exists(c.entry)) try {result.dxvk=await inspectPe(c.entry);} catch(e) {if(e.code!=='invalid_pe')throw e;}
    if (await exists(c.platform)) {
      try { const state = await loadState(c); result.platform = { status: state.status, host:state.schemaVersion===2?'l4n':'legacy-dxvk', version: state.version, installedAt: state.installedAt, lastError: state.lastError, ...(state.pluginTransaction ? { pendingPlugin: state.pluginTransaction.pluginId } : {}) }; }
      catch (e) { result.platform = { status: 'unowned', error: errorRecord(e) }; }
    }
    for (const item of await fs.readdir(c.bin)) if (item.startsWith('.l4p-install-') || item === '.l4p-operation.lock') result.pendingOperations.push(item);
    return result;
  }
  async function discover({ steamRoots, gameRoot } = {}) {
    const roots = steamRoots ?? await windowsSteamRoots(); const libraries = new Set(); const games = [], warnings = [];
    for (const root of roots) {
      libraries.add(path.resolve(root));
      for (const loc of ['steamapps/libraryfolders.vdf', 'config/libraryfolders.vdf']) {
        const file = path.join(root, loc); if (!(await exists(file))) continue;
        try {
          const data = parseKeyValues(await fs.readFile(file, 'utf8')); const entries = data.libraryfolders ?? data.LibraryFolders ?? data;
          for (const [id, entry] of Object.entries(entries)) if (/^\d+$/.test(id)) {
            const value = typeof entry === 'string' ? entry : entry.path;
            if (typeof value === 'string') libraries.add(path.resolve(value));
          }
        } catch (e) { warnings.push({ file, error: errorRecord(e) }); }
      }
    }
    for (const library of libraries) {
      const manifest = path.join(library, 'steamapps', 'appmanifest_550.acf'); if (!(await exists(manifest))) continue;
      try {
        const app = parseKeyValues(await fs.readFile(manifest, 'utf8')).AppState;
        if (!app || app.appid !== '550' || typeof app.installdir !== 'string' || path.basename(app.installdir) !== app.installdir || app.installdir.includes('\\') || app.installdir.includes('/')) fail('invalid_manifest', 'Steam install directory must be one path component');
        const root = path.join(library, 'steamapps', 'common', app.installdir);
        games.push({ ...(await inspectGame(root)), steamManifest: manifest, steamBuildId: app.buildid ?? null });
      } catch (e) { warnings.push({ file: manifest, error: errorRecord(e) }); }
    }
    if (gameRoot && !games.some((g) => samePath(g.gameRoot, gameRoot))) games.push(await inspectGame(gameRoot));
    return { steamRoots: roots, libraries: [...libraries], games, warnings };
  }
  async function listPlugins(gameRoot, { includeConfig = false } = {}) {
    const c = await context(gameRoot); if (!(await exists(c.platform))) return [];
    const ledger = await loadState(c); const enabled = await readEnabled(c.platform), plugins = await pluginInventory(c.platform);
    const order = orderPlugins(plugins, enabled);
    return Promise.all(plugins.map(async (p) => {
      let savedConfig, configError;
      const file = path.join(p.directory, 'config.json');
      if (includeConfig && await exists(file)) try {
        const value = await readJson(file);
        savedConfig = validateActionParameters({ parameters: Object.fromEntries(p.manifest.config.map(f => [f.id, f])) }, value);
      } catch (e) { configError = errorRecord(e); }
      const managed = Object.hasOwn(ledger.plugins, p.manifest.id);
      return { ...p, managed, canRollback: managed && !!ledger.plugins[p.manifest.id].previousDirectory,
        savedConfig, configError, enabled: enabled.includes(p.manifest.id), loadOrder: order.indexOf(p.manifest.id), runtimeState: 'unobserved' };
    }));
  }
  async function planInstall({ gameRoot, distRoot }) {
    const c = await context(gameRoot); await idle();
    if (await exists(c.platform)) fail('existing_platform', 'bin/l4p already exists; initial installation preserves it. Upgrade/reinstallation requires a later migration.', { directory: c.platform });
    if ((await fs.readdir(c.bin)).some((v) => v.startsWith('.l4p-install-'))) fail('recovery_required', 'An unfinished installation staging directory exists');
    const source = await directory(path.resolve(distRoot));
    const bridge=path.join(source, BRIDGE), runtimeRoot=path.join(source,'bin/l4p');
    if(!(await localL4n(c.root)).enabled) fail('l4n_required','请先启用 L4N；Matcha 模组通过它的子插件接口加载。');
    if(await platformPath(c.root,BRIDGE)) fail('existing_bridge','已有同名 L4N 插件，请先核对来源。');
    await requirePe(bridge,['GetL4NPluginInstance']);
    await requirePe(path.join(runtimeRoot, 'l4p_runtime.dll'), ['L4P_RuntimeInitialize', 'L4P_RuntimeFactoryReady']);
    const files = await treeFiles(runtimeRoot);
    for (const file of files) {
      const rel = relative(runtimeRoot, file);
      if ([STATE_FILE, 'backups', 'backend'].some((v) => rel === v || rel.startsWith(`${v}/`))) fail('invalid_distribution', 'Distribution includes reserved deployment paths', { file: rel });
    }
    const plugins = await pluginInventory(runtimeRoot), enabled = await readEnabled(runtimeRoot);
    const loadOrder = orderPlugins(plugins, enabled);
    requireLoadable(plugins, plugins.map(p => p.manifest.id));
    await requireReleaseRuntime(runtimeRoot, plugins);
    const sourceFiles = [];
    for (const file of [bridge, ...files]) sourceFiles.push({ path: relative(source, file), sha256: await fileDigest(file) });
    const evidence = { gameRoot: c.root, distRoot: source, host: 'l4n', sourceFiles, loadOrder };
    return { kind: 'l4p-install-plan', schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString(), ...evidence, fingerprint: digest(JSON.stringify(evidence)), changes: [BRIDGE, 'bin/l4p/'] };
  }
  async function applyInstall(plan, { confirmation } = {}) {
    requireConfirmation(confirmation);
    if (!object(plan) || plan.kind !== 'l4p-install-plan' || plan.schemaVersion !== 1) fail('invalid_plan', 'Expected an L4P installation plan');
    const c = await context(plan.gameRoot);
    return lock(c, 'install', async () => {
      const fresh = await planInstall({ gameRoot: c.root, distRoot: plan.distRoot });
      if (fresh.fingerprint !== plan.fingerprint) fail('stale_plan', 'Game or distribution files changed; create and confirm a new plan');
      const transactionId = randomUUID(), stage = path.join(c.bin, `.l4p-install-${transactionId}`);
      const state = { platform: 'l4p', schemaVersion: 2, version:'0.4.0', gameRoot:c.root, transactionId, status:'installing', installedAt:new Date().toISOString(), bridgeSha256:plan.sourceFiles.find(f=>f.path===BRIDGE).sha256, plugins: {} };
      for (const p of await pluginInventory(path.join(plan.distRoot, 'bin/l4p'))) state.plugins[p.manifest.id] = { version: p.manifest.version, installedAt: state.installedAt, ...(p.verification.releaseSha256 ? { releaseSha256: p.verification.releaseSha256 } : {}) };
      const bridgeBytes=await fs.readFile(path.join(plan.distRoot,BRIDGE));
      if(digest(bridgeBytes)!==state.bridgeSha256) fail('stale_plan','运行时插件在预览后已变化。');
      let published = false, attached=false;
      try {
        await copyTree(path.join(plan.distRoot, 'bin', 'l4p'), stage);
        for (const file of plan.sourceFiles.filter((v) => v.path.startsWith('bin/l4p/'))) {
          if (await fileDigest(path.join(stage, file.path.slice('bin/l4p/'.length))) !== file.sha256) fail('stale_plan', 'Copied distribution changed during transfer');
        }
        for (const [pluginId, record] of Object.entries(state.plugins)) {
          const marker = path.join(stage, 'plugins', pluginId, '.l4p-package.json');
          if (await exists(marker)) fail('invalid_distribution', 'Bundled plugin contains a reserved ownership marker', { pluginId });
          await writeJson(marker, { platform: 'l4p', transactionId, pluginId, ...(record.releaseSha256 ? { releaseSha256: record.releaseSha256 } : {}) });
        }
        await fs.mkdir(path.join(stage,'backups'));
        await fs.writeFile(path.join(stage,BRIDGE_COPY),bridgeBytes,{flag:'wx'});
        await atomicWrite(path.join(stage, 'enabled.txt'), plan.loadOrder.map((v) => `${v}\n`).join(''));
        await writeJson(path.join(stage, STATE_FILE), state);
        await idle();

        for (const file of plan.sourceFiles) if (await fileDigest(path.join(plan.distRoot, file.path)) !== file.sha256) fail('stale_plan', 'Distribution changed while preparing installation');
        // Publishing a real DLL tree by directory rename can remain denied by
        // Windows directory watchers even when individual file access is allowed.
        // The original entry remains active while an exclusively-created,
        // journalled runtime directory is populated. Replacing the entry commits.
        await fs.mkdir(c.platform); published = true;
        await writeJson(c.statePath, state);
        for (const file of await treeFiles(stage)) {
          if (path.basename(file) === STATE_FILE && path.dirname(file) === stage) continue;
          const target = path.join(c.platform, path.relative(stage, file));
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL);
        }
        await idle();
        await attachBridge(c,state);attached=true;
        state.status = 'installed'; await writeJson(c.statePath, state);
        let cleanupWarning;
        try { await removeOwnedTree(c.bin, stage); } catch (cleanup) { cleanupWarning = errorRecord(cleanup); }
        return { status: 'installed', gameRoot: c.root, requiresLaunch: true, entry: path.join(c.root,BRIDGE), runtime: path.join(c.platform, 'l4p_runtime.dll'), ...(cleanupWarning ? { cleanupWarning, stagingDirectory: stage } : {}) };
      } catch (e) {
        if (published) {
          try {
            // Only an entry published from this transaction can be removed.
            if(attached) await detachBridge(c,state);
            state.status = 'install-failed'; state.lastError = errorRecord(e); await writeJson(c.statePath, state);
            await removeOwnedTree(c.bin, stage);
          } catch (recoveryError) { fail('recovery_required', 'Installation failed and recovery needs attention', { originalError: errorRecord(e), recoveryError: errorRecord(recoveryError), platformDirectory: c.platform }); }
        } else await removeOwnedTree(c.bin, stage);
        throw e;
      }
    });
  }
  async function attachBridge(c,state) {
    if(!(await localL4n(c.root)).enabled) fail('l4n_required','请先启用 L4N 整包。');
    if(await platformPath(c.root,BRIDGE)) fail('existing_bridge','同名 L4N 插件已存在，保留原文件。');
    const source=await platformPath(c.platform,BRIDGE_COPY);
    if(!source || await fileDigest(source)!==state.bridgeSha256) fail('backup_changed','Matcha 运行时插件副本已变化。');
    for(const rel of ['bin/neko','bin/neko/plugins']){
      const dir=path.join(c.root,rel);try{await fs.mkdir(dir);}catch(e){if(e.code!=='EEXIST')throw e;}await directory(dir);
    }
    await idle();await fs.copyFile(source,path.join(c.root,BRIDGE),fs.constants.COPYFILE_EXCL);
  }
  async function detachBridge(c,state) {
    const file=await platformPath(c.root,BRIDGE);
    if(!file) return;
    if(await fileDigest(file)!==state.bridgeSha256) fail('external_change','同名 L4N 插件已变化，保留文件以供核对。');
    await idle();await fs.unlink(file);
  }
  async function restoreInternal(c) {
    const state = await loadState(c);
    if(state.schemaVersion===2){
      await detachBridge(c,state); state.status='restored';state.restoredAt=new Date().toISOString();
      await writeJson(c.statePath,state); return {status:'restored',entry:path.join(c.root,BRIDGE),preservedDirectory:c.platform};
    }
    const backup = path.join(c.platform, 'backups', 'original_dxvk_d3d9.dll');
    const current = await fileDigest(c.entry);
    if (current !== state.shimSha256 && current !== state.originalSha256) fail('external_change', 'Game entry was changed outside this installation; restore stopped');
    // An interrupted preparation may have a journal but no complete backup yet.
    // When the original entry is still intact there is no file to restore.
    if (current === state.shimSha256 && await fileDigest(backup) !== state.originalSha256) fail('backup_changed', 'Original entry backup changed; restore stopped');
    if (state.status === 'installed' && current === state.shimSha256) {
      await directory(path.dirname(backup));
      const owned = await fs.readFile(c.entry);
      if (digest(owned) !== state.shimSha256) fail('external_change', '游戏入口已发生外部变化，请检查后再恢复。');
      await idle(); await atomicWrite(path.join(c.platform, SAVED_SHIM), owned);
    }
    await idle(); state.status = 'restoring'; await writeJson(c.statePath, state);
    if (current === state.shimSha256) await atomicWrite(c.entry, await fs.readFile(backup));
    state.status = 'restored'; state.restoredAt = new Date().toISOString(); await writeJson(c.statePath, state);
    return { status: 'restored', entry: c.entry, preservedDirectory: c.platform };
  }
  async function restore(gameRoot, { confirmation } = {}) {
    requireConfirmation(confirmation); const c = await context(gameRoot);
    return lock(c, 'restore', () => restoreInternal(c));
  }
  async function resumeRuntime(gameRoot, { confirmation, distRoot } = {}) {
    requireConfirmation(confirmation); const c = await context(gameRoot);
    return lock(c, 'resume', async () => {
      const state = await loadState(c);
      if (state.status !== 'restored' || state.pluginTransaction) fail('resume_state', '请先恢复原入口并处理在途操作。');
      if(state.schemaVersion===1){
        // Previously restored legacy deployments keep all modules and their configuration.
        const source=distRoot??options.distRoot??fileURLToPath(new URL('../native/build-x86/dist/',import.meta.url));
        const bridge=await platformPath(source,BRIDGE);
        if(!bridge) fail('library_package_missing','需要含 L4N 运行时插件的新版 Matcha。');
        await requirePe(bridge,['GetL4NPluginInstance']); const bytes=await fs.readFile(bridge);
        if(!(await localL4n(c.root)).enabled) fail('l4n_required','先启用 L4N，再迁移保留的 Matcha 模组。');
        const saved=path.join(c.platform,BRIDGE_COPY);
        if(await exists(saved)){if(await fileDigest(saved)!==digest(bytes)) fail('external_change','保留的运行时插件已变化。');}
        else await fs.writeFile(saved,bytes,{flag:'wx'});
        state.schemaVersion=2;state.version='0.4.0';state.bridgeSha256=digest(bytes);
      }
      if(await platformPath(c.root,BRIDGE)) fail('existing_bridge','同名 L4N 插件已存在，请先核对。');
      state.status='installing';await writeJson(c.statePath,state);
      await attachBridge(c,state);state.status='installed';await writeJson(c.statePath,state);
      return {status:'installed',entry:path.join(c.root,BRIDGE),preservedDirectory:c.platform};
    });
  }
  async function recover(gameRoot, { confirmation } = {}) {
    requireConfirmation(confirmation); const c = await context(gameRoot); await idle();
    if (await exists(c.lock)) {
      const owner = await readJson(c.lock);
      if (owner.platform !== 'l4p' || !Number.isSafeInteger(owner.pid) || typeof owner.id !== 'string') fail('unowned_lock', 'Operation lock needs manual inspection');
      let alive = true; try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; else throw e; }
      if (alive) fail('operation_in_progress', 'The operation lock owner is still running', { pid: owner.pid });
      await fs.unlink(c.lock);
    }
    return lock(c, 'recover', async () => {
      const cleaned = [];
      for (const name of await fs.readdir(c.bin)) if (/^\.l4p-install-[0-9a-f-]{36}$/.test(name)) {
        const stage = path.join(c.bin, name); const state = await readJson(path.join(stage, STATE_FILE));
        if (state.platform !== 'l4p' || typeof state.gameRoot !== 'string' || !samePath(state.gameRoot, c.root) || `.l4p-install-${state.transactionId}` !== name) fail('recovery_required', 'Staging ownership needs manual inspection', { stage });
        const current = state.schemaVersion===2 ? null : await fileDigest(c.entry);
        if (state.schemaVersion!==2 && current !== state.originalSha256) {
          const published = await loadState(c);
          if (published.transactionId !== state.transactionId || current !== published.shimSha256 || published.status !== 'installed') fail('recovery_required', 'Staging entry state needs manual inspection', { stage });
        }
        await removeOwnedTree(c.bin, stage); cleaned.push(name);
      }
      if (await exists(c.platform)) {
        const state = await loadState(c);
        if (['installing', 'install-failed', 'restoring'].includes(state.status)) return { ...(await restoreInternal(c)), cleaned };
        if (state.pluginTransaction?.kind === 'update') {
          const id = state.pluginTransaction.pluginId;
          await rollbackPluginUpdate(c, state);
          cleaned.push(`update:${id}`);
        } else if (state.pluginTransaction?.kind === 'uninstall') {
          await recoverUninstall(c,state); cleaned.push('uninstall');
        } else if (state.pluginTransaction) {
          const txn = state.pluginTransaction; assertId(txn.pluginId);
          if (typeof txn.id !== 'string' || !/^\.plugin-stage-[0-9a-f-]{36}$/.test(txn.stage)) fail('recovery_required', 'Plugin transaction needs manual inspection');
          if ((await readEnabled(c.platform)).includes(txn.pluginId)) fail('recovery_required', 'Interrupted plugin was enabled externally; inspect it before recovery');
          const destination = path.join(c.platform, 'plugins', txn.pluginId);
          if (await exists(destination)) {
            const marker = await readJson(path.join(destination, '.l4p-package.json')).catch(() => null);
            const empty = (await fs.readdir(destination)).length === 0;
            if (!empty && (marker?.platform !== 'l4p' || marker?.transactionId !== txn.id)) fail('recovery_required', 'Plugin directory ownership needs manual inspection');
            await removeOwnedTree(c.platform, destination);
          }
          await removeOwnedTree(c.platform, path.join(c.platform, txn.stage));
          delete state.pluginTransaction; delete state.plugins[txn.pluginId]; await writeJson(c.statePath, state);
          cleaned.push(`plugin:${txn.pluginId}`);
        }
      }
      return { status: 'recovered', cleaned };
    });
  }
  async function installPlugin({ gameRoot, pluginDirectory, confirmation, checkStage }) {
    requireConfirmation(confirmation); const c = await context(gameRoot);
    return lock(c, 'install-plugin', async () => {
      const state = await loadState(c, true), policyPath = path.join(c.platform, 'release-trust.json');
      const plugin = await validatePlugin(pluginDirectory, { policyPath });
      await requireReleaseRuntime(c.platform, [plugin]);
      const destination = path.join(c.platform, 'plugins', plugin.manifest.id);
      if (await exists(destination)) fail('plugin_exists', 'Plugin already exists; use update-plugin to preserve its configuration and previous package', { id: plugin.manifest.id });
      if (state.pluginTransaction) fail('recovery_required', 'A plugin installation is unfinished; recover it first');
      const transactionId = randomUUID(), stage = path.join(c.platform, `.plugin-stage-${transactionId}`); let published = false, journalled = false, committed = false;
      try {
        await copyTree(plugin.directory, stage);
        const expectedRelease = plugin.verification.releaseSha256 ?? '';
        const staged=await validatePlugin(stage, { policyPath, expectedRelease }); await checkStage?.(staged,policyPath); await idle();
        if (await exists(path.join(stage, '.l4p-package.json'))) fail('invalid_package', 'Plugin package contains a reserved ownership marker');
        state.pluginTransaction = { id: transactionId, pluginId: plugin.manifest.id, stage: path.basename(stage) };
        await writeJson(c.statePath, state); journalled = true;
        await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.mkdir(destination); published = true;
        await writeJson(path.join(destination, '.l4p-package.json'), { platform: 'l4p', transactionId, pluginId: plugin.manifest.id, ...(expectedRelease ? { releaseSha256: expectedRelease } : {}) });
        await copyTree(stage, destination);
        await validatePlugin(destination, { policyPath, expectedRelease }); await idle();
        state.plugins[plugin.manifest.id] = { version: plugin.manifest.version, installedAt: new Date().toISOString(), ...(expectedRelease ? { releaseSha256: expectedRelease } : {}) };
        delete state.pluginTransaction; await writeJson(c.statePath, state); committed = true;
        let cleanupWarning; try { await removeOwnedTree(c.platform, stage); } catch (cleanup) { cleanupWarning = errorRecord(cleanup); }
        return { status: 'installed', id: plugin.manifest.id, enabled: false, verification: plugin.verification, ...(cleanupWarning ? { cleanupWarning, stagingDirectory: stage } : {}) };
      } catch (e) {
        if (!committed) {
          try {
            if (published) await removeOwnedTree(c.platform, destination);
            await removeOwnedTree(c.platform, stage);
            if (journalled) { delete state.pluginTransaction; delete state.plugins[plugin.manifest.id]; await writeJson(c.statePath, state); }
          } catch (recoveryError) { fail('recovery_required', 'Plugin install failed and recovery needs attention', { originalError: errorRecord(e), recoveryError: errorRecord(recoveryError) }); }
        }
        throw e;
      }
    });
  }
  async function rollbackPluginUpdate(c, state) {
    const txn = state.pluginTransaction; assertId(txn.pluginId);
    if (txn.kind !== 'update' || !/^[0-9a-f-]{36}$/.test(txn.id) || txn.stage !== `.plugin-stage-${txn.id}` || txn.backup !== `.plugin-backup-${txn.id}` || !object(txn.previous) || !VERSION_PATTERN.test(txn.previous.version) || !object(txn.previousMarker)) fail('recovery_required', 'Plugin update journal needs manual inspection');
    const destination = path.join(c.platform, 'plugins', txn.pluginId), backup = path.join(c.platform, txn.backup);
    const checkOld = async (dir) => {
      await directory(dir);
      const marker = await readJson(path.join(dir, '.l4p-package.json'));
      const manifest = validateManifest(await readJson(path.join(dir, 'manifest.json')));
      if (!equal(marker, txn.previousMarker) || marker.platform !== 'l4p' || marker.pluginId !== txn.pluginId || manifest.id !== txn.pluginId || manifest.version !== txn.previous.version) fail('recovery_required', 'Previous plugin package ownership changed', { directory: dir });
    };
    await idle();
    if (await exists(backup)) {
      await checkOld(backup);
      if (await exists(destination)) {
        const marker = await readJson(path.join(destination, '.l4p-package.json'));
        if (marker.platform !== 'l4p' || marker.pluginId !== txn.pluginId || marker.transactionId !== txn.id) fail('recovery_required', 'Replacement plugin ownership changed');
        await removeOwnedTree(c.platform, destination);
      }
      await fs.rename(backup, destination);
    } else await checkOld(destination); // Preparation failed, or a prior recovery already restored it.
    await removeOwnedTree(c.platform, path.join(c.platform, txn.stage));
    state.plugins[txn.pluginId] = txn.previous;
    delete state.pluginTransaction; await writeJson(c.statePath, state);
  }
  async function updatePlugin({ gameRoot, pluginDirectory, confirmation, expectedInstalled, previousSourceVersion, checkStage }) {
    requireConfirmation(confirmation); const c = await context(gameRoot);
    return lock(c, 'update-plugin', async () => {
      return replacePlugin(c, await loadState(c,true), pluginDirectory, expectedInstalled, undefined, previousSourceVersion, checkStage);
    });
  }
  async function replacePlugin(c, state, pluginDirectory, expectedInstalled, backupMarker, previousSourceVersion, checkStage) {
      const policyPath = path.join(c.platform, 'release-trust.json');
      if (state.pluginTransaction) fail('recovery_required', 'Recover the unfinished plugin transaction first');
      const plugin = await validatePlugin(pluginDirectory, { policyPath, expectedRelease: backupMarker?.releaseSha256 ?? '' }), id = plugin.manifest.id;
      if (backupMarker && (backupMarker.pluginId !== id || !isDeepStrictEqual(backupMarker,await readJson(path.join(pluginDirectory,'.l4p-package.json')))))
        fail('plugin_update_stale','备份身份已变化，请重新预览。');
      await requireReleaseRuntime(c.platform, [plugin]);
      const destination = path.join(c.platform, 'plugins', id), previous = state.plugins[id];
      if (!previous) fail('plugin_unowned', 'Install this plugin first; updates require an installation ledger');
      const old = await validatePlugin(destination, { policyPath, expectedRelease: previous.releaseSha256 ?? '' });
      const previousMarker = await readJson(path.join(destination, '.l4p-package.json'));
      if (old.manifest.id !== id || old.manifest.version !== previous.version || previousMarker.platform !== 'l4p' || previousMarker.pluginId !== id) fail('plugin_unowned', 'Installed package ownership changed');
      if (samePath(plugin.directory, destination)) fail('invalid_package', 'Choose a separate replacement package');
      const enabled = await readEnabled(c.platform);
      if (expectedInstalled && (old.manifest.version !== expectedInstalled.version || enabled.includes(id) !== expectedInstalled.enabled ||
        !isDeepStrictEqual(previousMarker, expectedInstalled.marker)))
        fail('plugin_update_stale', '已安装版本或启停状态刚有变化，请重新预览并确认更新。', { id });
      const inventory = (await pluginInventory(c.platform)).map(p => p.manifest.id === id ? plugin : p);
      const order = orderPlugins(inventory, enabled); requireLoadable(inventory, order);
      const transactionId = randomUUID(), stage = path.join(c.platform, `.plugin-stage-${transactionId}`), backup = path.join(c.platform, `.plugin-backup-${transactionId}`);
      let journalled = false, committed = false;
      try {
        await copyTree(plugin.directory, stage, { omitMarker: !!backupMarker });
        if (await exists(path.join(stage, '.l4p-package.json'))) fail('invalid_package', 'Package contains a reserved ownership marker');
        const configFile = path.join(destination, 'config.json');
        if (await exists(configFile)) {
          const config = await readJson(configFile);
          // Reject incompatible upgrades before touching the installed package.
          validateActionParameters({ parameters: Object.fromEntries(plugin.manifest.config.map(f => [f.id, f])) }, config);
          await atomicWrite(path.join(stage, 'config.json'), await fs.readFile(configFile));
        }
        const expectedRelease = plugin.verification.releaseSha256 ?? '';
        const staged=await validatePlugin(stage, { policyPath, expectedRelease }); await checkStage?.(staged,policyPath);
        await writeJson(path.join(stage, '.l4p-package.json'), { platform: 'l4p', transactionId, pluginId: id, ...(expectedRelease ? { releaseSha256: expectedRelease } : {}) });
        state.pluginTransaction = { kind: 'update', id: transactionId, pluginId: id, stage: path.basename(stage), backup: path.basename(backup), previous, previousMarker };
        await writeJson(c.statePath, state); journalled = true;
        await idle(); await fs.rename(destination, backup); await fs.rename(stage, destination);
        await validatePlugin(destination, { policyPath, expectedRelease });
        state.plugins[id] = { version: plugin.manifest.version, installedAt: previous.installedAt, updatedAt: new Date().toISOString(), previousDirectory: path.basename(backup), previousMarker, previousVersion: previous.version, previousSourceVersion: previousSourceVersion ?? null, ...(expectedRelease ? { releaseSha256: expectedRelease } : {}) };
        delete state.pluginTransaction; await writeJson(c.statePath, state); committed = true;
        return { status: 'updated', id, version: plugin.manifest.version, enabled: enabled.includes(id), previousDirectory: backup, verification: plugin.verification, applies: 'next-launch' };
      } catch (error) {
        if (!committed) try {
          if (journalled) await rollbackPluginUpdate(c, await loadState(c, true));
          else await removeOwnedTree(c.platform, stage);
        } catch (recoveryError) { fail('recovery_required', 'Plugin update requires recovery', { originalError: errorRecord(error), recoveryError: errorRecord(recoveryError) }); }
        throw error;
      }
  }
  // Plans describe a specific installed generation and its immediate backup. A caller supplies only a plugin ID.
  async function maintenance(c,state,id,operation) {
    assertId(id);
    if (!['rollback','uninstall'].includes(operation)) fail('invalid_argument','请选择卸载或回滚。');
    if (state.pluginTransaction) fail('recovery_required','请先恢复未完成的插件操作。');
    const previous=state.plugins[id]; if (!Object.hasOwn(state.plugins,id)) fail('plugin_unowned','请选择有安装记录的模组。');
    await directory(path.join(c.platform,'plugins'));
    const dest=await directory(path.join(c.platform,'plugins',id)), marker=await readJson(path.join(dest,'.l4p-package.json'));
    const manifest=validateManifest(await readJson(path.join(dest,'manifest.json')));
    if(marker.platform!=='l4p'||marker.pluginId!==id||manifest.id!==id||manifest.version!==previous.version)fail('plugin_unowned','安装记录与当前文件不一致。');
    const enabled=await readEnabled(c.platform);
    let target=null;
    if(operation==='rollback'){
      const name=previous.previousDirectory;
      if(!/^\.plugin-backup-[0-9a-f-]{36}$/.test(name)||name!=='.plugin-backup-'+marker.transactionId)fail('backup_missing','此安装没有可回滚的上一份备份。');
      const folder=await directory(path.join(c.platform,name)), oldMarker=await readJson(path.join(folder,'.l4p-package.json'));
      const old=await validatePlugin(folder,{policyPath:path.join(c.platform,'release-trust.json'),expectedRelease:oldMarker.releaseSha256??''});
      if(oldMarker.platform!=='l4p'||oldMarker.pluginId!==id||old.manifest.id!==id ||
        previous.previousMarker && !isDeepStrictEqual(previous.previousMarker,oldMarker) ||
        previous.previousVersion && previous.previousVersion!==old.manifest.version)fail('backup_changed','旧包与备份记录不一致。');
      const inventory=(await pluginInventory(c.platform)).map(p=>p.manifest.id===id?old:p);
      orderPlugins(inventory,enabled);
      target={directory:folder,version:old.manifest.version,sourceVersion:previous.previousSourceVersion ?? null,marker:oldMarker,entries:await fileStamps(folder)};
    } else {
      const inventory=await pluginInventory(c.platform);
      const needs=inventory.filter(p=>p.manifest.dependencies.some(d=>d.id===id));
      if(needs.length)fail('plugin_required','以下模组依赖它，请先移除依赖方：'+needs.map(p=>p.manifest.name).join('、'));
    }
    const entries=await fileStamps(dest);
    return {gameRoot:c.root,pluginId:id,operation,name:manifest.name,version:manifest.version,enabled:enabled.includes(id),directory:dest,entries,marker,target};
  }
  async function fileStamps(folder){
    return Promise.all((await treeFiles(folder)).map(async file=>{const s=await regular(file); return [relative(folder,file),s.size,s.ino,s.ctimeMs,s.mtimeMs];}));
  }
  async function previewPluginMaintenance({gameRoot,pluginId,operation}) {
    const c=await context(gameRoot); return maintenance(c,await loadState(c,true),pluginId,operation);
  }
  async function recoverUninstall(c,state){
    const t=state.pluginTransaction; assertId(t.pluginId);
    if(!/^[0-9a-f-]{36}$/.test(t.id)||typeof t.before!=='string'||typeof t.after!=='string')fail('recovery_required','卸载恢复记录需要检查。');
    await directory(path.join(c.platform,'plugins'));
    const dest=path.join(c.platform,'plugins',t.pluginId),stored=path.join(c.platform,'.plugin-removed-'+t.id);
    const moved=await exists(stored),folder=await directory(moved?stored:dest);
    if(!isDeepStrictEqual(await readJson(path.join(folder,'.l4p-package.json')),t.marker)||t.marker.pluginId!==t.pluginId || t.marker.platform!=='l4p' || moved && await exists(dest)) fail('recovery_required','插件目录归属已变化，请保留现场。');
    const enabled=path.join(c.platform,'enabled.txt'); const now=await enabledText(enabled);
    if(now!==t.before && now!==t.after)fail('recovery_required','启用清单已有外部修改，请核对后恢复。');
    await idle(); if(moved)await fs.rename(stored,dest);
    if(now!==t.before)await atomicWrite(enabled,t.before);
    delete state.pluginTransaction;await writeJson(c.statePath,state);
  }
  async function enabledText(file){if(!await exists(file))return ''; await regular(file);return fs.readFile(file,'utf8');}
  async function applyPluginMaintenance({gameRoot,expected,confirmation,previousSourceVersion}){
    requireConfirmation(confirmation);const c=await context(gameRoot);
    return lock(c,'plugin-maintenance',async()=>{
      const state=await loadState(c,true),p=await maintenance(c,state,expected.pluginId,expected.operation);
      if(!isDeepStrictEqual(expected,p))fail('plugin_update_stale','确认期间插件或备份已变化，请重新预览。');
      if(p.operation==='rollback') return {...await replacePlugin(c,state,p.target.directory,p,p.target.marker,previousSourceVersion),status:'rolled-back'};
      const id=randomUUID(),stored=path.join(c.platform,'.plugin-removed-'+id),enabledFile=path.join(c.platform,'enabled.txt');
      const before=await enabledText(enabledFile);
      const after=before.split(/(?<=\n)/).filter(line=>line.trim()!==p.pluginId).join('');
      state.pluginTransaction={kind:'uninstall',id,pluginId:p.pluginId,marker:p.marker,before,after};
      await writeJson(c.statePath,state);
      try{
        await idle();await fs.rename(p.directory,stored);
        if(after!==before)await atomicWrite(enabledFile,after);
        delete state.plugins[p.pluginId];delete state.pluginTransaction;await writeJson(c.statePath,state);
      }catch(e){await recoverUninstall(c,await loadState(c,true));throw e;}
      return {status:'uninstalled',id:p.pluginId,previousDirectory:stored};
    });
  }
  async function configureReleaseTrust({ gameRoot, policyPath, confirmation }) {
    requireConfirmation(confirmation); const c = await context(gameRoot);
    return lock(c, 'configure-release-trust', async () => {
      await loadState(c, true);
      const policy = await readJson(path.resolve(policyPath));
      if (policy.schemaVersion !== 1 || !Array.isArray(policy.signers) || !Array.isArray(policy.revokedReleases) || !Array.isArray(policy.revokedSigners)) fail('invalid_trust_policy', 'Expected explicit signer pins and revocation lists');
      const pins = new Set();
      for (const signer of policy.signers) {
        if (!object(signer) || !/^[0-9a-f]{64}$/.test(signer.certificateSha256) || signer.channel !== 'development' || typeof signer.identity !== 'string' || !signer.identity || pins.has(signer.certificateSha256)) fail('invalid_trust_policy', 'Expected unique development certificate pins and identities');
        pins.add(signer.certificateSha256);
      }
      for (const hash of [...policy.revokedReleases, ...policy.revokedSigners]) if (!/^[0-9a-f]{64}$/.test(hash)) fail('invalid_trust_policy', 'Invalid revocation digest');
      const target = path.join(c.platform, 'release-trust.json');
      if (await exists(target)) {
        await fs.mkdir(path.join(c.platform, 'backups'), { recursive: true });
        await fs.copyFile(target, path.join(c.platform, 'backups', `release-trust-${randomUUID()}.json`), fs.constants.COPYFILE_EXCL);
      }
      await idle(); await writeJson(target, policy);
      return { status: 'configured', channel: 'development', signers: policy.signers, applies: 'next-launch' };
    });
  }
  async function setPluginEnabled({ gameRoot, pluginId, enabled, confirmation }) {
    requireConfirmation(confirmation); assertId(pluginId); if (typeof enabled !== 'boolean') fail('invalid_parameter', 'enabled must be boolean');
    const c = await context(gameRoot);
    return lock(c, 'set-plugin-enabled', async () => {
      await loadState(c, true); const plugins = await pluginInventory(c.platform), byId = new Map(plugins.map((p) => [p.manifest.id, p]));
      if (!byId.has(pluginId)) fail('plugin_missing', 'Plugin is not installed', { pluginId });
      if (byId.get(pluginId).manifest.loadRole === 'dependency') fail('dependency_only', '此组件随需要它的模组自动加载。');
      const wanted = new Set(await readEnabled(c.platform));
      if (enabled) {
        const visiting = new Set();
        function include(id) {
          if (visiting.has(id)) fail('dependency_cycle', 'Plugin dependency cycle detected', { id });
          const plugin = byId.get(id); if (!plugin) fail('dependency_missing', 'Required plugin is not installed', { id });
          visiting.add(id); wanted.add(id);
          for (const d of plugin.manifest.dependencies) include(d.id);
          visiting.delete(id);
        }
        include(pluginId);
      } else wanted.delete(pluginId);
      // Old selectable DLLs retain their enabled state. A support-only DLL
      // lives in the effective list exactly while some selected DLL needs it.
      const reachable = new Set();
      const retain = id => {
        if (reachable.has(id)) return;
        reachable.add(id);
        for (const d of byId.get(id)?.manifest.dependencies ?? []) retain(d.id);
      };
      for (const id of wanted) if (byId.get(id)?.manifest.loadRole !== 'dependency') retain(id);
      for (const id of wanted) if (byId.get(id)?.manifest.loadRole === 'dependency' && !reachable.has(id)) wanted.delete(id);
      const order = orderPlugins(plugins, [...wanted]); await idle();
      if (enabled) { requireLoadable(plugins, order); await requireReleaseRuntime(c.platform, plugins.filter(p => order.includes(p.manifest.id))); }
      await atomicWrite(path.join(c.platform, 'enabled.txt'), order.map((v) => `${v}\n`).join(''));
      return { status: 'configured', enabled: order, applies: 'next-launch' };
    });
  }
  async function runtimeRequest(pid, request, { timeoutMs = 5000 } = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0) fail('invalid_pid', 'pid must be a positive integer');
    if (!object(request) || !['status', 'invoke'].includes(request.type)) fail('invalid_request', 'Expected status or invoke request');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail('invalid_timeout', 'timeoutMs must be 1..60000');
    const message = { ...request, id: request.id ?? randomUUID() };
    if (typeof message.id !== 'string' || !message.id || message.id.length > 128) fail('invalid_request', 'Request id must be a nonempty string of at most 128 characters');
    const data = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8'); if (data.length > MAX_PIPE_REQUEST) fail('request_too_large', 'Runtime request exceeds 64 KiB');
    return new Promise((resolve, reject) => {
      let pending = Buffer.alloc(0), settled = false;
      const socket = net.createConnection(pipeFor(pid));
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => finish(new PlatformError('runtime_timeout', 'Runtime did not answer within the deadline')), timeoutMs);
      socket.on('connect', () => socket.write(data));
      socket.on('data', (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        if (pending.length > MAX_PIPE_RESPONSE) return finish(new PlatformError('response_too_large', 'Runtime response exceeds 256 KiB'));
        const newline = pending.indexOf(10); if (newline < 0) return;
        let reply;
        try { reply = JSON.parse(pending.subarray(0, newline).toString('utf8')); } catch { return finish(new PlatformError('invalid_response', 'Runtime returned invalid JSON')); }
        if (!object(reply) || reply.id !== message.id || typeof reply.ok !== 'boolean') return finish(new PlatformError('response_mismatch', 'Runtime response id or shape does not match the request'));
        if (!reply.ok) return finish(new PlatformError(reply.error?.code ?? 'runtime_error', reply.error?.message ?? String(reply.error ?? 'Runtime action failed'), reply.error?.details));
        finish(null, reply);
      });
      socket.on('error', (e) => finish(new PlatformError('runtime_unavailable', 'Could not connect to the platform runtime', { reason: e.message, pid })));
      socket.on('end', () => { if (!settled) finish(new PlatformError('runtime_disconnected', 'Runtime closed the connection before a complete response')); });
    });
  }
  async function invokePlugin({ gameRoot, pid, pluginId, actionId, args = {}, confirmation }) {
    assertId(pluginId); assertId(actionId, 'actionId'); const c = await context(gameRoot); await loadState(c, true);
    const plugins = await listPlugins(c.root); const plugin = plugins.find((p) => p.manifest.id === pluginId);
    if (!plugin || !plugin.enabled) fail('plugin_unavailable', 'Plugin must be installed and enabled', { pluginId });
    const action = plugin.manifest.actions.find((a) => a.id === actionId); if (!action) fail('action_missing', 'Plugin does not declare this action', { pluginId, actionId });
    const params = validateActionParameters(action, args);
    if (action.effect === 'write' || action.requiresConfirmation) requireConfirmation(confirmation);
    const processList = await processes(); const game = processList.find((p) => p.pid === pid && p.path && samePath(p.path, path.join(c.root, 'left4dead2.exe')));
    if (!game) fail('runtime_process_mismatch', 'PID must belong to this game installation', { pid });
    return runtimeRequest(pid, { type: 'invoke', pluginId, actionId, params, ...(confirmation ? { confirmation } : {}) });
  }
  async function launch({ gameRoot, steamExe, confirmation, connect, mode = 'development', platformDataDir, serverModeId = '', gameSettings }) {
    const spec = launchSpec(mode, connect, gameSettings);
    requireConfirmation(confirmation); const c = await context(gameRoot); await idle();
    if (mode === 'clean') {
      if (!steamExe) {
        const roots = await windowsSteamRoots();
        if (roots.length) steamExe = path.join(roots[0], 'steam.exe');
      }
      if (!steamExe) fail('steam_missing', '请安装并登录 Steam，再启动纯净对抗。');
      await regular(steamExe);
      const installations = await discover({ steamRoots: [path.dirname(path.resolve(steamExe))] });
      if (!installations.games.some(g => samePath(g.gameRoot, c.root)))
        fail('clean_steam_required', '请在运行环境中选择 Steam 登记的 L4D2 目录。');
      if (!await checkSteamRunning(steamExe)) fail('steam_not_running', '请先打开 Steam 并登录。');
      const { assertCleanGame } = await import('./clean-launch.mjs');
      await assertCleanGame(c.root, inspectPe, SHIM_EXPORT);
      await idle();
      const executable = path.join(c.root, 'left4dead2.exe');
      const spawned = await launchGame(executable, spec.launchOptions, c.root);
      return { status: 'requested', gameRoot: c.root, appId: 550, executable, ...spec, pid: spawned?.pid };
    }
    const { assertPlatformLaunch } = await import('./platforms/launch.mjs');
    await assertPlatformLaunch({ gameRoot: c.root, connect, modeId: serverModeId, dataDir: platformDataDir, inspectGame });
    const tracked=await exists(c.platform);
    const state=tracked ? await loadState(c) : null;
    const skipL4n=spec.launchOptions.some(arg=>arg.toLowerCase()==='-hide_neko');
    const standalone=mode==='modded' && (!state || state.status==='restored' || (skipL4n && state.schemaVersion===2 && state.status==='installed')) && (await localL4n(c.root)).enabled;
    if(!standalone){
      if(state?.status!=='installed') fail('platform_not_installed','请启用 L4N 或配置 Matcha 运行时。');
      const bridge=state.schemaVersion===2;
      const entry=bridge?await platformPath(c.root,BRIDGE):c.entry;
      if(!entry || await fileDigest(entry)!==(bridge?state.bridgeSha256:state.shimSha256)) fail('external_change','运行时入口已变化，请先核对。');
      if(bridge && !(await localL4n(c.root)).enabled) fail('l4n_required','请先启用 L4N。');
      const plugins=await pluginInventory(c.platform), order=orderPlugins(plugins,await readEnabled(c.platform));
      const selected=plugins.filter(p=>order.includes(p.manifest.id));requireLoadable(plugins,order);await requireReleaseRuntime(c.platform,selected);
    }
    if (!steamExe) { const roots = await windowsSteamRoots(); steamExe = roots.length ? path.join(roots[0], 'steam.exe') : undefined; }
    if (!steamExe) fail('steam_missing', 'Steam executable was not found; supply steamExe');
    await regular(steamExe);
    if (spec.route === 'game-exe') {
      if (!await checkSteamRunning(steamExe)) fail('steam_not_running', `请先打开 Steam 并登录，再使用${spec.label}。`);
      const executable = path.join(c.root, 'left4dead2.exe');
      const spawned = await launchGame(executable, spec.launchOptions, c.root);
      return { status: 'requested', gameRoot: c.root, appId: 550, executable, ...spec, pid: spawned?.pid };
    }
    // Verify Steam's AppID 550 target before asking it to launch. This avoids launching another library install.
    const installations = await discover({ steamRoots: [path.dirname(path.resolve(steamExe))] });
    if (!installations.games.some((g) => samePath(g.gameRoot, c.root))) fail('steam_target_mismatch', 'Steam AppID 550 does not resolve to the selected gameRoot');
    await launchFile(path.resolve(steamExe), ['-applaunch', '550', ...spec.launchOptions]);
    return { status: 'requested', gameRoot: c.root, appId: 550, ...spec };
  }
  async function launchQuickTest({ gameRoot, testDirectory, map, width, confirmation, steamExe }) {
    requireConfirmation(confirmation); const c = await context(gameRoot); await idle();
    if (typeof testDirectory !== 'string' || !(path.dirname(path.dirname(path.resolve(testDirectory))).toLowerCase() === path.resolve(c.root).toLowerCase() && isFolder(path.dirname(path.resolve(testDirectory)), 'tests')) || !/^[0-9a-f-]{36}$/.test(path.basename(testDirectory))) fail('test_directory_invalid', '测试目录需要由 Matcha 准备。');
    await directory(testDirectory);
    const record = await readJson(path.join(testDirectory, 'session.json'));
    if (record.owner !== 'flare-quick-test' || record.environmentVersion !== 4 || !samePath(record.gameRoot, c.root) || record.preset?.map !== map || record.preset?.width !== width || !/^[a-z0-9_][a-z0-9_-]{0,95}$/i.test(map) || ![960,1280,1600].includes(width)) fail('test_session_invalid', '测试设置已变化，请重新开始测试。');
    await regular(path.join(testDirectory, 'left4dead2', 'gameinfo.txt'));
    await requirePe(path.join(testDirectory, 'left4dead2.exe'), [], false);
    if (!steamExe) { const roots = await windowsSteamRoots(); steamExe = roots.length ? path.join(roots[0], 'steam.exe') : undefined; }
    if (!steamExe) fail('steam_missing', '请先安装并打开 Steam。');
    await regular(steamExe);
    if (!await checkSteamRunning(steamExe)) fail('steam_not_running', '请先打开 Steam 并登录，再开始测试。');
    // D3D9 uses the stock rendering route. The Beacon hook lives in DXVK, selected by -vulkan.
    const args = ['-steam','-insecure','-novid','-windowed','-noborder','-w',String(width),'-h',String(width*9/16),
      '-defaultgamedir','left4dead2','-game','left4dead2','-NoVConfig','-skiploadingworkshopaddons','-nojoy','-condebug','-conclearlog',
      '+sv_lan','1','+sv_cheats','1','+exec','flare_test.cfg','+map',map];
    await idle();
    const spawned = await launchGame(path.join(testDirectory, 'left4dead2.exe'), args, testDirectory);
    return { status:'requested',pid:spawned?.pid,launchOptions:args };
  }
  return { inspectGame, discover, validatePlugin, listPlugins, planInstall, applyInstall, restore, resumeRuntime, recover, installPlugin, updatePlugin, previewPluginMaintenance, applyPluginMaintenance, configureReleaseTrust, setPluginEnabled, runtimeRequest, invokePlugin, launch, launchQuickTest, stopGameProcess: options.stopGameProcess ?? forceStopProcess };
}

const core = createPlatform();
export const { inspectGame, discover, listPlugins, planInstall, applyInstall, restore, resumeRuntime, recover, installPlugin, updatePlugin, previewPluginMaintenance, applyPluginMaintenance, configureReleaseTrust, setPluginEnabled, runtimeRequest, invokePlugin, launch, launchQuickTest, stopGameProcess } = core;
