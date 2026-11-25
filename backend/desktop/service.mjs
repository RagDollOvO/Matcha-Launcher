import { samePath, stamp } from '../mods/files.mjs';
import { Storage } from './storage.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import * as core from '../core.mjs';
import { PiTransport } from '../pi/transport.mjs';
import { PiConfigFiles } from '../pi/config-files.mjs';
import { listSessions, trashSession } from '../pi/session-files.mjs';
import { platformToolCatalog } from '../pi/platform-extension.mjs';
import { ModManager } from '../mods/manager.mjs';
import { ConflictFileIndex } from '../mods/conflicts.mjs';
import { conflictReviewPage, conflictReviewSummaries } from '../mods/conflict-reviews.mjs';
import { displayNames } from '../mods/display-names.mjs';
import { changeTrash, combinedTrash } from '../mods/favorite-trash.mjs';
import { prepareFavorites, migrateFavorites, exportFavoriteVpk } from '../mods/favorite-vault.mjs';
import { prepareFavoriteWrite, favoriteAsset, favoriteSource, linkFavoriteSource, favoriteRefsView, trashThumbnail } from '../mods/favorites.mjs';
import { ModTrash } from '../mods/trash.mjs';
import { TaskManager } from '../mods/tasks.mjs';
import { ModAudio } from '../mods/audio.mjs';
import { steamProfile } from '../steam-profile.mjs';
import { Workshop } from '../mods/workshop.mjs';
import { Bilibili } from '../bilibili.mjs';
import { GameMaps, gameMapsId } from '../mods/gamemaps.mjs';
import { listBrowserArchive } from '../mods/browser-downloads.mjs';
import { regular, identity, readVpk } from '../mods/vpk.mjs';
import { libraryId, workshopId } from '../mods/library.mjs';
import { extractMod } from '../mods/extract.mjs';
import { packModFolder, packSource } from '../mods/pack.mjs';
import { packAndImportMod } from '../mods/imports.mjs';
import { modCommands } from '../mods/commands.mjs';
import { profileViews, missingModsByProfile, applyModProfile, enableNewMods } from '../mods/profiles.mjs';
import { ServerManager } from '../servers/manager.mjs';
import { serverCommands } from '../servers/commands.mjs';
import { savedGameSummary } from '../saved-game-settings.mjs';
import { localL4n } from '../local-render.mjs';
import { l4nLaunchOn, setL4nLaunch } from '../launch-argv.mjs';
import { launchModes, launchSpec } from '../launch.mjs';
import { defaultGameSettings, validateGameSettings, autoexecPath, writeAutoexec } from '../game-settings.mjs';
import { QuickTest } from '../quick-test/manager.mjs';
import { ExternalPlatforms } from '../platforms/manager.mjs';
import { PackRegister } from '../platforms/pack-register.mjs';
import { PackRemoval } from '../platforms/pack-removal.mjs';
import { PlatformLifecycle } from '../platforms/lifecycle.mjs';
import { remoteTarget } from '../platforms/launch.mjs';
import { versionString } from '../platforms/releases.mjs';
import { platformPath, readBytes } from '../platforms/files.mjs';
import { CommunityAcceleration } from '../community/manager.mjs';
import { SdkUpdates, sdkOrigin } from '../platforms/sdk-updates.mjs';
import { allowScreen } from '../platforms/dll-screen.mjs';
import { NativeLibraries } from '../native-libraries.mjs';
import { SettingsCache, checkUpdate } from './settings.mjs';
import channel from './release-channel.json' with { type: 'json' };
import meta from '../package.json' with { type: 'json' };
import { L4nPlugins } from '../l4n-plugins.mjs';
import { dllLoadStatus } from '../dll-status.mjs';
import { DllIntake } from '../dll-intake.mjs';
import { dllHost } from '../pi/dll-host.mjs';
import { serverHost } from '../pi/server-host.mjs';
import { settingsHost } from '../pi/settings-host.mjs';
import { importHost } from '../game-settings-import.mjs';
import { PluginOverlays, mergePluginMetadata } from '../plugin-overlays.mjs';
import { DllSources } from '../dll-sources.mjs';
import { declaredPluginAssets, packageImage } from '../plugin-assets.mjs';
import { modHost } from '../pi/mod-host.mjs';
import { readPermissions, savePermissions } from '../pi/autonomy.mjs';
import { claimDataDir, DEV_DATA, isFolder, migrateLegacyNames } from '../legacy-names.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultProfile = () => ({ id: 'default', name: '默认方案', note: 'Matcha · 原生 DLL 模组', modIds: [], pluginIds: [], launchOptions: '', updatedAt: new Date().toISOString() });
// Legacy desktop selections join the normal route; explicit CLI modes stay compatible.
const desktopMode = mode => mode === 'direct' || mode === 'development' ? 'modded' : mode;
const defaults = () => ({ version: 1, gameRoot: '', profiles: [defaultProfile()], activeProfileId: 'default', categories: [{ id: 'cat-none', name: '未分类', builtin: true }], assignments: {}, modMeta: {}, favoriteCollections: [] });
const fail = (code, message) => { throw new core.PlatformError(code, message); };
const exists = async p => fs.access(p).then(() => true, () => false);
const isQuickTestProcess = (root, process) => {
  if (!process.path || path.basename(process.path).toLowerCase() !== 'left4dead2.exe') return false;
  const session = path.dirname(process.path), folder = path.dirname(session);
  return /^[0-9a-f-]{36}$/.test(path.basename(session)) && isFolder(folder, 'tests') && samePath(path.dirname(folder), root);
};

const defaultDataDir = () => process.env.BEACON_DATA_DIR ?? claimDataDir(DEV_DATA) ?? path.join(projectRoot, DEV_DATA.name);
/**
 * 服务起来之前跑一次：把旧名字（Flare）的数据目录引用和游戏目录里的 .flare-* 文件夹换成 Matcha 的。
 * native 是桌面壳的存储通道（内置浏览器的下载记录在桌面壳那边）。失败不挡启动，旧名字照样能用。
 */
export async function prepareDataDir({ dataDir = defaultDataDir(), native, discover = core.discover } = {}) {
  if (process.env.MATCHA_CHANNEL === 'beta') return {dataDir:null,renamed:[],failed:[]};
  let gameRoot = '';
  try { gameRoot = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8')).gameRoot || ''; } catch {}
  if (!gameRoot) gameRoot = (await discover().catch(() => null))?.games?.[0]?.gameRoot ?? '';
  const result = await migrateLegacyNames({ dataDir, gameRoot,
    patchBrowser: native ? (rowId, oldPath, patch) => native('patch', { rowId, oldPath, patch }) : undefined });
  logRename(result);
  return result;
}
function logRename(r) {
  const lines = [...(r.dataDir ? ['  ' + r.dataDir.from + ' -> ' + r.dataDir.to] : []), ...r.renamed.map(x => '  ' + x.from + ' -> ' + x.to),
    ...r.failed.map(x => '  没改成（下次再试）' + x.folder + ': ' + x.message)];
  if (lines.length) console.error('[' + new Date().toISOString() + '] Matcha 改名\n' + lines.join('\n'));
}

/** One capability service for the Tauri JSONL child and Vite development adapter. */
export class DesktopService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.core = options.core ?? core;
    this.externalPlatforms = new ExternalPlatforms({ getModules: options.getPlatformModules });
    this.modManager = new ModManager({ inspectGame: root => this.core.inspectGame(root),
      displayNames: root => displayNames(this.settings, root),
      workshopThumbnail: id => this.workshop.preview(id, { requestId: randomUUID() }) });
    this.modTrash = new ModTrash(this.modManager, this);
    this.dataDir = options.dataDir ?? defaultDataDir();
    this.packRegister = new PackRegister(this.dataDir, this.externalPlatforms);
    this.packRemoval = new PackRemoval(this);
    this.community = new CommunityAcceleration({ dataDir: this.dataDir, supported: options.communityDesktop === true && process.platform === 'win32',
      emit: event => this.emit('event', event) });
    this.platformLifecycle = new PlatformLifecycle({ dataDir: this.dataDir, readOnly: this.externalPlatforms,
      inspectGame: root => this.core.inspectGame(root), fetch: options.platformFetch, beforeWrite: options.platformBeforeWrite });
    this.externalPlatforms.managed = this.platformLifecycle;
    this.serverManager = new ServerManager({ dataDir: this.dataDir, query: options.queryServer, readFriends: options.readFriends });
    this.serverCommands = serverCommands(this.serverManager, () => this.emit('event', { type: 'servers_changed' }));
    this.quickTest = new QuickTest({ manager: this.modManager, core: this.core, dataDir: this.dataDir });
    this.distRoot = options.distRoot ?? path.join(projectRoot, 'native/build-x86/dist');
    this.nativeLibraries = new NativeLibraries({ dataDir: this.dataDir, inspectGame: root => this.core.inspectGame(root), distRoot: this.distRoot, vendorRoot: options.vendorRoot, fetch: options.nativeFetch ?? ((...args)=>this.workshop.fetch(...args)) });
    this.l4nPlugins = new L4nPlugins({ dataDir: this.dataDir, inspectGame: root => this.core.inspectGame(root) });
    this.dllIntake = new DllIntake({ dataDir: this.dataDir });
    this.dllImportPlans = new Map();
    this.pluginOverlays = new PluginOverlays(this.dataDir);
    this.dllOverlayPlans = new Map(); this.dllMetadataIssues = new Map();
    this.audio = new ModAudio(this.modManager, options.audioExecutable ?? path.join(projectRoot, 'native/build-x86/dist/tools/flare_audio.exe'));
    this.workshop = new Workshop(this.modManager, { fetch: options.workshopFetch, community: this.community });
    this.dllSources = new DllSources({ dataDir: this.dataDir, fetch: options.dllSourceFetch ?? this.workshop.fetch, workshop: this.workshop });
    this.sdkUpdates = new SdkUpdates(this.dataDir,this.dllSources,()=>this.emit('event',{type:'objects_changed'}));
    this.bilibili = new Bilibili({ dataDir: this.dataDir, fetch: options.bilibiliFetch });
    this.gamemaps = new GameMaps({ dataDir: this.dataDir, browser: options.gamemapsBrowser, fetch: options.gamemapsFetch });
    this.desktopDir = options.desktopDir ?? process.env.FLARE_DESKTOP_DIR;
    this.tasks = new TaskManager({ dataDir: this.dataDir, emit: event => {
      this.emit('event', event);
      if (event.type === 'task_progress' && ['done', 'failed'].includes(event.state) && (['download', 'pack'].includes(event.kind) || event.kind.startsWith('platform-'))) this.emit('event', { type: 'objects_changed' });
    }, run: (kind, request, ctx) => this.runTask(kind, request, ctx) });
    this.createPi = options.createPi ?? (config => new PiTransport(config));
    this.piConfigDir = options.piConfigDir ?? path.join(this.dataDir, 'pi');
    this.piSessionDir = options.piSessionDir ?? path.join(this.piConfigDir, 'sessions');
    this.piFiles = new PiConfigFiles(this.piConfigDir, options.piEnv ?? process.env);
    this.settingsCache = new SettingsCache(this);
    this.appVersion = process.env.MATCHA_APP_VERSION || meta.version;
    this.updateRepository = options.updateRepository ?? process.env.MATCHA_UPDATE_REPOSITORY ?? channel.repository;
    this.pluginMaintenancePlans = new Map();
    this.settingsFile = path.join(this.dataDir, 'settings.json');
    this.launchFile = path.join(this.dataDir, 'launch.json');
    this.launchMode = 'modded';
    this.settings = defaults();
    this.queue = Promise.resolve();
    this.piQueue = Promise.resolve();
    this.plans = new Map();
    this.pi = null;
    this.piBusy = false;
    this.storageOps=0;this.storage=new Storage(this,options.storageNative);
    this.gamemaps.deleteArchives=()=>this.storage.cfg.deleteArchivesAfterImport;
    this.ready = this.load().then(()=>migrateFavorites(this)).then(async()=>{try{await this.storage.load()}catch(e){this.storage.error=e;this.emit('event',{type:'bridge_fault',error:core.errorRecord(e)})}});
    this.sdkTimer=setInterval(()=>{void this.ready.then(()=>this.sdkTargets()).then(ts=>this.sdkUpdates.check(ts)).catch(e=>this.emit('event',{type:'bridge_fault',error:core.errorRecord(e)}));},86400000);
    this.sdkTimer.unref();
  }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.settingsFile, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.profiles) || !saved.profiles.length) fail('settings_invalid', 'Matcha 设置文件格式需要检查；原文件已保留。');
      this.settings = { ...defaults(), ...saved };
      this.settings.profiles = this.settings.profiles.map(p => p.note === 'Beacon · 原生模组平台' ? { ...p, note: 'Matcha · 原生 DLL 模组' } : p);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    try {
      const saved = JSON.parse(await fs.readFile(this.launchFile, 'utf8'));
      if (saved.version !== 1 || !launchModes.includes(saved.mode)) fail('launch_settings_invalid', '启动设置格式需要检查；原文件已保留。');
      this.launchMode = launchSpec(desktopMode(saved.mode)).mode;
      if (this.launchMode !== saved.mode) await this.saveLaunchMode(this.launchMode);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async saveLaunchMode(mode) {
    if (!launchModes.includes(mode)) fail('launch_mode_invalid', '请选择有效的游戏启动方式。');
    const spec = launchSpec(desktopMode(mode), undefined, this.gameSettings());
    await fs.mkdir(this.dataDir, { recursive: true });
    const staging = `${this.launchFile}.${process.pid}.tmp`;
    try {
      await fs.writeFile(staging, JSON.stringify({ version: 1, mode: spec.mode }, null, 2), { flag: 'wx' });
      await fs.rename(staging, this.launchFile);
    } catch (e) { await fs.unlink(staging).catch(() => {}); throw e; }
    this.launchMode = spec.mode;
    return spec;
  }
  prepareFavorites(next) { return prepareFavorites(this,next); }
  async save(next) {
    const favorites = await prepareFavoriteWrite(this, next);
    next = favorites.next;
    await fs.mkdir(this.dataDir, { recursive: true });
    const staging = `${this.settingsFile}.${randomUUID()}.tmp`;
    try {
      const h = await fs.open(staging, 'wx');
      try { await h.writeFile(JSON.stringify(next, null, 2)); await h.sync(); } finally { await h.close(); }
      await fs.rename(staging, this.settingsFile);
    } catch (e) {
      await favorites.discardNewVersions();
      throw e;
    } finally { await fs.unlink(staging).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    this.settings = next;
    await favorites.discardRetiredVersions().catch(e => this.emit('event', { type: 'bridge_fault', error: core.errorRecord(e) }));
  }
  async root() {
    if (this.settings.gameRoot) return this.settings.gameRoot;
    const result = await this.core.discover();
    return result.games[0]?.gameRoot ?? '';
  }
  async trashEntries(root){return combinedTrash(this.settings,root?await this.modTrash.list(root):[]);}
  changeTrash(op,ids,confirmation,root){return changeTrash(this,op,ids,confirmation,root);}
  gameSettings() { return validateGameSettings(this.settings.gameSettings ?? defaultGameSettings()); }
  async gameSettingsReply() {
    const settings = this.gameSettings(), root = await this.root();
    return { ...settings, effective: Object.fromEntries(launchModes.map(mode => [mode, launchSpec(mode, undefined, settings).launchOptions])),
      ...(root ? { autoexecPath: autoexecPath(root) } : {}) };
  }
  async applyGameSettings(gameRoot, beforeLaunch = false) {
    // Existing callers without saved game settings retain their original file behavior.
    if (!gameRoot || !this.settings.gameSettings) return;
    const result = await writeAutoexec(gameRoot, this.gameSettings().autoexec,
      async () => !(await this.core.inspectGame(gameRoot)).processes.length);
    if (beforeLaunch && result.pending) fail('game_running', '请先退出游戏，再应用配置并启动。');
  }
  /** 页面保存和茶茶确认后的保存共用：先校验最终参数，再存设置，最后写 autoexec 管理段 */
  async commitGameSettings(value) {
    const gameSettings = validateGameSettings(value);
    // Validate the merged argv before committing any settings or game file.
    launchSpec(this.launchMode === 'clean' ? 'modded' : this.launchMode, undefined, gameSettings);
    await this.save({ ...this.settings, gameSettings });
    try { await this.applyGameSettings(await this.root()); }
    catch (e) { e.details = { ...e.details, saved: true }; throw e; }
    return this.gameSettingsReply();
  }
  /**
   * 界面偏好只存在前端，请主窗口代办：发 ui_request 事件，等它用 ui-response 回执。
   * 主窗口没开、刷新中或在弹确认框时可能等不到，超时后报 ui_unavailable。
   */
  uiRequest(action, payload = {}, timeoutMs = 5000) {
    this.uiPending ??= new Map();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.uiPending.delete(requestId);
        reject(Object.assign(new Error('启动器界面没响应，请确认 Matcha 主窗口开着后再试。'), { code: 'ui_unavailable' }));
      }, timeoutMs);
      this.uiPending.set(requestId, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); },
      });
      this.emit('event', { type: 'ui_request', requestId, action, ...payload });
    });
  }
  /** 主窗口替茶茶读写界面偏好后的回执（ui_request 的另一半） */
  uiResponse(p = {}) {
    const id = String(p.requestId ?? ''), waiting = this.uiPending?.get(id);
    if (!waiting) return { status: 'expired' };
    this.uiPending.delete(id);
    if (p.ok === true) waiting.resolve(p.value ?? null);
    else waiting.reject(Object.assign(new Error(p.error?.message ?? '启动器界面没有完成这次请求。'), { code: p.error?.code ?? 'ui_request_failed', ...(p.error?.details !== undefined ? { details: p.error.details } : {}) }));
    return { status: 'received' };
  }
  async requireRoot() {
    const root = await this.root();
    if (!root) fail('game_root_required', '请先安装 L4D2，或选择完整的游戏目录。');
    return root;
  }
  profileViews(mods) { return profileViews(this.settings.profiles, mods); }
  applyModProfile(id, confirmation) { return applyModProfile(this, id, confirmation); }
  enableNewMods(gameRoot, ids) { return enableNewMods(this, gameRoot, ids); }
  favoriteAsset(id) { return favoriteAsset(this, id); }
  favoriteSource(id, file) { return favoriteSource(this, id, file); }
  linkFavoriteSource(id, file, gameRoot, modId) { return linkFavoriteSource(this, id, file, gameRoot, modId); }
  async bundledPlugins() {
    const root = path.join(this.distRoot, 'bin/l4p/plugins');
    const dirs = await fs.readdir(root, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const result = [];
    for (const dir of dirs.filter(d => d.isDirectory() && !d.isSymbolicLink())) {
      const manifestFile = await platformPath(root, `${dir.name}/manifest.json`);
      const dll = await platformPath(root, `${dir.name}/plugin.dll`);
      if (!manifestFile || !dll) continue;
      const m = core.validateManifest(JSON.parse((await readBytes(manifestFile)).toString('utf8')));
      if (m.id !== dir.name) fail('invalid_manifest', '随附模组目录与 ID 不一致。');
      if (/^(beacon\.|skeeto\.|demo\.hello$)/.test(m.id)) continue;
      result.push({ ...m, file: m.entry, author: m.author ?? m.developer?.author ?? '', description: m.description ?? '', api: String(m.apiVersion),
        installed: false, packageDirectory: path.join(root, dir.name), enabled: false, host: 'flare', loadOrder: -1, runtimeState: 'available',
        loadStatus: dllLoadStatus({ installed: false }), verification: { state: 'unverified' } });
    }
    return result;
  }
  async l4nPluginSnapshot() {
    const root = await this.requireRoot(), inspection = await this.core.inspectGame(root);
    const process = inspection.processes.find(p => p.path && samePath(p.path, path.join(root, 'left4dead2.exe')));
    let runtime, issue;
    if (process && inspection.platform.status === 'installed') {
      try { runtime = (await this.core.runtimeRequest(process.pid, { type: 'status' }, { timeoutMs: 1200 })).result; }
      catch (e) { issue = core.errorRecord(e); }
    }
    const result = await this.l4nPlugins.snapshot(root, { inspection, runtime });
    if (issue) result.issues.push(issue);
    return result;
  }
  async dllPolicy() {
    const root = await this.root();
    return root ? path.join(root, 'bin/l4p/release-trust.json') : undefined;
  }
  async inspectDllIntake(file, signal) { return this.dllIntake.inspect(file, { policyPath: await this.dllPolicy(), signal }); }
  async prepareDllIntake(params, signal) {
    let updateTarget;
    if (params.updatePluginId !== undefined) {
      if (params.mode !== 'library' || typeof params.updatePluginId !== 'string' || !params.updatePluginId)
        fail('dll_update_target_invalid', '普通 DLL 更新需要 library 模式和清单中的已安装模组 ID。');
      const gameRoot = await this.requireRoot();
      const previous = (await this.core.listPlugins(gameRoot)).find(p => p.manifest.id === params.updatePluginId);
      if (!previous) fail('plugin_missing', '更新目标已移除，请重新查询 DLL 清单。');
      if (previous.manifest.loadKind !== 'library') fail('dll_update_target_invalid', '请为普通 DLL 选择整体加载模组；SDK 更新沿用作者的同 ID 发行包。');
      const file = await platformPath(previous.directory, '.l4p-package.json');
      if (!file) fail('plugin_unowned', '更新目标缺少 Matcha 安装记录，请先核对目录归属。');
      const marker = JSON.parse((await readBytes(file)).toString('utf8'));
      if (marker.platform !== 'l4p' || marker.pluginId !== params.updatePluginId) fail('plugin_unowned', '更新目标的安装记录与模组身份有变化。');
      const source = (await this.pluginOverlays.all())[params.updatePluginId]?.source;
      updateTarget = { id: params.updatePluginId, gameRoot, manifest: previous.manifest, marker, sourceVersion: source?.version ?? null };
    }
    return this.dllIntake.prepare(params.intakeId, params, { policyPath: await this.dllPolicy(), signal, updateTarget });
  }
  decoratePlugin(raw, overlay, issues) {
    if (raw.id === 'flare.game-ui' && /^(?:Matcha |Flare )?游戏内设置服务$/.test(raw.name)) raw = { ...raw, name: '抹茶模组设置' };
    try { return mergePluginMetadata(raw, overlay); }
    catch (e) { issues?.push({ ...core.errorRecord(e), pluginId: raw.id }); return mergePluginMetadata(raw); }
  }
  async pluginRecord(id) {
    const root = await this.root();
    if (root) {
      const game = await this.core.inspectGame(root);
      if (!['absent', 'unowned'].includes(game.platform.status)) {
        const found = (await this.core.listPlugins(root)).find(p => p.manifest.id === id);
        if (found) return { raw: { ...found.manifest, host: 'flare' }, directory: path.join(root, 'bin/l4p/plugins', id) };
      }
      if (typeof id === 'string' && id.startsWith('l4n.')) {
        const found = (await this.l4nPlugins.snapshot(root, { inspection: game })).plugins.find(p => p.id === id);
        if (found) return { raw: found, directory: path.join(root, 'bin/neko/plugins') };
      }
    }
    const bundled = (await this.bundledPlugins()).find(p => p.id === id);
    if (bundled) return { raw: { ...bundled, host: 'flare' }, directory: bundled.packageDirectory };
    fail('plugin_missing', '请刷新模组列表，或先完成导入。');
  }
  async sourceFetch(params, signal) {
    if (params.type !== 'local') return this.dllSources.inspect(params, signal);
    const intake = await this.inspectDllIntake(params.path, signal);
    return { ...await this.dllIntake.details(intake.intakeId), source: { type: 'local', label: path.basename(params.path) } };
  }
  async sourceDownload(planId, confirmation, signal) {
    const downloaded = await this.dllSources.download(planId, confirmation, signal);
    if (downloaded.image) return downloaded;
    const intake = await this.inspectDllIntake(downloaded.file, signal);
    await this.dllIntake.origin(intake.intakeId, downloaded.source, downloaded.publisher);
    return { ...downloaded, intake: await this.dllIntake.details(intake.intakeId) };
  }
  async overlayInput(raw, params, signal) {
    const input = { fields: params.fields ?? {}, basis: params.basis };
    if (params.sourceId || params.source) {
      let observed;
      if (params.sourceId) observed = this.dllSources.row(params.sourceId);
      else if (params.source.type === 'local') input.source = params.source;
      else { const fetched = await this.dllSources.inspect(params.source, signal); observed = this.dllSources.row(fetched.sourceId); }
      if (observed) {
        const stored = (await this.pluginOverlays.all())[raw.id]?.source;
        input.source = { ...observed.source };
        if (stored?.type === input.source.type && stored.url === input.source.url) {
          if (stored.version) input.source.version = stored.version; else delete input.source.version;
          if (Date.parse(stored.checkedAt) > Date.parse(input.source.checkedAt)) {
            input.source.latest = stored.latest; input.source.checkedAt = stored.checkedAt;
          }
        } else if (params.source?.version) {
          if (![observed.source.version, raw.version].includes(params.source.version)) fail('source_version', '接入版本需要与作者发行记录或实际 SDK 版本一致。');
          input.source.version = params.source.version;
        } else if (observed.source.type === 'github' && raw.loadKind !== 'library' && raw.version) input.source.version = raw.version;
        input.publisher = observed.publisher;
      }
    }
    return input;
  }
  async previewDllOverlay(params, signal) {
    const plugin = await this.pluginRecord(params.id), input = await this.overlayInput(plugin.raw, params, signal);
    const planned = await this.pluginOverlays.plan(plugin.raw, plugin.directory, input);
    const planId = randomUUID();
    this.dllOverlayPlans.set(planId, { id: params.id, root: await this.root(), input, expected: planned.expected, at: Date.now() });
    if (this.dllOverlayPlans.size > 30) this.dllOverlayPlans.delete(this.dllOverlayPlans.keys().next().value);
    return { planId, id: params.id, name: plugin.raw.name, changes: planned.changes, source: planned.source,
      previousSource: planned.previousSource, sourceChanged: planned.sourceChanged, basis: planned.basis,
      publisher: input.publisher, previousPublisher: (await this.pluginOverlays.all())[params.id]?.publisher };
  }
  async applyDllOverlay(planId, confirmation) {
    this.confirm(confirmation);
    const plan = this.dllOverlayPlans.get(planId), root = await this.root();
    if (!plan || Date.now() - plan.at > 15 * 60 * 1000 || !!(plan.root || root) && !samePath(plan.root, root)) fail('metadata_stale', '请重新检查整理资料并确认。');
    const plugin = await this.pluginRecord(plan.id);
    const result = await this.pluginOverlays.save(plugin.raw, plugin.directory, plan.input, 'agent', confirmation, plan.expected);
    if (plan.input.source) this.dllMetadataIssues.delete(plan.id);
    this.dllOverlayPlans.delete(planId); this.emit('event', { type: 'objects_changed' }); return result;
  }
  async recordDllSource(params, signal) {
    await this.pluginRecord(params.id);
    const stored = (await this.pluginOverlays.all())[params.id];
    if (!stored?.source || stored.source.type === 'local') fail('source_missing', '请先确认这个模组的远端来源。');
    const view = params.sourceId ? { sourceId: params.sourceId } : await this.dllSources.inspect({ ...stored.source, refresh: true }, signal);
    const observed = this.dllSources.row(view.sourceId);
    if (params.latest !== undefined && !isDeepStrictEqual(params.latest, observed.source.latest)) fail('source_stale', '版本记录与当前来源检查结果有变化，请重新读取。');
    const result = await this.pluginOverlays.checked(params.id, observed);
    this.emit('event', { type: 'objects_changed' }); return result;
  }
  async attachDllMetadata(result, candidate, fallbackDirectory) {
    if (candidate) try { await this.settingsCache.imported(candidate); }
    catch { /* The completed installation stays usable. Unclassified staging stays on disk. */ }
    const id = result.id ?? result.pluginId;
    try {
      const plugin = await this.pluginRecord(id), current = (await this.pluginOverlays.all())[id];
      const declared=sdkOrigin(plugin.raw);
      const source = candidate?.record.sourceContext?.source ?? ((!current?.source || current.source.type==='local') && declared ? declared : undefined) ?? (!current?.source || current.source.type === 'local'
        ? { type: 'local', label: path.basename(candidate?.record.source ?? fallbackDirectory) } : undefined);
      const publisher = candidate?.record.sourceContext?.publisher;
      if (source && current?.source && current.source.type!=='local' && (current.source.type !== source.type || current.source.url !== source.url ||
        current.publisher && publisher && !isDeepStrictEqual(current.publisher, publisher)))
        fail('source_changed', '模组已导入；来源仓库或发布者有变化，请由 Agent 单独确认资料来源。');
      await this.pluginOverlays.attach(plugin.raw, { source, publisher, generated: candidate ? candidate.generatedMetadata === true : undefined });
      this.dllMetadataIssues.delete(id); return result;
    } catch (e) {
      this.dllMetadataIssues.set(id, core.errorRecord(e));
      return { ...result, metadataWarning: core.errorRecord(e) };
    }
  }
  async sdkTargets() {
    const root=await this.root(); if(!root)return [];
    const inspection=await this.core.inspectGame(root); if(['absent','unowned'].includes(inspection.platform.status))return [];
    return this.sdkUpdates.targets(root,await this.core.listPlugins(root),await this.pluginOverlays.all());
  }
  assertDownloadFree(sourceId) {
    if(this.tasks.list().some(t=>t.sourceId===sourceId&&!['done','failed','canceled'].includes(t.state)))fail('task_duplicate','这个组件已经有下载任务。');
  }
  async queueSdkUpdate(id) {
    const target=(await this.sdkTargets()).find(t=>t.id===id);await this.sdkUpdates.load();
    const offer=target && this.sdkUpdates.rows[target.key]?.offer;
    if(!offer)fail('source_missing','请先检查这个 SDK 模组的新版。');
    if(!offer.asset)fail('plugin_needs_agent','发行版没有唯一匹配的成品 ZIP，请让茶茶核对附件。');
    if(offer.update.signer==='changed'||offer.update.signer==='unsigned'&&target.verification?.certificateSha256)fail('plugin_signer_changed','新版签名有变化，请让茶茶核对。');
    const sourceId='plugin:'+id;this.assertDownloadFree(sourceId);
    return this.tasks.create('platform-download',{sourceId,id,gameRoot:await this.requireRoot(),key:target.key,tag:offer.tag,asset:offer.asset},'下载 '+id+' '+offer.update.version);
  }
  async fetchSdkUpdate(req,ctx) {
    const t=(await this.sdkTargets()).find(t=>t.key===req.key && t.id===req.id);
    await this.sdkUpdates.load();const offer=t&&this.sdkUpdates.rows[t.key]?.offer;
    if(!offer || offer.tag!==req.tag || !isDeepStrictEqual(offer.asset,req.asset))fail('source_stale','模组或发行附件已变化，请重新检查。');
    const github=t.source.type==='github',remote=await this.dllSources.inspect({type:t.source.type,url:github?t.source.url+'/releases/tag/'+encodeURIComponent(req.tag):t.source.url,refresh:true},ctx.signal);
    if(t.publisher&&!isDeepStrictEqual(remote.publisher,t.publisher))fail('source_changed','发布者身份已变化，请先核对来源。');
    const asset=remote.assets.find(a=>a.id===req.asset.id && a.name===req.asset.name && a.size===req.asset.size && (a.digest??null)===(req.asset.digest??null));
    if(!asset || remote.source.version!==req.tag)fail('source_stale','发行记录与检查时不同，请重新检查。');
    const plan=this.dllSources.preview({sourceId:remote.sourceId,assetId:asset.id});
    const file=await this.dllSources.download(plan.planId,{source:'user',approved:true},ctx.signal,ctx.progress);
    return ctx.commit(async()=>{
      const intake=await this.inspectDllIntake(file.file,ctx.signal);
      const previous=t.verification?.certificateSha256;
      let signer='unknown';
      if(intake.outcome==='sdk-ready'){
        if(intake.manifest.id!==req.id||intake.manifest.loadKind==='library'||(github?intake.manifest.version!==offer.update.version:intake.manifest.version.localeCompare(t.version,'en',{numeric:true})<=0))
          fail('dll_update_target_invalid','附件内的模组 ID 或版本与更新目标不符。');
        const {verification}=await core.validatePlugin(intake.preparedDirectory,{policyPath:await this.dllPolicy()});
        signer=verification.signature==='absent'?'unsigned':previous?(previous===verification.certificateSha256?'same':'changed'):'unknown';
      } else if(previous && intake.issues.some(i=>i.message.includes('release_signer_untrusted')))signer='changed';
      await this.sdkUpdates.actual(t,signer,asset.id);
      if(signer==='changed'||previous&&signer==='unsigned')fail('plugin_signer_changed','实际发行包的签名已变化，请让茶茶核对。');
      if(!(await this.sdkTargets()).some(now=>now.key===t.key))fail('source_stale','下载期间更新目标已变化，请重新检查。');
      await this.dllIntake.origin(intake.intakeId,remote.source,remote.publisher,req.id,{root:req.gameRoot,version:t.version,signer:previous??null,tag:github?offer.update.version:null});
      return {intakeId:intake.intakeId};
    });
  }
  async screenDll({pluginId,intakeId}) {
    if(!!pluginId===!!intakeId)fail('invalid_argument','请选择一个模组或暂存记录。');
    const policy=await this.dllPolicy();
    if(intakeId)return this.dllIntake.rescreen(intakeId,policy);
    const root=await this.root(), p=root && (await this.core.listPlugins(root)).find(p=>p.manifest.id===pluginId);
    if(p)return this.dllIntake.screening(p.directory,policy,p.verification,true);
    const b=(await this.bundledPlugins()).find(p=>p.id===pluginId);
    if(!b)fail('plugin_missing','请选择 Matcha DLL 模组。');
    return this.dllIntake.screening(b.packageDirectory,policy,undefined,true);
  }
  stageCheck(expected) {
    return async (p,policy)=>{
      const actual=await this.dllIntake.screening(p.directory,policy,p.verification,true);
      allowScreen(actual);
      if(expected && !isDeepStrictEqual(actual.files,expected.files))fail('intake_stale','确认后 DLL 文件已变化，请重新预览。');
    };
  }
  async previewDllImport({ intakeId, candidateId }) {
    const candidate = await this.dllIntake.candidate(intakeId, candidateId), gameRoot = await this.requireRoot();
    const inspection = await this.core.inspectGame(gameRoot);
    if (inspection.processes.length) fail('game_running', '请先退出游戏，再导入 DLL 模组。');
    if (candidate.host === 'flare' && inspection.platform.status !== 'installed') fail('runtime_required', '请先部署 Matcha 加载器，再导入 SDK 或整体 DLL 包。');
    let l4nPlan, validation, previous, expectedInstalled;
    if (candidate.updateTarget && !samePath(candidate.updateTarget.gameRoot, gameRoot))
      fail('context_changed', '这个更新候选属于另一游戏目录，请在当前目录重新选择更新目标。');
    if (candidate.host === 'l4n') l4nPlan = await this.l4nPlugins.preview(gameRoot,
      { operation: 'import', file: path.join(candidate.directory, candidate.files[0].path) });
    else {
      validation = await core.validatePlugin(candidate.directory, { policyPath: await this.dllPolicy() });
      previous = (await this.core.listPlugins(gameRoot)).find(p => p.manifest.id === validation.manifest.id);
      if (candidate.updateTarget && (!previous || validation.manifest.id !== candidate.updateTarget.id))
        fail('dll_update_target_invalid', '更新目标已移除或身份有变化，请重新查询 DLL 清单并整理更新包。');
      if (previous) {
        const marker = await platformPath(previous.directory, '.l4p-package.json');
        if (!marker) fail('plugin_unowned', '已存在的同 ID 模组缺少安装记录，请先核对目录归属。');
        expectedInstalled = { version: previous.manifest.version, enabled: previous.enabled,
          marker: JSON.parse((await readBytes(marker)).toString('utf8')) };
        if (candidate.updateTarget && (previous.manifest.version !== candidate.updateTarget.manifest.version ||
          !isDeepStrictEqual(expectedInstalled.marker, candidate.updateTarget.marker)))
          fail('plugin_update_stale', '更新目标在暂存整理后已有变化，请重新查询并整理更新包。');
      }
    }
    const screening=await this.dllIntake.screening(candidate.directory,await this.dllPolicy(),validation?.verification,true);
    if(candidate.record.screening)allowScreen(candidate.record.screening);
    if(candidate.record.updatePluginId && (previous?.manifest.id!==candidate.record.updatePluginId || !previous))fail('dll_update_target_invalid','更新目标已变化，请重新选择。');
    const from=candidate.record.sdkUpdate;
    if(from && (!samePath(from.root,gameRoot)||previous.manifest.version!==from.version || (previous.verification?.certificateSha256??null)!==from.signer ||
      from.signer && validation?.verification?.certificateSha256!==from.signer || from.tag && validation?.manifest.version!==from.tag))
      fail('plugin_update_stale','版本、签名或游戏目录已变化，请重新核对。');
    const planId = randomUUID(), plan = { screening,intakeId, candidateId, gameRoot, host: candidate.host,
      name: validation?.manifest.name ?? candidate.files[0].path,
      pluginId: validation?.manifest.id ?? l4nPlan?.plugin.id, operation: previous ? 'update' : 'install', version: validation?.manifest.version ?? null,
      previousVersion: previous?.manifest.version ?? null, enabled: previous?.enabled ?? false, expectedInstalled,
      sourceVersion: candidate.record.sourceContext?.source.version ?? null, previousSourceVersion: candidate.updateTarget?.sourceVersion ?? null,
      files: candidate.files.map(({ path, bytes }) => ({ path, bytes })), at: Date.now(), l4nPlanId: l4nPlan?.planId };
    this.dllImportPlans.set(planId, plan);
    if (this.dllImportPlans.size > 30) this.dllImportPlans.delete(this.dllImportPlans.keys().next().value);
    return { planId, gameRoot, host: plan.host, name: plan.name, files: plan.files, pluginId: plan.pluginId,
      screening, operation: plan.operation, version: plan.version, previousVersion: plan.previousVersion, enabled: plan.enabled,
      sourceVersion: plan.sourceVersion, previousSourceVersion: plan.previousSourceVersion, verification: validation?.verification };
  }
  async applyDllImport(planId, confirmation) {
    this.confirm(confirmation);
    const plan = this.dllImportPlans.get(planId), root = await this.requireRoot();
    if (!plan || Date.now() - plan.at > 15 * 60 * 1000 || !samePath(root, plan.gameRoot)) fail('intake_stale', '请重新检查整理结果并确认。');
    const candidate = await this.dllIntake.candidate(plan.intakeId, plan.candidateId);
    allowScreen(plan.screening);allowScreen(await this.dllIntake.screening(candidate.directory,await this.dllPolicy(),undefined,true));
    const result = plan.host === 'l4n' ? await this.l4nPlugins.apply(root, plan.l4nPlanId, confirmation)
      : plan.operation === 'update' ? await this.core.updatePlugin({ gameRoot: root, pluginDirectory: candidate.directory, confirmation, checkStage:this.stageCheck(plan.screening), expectedInstalled: plan.expectedInstalled, previousSourceVersion: (await this.pluginOverlays.all())[plan.pluginId]?.source?.version })
      : await this.core.installPlugin({ gameRoot: root, pluginDirectory: candidate.directory, confirmation, checkStage:this.stageCheck(plan.screening) });
    const attached = await this.attachDllMetadata(result, candidate, candidate.directory);
    this.dllImportPlans.delete(planId); this.emit('event', { type: 'objects_changed' });
    return { ...attached, intakeId: plan.intakeId, host: plan.host, operation: plan.operation, enabled: attached.enabled ?? plan.enabled };
  }
  /** DLL page and Agent queries share the effective metadata and runtime evidence. */
  async dllSnapshot(root, inspection, issues = []) {
    for (const [pluginId, error] of this.dllMetadataIssues) issues.push({ ...error, pluginId });
    let overlays = {};
    try { overlays = await this.pluginOverlays.all(); } catch (e) { issues.push(core.errorRecord(e)); }
    const normalProcess = inspection?.processes.find(p => p.path && samePath(p.path, path.join(root, 'left4dead2.exe')));
    let inventory = [], runtime = null;
    if (inspection && !['absent', 'unowned'].includes(inspection.platform.status)) {
      try { inventory = await this.core.listPlugins(root, { includeConfig: true }); }
      catch (e) { issues.push(core.errorRecord(e)); }
    }
    if (normalProcess && inspection.platform.status === 'installed') {
      try { runtime = (await this.core.runtimeRequest(normalProcess.pid, { type: 'status' }, { timeoutMs: 1200 })).result; }
      catch (e) { issues.push(core.errorRecord(e)); }
    }
    const includeL4n=l4nLaunchOn(this.gameSettings().extraArgs), modded=this.launchMode!=='clean';
    const plugins = inventory.filter(p => !/^(beacon\.|skeeto\.|demo\.hello$)/.test(p.manifest.id)).map(p => {
      const m = p.manifest, observed = runtime?.plugins.find(x => x.id === m.id);
      const loadStatus = dllLoadStatus({ enabled: p.enabled, loadKind: m.loadKind ?? 'sdk', observed,
        running: !!normalProcess, connected: !!runtime, hostEnabled: modded && inspection.platform.status === 'installed' && (inspection.platform.host!=='l4n' || includeL4n), error: p.verification?.error });
        return this.decoratePlugin({ ...m, file: m.entry, author: m.author ?? m.developer?.author ?? '', description: m.description ?? '', api: String(m.apiVersion),
          verification: p.verification, runtimeVerification: observed?.verification, savedConfig: p.savedConfig, configError: p.configError?.message,
          installed: true, managed: p.managed, canRollback:p.canRollback, enabled: p.enabled, host: 'flare', loadOrder: p.loadOrder, loadStatus,
          runtimeState: observed?.state === 'initialized' && m.loadKind === 'library' ? 'loaded' : observed?.state ?? 'unobserved',
          error: observed?.error ?? p.verification?.error?.message }, overlays[m.id], issues);
    });
    const policy=root?path.join(root,'bin/l4p/release-trust.json'):undefined;
    for(const p of plugins){
      const r=inventory.find(row=>row.manifest.id===p.id);
      try{p.screening=await this.dllIntake.screening(r.directory,policy,r.verification);}catch(e){issues.push({...core.errorRecord(e),pluginId:p.id});}
    }
    try {
      await this.sdkUpdates.load();
      const targets=this.sdkUpdates.targets(root,inventory,overlays);
      for(const t of targets){const p=plugins.find(p=>p.id===t.id),r=this.sdkUpdates.rows[t.key];if(p){p.update=r?.offer?.update??null;if(r?.error)issues.push({pluginId:p.id,code:'sdk_updates',message:r.error});}}
      if(targets.some(t=>!(this.sdkUpdates.rows[t.key]?.next>Date.now())))void this.sdkUpdates.check(targets).catch(()=>{});
    }catch(e){issues.push(core.errorRecord(e));}
    let nativeLibraries;
    try { nativeLibraries = await this.nativeLibraries.snapshot(root, inspection); }
    catch (e) { issues.push(core.errorRecord(e)); }
    if(nativeLibraries) nativeLibraries.l4n.launchEnabled=nativeLibraries.l4n.enabled && includeL4n;
    let l4nPlugins = { hostEnabled: false, pending: false, plugins: [], issues: [] };
    if (inspection) try { l4nPlugins = await this.l4nPlugins.snapshot(root, { inspection, runtime, host: nativeLibraries && {enabled:modded && nativeLibraries.l4n.launchEnabled} }); }
    catch (e) { issues.push(core.errorRecord(e)); }
    l4nPlugins.plugins = l4nPlugins.plugins.map(p => this.decoratePlugin(p, overlays[p.id], issues));
    let availablePlugins = [];
    try { availablePlugins = (await this.bundledPlugins()).filter(p => !plugins.some(i => i.id === p.id)).map(p => this.decoratePlugin(p, overlays[p.id], issues)); }
    catch (e) { issues.push(core.errorRecord(e)); }
    for(const p of availablePlugins)try{p.screening=await this.dllIntake.screening(p.packageDirectory,policy);}catch(e){issues.push({...core.errorRecord(e),pluginId:p.id});}
    let externalPacks = [];
    try { externalPacks = (await this.packRegister.list(root, inspection)).filter(p=>p.files.some(f=>f.state==='match')); }
    catch (e) { issues.push({ code: 'pack_inventory', message: e.message }); }
    return { plugins, availablePlugins, nativeLibraries, l4nPlugins, runtime, normalProcess, overlays, externalPacks };
  }
  async dllInventory({ id } = {}) {
    if (id !== undefined && (typeof id !== 'string' || !id.trim())) fail('invalid_argument', '请选择清单中的 DLL 模组 ID。');
    const root = await this.root(), issues = [];
    let inspection;
    if (root) {
      try { inspection = await this.core.inspectGame(root); }
      catch (e) { issues.push(core.errorRecord(e)); }
    }
    const dll = await this.dllSnapshot(root, inspection, issues);
    const select = list => list.filter(p => id === undefined || p.id === id).map(p => ({ ...p,
      ...(dll.overlays[p.id]?.publisher ? { publisher: dll.overlays[p.id].publisher } : {}),
      ...(this.dllMetadataIssues.has(p.id) ? { metadataWarning: this.dllMetadataIssues.get(p.id) } : {}) }));
    const plugins = select(dll.plugins), availablePlugins = select(dll.availablePlugins);
    const l4nPlugins = { ...dll.l4nPlugins, plugins: select(dll.l4nPlugins.plugins) };
    const externalPacks = dll.externalPacks.filter(p => id === undefined || p.id === id);
    if (id !== undefined && !plugins.length && !availablePlugins.length && !l4nPlugins.plugins.length && !externalPacks.length)
      throw new core.PlatformError('plugin_missing', '当前 DLL 清单里没有这个模组，请刷新目标 ID。', { id, issues });
    return { game: { root, installed: !!inspection, running: !!dll.normalProcess, pid: dll.normalProcess?.pid },
      runtime: { installed: inspection?.platform.status === 'installed', status: inspection?.platform.status ?? 'absent',
        version: inspection?.platform.version ?? null, connected: !!dll.runtime, pendingOperations: inspection?.pendingOperations ?? [] },
      plugins, availablePlugins, l4nPlugins, externalPacks, nativeLibraries: dll.nativeLibraries, issues, checkedAt: new Date().toISOString() };
  }
  async snapshot() {
    const discovery = await this.core.discover();
    const root = this.settings.gameRoot || discovery.games[0]?.gameRoot || '';
    let inspection = discovery.games.find(g => samePath(g.gameRoot, root));
    const issues = discovery.warnings.map(w => ({ code: w.error.code, message: w.error.message }));
    if (!inspection && root) {
      try { inspection = await this.core.inspectGame(root); }
      catch (e) { issues.push(core.errorRecord(e)); }
    }
    const { plugins, availablePlugins, nativeLibraries, l4nPlugins, runtime, normalProcess, externalPacks } = await this.dllSnapshot(root, inspection, issues);
    const process = normalProcess ?? inspection?.processes.find(p => isQuickTestProcess(root, p));
    const fileIndex = new ConflictFileIndex();
    let modInventory = { mods: [], conflicts: [], issues: [], writable: false, addonListPath: '' };
    let modScanComplete = false;
    if (inspection) {
      try {
        modInventory = await this.modManager.scan(root, { fileIndex });
        modScanComplete = !modInventory.issues.length;
      }
      catch (e) { issues.push(core.errorRecord(e)); }
    }
    issues.push(...modInventory.issues);
    let trash = [];
    if (inspection) {
      try { trash = await this.modTrash.list(root); }
      catch (e) { issues.push(core.errorRecord(e)); }
    }
    const categories = this.settings.categories;
    const mods = modInventory.mods.map(m => ({ ...m, origin: this.settings.modOrigins?.[m.id], categoryId: categories.some(c => c.id === this.settings.assignments[m.id]) ? this.settings.assignments[m.id] : 'cat-none' }));
    const profiles = this.profileViews(mods);
    let servers = [], serverLayout;
    try { ({ servers, serverLayout } = await this.serverManager.snapshot()); }
    catch (e) { issues.push(core.errorRecord(e)); }
    const platforms = [];
    this.modFileIndex = { root, fileIndex, mods, modsById: new Map(mods.map(mod => [mod.id, mod])) };
    return {
      game: { installed: !!inspection, root, steamId: '550', build: inspection?.steamBuildId ?? '—', running: !!process, pid: process?.pid, startedAt: process?.startedAt },
      launch: launchSpec(this.launchMode, undefined, this.gameSettings()),
      installations: discovery.games.map(g => ({ root: g.gameRoot, build: g.steamBuildId ?? '—' })),
      runtime: { installed: inspection?.platform.status === 'installed', status: inspection?.platform.status ?? 'absent',
        host:inspection?.platform.host, version: inspection?.platform.version ?? '—', dir: 'bin\\l4p', apiVersion: '1', connected: !!runtime, phase: 'render-init',
        pendingOperations: inspection?.pendingOperations ?? [] },
      dxvk: { installed: !!nativeLibraries?.dxvk.installed, enabled: false, version: nativeLibraries?.dxvk.version??'—',
        dll:nativeLibraries?.dxvk.entries.find(e=>e.kind==='dxvk')?.path??'', configured:false },
      plugins, availablePlugins, platforms, externalPacks, nativeLibraries, l4nPlugins, profiles, activeProfileId: this.settings.activeProfileId,
      categories, mods, modMeta: this.settings.modMeta, favoriteCollections: this.settings.favoriteCollections, favoriteRefs: favoriteRefsView(this), trash:combinedTrash(this.settings,trash), conflicts: modInventory.conflicts, servers, serverLayout, cfg: [],
      conflictReviews: conflictReviewSummaries(this.modFileIndex, profiles, this.settings.modConflictReviews),
      modState: { writable: modInventory.writable, addonListPath: modInventory.addonListPath,
        ...(modScanComplete && { missingByProfile: missingModsByProfile(profiles, mods, root) }) },
      tasks: this.tasks.list(),
      capabilities: { plugins: true, l4nPlugins: true, platforms: false, platformManagement: false, mods: true, servers: true, config: true },
      issues, checkedAt: new Date().toISOString(),
    };
  }
  async dispatch(command,params={},confirmation){
    await this.ready;
    const writing=/^(browser-import|browser-archive|gamemaps-download|workshop-download|task-(?:retry|resume)|recycle-favorite-files|pack-favorite-folder|select-game|pack-mod-folder|extract-mod|start-extract|import-favorite-copy|import-mod|library-|plugin-|cache-clear|pi-command|set-mod|apply-profile)/.test(command);
    if(this.storage.error&&(command.startsWith('storage-')||writing&&command!=='select-game'))throw this.storage.error;
    if(command==='storage-move' && this.storage.busy())fail('storage_busy','传输或导入正在进行。');
    if(writing && this.storage.cfg?.move)fail('storage_busy','请先完成下载与缓存搬家。');
    if(writing)this.storageOps++;
    try{return await this.dispatchRequest(command,params,confirmation)}finally{if(writing)this.storageOps--}
  }
  async dispatchRequest(command, params = {}, confirmation) {
    // 不进串行队列：等这份回执的操作本身可能正占着队列
    if (command === 'ui-response') return this.uiResponse(params);
    if (command.startsWith('platform-') && command !== 'platform-preview-launch') fail('platform_retired', '旧平台入口已撤下，请使用 DLL 页的 L4N 整包开关。');
    if (command === 'community-status') return this.community.status();
    if (command === 'community-set') { this.confirm(confirmation); return this.community.setEnabled(params.enabled, { consent: params.consent === true }); }
    if (command === 'community-recover') { this.confirm(confirmation); return this.community.recover(); }
    if (command === 'community-check') {
      const started = Date.now();
      try {
        const response = await this.workshop.fetch('https://steamcommunity.com/app/550/workshop/', { signal: AbortSignal.timeout(20000), redirect: 'error' });
        await response.body?.cancel();
        return { ok: response.ok, status: response.status, elapsedMs: Date.now() - started, route: this.community.active ? 'steampp' : 'system' };
      } catch (e) { return { ok: false, elapsedMs: Date.now() - started, message: e.cause?.message ?? e.message, route: this.community.active ? 'steampp' : 'system' }; }
    }
    await Promise.all([this.ready, this.tasks.ready]);
    if(command==='dll-updates-check')return this.sdkUpdates.check(await this.sdkTargets(),true);
    if(command==='plugin-update-fetch'){
      this.confirm(confirmation);const {taskId}=await this.serial(()=>this.queueSdkUpdate(params.id));
      const row=await this.tasks.completed(taskId);return this.dllIntake.view(await this.dllIntake.record(row.intakeId));
    }
    if (command === 'update-check') return checkUpdate(this.appVersion, this.updateRepository, this.workshop.fetch);
    if (command === 'steam-profile') return steamProfile({ gameRoot: this.settings.gameRoot });
    if (command === 'task-list') return this.tasks.list();
    if (command === 'download-settings-get') return { ...this.tasks.settings };
    if (command === 'download-settings-set') return this.tasks.setSettings(params);
    if (command === 'task-pause') return this.tasks.pause(params.taskId);
    if (command === 'task-resume') return this.tasks.resume(params.taskId);
    if (command === 'task-remove') return this.tasks.remove(params.taskIds);
    if (command === 'task-cancel') return this.tasks.cancel(params.taskId);
    if (command === 'task-retry') {
      this.confirm(confirmation);
      const task = this.tasks.get(params.taskId);
      if (task.kind.startsWith('platform-') && task.kind !== 'platform-download') fail('platform_plan_required', '请重新预览平台操作，再创建任务。');
      return this.tasks.retry(params.taskId);
    }
    if (command === 'workshop-resolve') return this.workshop.resolve(await this.requireRoot(), params.ids);
    if (command === 'workshop-browse') return this.workshop.browse(await this.root(), params);
    if (command === 'workshop-detail') return this.workshop.detail(await this.root(), params.id);
    if (command === 'workshop-preview') return this.workshop.preview(params.id, params);
    if (command === 'workshop-preview-cancel') return this.workshop.cancelPreview(params.requestId);
    if (command === 'bilibili-search') return this.bilibili.search(params);
    if (command === 'bilibili-detail') return this.bilibili.detail(params.id);
    if (command === 'gamemaps-browse') return this.gamemaps.browse(params);
    if (command === 'gamemaps-detail') return this.gamemaps.detail(params.id);
    if (command === 'browser-archive') return listBrowserArchive(this.dataDir, params.id,this.storage.downloadRoots('browser'));
    if (command === 'workshop-open') {
      if (params.id !== undefined && !workshopId(params.id)) fail('invalid_argument', '工坊 ID 无效。');
      const url = params.id ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${params.id}` : 'https://steamcommunity.com/app/550/workshop/';
      if (process.platform !== 'win32') fail('unsupported_platform', '请复制链接到浏览器打开。');
      await new Promise((resolve, reject) => {
        const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
        child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
      });
      return { status: 'opened' };
    }
    if (command === 'mod-conflict-files') {
      if (params.profileId !== undefined) return conflictReviewPage(this, params);
      if (!this.modFileIndex || this.modFileIndex.root !== params.gameRoot)
        fail('context_changed', 'Mod 清单已变化，请重新扫描。');
      return this.modFileIndex.fileIndex.page(params);
    }
    if (command === 'mod-sounds' || command === 'mod-sound') {
      const source=this.favoriteAsset(params.id);
      const root=source ? this.settings.gameRoot || path.dirname(source) : await this.requireRoot();
      return command==='mod-sounds' ? this.audio.list(root,params.id,source) : this.audio.sound(root,params.id,params.path,source);
    }
    if (command === 'mod-thumbnail') {
      const source=this.favoriteAsset(params.id);
      if(source)return this.modManager.localThumbnail(source);
      return this.modManager.thumbnail(await this.requireRoot(), params.id);
    }
    if (command === 'trash-thumbnail') return trashThumbnail(this, params.trashId);
    if (['pi-connect', 'pi-reconnect', 'pi-close', 'pi-sessions', 'pi-session-delete', 'pi-settings-set', 'pi-auth-set', 'pi-auth-remove', 'pi-models-set'].includes(command)
      || (command === 'pi-command' && ['new_session', 'switch_session', 'fork', 'clone', 'set_model', 'set_thinking_level', 'set_auto_compaction', 'set_auto_retry'].includes(params.type))) {
      return this.piLifecycle(() => this.piCommand(command, params));
    }
    if (command.startsWith('pi-')) return this.piCommand(command, params);
    // Server writes and probes use their own queues, outside the core/Mod queue.
    const serverCommand = this.serverCommands.get(command);
    if (serverCommand) return serverCommand(params);
    // Serialize reads with writes so a snapshot cannot show a half-applied operation.
    return this.serial(() => this.execute(command, params, confirmation));
  }
  serial(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  async switchRecordedDll(id,enabled,expectedRoot) {
    const root=await this.requireRoot();
    if(typeof expectedRoot!=='string'||!samePath(root,expectedRoot))fail('context_changed','游戏目录已切换，请刷新后再试。');
    const row=await this.packRegister.setEnabled(root,id,enabled,()=>this.core.inspectGame(root));
    this.emit('event',{type:'objects_changed'});return row;
  }
  confirm(confirmation) {
    if (confirmation?.approved !== true || confirmation.source !== 'user') fail('confirmation_required', '请确认此次操作。');
  }
  async getDesktop() {
    if (this.desktopDir) return this.desktopDir;
    if (process.platform !== 'win32') fail('desktop_required', '请选择输出父目录。');
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); [Environment]::GetFolderPath("Desktop")'], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
    const value = stdout.trim(); if (!value || !path.isAbsolute(value)) fail('desktop_required', '桌面位置读取失败，请选择输出父目录。');
    return value;
  }
  async copyModFiles({ ids, gameRoot, favorites }) {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) fail('invalid_argument', '请选择要复制的 Mod。');
    let root;
    const files = new Map();
    for (const id of new Set(ids)) {
      let source;
      if (favorites === true && this.settings.favoriteRefs?.[id]) source = this.favoriteAsset('fav-asset:' + id);
      else {
        root ??= await this.requireRoot();
        if (typeof gameRoot !== 'string' || !samePath(root, gameRoot)) fail('game_changed', '游戏目录已切换，请重新选择 Mod。');
        source = await this.modManager.resolve(root, id);
      }
      // Standalone VPKs can be copied even if they failed to scan; split VPKs
      // need their referenced volumes in the same Explorer clipboard operation.
      await regular(source);
      const paths = /_dir\.vpk$/i.test(source) ? (await this.modManager.cached(source)).files.map(f => f.file) : [source];
      for (const file of paths) files.set(file.toLowerCase(), file);
    }
    return { paths: [...files.values()] };
  }
  async queueVpkDrop(paths) {
    if (!Array.isArray(paths) || !paths.length || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file)))
      fail('invalid_argument', '请拖入本地 VPK 或素材文件夹。');
    const desktop = await this.getDesktop(), seen = new Set(), errors = [];
    let queued = 0;
    for (let file of paths) {
      try {
        file = path.resolve(file);
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) fail('unsafe_path', '请拖入实际文件或文件夹。');
        if (stat.isDirectory()) {
          const input = await packSource(file), key = input.file.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          await this.tasks.create('pack', { file: input.file, sourceStamp: input.sourceStamp, exportDir: desktop, gameRoot: '' }, input.name);
        } else {
          if (!stat.isFile() || !/\.vpk$/i.test(file)) fail('invalid_argument', '请选择 VPK 或素材文件夹。');
          const index = file.replace(/_\d{3,5}\.vpk$/i, '_dir.vpk');
          if (index !== file && await exists(index)) file = index;
          const key = file.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const vpk = await readVpk(file);
          const title = path.basename(file).replace(/(?:_dir)?\.vpk$/i, '') || vpk.title;
          await this.tasks.create('extract', { gameRoot: '', title, target: desktop, source: vpk.file, sourceVersion: vpk.files.map(f => f.identity) }, title);
        }
        queued++;
      } catch (e) { errors.push(`${path.basename(file) || file}：${e.message}`); }
    }
    return { queued, errors };
  }
  async runTask(kind, request, ctx) {
    if(kind==='platform-download' && request.sourceId==='native:'+request.id && ['l4n','dxvk'].includes(request.id)){
      if(request.id!=='l4n' || request.plan?.id!=='l4n') fail('renderer_read_only','DXVK 由游戏管理。');
      const catalog=await this.nativeLibraries.catalog();return this.nativeLibraries.cache.download(request.plan,catalog.l4n,ctx);
    }
    if(kind==='platform-download' && request.sourceId==='plugin:'+request.id)return this.fetchSdkUpdate(request,ctx);
    if (kind.startsWith('platform-')) fail('platform_retired', '旧平台任务已撤下，请使用 L4N 整包管理。');
    if (kind === 'platform-download') {
      await this.platformLifecycle.store.idle(request.gameRoot);
      return this.platformLifecycle.release(request.id).download(request.version, ctx);
    }
    if (kind === 'platform-operation') return this.serial(() => this.platformLifecycle.execute(request.gameRoot, request.id,
      request.operation, request.planId, request.params, { approved: true, source: 'user' }, ctx));
    if (kind === 'platform-launch') return this.serial(async () => {
      const confirmation = { approved: true, source: 'user' };
      if (!samePath(request.gameRoot, await this.requireRoot())) fail('platform_plan_stale', '已切换游戏目录，请重新预览启动。');
      const context = await this.platformLaunchContext(request.params);
      await this.platformLifecycle.execute(request.gameRoot, 'skeeto', 'launch-policy', request.planId, context, confirmation, ctx);
      await this.applyGameSettings(request.gameRoot, true);
      await this.applyModProfile(context.profileId, confirmation);
      return this.core.launch({ gameRoot: request.gameRoot, mode: context.mode, connect: context.connect || undefined,
        serverModeId: context.modeId, platformDataDir: this.dataDir, gameSettings: this.gameSettings(), confirmation });
    });
    if (kind === 'extract') return extractMod(this.modManager, request, ctx);
    if (kind === 'pack') {
      if(request.favoriteExport)return exportFavoriteVpk(this,request.favoriteExport,ctx,request.exportDir);
      if(request.exportDir) return packModFolder(request,ctx);
      return packAndImportMod(this, request, ctx);
    }
    if (kind === 'download' && request.source === 'gamemaps') return this.gamemaps.download(request, ctx, (receipt, saveReceipt) => this.serial(async () => {
      const imported = [];
      for (const file of receipt.files) {
        let result = receipt.imported[file];
        if (result) {
          // A retry resumes only files this task published and that remain unchanged.
          if (result.stamp ? stamp(await regular(result.file)) !== result.stamp : identity(await regular(result.file)) !== result.identity) fail('file_changed', `已导入的文件发生变化，请检查：${result.file}`);
        } else {
          result = await this.modManager.import({ gameRoot: request.gameRoot, file, ownedDownload:true, confirmation: { approved: true, source: 'user' } });
          receipt.imported[file] = result = { id: result.id, file: result.file, stamp: stamp(await regular(result.file)) };
          await saveReceipt();
        }
        await this.save({ ...this.settings,
          modMeta: { ...this.settings.modMeta, [result.id]: { ...this.settings.modMeta[result.id], inbox: true } },
          modOrigins: { ...this.settings.modOrigins, [result.id]: { pageUrl: receipt.item.url, title: receipt.item.title, downloadId: ctx.taskId } },
        });
        imported.push(result.id);
      }
      await this.enableNewMods(request.gameRoot, imported);
      return { modId: imported[0], imported };
    }));
    if (kind === 'download') return this.workshop.download(request, ctx, (publish, item) => this.serial(async () => {
      // Updating a library item keeps the player's on/off choice; only first downloads turn on.
      const fresh = !(await this.modManager.library.entries(request.gameRoot).catch(() => [])).some(m => m.id === libraryId(item.id));
      const published = await this.modManager.mutation(request.gameRoot, { approved: true, source: 'user' }, async () => {
        const old = this.settings.modMeta, id = libraryId(item.id);
        await this.save({ ...this.settings, modMeta: { ...old, [id]: { ...old[id], inbox: true } } });
        try { return await publish(); }
        catch (e) { await this.save({ ...this.settings, modMeta: old }); throw e; }
      }, { offlineLibrary: true });
      if (fresh) await this.enableNewMods(request.gameRoot, [libraryId(item.id)]);
      return published;
    }));
    fail('unsupported_capability', `未知任务类型：${kind}`);
  }
  async platformLaunchContext(p) {
    const mode = launchSpec(desktopMode(p.mode ?? this.launchMode)).mode;
    const profileId = p.profileId ?? this.settings.activeProfileId;
    if (!this.settings.profiles.some(profile => profile.id === profileId)) fail('profile_missing', '方案已不存在。');
    const serverId = p.serverId ?? '', connect = serverId ? await this.serverManager.connectTarget(serverId, mode, mode === 'clean' ? undefined : this.gameSettings()) : '';
    const server = serverId && (this.serverManager.friends.rows.get(serverId) ?? (await this.serverManager.list()).find(s => s.id === serverId));
    return { mode, profileId, serverId, connect, remote: remoteTarget(connect), modeId: server?.modeId ?? '' };
  }
  async execute(command, p, confirmation) {
    const modCommand = modCommands.get(command);
    if (modCommand) return modCommand(this, p, confirmation);
    switch (command) {
      case 'plugin-record-set-enabled': this.confirm(confirmation);return this.switchRecordedDll(p.id,p.enabled,p.gameRoot);
      case 'storage-get': return this.storage.status();
      case 'storage-set': {
        if(typeof p.deleteArchivesAfterImport!=='boolean')fail('invalid_argument','需要布尔值。');
        this.storage.cfg.deleteArchivesAfterImport=p.deleteArchivesAfterImport;await this.storage.save();return this.storage.status();
      }
      case 'storage-move': this.confirm(confirmation);return this.storage.start(p.path);
      case 'storage-clean-preview':return this.storage.clean(p.kinds,false);
      case 'storage-clean':if(this.storage.cfg.move||this.storage.busy())fail('storage_busy','请先等待搬家或下载完成。');return this.storage.clean(p.kinds,true,confirmation);
      case 'app-info': {
        // Explorer runs outside the packaged parent's AppData virtualization.
        const visible = async dir => dir && fs.realpath(dir).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; });
        const [dataDir, storageDir, piConfigDir, logsDir] = await Promise.all(
          [this.dataDir, this.storage.cfg?.root, this.piConfigDir, path.join(this.dataDir,'logs')].map(visible));
        return { version:this.appVersion, dataDir:dataDir ?? this.dataDir, storageDir:storageDir ?? this.storage.cfg?.root,
          piConfigDir:piConfigDir ?? this.piConfigDir, logsDir };
      }
      case 'cache-status': return this.settingsCache.status();
      case 'cache-clear': this.confirm(confirmation); return this.settingsCache.run(p.ids,true);
      case 'plugin-maintenance-preview': {
        const expected=await this.core.previewPluginMaintenance({gameRoot:await this.requireRoot(),pluginId:p.pluginId,operation:p.operation});
        const planId=randomUUID();
        this.pluginMaintenancePlans.set(planId,{expected,at:Date.now()});
        if(this.pluginMaintenancePlans.size>24)this.pluginMaintenancePlans.delete(this.pluginMaintenancePlans.keys().next().value);
        return {planId,gameRoot:expected.gameRoot,name:expected.name,version:expected.version,targetVersion:expected.target?.version,
          directory:expected.directory,files:expected.entries.map(f=>f[0]),backupDirectory:expected.target?.directory};
      }
      case 'plugin-maintenance-apply': {
        this.confirm(confirmation);
        const plan=this.pluginMaintenancePlans.get(p.planId),gameRoot=await this.requireRoot();
        if(!plan||!samePath(plan.expected.gameRoot,gameRoot)||Date.now()-plan.at>900000)fail('plugin_update_stale','请重新预览当前游戏目录的插件。');
        const expected=plan.expected,id=expected.pluginId;
        const result=await this.core.applyPluginMaintenance({gameRoot,expected,confirmation,previousSourceVersion:(await this.pluginOverlays.all())[id]?.source?.version});
        this.pluginMaintenancePlans.delete(p.planId);
        if(expected.operation==='rollback') try { await this.pluginOverlays.mutate(rows=>{
          if(rows[id]?.source){if(expected.target.sourceVersion)rows[id].source.version=expected.target.sourceVersion;else delete rows[id].source.version;}
        }); }catch(e){result.metadataWarning=core.errorRecord(e);}
        this.emit('event',{type:'objects_changed'});return result;
      }
      case 'library-download-preview': {
        if(p.id==='dxvk') fail('renderer_read_only','DXVK 由游戏管理。');
        if(!['l4n','dxvk'].includes(p.id))fail('library_invalid','请选择 L4N 或 DXVK。');
        return this.nativeLibraries.cache.preview(p.id,(await this.nativeLibraries.catalog())[p.id]);
      }
      case 'library-download': {
        this.confirm(confirmation);const plan=this.nativeLibraries.cache.take(p.planId),sourceId='native:'+plan.id;
        this.assertDownloadFree(sourceId);return this.tasks.create('platform-download',{id:plan.id,plan,sourceId},'下载 '+plan.id.toUpperCase()+' '+plan.version);
      }
      case 'dll-screen': return this.screenDll(p);
      case 'library-preview': return this.nativeLibraries.preview(await this.requireRoot(), p.id, p.enabled);
      case 'library-apply': return this.nativeLibraries.apply(await this.requireRoot(), p.planId, confirmation);
      case 'library-recover': return this.nativeLibraries.recover(await this.requireRoot(), p.id, confirmation);
      case 'l4n-plugins-list': return this.l4nPluginSnapshot();
      case 'l4n-plugin-preview': return this.l4nPlugins.preview(await this.requireRoot(), p);
      case 'l4n-plugin-apply': {
        const result = await this.l4nPlugins.apply(await this.requireRoot(), p.planId, confirmation);
        this.emit('event', { type: 'objects_changed' }); return result;
      }
      case 'l4n-plugin-recover': {
        const result = await this.l4nPlugins.recover(await this.requireRoot(), confirmation);
        this.emit('event', { type: 'objects_changed' }); return result;
      }
      case 'plugin-intake-inspect': return this.inspectDllIntake(p.file);
      case 'plugin-intake-details': return this.dllIntake.details(p.intakeId);
      case 'plugin-intake-import-preview': return this.previewDllImport(p);
      case 'plugin-intake-import': return this.applyDllImport(p.planId, confirmation);
      case 'plugin-overlay-save': {
        const plugin = await this.pluginRecord(p.id);
        const result = await this.pluginOverlays.save(plugin.raw, plugin.directory, { fields: p.fields }, 'user');
        this.emit('event', { type: 'objects_changed' }); return result;
      }
      case 'snapshot': return this.snapshot();
      case 'game-settings-l4n-launch': {
        const root=await this.requireRoot();
        if(typeof p.enabled!=='boolean' || typeof p.gameRoot!=='string' || !samePath(root,p.gameRoot)) fail('context_changed','游戏目录已变化，请刷新后再试。');
        if(!(await localL4n(root)).supportsLaunchToggle) fail('l4n_launch_unsupported','这个启动入口尚未识别出 L4N 跳过参数。');
        const old=this.gameSettings(), extraArgs=setL4nLaunch(old.extraArgs,p.enabled);
        if(extraArgs!==old.extraArgs){
          const gameSettings=validateGameSettings({...old,extraArgs});
          launchSpec('modded',undefined,gameSettings);
          await this.save({...this.settings,gameSettings});
          this.emit('event',{type:'objects_changed'});
        }
        return this.gameSettingsReply();
      }
      case 'saved-game-settings': {
        const root = await this.requireRoot();
        if (!samePath(root,p.root)) fail('context_changed','游戏目录已切换，请重新读取。');
        return savedGameSummary(root);
      }
      case 'game-settings-get': return this.gameSettingsReply();
      // 把 Steam 启动选项和 autoexec.cfg 里已有的设置导入 Matcha：先预览，玩家在设置页点导入再应用
      case 'game-settings-import-preview': return (this.importer ??= importHost(this)).preview(p);
      case 'game-settings-import-apply': return (this.importer ??= importHost(this)).apply(p.planId);
      case 'game-settings-set': {
        const reply = await this.commitGameSettings(p);
        this.emit('event', { type: 'objects_changed' });
        return reply;
      }
      case 'plugin-asset':
      case 'plugin-cover': {
        const plugin = await this.pluginRecord(p.id), record = (await this.pluginOverlays.all())[p.id];
        const presentation = mergePluginMetadata(plugin.raw, record).presentation;
        let selected = p.path;
        if (command === 'plugin-cover') {
          if (!['module', 'collection', 'catalog'].includes(p.kind)) fail('invalid_argument', '封面类型无效。');
          const collection = p.collectionId === undefined ? presentation?.collection : presentation?.collections?.find(c => c.id === p.collectionId);
          if (p.kind === 'collection' && p.collectionId !== undefined && !collection) fail('collection_missing', '此功能未声明该小合集。');
          selected = p.kind === 'catalog' ? presentation?.catalog?.cover : p.kind === 'collection' ? collection?.cover : presentation?.cover;
          if (!selected) return { dataUrl: null };
        }
        if (!declaredPluginAssets(presentation).has(selected)) fail('asset_not_declared', '此图片未在该模组的资料中声明。');
        if (selected.startsWith('@overlay/')) return this.pluginOverlays.image(p.id, selected);
        return packageImage(plugin.directory, selected);
      }
      case 'platform-doc': return this.externalPlatforms.doc(await this.requireRoot(), p.id, p.path);
      case 'platform-check-update': return this.platformLifecycle.checkUpdate(await this.requireRoot(), p.id);
      case 'platform-download': {
        this.confirm(confirmation);
        if (this.externalPlatforms.adapter(p.id).distribution === 'source-ports') fail('platform_retired', 'Skeeto 整包下载已撤下，请在 DLL 合集中选择源码移植模组。');
        versionString(p.version);
        const gameRoot = await this.requireRoot(); await this.platformLifecycle.store.idle(gameRoot);
        if ([...this.tasks.records.values()].some(t => t.kind === 'platform-download' && t.request.id === p.id && t.request.version === p.version && !['done', 'failed', 'canceled'].includes(t.state))) fail('task_duplicate', '此版本已有下载任务。');
        return this.tasks.create('platform-download', { gameRoot, id: p.id, version: p.version }, `Skeeto ${p.version}`);
      }
      case 'platform-preview-install': return this.platformLifecycle.preview(await this.requireRoot(), p.id, 'install', { version: versionString(p.version) });
      case 'platform-preview-operation': {
        if (!['set-enabled', 'uninstall', 'set-self-update', 'recover'].includes(p.operation)) fail('invalid_argument', '请选择启停、卸载、自更新或恢复操作。');
        return this.platformLifecycle.preview(await this.requireRoot(), p.id, p.operation,
          ['set-enabled', 'set-self-update'].includes(p.operation) ? { enabled: p.enabled } : {});
      }
      case 'platform-preview-launch': {
        return { required: false, modules: [] };
      }
      case 'platform-install':
      case 'platform-set-enabled':
      case 'platform-uninstall':
      case 'platform-recover':
      case 'platform-set-self-update': {
        this.confirm(confirmation); this.externalPlatforms.adapter(p.id);
        const gameRoot = await this.requireRoot(), operation = command.slice('platform-'.length);
        const plan = this.platformLifecycle.plans.get(p.planId)?.view;
        if (!plan || plan.id !== p.id || plan.operation !== operation || !samePath(plan.gameRoot, gameRoot)) fail('platform_plan_required', '请先预览此次平台操作。');
        const params = operation === 'install' ? { version: plan.params.version } : ['set-enabled', 'set-self-update'].includes(operation) ? { enabled: p.enabled } : {};
        return this.tasks.create('platform-operation', { gameRoot, id: p.id, operation, planId: p.planId, params }, `Skeeto · ${operation}`);
      }
      case 'test-options': return this.quickTest.describe(await this.requireRoot(), p.modIds, p.mapModId);
      case 'test-status': return this.quickTest.status(await this.requireRoot());
      case 'start-test': return this.quickTest.start(await this.requireRoot(), p.preset, confirmation);
      case 'copy-mod-files': return this.copyModFiles(p);
      case 'vpk-drop': {
        this.confirm(confirmation);
        return this.queueVpkDrop(p.paths);
      }
      case 'extract-mod': {
        this.confirm(confirmation);
        const source=this.favoriteAsset(p.id);
        const gameRoot=source ? this.settings.gameRoot || path.dirname(source) : await this.requireRoot();
        const vpk = await this.modManager.cached(source ?? await this.modManager.resolve(gameRoot, p.id));
        const title = !vpk.hasTitle && p.id.startsWith('library:workshop:') ? (await this.modManager.library.read(gameRoot, p.id.slice('library:workshop:'.length))).title : vpk.title;
        const target = p.target ?? await this.getDesktop();
        if (typeof target !== 'string' || !path.isAbsolute(target)) fail('invalid_argument', '请选择绝对路径的输出父目录。');
        return this.tasks.create('extract', { gameRoot, id: p.id, title, target, source, sourceVersion: vpk.files.map(f => f.identity) }, title);
      }
      case 'gamemaps-download': {
        this.confirm(confirmation); const id = gameMapsId(p.id), gameRoot = await this.requireRoot();
        if ([...this.tasks.records.values()].some(t => t.kind === 'download' && t.request.source === 'gamemaps' && samePath(t.request.gameRoot, gameRoot) && t.request.id === id && !['done', 'failed', 'canceled'].includes(t.state))) fail('task_duplicate', '此 GameMaps 条目已有下载任务。');
        return this.tasks.create('download', { gameRoot, id, source: 'gamemaps' }, `GameMaps ${id}`);
      }
      case 'workshop-download': {
        this.confirm(confirmation);
        if (!Array.isArray(p.ids) || !p.ids.length || p.ids.length > 32 || p.ids.some(id => !workshopId(id))) fail('invalid_argument', '每次请选择 1–32 个有效工坊条目。');
        const gameRoot = await this.requireRoot(), selected = [...new Set(p.ids)];
        if (this.tasks.pendingCount() + selected.length > 32) fail('task_limit', '任务队列已满，请稍后添加。');
        for (const id of selected) if ([...this.tasks.records.values()].some(t => t.kind === 'download' && t.request.source !== 'gamemaps' && t.request.gameRoot === gameRoot && t.request.id === id && !['done', 'failed', 'canceled'].includes(t.state))) fail('task_duplicate', '选中条目已有下载任务。');
        const taskIds = [];
        for (const id of selected) taskIds.push((await this.tasks.create('download', { gameRoot, id }, `工坊 ${id}`)).taskId);
        return { taskIds };
      }
      case 'reveal-path': {
        if (typeof p.path !== 'string' || !path.isAbsolute(p.path)) fail('invalid_argument', '需要本地绝对路径。');
        const stat = await fs.lstat(p.path).catch(e => { if (e.code === 'ENOENT') fail('path_missing','这个位置已移走或尚未创建：' + p.path); throw e; });
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail('unsafe_path', '请选择普通文件或目录。');
        if (process.platform !== 'win32') fail('unsupported_platform', '此操作使用 Windows 资源管理器。');
        const target = await fs.realpath(p.path);
        await new Promise((resolve, reject) => {
          const child = spawn('explorer.exe', stat.isDirectory() ? [target] : ['/select,', target], { stdio: 'ignore' });
          child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
        });
        return { status: 'opened' };
      }
      case 'set-launch-mode': return this.saveLaunchMode(p.mode);
      case 'select-game': {
        if (this.piBusy) fail('agent_busy', '先停止当前助手任务，再切换游戏目录。');
        const game = p.gameRoot ? await this.core.inspectGame(p.gameRoot) : null;
        await this.piLifecycle(() => this.closePi());
        await this.save({ ...this.settings, gameRoot: game?.gameRoot ?? '' });
        // 新选的游戏目录里可能还是 .flare-* 旧文件夹：先改名，记着它们的存储设置要重新读。
        const renamed = game && process.env.MATCHA_CHANNEL !== 'beta' ? await migrateLegacyNames({ dataDir: this.dataDir, gameRoot: game.gameRoot,
          patchBrowser: (id, oldPath, patch) => this.storage.patchBrowser(id, oldPath, patch) }).then(r => (logRename(r), r.renamed.length), () => 0) : 0;
        if(this.storage.error||renamed){await this.storage.load();delete this.storage.error;this.storage.notify();}else await this.storage.gameChanged();
        this.plans.clear();
        this.emit('event', { type: 'context_changed' });
        return this.snapshot();
      }
      case 'plan-install': {
        const plan = await this.core.planInstall({ gameRoot: await this.requireRoot(), distRoot: this.distRoot });
        this.plans.clear(); this.plans.set(plan.id, plan);
        return { id: plan.id, gameRoot: plan.gameRoot, changes: plan.changes };
      }
      case 'apply-install': {
        const plan = this.plans.get(p.planId);
        if (!plan || !samePath(plan.gameRoot, await this.requireRoot())) fail('plan_expired', '安装计划已过期，请重新检查。');
        const result = await this.core.applyInstall(plan, { confirmation });
        this.plans.delete(p.planId);
        return result;
      }
      case 'restore': return this.core.restore(await this.requireRoot(), { confirmation });
      case 'resume-runtime': return this.core.resumeRuntime(await this.requireRoot(), { confirmation,distRoot:this.distRoot });
      case 'recover': return this.core.recover(await this.requireRoot(), { confirmation });
      case 'validate-plugin': {
        // Preserve the existing SDK-directory maintenance contract; the new
        // player-facing path is a checked ZIP or an Agent-prepared package.
        if (typeof p.pluginDirectory === 'string' && (await fs.lstat(p.pluginDirectory).catch(() => null))?.isDirectory()) {
          try {
            const legacy = await core.validatePlugin(p.pluginDirectory, { policyPath: await this.dllPolicy() });
            if (legacy.manifest.loadKind !== 'library') return { ...legacy, screening:await this.dllIntake.screening(legacy.directory,await this.dllPolicy(),legacy.verification), preparedDirectory: p.pluginDirectory };
          } catch (e) {
            if (!['file_missing', 'invalid_manifest', 'invalid_json', 'invalid_id', 'unsupported_version', 'invalid_pe', 'release_rejected'].includes(e.code)) throw e;
          }
        }
        const intake = await this.inspectDllIntake(p.pluginDirectory);
        if (intake.outcome !== 'sdk-ready') throw new core.PlatformError(intake.outcome === 'rejected' ? 'plugin_package_rejected' : 'plugin_needs_agent',
          intake.issues.map(issue => issue.message).join('\n'), intake);
        const result = await core.validatePlugin(intake.preparedDirectory, { policyPath: await this.dllPolicy() });
        return { ...result, screening:intake.screening, preparedDirectory: intake.preparedDirectory, intakeId: intake.intakeId, candidateId: intake.candidateId };
      }
      case 'install-plugin': {
        const candidate = await this.dllIntake.forDirectory(p.pluginDirectory);
        this.confirm(confirmation);
        allowScreen(await this.dllIntake.screening(p.pluginDirectory,await this.dllPolicy(),undefined,true));
        const result = await this.core.installPlugin({ gameRoot: await this.requireRoot(), pluginDirectory: p.pluginDirectory, confirmation, checkStage:this.stageCheck() });
        return this.attachDllMetadata(result, candidate, p.pluginDirectory);
      }
      case 'update-plugin': {
        const candidate = await this.dllIntake.forDirectory(p.pluginDirectory);
        this.confirm(confirmation);
        const id = core.validateManifest(JSON.parse((await readBytes(await platformPath(p.pluginDirectory,'manifest.json'))).toString('utf8').replace(/^\uFEFF/,''))).id;
        allowScreen(await this.dllIntake.screening(p.pluginDirectory,await this.dllPolicy(),undefined,true));
        const result = await this.core.updatePlugin({ gameRoot: await this.requireRoot(), pluginDirectory: p.pluginDirectory, confirmation, checkStage:this.stageCheck(),
          previousSourceVersion: (await this.pluginOverlays.all())[id]?.source?.version });
        return this.attachDllMetadata(result, candidate, p.pluginDirectory);
      }
      case 'set-plugin-enabled': {
        if (typeof p.enabled !== 'boolean') fail('invalid_argument', 'enabled 需要布尔值。');
        return this.core.setPluginEnabled({ gameRoot: await this.requireRoot(), pluginId: p.pluginId, enabled: p.enabled, confirmation });
      }
      case 'invoke': return this.core.invokePlugin({ gameRoot: await this.requireRoot(), pid: p.pid, pluginId: p.pluginId, actionId: p.actionId, args: p.args, confirmation });
      case 'stop-game': {
        this.confirm(confirmation);
        const gameRoot = await this.requireRoot();
        if (typeof p.gameRoot !== 'string' || !samePath(p.gameRoot, gameRoot)) fail('game_changed', '游戏目录已切换，请刷新后再试。');
        if (!Number.isInteger(p.pid) || typeof p.startedAt !== 'string') fail('game_process_changed', '请刷新游戏进程后再试。');
        const inspection = await this.core.inspectGame(gameRoot);
        const games = inspection.processes.filter(process => samePath(process.path, path.join(gameRoot, 'left4dead2.exe')) || isQuickTestProcess(gameRoot, process));
        const target = games.find(process => process.pid === p.pid && process.startedAt === p.startedAt);
        if (target) return this.core.stopGameProcess(target);
        if (games.length) fail('game_process_changed', '游戏进程已变化，请刷新后再试。');
        return { status: 'exited' };
      }
      case 'launch': {
        this.confirm(confirmation);
        const mode = launchSpec(desktopMode(p.mode ?? this.launchMode)).mode;
        const gameRoot = await this.requireRoot();
        if (mode === 'clean') return this.core.launch({ gameRoot, mode, confirmation });
        await this.applyGameSettings(gameRoot, true);
        await this.applyModProfile(p.profileId ?? this.settings.activeProfileId, confirmation);
        return this.core.launch({ gameRoot, mode, gameSettings: this.gameSettings(), confirmation });
      }
      case 'connect-server': {
        if (confirmation?.approved !== true || confirmation?.source !== 'user') fail('confirmation_required', '连接服务器前请确认启动游戏。');
        const mode = launchSpec(desktopMode(p.mode ?? this.launchMode)).mode;
        const gameRoot = await this.requireRoot();
        if (mode === 'clean') return this.core.launch({ gameRoot, mode, connect: await this.serverManager.connectTarget(p.id, mode), confirmation });
        const connect = await this.serverManager.connectTarget(p.id, mode, this.gameSettings());
        await this.applyGameSettings(gameRoot, true);
        await this.applyModProfile(p.profileId ?? this.settings.activeProfileId, confirmation);
        return this.core.launch({ gameRoot, mode, connect, gameSettings: this.gameSettings(), confirmation });
      }
      default: fail('unsupported_capability', `此能力待接入：${command}`);
    }
  }
  async piConfig() {
    const candidates = [process.env.BEACON_PI_ENTRY, path.join(path.dirname(process.execPath), 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js')].filter(Boolean);
    let piEntry;
    for (const p of candidates) if (await exists(p)) { piEntry = p; break; }
    if (!piEntry) fail('pi_missing', '尚未找到 Pi CLI。安装 @earendil-works/pi-coding-agent 后重新连接。');
    return { nodePath: process.execPath, piEntry, configDir: this.piConfigDir, sessionDir: this.piSessionDir, gameRoot: await this.root() || undefined };
  }
  async connectPi() {
    if (this.piStarting) return this.piStarting;
    if (this.pi?.running) return this.pi.request('get_state');
    this.piStarting = (async () => {
      const config = await this.piConfig();
      const mods = modHost(this, config.gameRoot), dlls = dllHost(this, config.gameRoot), servers = serverHost(this), settings = settingsHost(this);
      config.modRequest = (operation, ...args) => operation.startsWith('dll-') ? dlls(operation, ...args)
        : operation.startsWith('server-') ? servers(operation, ...args)
          : operation.startsWith('settings-') ? settings(operation, ...args) : mods(operation, ...args);
      if (this.lastPiState?.sessionFile && this.lastPiRoot === config.gameRoot && await exists(this.lastPiState.sessionFile)) config.session = this.lastPiState.sessionFile;
      const pi = this.createPi(config);
      this.lastPiRoot = config.gameRoot;
      this.pi = pi;
      pi.on('event', event => {
        if (event.type === 'agent_start') this.piBusy = true;
        if (event.type === 'agent_settled') this.piBusy = false;
        this.emit('event', { type: 'pi_event', event });
        if (event.type === 'tool_execution_end') this.emit('event', { type: 'objects_changed' });
      });
      pi.on('fault', error => this.emit('event', { type: 'pi_fault', error }));
      pi.on('exit', exit => { this.piBusy = false; this.emit('event', { type: 'pi_exit', ...exit }); });
      let state = await pi.start();
      // Use Flash for a fresh DeepSeek selection; keep an explicitly selected current model.
      if (state?.model?.provider === 'deepseek' && !config.session) {
        const defaults = await this.piFiles.settings();
        if (!defaults.defaultModel || (defaults.defaultProvider === 'deepseek' && ['deepseek-chat','deepseek-reasoner','deepseek-v4-flash'].includes(defaults.defaultModel))) {
          const { models } = await pi.request('get_available_models');
          const flash = models.find(m => m.provider === 'deepseek' && (m.name === 'DeepSeek V4.1 Flash' || m.id === 'deepseek-v4.1-flash' || m.id === 'deepseek-flash'));
          if (flash) {
            if (state.model.id !== flash.id) { await pi.request('set_model', { provider: flash.provider, modelId: flash.id }); state = await pi.request('get_state'); }
            await this.piFiles.saveSettings({ defaultProvider: flash.provider, defaultModel: flash.id });
          }
        }
      }
      this.lastPiState = state;
      return state;
    })();
    try { return await this.piStarting; }
    finally { this.piStarting = null; }
  }
  async piCommand(command, p) {
    // File-backed capabilities are available before the CLI is connected/installed.
    if (command === 'pi-auth-status') return this.piFiles.authStatus();
    if (command === 'pi-auth-set') return this.piFiles.setKey(p.provider, p.apiKey);
    if (command === 'pi-auth-remove') return this.piFiles.removeKey(p.provider);
    if (command === 'pi-models-get') return this.piFiles.models();
    if (command === 'pi-models-set') return this.piFiles.saveModels(p);
    if (command === 'pi-settings-get') return this.piFiles.settings();
    if (command === 'pi-settings-set') return this.piFiles.saveSettings(p);
    // 茶茶的确认方式（自主 / 每次都问）：扩展每次确认前现读，改了马上生效
    if (command === 'pi-permissions-get') return readPermissions(this.piConfigDir);
    if (command === 'pi-permissions-set') return savePermissions(this.piConfigDir, p);
    if (command === 'pi-tools') return { tools: platformToolCatalog() };
    if (command === 'pi-sessions' || command === 'pi-session-delete') {
      if (this.pi?.running) this.lastPiState = await this.pi.request('get_state');
      const current = this.lastPiState?.sessionFile;
      return command === 'pi-sessions' ? listSessions(this.piSessionDir, current) : trashSession(this.piSessionDir, p.path, current);
    }
    if (command === 'pi-info') {
      const config = await this.piConfig();
      const quote = s => `'${s.replaceAll("'", "''")}'`;
      return { configDir: config.configDir, connected: !!this.pi?.running,
        loginCommand: `$env:PI_CODING_AGENT_DIR = ${quote(config.configDir)}\n& ${quote(config.nodePath)} ${quote(config.piEntry)}` };
    }
    if (command === 'pi-connect') return this.connectPi();
    if (command === 'pi-reconnect') {
      if (this.piBusy || this.piCompacting) fail('agent_busy', '先停止当前任务或等待压缩完成，再重新连接。');
      if (this.pi?.running) this.lastPiState = await this.pi.request('get_state');
      await this.closePi();
      return this.connectPi();
    }
    if (command === 'pi-close') { await this.closePi(); return { status: 'closed' }; }
    if (!['pi-cancel', 'pi-ui-response', 'pi-command'].includes(command)) fail('unknown_command', '未知的 Pi 命令。');
    if (!this.pi?.running) fail('pi_disconnected', '请先连接 Pi CLI。');
    if (command === 'pi-cancel') return this.pi.cancel();
    if (command === 'pi-ui-response') return this.pi.answerUi(p.dialogId, p.answer);
    if (command === 'pi-command') {
      const params = p.params ?? {};
      if (this.piCompacting && ['new_session', 'switch_session', 'fork', 'clone', 'set_model', 'set_thinking_level'].includes(p.type)) fail('agent_busy', '请等待会话压缩完成，再切换会话或模型设置。');
      if (p.type === 'compact') {
        if (this.piCompacting) fail('agent_busy', '正在压缩会话，请等待完成。');
        this.piCompacting = true;
        try { return await this.pi.request(p.type, params); }
        finally { this.piCompacting = false; }
      }
      const result = await this.pi.request(p.type, params);
      if (p.type === 'set_model') await this.piFiles.saveSettings({ defaultProvider: result.provider, defaultModel: result.id });
      if (p.type === 'set_thinking_level') {
        const state = await this.pi.request('get_state');
        await this.piFiles.saveSettings({ defaultThinkingLevel: state.thinkingLevel });
        this.lastPiState = state;
      }
      if (p.type === 'set_auto_compaction') await this.piFiles.saveSettings({ autoCompaction: params.enabled });
      if (p.type === 'set_auto_retry') await this.piFiles.saveSettings({ autoRetry: params.enabled });
      if (p.type === 'get_state') this.lastPiState = result;
      if (['new_session', 'switch_session', 'fork', 'clone'].includes(p.type)) this.lastPiState = await this.pi.request('get_state');
      return result;
    }
    fail('unknown_command', '未知的 Pi 命令。');
  }
  async closePi() {
    if (this.piStarting) await this.piStarting.catch(() => {});
    if (this.pi) await this.pi.close();
    this.pi = null; this.piBusy = false;
  }
  piLifecycle(fn) {
    const result = this.piQueue.then(fn);
    this.piQueue = result.catch(() => {});
    return result;
  }
  async close() {
    for (const [id, w] of this.uiPending ?? []) { this.uiPending.delete(id); w.reject(Object.assign(new Error('Matcha 正在关闭。'), { code: 'ui_unavailable' })); }
    clearInterval(this.sdkTimer); await this.storage.worker; await this.sdkUpdates.close(); await this.community.close(); await this.bilibili.close(); await this.tasks.close(); await this.gamemaps.close(); await this.queue; await this.piQueue; await this.piFiles.queue; await this.closePi(); await this.serverManager.close(); await this.workshop.close(); }
}
