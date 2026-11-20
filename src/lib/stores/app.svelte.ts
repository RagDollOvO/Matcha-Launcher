import { api, type LocalModInput, type Snapshot } from '../api';
import { serverApi } from '../api/servers';
import type { IntakeResult, L4nPluginPlan, LaunchConfiguration, LaunchMode, PlatformChangePlan } from '../types';
import { desktop, errorText, onBridgeEvent, pickDll, restoreWindow, windowAction } from '../api/bridge';
import { prefs } from './prefs.svelte';
import { sfx } from '../sound/sfx.svelte';
import { systemNotify } from './system-notify';
import { gameSettings } from './game-settings.svelte';
import { modeLabel } from '../launch-modes';
import { isMissingCommand } from '../api/launcher';
import { libraryUpdate, markOfferNotified, needsDownload, offerDismissed, offerNotified, sizeLabel } from '../plugins/native-offer';
import { screeningConfirm } from '../plugins/safety';
import type { Category, CfgEntry, Conflict, ExternalPlatform, Mod, ModMeta, ModTask, PlatformOperation, PlatformPlan, PlatformPlugin, PlatformRelease, PluginAction, Profile, Route, Server, ServerGroup, ServerLayout, TrashEntry } from '../types';

/** Mod 页最外层（不属于任何分类） */
export const ROOT = 'all';
/** Mod 页侧栏「库」里的三个视图，和分类 id 共用 modFilter.category */
export const FAV = 'fav';
export const INBOX = 'inbox';
export const TRASH = 'trash';
/** 服务器页「未分组」：不在任何合集里的服务器，固定排在最后 */
export const LOOSE = 'loose';
export interface ServerSection { id: string; name: string; servers: Server[]; loose?: boolean }

/** 确认框里的结构化内容：删除、永久删除用 */
export interface ConfirmExtra {
  /** 要处理的条目；modId 对得上库里的 Mod 时显示缩略图 */
  items?: { modId?: string; trashId?: string; title: string; files: { file: string; size: number }[]; sizeBytes: number }[];
  /** 条目超出显示上限的数量 */
  more?: number;
  /** 要点：左边标签、右边内容 */
  facts?: { label: string; value: string; danger?: boolean }[];
  /** 需要用户先处理的事，例如在 Steam 取消订阅；links 可逐条复制 */
  warn?: { title: string; text: string; links?: string[] };
  /** 带标题的两列清单：平台计划的文件变化、模块调整等 */
  lists?: { title: string; rows: { k: string; v: string }[] }[];
}

const bytesLabel = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;
const verificationLabel = (v?: { state: string; integrity?: string }) =>
  !v ? '未返回' : v.state === 'rejected' ? '核验未通过' : v.state === 'unverified' ? '本地包，没有发行签名' : '发行签名已核验';

let uid = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}${(uid++).toString(36)}`;

export type LaunchState = 'idle' | 'launching' | 'requested' | 'running';

class AppState {
  ready = $state(false);
  error = $state('');
  busy = $state('');
  refreshing = $state(false);
  private pendingRefresh: Promise<void> | null = null;
  private refreshFailed = false;
  checkedAt = $state('');
  issues = $state<Snapshot['issues']>([]);
  installations = $state<Snapshot['installations']>([]);
  capabilities = $state<Snapshot['capabilities']>({ plugins: true, mods: false, servers: false, config: false });
  confirmation = $state<{ title: string; message: string; ok?: string; extra?: ConfirmExtra; resolve: (approved: boolean) => void } | null>(null);
  route = $state<Route>('home');
  /** 下载页「查看」：Mod 页打开时定位到这个 Mod 并展开详情 */
  focusMod = $state<string | null>(null);
  agentOpen = $state(false);
  friendsOpen = $state(false);

  game = $state<Snapshot['game']>(null!);
  mods = $state<Snapshot['mods']>([]);
  modState = $state<Snapshot['modState']>({ writable: false, addonListPath: '' });
  lastModBackup = $state('');
  categories = $state<Snapshot['categories']>([]);
  /** 收藏等跨方案标记；后端未接入 modMeta 前存在本机 */
  modMeta = $state<Record<string, ModMeta>>({});
  favoriteCollections = $state<NonNullable<Snapshot['favoriteCollections']>>([]);
  favoriteRefs = $state<NonNullable<Snapshot['favoriteRefs']>>({});
  favoriteEntries = $derived([...this.mods.filter(m => !!this.modMeta[m.id]?.favorite), ...Object.values(this.favoriteRefs)]);
  private metaRemote = false;
  private metaLoaded = false;
  /** Matcha 回收站 */
  trash = $state<TrashEntry[]>([]);
  /** 后台任务：创意工坊下载、解包 */
  tasks = $state<ModTask[]>([]);
  private doneDownloads: ModTask[] = [];
  private doneTimer: ReturnType<typeof setTimeout> | undefined;
  profiles = $state<Snapshot['profiles']>([]);
  activeProfileId = $state('');
  /** Mod 页正在编辑的方案，可与启动方案不同 */
  editingProfileId = $state('');
  conflicts = $state<Snapshot['conflicts']>([]);
  runtime = $state<Snapshot['runtime']>(null!);
  dxvk = $state<Snapshot['dxvk']>(null!);
  plugins = $state<Snapshot['plugins']>([]);
  availablePlugins = $state<PlatformPlugin[]>([]);
  nativeLibraries = $state<Snapshot['nativeLibraries']>();
  /** L4N 子插件（只读展示用） */
  l4nPlugins = $state<Snapshot['l4nPlugins']>();
  /** 外部平台包（Skeeto 等） */
  platforms = $state<ExternalPlatform[]>([]);
  externalPacks = $state<import('../types').ExternalPackRecord[]>([]);
  /** 插件页正在查看的外部平台；null = 插件列表 */
  platformOpen = $state<string | null>(null);
  servers = $state<Snapshot['servers']>([]);
  /** 服务器合集；本机保留待保存副本，收到后端回执后清理 */
  serverLayout = $state<ServerLayout>({ groups: [], loose: [] });
  private layoutRemote = false;
  private layoutLoaded = false;
  /** 正在保存的布局请求数；期间不让轮询回来的旧布局盖掉刚拖好的顺序 */
  private layoutSaving = 0;
  private layoutDirty = false;
  private layoutBase: ServerLayout | undefined;
  serverLayoutConflict = $state(readLocal<boolean>('flare.serverLayout.conflict', false));
  private layoutWrites: Promise<void> = Promise.resolve();
  /** 规范化后的合集：只含现存服务器、不重复；未分组在最后 */
  serverSections = $derived.by(() => sectionsOf(this.serverLayout, this.servers));
  /** 服务器 id → 所在合集与序号（从 1 开始），卡片编号用 */
  serverPlace = $derived.by(() => {
    const out = new Map<string, { group: string; index: number }>();
    for (const sec of this.serverSections) sec.servers.forEach((s, i) => out.set(s.id, { group: sec.id, index: i + 1 }));
    return out;
  });
  private queuedQueries = new Set<string>();
  cfg = $state<CfgEntry[]>([]);
  cfgDirty = $state(false);

  launchState = $state<LaunchState>('idle');
  /** 这次启动后按设置把窗口最小化了；游戏退出时据此叫回前台 */
  private minimizedForGame = false;
  launchConfig = $state<LaunchConfiguration>({ mode: 'modded', label: 'L4N 平台启动', route: 'game-exe', vacMode: 'game-default', launchOptions: gameSettings.args('modded') });
  requestedMode: LaunchMode = 'development';
  launchedAt = $state<number | null>(null);
  requestedAt = 0;
  serversRefreshing = $state(false);
  modFilter = $state<{ category: string; status: 'all' | 'on' | 'off' | 'conflict'; q: string }>({ category: 'all', status: 'all', q: '' });
  toasts = $state<Toast[]>([]);

  activeProfile = $derived(this.profiles.find((p) => p.id === this.activeProfileId));
  editingProfile = $derived(this.profiles.find((p) => p.id === this.editingProfileId));

  async init() {
    await this.refresh();
    return onBridgeEvent(event => {
      if (event.type === 'objects_changed') void this.refresh();
      if (event.type === 'open_downloads') this.route = 'downloads';
      if (event.type === 'task_progress') { const { type: _, ...task } = event; this.onTask(task as ModTask); }
      if (event.type === 'servers_changed') void serverApi.state().then(state => {
        this.servers = state.servers; this.acceptLayout(state.serverLayout);
      }).catch(e => {
        if ((e as { code?: string }).code === 'unsupported_capability') void serverApi.list().then(rows => { this.servers = rows; }).catch(error => this.toast(errorText(error)));
        else this.toast(errorText(e));
      });
      if (event.type === 'bridge_exit') this.error = '本地服务已退出，请重新打开 Matcha。';
    });
  }
  private accept(s: Snapshot) {
    Object.assign(this, {
      game: s.game, mods: s.mods, modState: s.modState ?? { writable: false, addonListPath: '' }, categories: s.categories, profiles: s.profiles,
      activeProfileId: s.activeProfileId,
      launchConfig: s.launch ?? this.launchConfig,
      conflicts: s.conflicts, runtime: s.runtime, dxvk: s.dxvk, plugins: s.plugins, servers: s.servers, cfg: s.cfg,
      issues: s.issues, installations: s.installations, capabilities: s.capabilities, checkedAt: s.checkedAt,
      platforms: s.platforms ?? [],
      externalPacks: s.externalPacks ?? [],
      availablePlugins: s.availablePlugins ?? [],
      nativeLibraries: s.nativeLibraries,
      l4nPlugins: s.l4nPlugins,
    });
    this.acceptMeta(s.modMeta);
    this.favoriteCollections = s.favoriteCollections ?? [];
    this.favoriteRefs = s.favoriteRefs ?? {};
    this.offerNativeOnce();
    this.trash = s.trash ?? [];
    this.acceptTasks(s.tasks);
    this.acceptLayout(s.serverLayout);
    if (!this.profiles.some(p => p.id === this.editingProfileId)) this.editingProfileId = s.activeProfileId;
    if (s.game.running) {
      // 从 Matcha 发起的启动，检测到游戏进程：按设置把启动器收起来
      if ((this.launchState === 'requested' || this.launchState === 'launching') && desktop && prefs.afterLaunch === 'minimize') {
        this.minimizedForGame = true;
        void windowAction('minimize').catch(() => { this.minimizedForGame = false; });
      }
      this.launchState = 'running';
      this.launchedAt ??= Date.now();
    } else if (this.launchState !== 'launching') {
      if (this.launchState === 'running' && this.minimizedForGame) { this.minimizedForGame = false; void restoreWindow(); }
      if (this.launchState !== 'requested' || Date.now() - this.requestedAt > 45000) {
        if (this.launchState === 'requested') this.toast(this.requestedMode === 'direct' ? '游戏尚未保持运行，请检查游戏弹窗、Steam 登录状态与日志。' : '尚未检测到游戏进程，请检查 Steam 的启动提示。');
        this.launchState = 'idle'; this.launchedAt = null;
      }
    }
    this.ready = true;
  }
  refresh(): Promise<void> {
    if (this.pendingRefresh) return this.pendingRefresh;
    this.refreshing = true;
    this.pendingRefresh = (async () => {
      try { this.accept(await api.loadSnapshot()); if (this.refreshFailed) this.error = ''; this.refreshFailed = false; }
      catch (e) { this.error = errorText(e); this.refreshFailed = true; }
      finally { this.refreshing = false; this.pendingRefresh = null; }
    })();
    return this.pendingRefresh;
  }
  /** ok：确认按钮的文字，缺省为「确认执行」；extra：文件清单、要点、提醒等结构化内容 */
  confirm(title: string, message: string, ok?: string, extra?: ConfirmExtra): Promise<boolean> {
    if (this.confirmation) return Promise.resolve(false);
    return new Promise(resolve => { this.confirmation = { title, message, ok, extra, resolve }; });
  }
  answerConfirmation(approved: boolean) {
    this.confirmation?.resolve(approved); this.confirmation = null;
  }
  async perform<T>(label: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    if (this.busy) return;
    this.busy = label; this.error = '';
    try {
      const result = await fn();
      await this.pendingRefresh;
      await this.refresh();
      if (success) this.notify({ text: success, kind: 'ok' });
      return result;
    } catch (e) { this.error = errorText(e); this.notify({ text: this.error, kind: 'error', ms: 5000 }); }
    finally { this.busy = ''; }
  }
  async selectGame(root: string) {
    return this.perform('检查游戏目录', async () => this.accept(await api.selectGame(root)), '游戏目录已更新');
  }
  async installRuntime() {
    await this.perform('部署 DLL 运行时', async () => {
      const plan = await api.planInstall();
      if (!await this.confirm('部署 DLL 运行时', `目标：${plan.gameRoot}\n\n通过 L4N 的子插件目录加载 Matcha Runtime。游戏 EXE 和 DXVK 文件保持原样。`)) return;
      await api.applyInstall(plan.id);
      this.toast('DLL 运行时已部署，下次完整启动时生效');
    });
  }
  async restoreRuntime(recover = false) {
    await this.perform(recover ? '恢复在途操作' : '恢复原入口', async () => {
      if (!await this.confirm(recover ? '恢复在途操作' : '恢复游戏原入口', `${this.game.root}\n\n恢复平台拥有的入口；模组、配置和日志保留在 bin\\l4p。`)) return;
      await (recover ? api.recover() : api.restore()); this.toast('恢复操作已完成');
    });
  }
  async resumeRuntime() {
    await this.perform('重新启用 DLL 运行时', async () => {
      if (!await this.confirm('重新启用 DLL 运行时', `${this.game.root}\n\n恢复此前保存的 Matcha 加载器，保留模组、设置和启停列表。`)) return;
      await api.resumeRuntime(); this.toast('DLL 运行时已启用，可用「L4N 平台启动」');
    });
  }
  /** 还没装、但 Matcha 随包附带的依赖 */
  bundledDeps(dependencies: { id: string; version: string }[] = []) {
    return dependencies.flatMap(d => {
      if (this.plugins.some(p => p.id === d.id)) return [];
      const bundled = this.availablePlugins.find(p => p.id === d.id && p.version === d.version && p.loadRole === 'dependency');
      return bundled?.packageDirectory ? [bundled] : [];
    });
  }
  /** 检查通过的标准 SDK 包：按后端计划确认导入或同 ID 更新，显示宿主和最终文件清单。 */
  async importIntake(intake: IntakeResult): Promise<boolean> {
    const m = intake.manifest;
    if (intake.outcome !== 'sdk-ready' || !intake.candidateId || !m) return false;
    return !!await this.perform('导入 DLL 模组', async () => {
      const plan = await api.pluginIntakeImportPreview(intake.intakeId, intake.candidateId!);
      const updating = plan.operation === 'update';
      const deps = this.bundledDeps(m.dependencies);
      const total = plan.files.reduce((s, f) => s + f.bytes, 0);
      // 危险筛查：拦截的不给装，敏感能力列出来让玩家知道
      const screening = plan.screening ?? intake.screening;
      const safety = screeningConfirm(screening);
      if (screening?.tier === 'blocked') {
        await this.confirm('这个包被拦下了', `${m.name} · v${m.version}\n\n危险筛查命中了禁止项，Matcha 不会装它。原文件和游戏目录都没动。`, '知道了', { facts: [safety.fact], lists: safety.list ? [safety.list] : [] });
        return false;
      }
      const ok = await this.confirm(updating ? '更新 DLL 模组' : '导入 DLL 模组', `${m.name} · v${m.version}\nID：${m.id}`, updating ? '更新' : '导入', {
        facts: [
          { label: '宿主', value: plan.host === 'l4n' ? 'L4N 子插件' : 'Matcha 加载器' },
          { label: '目标', value: `${plan.gameRoot}\\bin\\${plan.host === 'l4n' ? 'neko' : 'l4p'}\\plugins` },
          { label: '核验', value: verificationLabel(plan.verification) },
          safety.fact,
          ...(deps.length ? [{ label: '一并安装', value: deps.map(p => p.name).join('、') }] : []),
          ...(updating ? [{ label: '版本', value: `从 v${plan.previousVersion} 更新到 v${plan.version}` },
            { label: '更新后', value: `保留配置和启停状态（${plan.enabled ? '启用' : '停用'}），旧包完整备份` }]
            : [{ label: '导入后', value: '默认停用，在功能列表里打开后下次启动生效' }]),
        ],
        lists: [...(safety.list ? [safety.list] : []), { title: `导入的文件 · 共 ${bytesLabel(total)}`, rows: plan.files.slice(0, 60).map(f => ({ k: f.path, v: bytesLabel(f.bytes) })) }],
        warn: { title: 'DLL 会在游戏进程里运行', text: '它以你当前的用户权限运行。危险筛查只是静态检查，证明不了一定安全，请确认来源可信。作者的压缩包保持原样，可以随时停用。' },
      });
      if (!ok) return false;
      for (const dependency of deps) await api.installPlugin(dependency.packageDirectory!);
      const r = await api.pluginIntakeImport(plan.planId);
      const done = updating ? '已更新，配置与启停状态已保留' : '已导入，当前停用';
      if (r.metadataWarning) this.toast(`${done}。来源资料没登记上：${r.metadataWarning.message}`, undefined, 7000);
      else this.toast(done);
      return true;
    });
  }
  /** 导入失败但可以交给 Agent 的包：列出问题，问要不要交给 Agent */
  private async offerAgent(e: unknown, updatePluginId?: string): Promise<boolean> {
    const { code, details } = e as { code?: string; details?: IntakeResult };
    if (code !== 'plugin_needs_agent' && code !== 'plugin_package_rejected' || !details?.issues) return false;
    const agentOk = code === 'plugin_needs_agent' && details.agent?.available;
    const go = await this.confirm(agentOk ? '这个包需要茶茶整理' : '这个包没法导入', agentOk
      ? '茶茶会按实际宿主和文件布局在暂存区整理，再给你确认。作者的文件保持原样。'
      : '原文件和游戏目录都没动。请核对作者的完整发行包，或者重新下载后再试。',
      agentOk ? '交给茶茶整理' : '知道了',
      { lists: [{ title: '检查结果', rows: details.issues.map(i => ({ k: i.file ?? '—', v: i.message })) }] });
    if (go && agentOk) {
      const { askAgent } = await import('../plugins/intake');
      const target = updatePluginId ? `\n这是已有模组 ${updatePluginId} 的更新包。先用 dll_inventory 查询该 ID，核对来源和宿主；普通整体 DLL 用 dll_package_prepare 的 updatePluginId 绑定此目标，SDK 包保留作者的同 ID 声明。` : '';
      this.toast(askAgent(details.agent.prompt + target) === 'sent' ? '已交给茶茶，进度在右侧对话里' : '茶茶还没准备好，指令先放进对话框了');
    }
    return true;
  }
  async importPlugin(directory: string, updatePluginId?: string): Promise<boolean> {
    return !!await this.perform('导入 DLL 模组', async () => {
      let prepared;
      try { prepared = await api.validatePlugin(directory); }
      catch (e) { if (await this.offerAgent(e, updatePluginId)) return false; throw e; }
      const { manifest } = prepared;
      if (updatePluginId && (manifest.id !== updatePluginId || !this.plugins.some(p => p.id === updatePluginId && p.installed !== false)))
        throw new Error('所选包与当前更新目标的 ID 有差异，或目标已移除，请核对同一模组的发行包。');
      directory = prepared.preparedDirectory ?? directory;
      const installed = this.plugins.find(p => p.id === manifest.id && p.installed !== false);
      const deps = this.bundledDeps(manifest.dependencies);
      const dependencies = deps.length ? `\n一并安装：${deps.map(p => p.name).join('、')}。` : '';
      const detail = installed ? `从 ${installed.version} 更新到 ${manifest.version}。保留配置和启停状态，旧包完整备份。` : '导入后默认停用。';
      if (!await this.confirm(installed ? '更新 DLL 模组' : '导入 DLL 模组', `${manifest.name} · ${manifest.version}\nID：${manifest.id}\n来源：${directory}\n目标：${this.game.root}\\bin\\l4p\\plugins${dependencies}\n\nDLL 将以当前用户权限在游戏进程内运行，请确认来源可信。${detail}`)) return false;
      for (const dependency of deps) await api.installPlugin(dependency.packageDirectory!);
      if (installed) { await api.updatePlugin(directory); this.toast('模组已更新，配置与启停状态已保留'); }
      else { await api.installPlugin(directory); this.toast('模组已导入，当前停用'); }
      return true;
    });
  }
  async invokePlugin(plugin: PlatformPlugin, action: PluginAction, args: Record<string, unknown>) {
    return this.perform(action.label, async () => {
      const needsApproval = action.effect === 'write' || action.requiresConfirmation;
      if (needsApproval && !await this.confirm(action.label, `模组：${plugin.name}\nPID：${this.game.pid}\n参数：${JSON.stringify(args, null, 2)}`)) return;
      if (!this.game.pid) throw new Error('等待游戏启动并连接 Matcha 加载器。');
      return api.invoke(this.game.pid, plugin.id, action.id, args, needsApproval);
    });
  }

  // ---------- 查询 ----------
  mod(id: string): Mod | undefined { return this.mods.find((m) => m.id === id); }
  profile(id: string): Profile | undefined { return this.profiles.find((p) => p.id === id); }

  /** 只有两边都在该方案里启用，冲突才算“生效中” */
  activeConflicts(profile: Profile | undefined): Conflict[] {
    if (!profile) return [];
    const on = new Set(profile.modIds);
    return this.conflicts.filter((c) => on.has(c.a) && on.has(c.b));
  }
  conflictsOf(modId: string, profile: Profile | undefined): Conflict[] {
    return this.activeConflicts(profile).filter((c) => c.a === modId || c.b === modId);
  }
  categoryCount(catId: string): number { return this.mods.filter((m) => m.categoryId === catId).length; }

  // ---------- 方案 ----------
  async setActiveProfile(id: string, silent = false) {
    try { await api.selectProfile(id); } catch (e) { this.toast(errorText(e)); return; }
    this.activeProfileId = id;
    if (!silent) this.toast(`启动方案已切换为「${this.profile(id)?.name}」`);
  }
  /** 主页左右切换方案 */
  cycleProfile(step: 1 | -1) {
    const i = this.profiles.findIndex((p) => p.id === this.activeProfileId);
    const next = this.profiles[(i + step + this.profiles.length) % this.profiles.length];
    this.setActiveProfile(next.id, true);
  }
  /** opts.modIds：新方案直接带上这些 Mod；opts.open = false 时不切换正在编辑的方案 */
  createProfile(name: string, fromId?: string, opts: { modIds?: string[]; open?: boolean } = {}) {
    const src = fromId ? this.profile(fromId) : undefined;
    const p: Profile = {
      id: newId('p'), name, note: src ? `复制自「${src.name}」` : '',
      modIds: opts.modIds ? [...opts.modIds] : src ? [...src.modIds] : [], pluginIds: src ? [...src.pluginIds] : [],
      launchOptions: src?.launchOptions ?? '', updatedAt: today(), modsInitialized: true, modsGameRoot: this.game.root,
    };
    this.profiles.push(p);
    if (opts.open !== false) this.editingProfileId = p.id;
    void api.saveProfile(p).catch(e => this.toast(errorText(e)));
    return this.profiles[this.profiles.length - 1];
  }
  freshProfileName(base = '新方案') {
    for (let i = 1; ; i++) { const n = i === 1 ? base : `${base} ${i}`; if (!this.profiles.some((p) => p.name === n)) return n; }
  }
  renameProfile(id: string, name: string) {
    const p = this.profile(id);
    if (!p || !name.trim()) return;
    p.name = name.trim();
    this.touch(p);
  }
  async deleteProfile(id: string) {
    if (this.profiles.length <= 1) return this.toast('至少保留一个方案');
    try { await api.deleteProfile(id); } catch (e) { this.toast(errorText(e)); return; }
    const name = this.profile(id)?.name;
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeProfileId === id) this.activeProfileId = this.profiles[0].id;
    if (this.editingProfileId === id) this.editingProfileId = this.profiles[0].id;
    this.toast(`已删除方案「${name}」`);
  }

  // ---------- Mod ----------
  isEnabled(modId: string, profile = this.editingProfile) { return !!profile?.modIds.includes(modId); }
  async setModsEnabled(ids: string[], enabled: boolean, profile = this.editingProfile, message?: string) {
    if (!profile) return;
    const set = new Set(profile.modIds);
    ids.forEach((id) => (enabled ? set.add(id) : set.delete(id)));
    const next = { ...$state.snapshot(profile), modIds: [...set], modsInitialized: true, modsGameRoot: this.game.root, updatedAt: today() };
    await this.perform('保存 Mod 方案', () => api.saveProfile(next), message ?? `已保存到「${profile.name}」`);
  }

  // ---------- 收藏（modMeta） ----------
  isFavorite(id: string) { return !!this.modMeta[id]?.favorite || !!this.favoriteRefs[id]; }
  favoriteIds(): string[] { return this.favoriteEntries.map(m => m.id); }
  favoriteMod(id: string) {
    const ref=this.favoriteRefs[id];
    return ref ? (ref.library?.gameRoot.toLowerCase()===this.game.root.toLowerCase() ? this.mod(ref.library!.modId) : undefined) : this.mod(id);
  }
  importFavoriteSources(ids:string[]) {
    const root=this.game.root;
    return this.perform('导入收藏文件',async()=>{
      for (const id of ids) {
        const ref=this.favoriteRefs[id];
        if (!ref || this.favoriteMod(id)) continue;
        const input=await api.previewModInput(ref.absolutePath);
        if (input.kind!=='vpk' && input.kind!=='folder') throw new Error('收藏的来源文件已变化：'+ref.title);
        if (input.targetExists) throw new Error('Mod 库里已有「'+input.name+'」。请在库里确认现有版本，或给来源改名后重新收藏。');
        if (input.kind==='folder') {
          const task=await api.packModFolder(input,root,ROOT,id);
          const done=await this.waitTask(task.taskId);
          if (done.state!=='done') throw new Error(done.error?.message??'文件夹打包未完成');
        } else await api.importMod(input,root,id);
      }
      return true;
    }).then(async result=>{ if (!result) await this.refresh(); return result; });
  }
  applyFavorites(ids:string[],profiles:string[]) {
    return this.perform('保存方案成员',()=>api.favoriteToProfiles(ids,profiles,this.game.root));
  }
  async bookmarkFiles(paths: string[], collectionId?: string) {
    const result = await this.perform('保存到收藏夹', () => api.bookmarkFiles(paths, collectionId));
    if (result) this.notify({kind:result.skipped.length ? 'info' : 'ok', text:'已收进' + (this.favoriteCollections.find(c => c.id === collectionId)?.name ?? '收藏夹') + ' · ' + result.count + ' 项' + (result.skipped.length ? '；' + result.skipped.join('；') : '')});
    return result;
  }
  editFavoriteCollection(edit: Parameters<typeof api.editFavoriteCollection>[0]) {
    return this.perform('保存收藏合集', () => api.editFavoriteCollection(edit));
  }
  setFavorite(ids: string[], favorite: boolean) {
    this.patchMeta(ids, (m) => { if (favorite) m.favorite = true; else delete m.favorite; });
    if (!favorite) {
      const removed = new Set(ids);
      for (const id of removed) delete this.favoriteRefs[id];
      for (const c of this.favoriteCollections) c.modIds = c.modIds.filter(id => !removed.has(id));
    }
    // 单个点星标有即时视觉反馈，不再弹提示
    if (ids.length > 1) this.toast(favorite ? `已收藏 ${ids.length} 个 Mod` : `已取消收藏 ${ids.length} 个 Mod`);
  }

  // ---------- 新下载（modMeta.inbox）：下载完成、还没整理 ----------
  isInbox(id: string) { return !!this.modMeta[id]?.inbox; }
  inboxIds(): string[] { return this.mods.filter((m) => this.isInbox(m.id)).map((m) => m.id); }
  /** 「标记已整理」：离开新下载，其余标记不变 */
  markSorted(ids: string[]) {
    const list = ids.filter((id) => this.isInbox(id));
    if (!list.length) return;
    this.patchMeta(list, (m) => { delete m.inbox; });
    if (list.length > 1) this.toast(`${list.length} 个 Mod 已标记为整理过`);
  }
  /** 改分类、加入方案后后端会自动清掉 inbox；这里先在本地同步，不用等下一次快照 */
  private dropInbox(ids: string[]) {
    const list = ids.filter((id) => this.isInbox(id));
    if (!list.length) return;
    if (this.metaRemote) for (const id of list) { const next = { ...this.modMeta[id] }; delete next.inbox; this.modMeta[id] = next; }
    else this.patchMeta(list, (m) => { delete m.inbox; });
  }
  /** 按 id 改标记；改完为空的记录发 null 删除 */
  private patchMeta(ids: string[], edit: (m: ModMeta) => void) {
    const patch: Record<string, ModMeta | null> = {};
    for (const id of ids) {
      const next: ModMeta = { ...this.modMeta[id] };
      edit(next);
      for (const k of Object.keys(next) as (keyof ModMeta)[]) if (next[k] === undefined || next[k] === false) delete next[k];
      if (Object.keys(next).length) { this.modMeta[id] = next; patch[id] = next; }
      else { delete this.modMeta[id]; patch[id] = null; }
    }
    this.persistMeta(patch);
  }
  private acceptMeta(remote: Snapshot['modMeta']) {
    if (remote) {
      this.metaRemote = true;
      const local = readLocalMeta();
      if (Object.keys(local).length) {
        // 后端接入后，把之前暂存在本机的标记合并上去一次
        this.modMeta = { ...remote, ...local };
        void api.saveModMeta(local).then(() => clearLocalMeta()).catch(e => this.toast(errorText(e)));
      } else this.modMeta = remote;
    } else if (!this.metaLoaded) {
      this.modMeta = readLocalMeta();
    }
    this.metaLoaded = true;
  }
  private persistMeta(patch: Record<string, ModMeta | null>) {
    if (this.metaRemote) void api.saveModMeta(patch).catch(e => { this.toast(errorText(e)); void this.refresh(); });
    else writeLocalMeta($state.snapshot(this.modMeta));
  }
  toggleMod(id: string) { this.setModsEnabled([id], !this.isEnabled(id)); }
  async syncMods(profile = this.editingProfile) {
    if (!profile) return;
    await this.perform('同步游戏启用项', async () => {
      if (!await this.confirm('从游戏同步 Mod 方案', `用游戏的 Mod 设置覆盖「${profile.name}」的勾选。尚未登记的有效 VPK 默认勾选。`)) return;
      const next = { ...$state.snapshot(profile), modIds: this.mods.filter(m => !m.error && m.enabled !== false).map(m => m.id), modsInitialized: true, modsGameRoot: this.game.root, updatedAt: today() };
      await api.saveProfile(next); this.toast('已从游戏同步');
    });
  }
  async applyMods(profile = this.editingProfile) {
    if (!profile) return;
    await this.perform('应用 Mod 方案', async () => {
      const conflicts = this.activeConflicts(profile).length;
      if (!await this.confirm('应用 Mod 方案', `「${profile.name}」· ${profile.modIds.length} 个启用项\n${this.modState.addonListPath}\n\n备份原配置，写入 Mod 启停状态，并设为启动方案。其余条目保留，下次完整启动生效。${conflicts ? `\n\n此方案有 ${conflicts} 组资源路径重叠，游戏将按实际加载顺序处理。` : ''}`)) return;
      const result = await api.applyModProfile(profile.id);
      this.lastModBackup = result.backup ?? '';
      this.toast('Mod 方案已应用，下次完整启动生效');
    });
  }
  /** 一次确认：现成 VPK 直接导入，散装素材交给后台打包。分类在松手时确定。 */
  async importMods(paths: string[], categoryId = ROOT) {
    const root = this.game.root;
    const imported = await this.perform('准备导入 Mod', async () => {
      const inputs: LocalModInput[] = [], notes: string[] = [];
      let shards = 0;
      for (const file of new Set(paths)) {
        const name = file.split(/[\\/]/).pop() || file;
        try {
          const item = await api.previewModInput(file);
          if (item.kind === 'vpk' || item.kind === 'folder') inputs.push(item);
          else if (item.kind === 'shard') shards++;
          else notes.push(`${name}：请选择 VPK 或素材文件夹。`);
        } catch (e) { notes.push(`${name}：${errorText(e)}`); }
      }
      if (shards) notes.push(`已跳过 ${shards} 个分卷数据文件；分卷包请选择 _dir.vpk。`);
      if (!inputs.length) throw new Error(notes.join('\n') || '请选择 VPK 或素材文件夹。');
      const names = new Set<string>();
      for (const item of inputs) {
        const key = item.name.toLowerCase();
        if (names.has(key)) throw new Error(`选中的素材会生成同一个文件「${item.name}」。请一次只导入其中一份。`);
        names.add(key);
      }
      const only = inputs.length === 1 ? inputs[0] : null;
      const conflicts = inputs.filter(item => item.targetExists);
      const title = conflicts.length ? (only ? '替换同名 Mod？' : `有 ${conflicts.length} 个同名 Mod，确认替换？`) : only?.kind === 'folder' ? '打包并导入文件夹' : only ? '导入 VPK Mod' : `导入 ${inputs.length} 个 Mod`;
      const target = root + '\\left4dead2\\addons';
      const facts = only ? [
        { label: '来源', value: only.file },
        ...(only.kind === 'folder' ? [
          { label: '生成', value: only.name },
          { label: '包内', value: only.prefix ? `保留 ${only.prefix}/ 目录` : '保留文件夹内的目录结构' },
        ] : [{ label: 'VPK', value: `${only.title} · ${mib(only.sizeMB * 1048576)} · ${only.fileCount} 个资源 · 复制 ${only.files.length} 个文件` }]),
      ] : [];
      facts.push({ label: '目标', value: target });
      const category = this.categories.find(c => !c.builtin && c.id === categoryId);
      const previous = only?.targetExists ? this.mod(only.name.toLowerCase()) : undefined;
      if (category || previous) facts.push({ label: '导入后分类', value: this.categoryLabel(category?.id ?? previous!.categoryId) });
      const rows = inputs.map(item => ({
        k: item.name, v: conflicts.length ? (item.targetExists ? '替换旧包' : '新增') : item.kind === 'folder' ? '文件夹 → VPK' : `${mib(item.sizeMB * 1048576)} · ${item.fileCount} 个资源`,
      }));
      for (const item of inputs) if (item.kind === 'vpk' && item.warning) notes.push(`${item.name}：${item.warning}`);
      const explanation = conflicts.length
        ? `${only ? `目标目录已有「${only.name}」。` : ''}确认后，Matcha 会先备份同名旧包及其分卷，再用新包替换。导入的 Mod 会在当前启动方案中启用，下次启动游戏时生效。`
        : '导入后在当前启动方案中启用，下次启动游戏时生效。';
      const action = conflicts.length ? (only?.kind === 'folder' ? '打包并替换' : only ? '确认替换' : '确认导入并替换') : only?.kind === 'folder' ? '打包并导入' : '导入';
      if (!await this.confirm(title, explanation, action, {
        facts, lists: only ? [] : [{ title: '导入内容', rows }], ...(notes.length ? { warn: { title: '导入提示', text: notes.join('\n') } } : {}),
      })) return [];
      const ids: string[] = [], failed: string[] = []; let queued = 0, replaced = 0;
      for (const item of inputs) {
        try {
          if (item.kind === 'folder') { await api.packModFolder(item, root, categoryId); queued++; }
          else {
            const r = await api.importMod(item, root); ids.push(r.id); if (r.replaced) replaced++;
            if (!r.enabled) failed.push(`${item.name} 已导入，尚未加入当前启动方案。请检查方案的游戏目录和 Mod 状态。`);
          }
        } catch (e) { failed.push(`${item.name}：${errorText(e)}`); }
      }
      const message = [ids.length > replaced && `已导入 ${ids.length - replaced} 个 VPK`, replaced && `已替换 ${replaced} 个同名 Mod`, queued && `${queued} 个文件夹已加入打包队列`, ...failed].filter(Boolean).join('；');
      if (ids.length || failed.length) this.notify({ kind: failed.length ? 'error' : 'ok', text: message });
      return ids;
    });
    if (imported?.length && this.game.root === root && this.categories.some(c => c.id === categoryId && !c.builtin))
      this.moveToCategory(imported, categoryId);
  }
  /** catId 为 ROOT 或 'cat-none' 时移出分类，放回最外层 */
  moveToCategory(ids: string[], catId: string) {
    const target = catId === ROOT ? 'cat-none' : catId;
    const moved = this.mods.filter((m) => ids.includes(m.id) && m.categoryId !== target);
    for (const m of moved) m.categoryId = target;
    this.dropInbox(moved.map((m) => m.id));
    this.persistCategories();
  }

  // ---------- 分类：可嵌套的文件夹。最外层 = ROOT，未分类的 Mod 直接放在最外层 ----------
  private cat(id: string) { return this.categories.find((c) => c.id === id && !c.builtin); }
  /** Mod 所在分类；'cat-none' 或已失效的分类都算最外层 */
  folderOf(m: Mod): string { return this.cat(m.categoryId) ? m.categoryId : ROOT; }
  parentOf(c: Category): string { return c.parentId && c.parentId !== c.id && this.cat(c.parentId) ? c.parentId : ROOT; }
  childCategories(parentId: string): Category[] {
    return this.categories.filter((c) => !c.builtin && this.parentOf(c) === parentId)
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name, 'zh'));
  }
  async reorderCategory(id: string, targetId: string, after: boolean) {
    const source = this.cat(id), target = this.cat(targetId);
    if (!source || !target || source === target || this.parentOf(source) !== this.parentOf(target) || this.busy) return;
    const siblings = this.childCategories(this.parentOf(source)).map(c => c.id);
    const ids = siblings.filter(k => k !== id);
    ids.splice(ids.indexOf(targetId) + Number(after), 0, id);
    if (ids.every((k, i) => k === siblings[i])) return;
    const ranks = new Map(ids.map((k, i) => [k, i]));
    const categories = $state.snapshot(this.categories).map(c => ranks.has(c.id) ? {...c, order:ranks.get(c.id)!} : c);
    await this.perform('保存分类顺序', () => api.saveCategories(categories, {}));
  }
  /** 从最外层到 id 的路径（不含最外层） */
  categoryPath(id: string): Category[] {
    const out: Category[] = [];
    for (let c = this.cat(id); c && !out.includes(c); c = this.cat(this.parentOf(c))) out.unshift(c);
    return out;
  }
  categoryLabel(id: string): string { return this.categoryPath(id).map((c) => c.name).join(' / ') || '最外层'; }
  /** id 及其所有子孙分类 */
  subtree(id: string): Set<string> {
    const out = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of this.categories) if (!c.builtin && !out.has(c.id) && out.has(this.parentOf(c))) { out.add(c.id); grew = true; }
    }
    return out;
  }
  /** 树形顺序展开的全部分类，用于下拉框 */
  categoryTree(parentId = ROOT, depth = 0): { c: Category; depth: number }[] {
    return this.childCategories(parentId).flatMap((c) => [{ c, depth }, ...this.categoryTree(c.id, depth + 1)]);
  }
  private siblingTaken(name: string, parentId: string, except?: string) {
    return this.childCategories(parentId).some((c) => c.name === name && c.id !== except);
  }
  createCategory(name: string, parentId = ROOT): Category | undefined {
    const n = name.trim();
    if (!n) return;
    if (this.siblingTaken(n, parentId)) { this.toast('同一层已有这个分类名'); return; }
    const c: Category = { id: newId('cat'), name: n, ...(parentId !== ROOT ? { parentId } : {}) };
    this.categories.push(c);
    this.persistCategories();
    return this.categories[this.categories.length - 1];
  }
  /** 「新建分类」「新建分类 2」… 在同一层不重名 */
  freshCategoryName(parentId = ROOT) {
    for (let i = 1; ; i++) { const n = i === 1 ? '新建分类' : `新建分类 ${i}`; if (!this.siblingTaken(n, parentId)) return n; }
  }
  renameCategory(id: string, name: string) {
    const c = this.cat(id);
    const n = name.trim();
    if (!c || !n || n === c.name) return;
    if (this.siblingTaken(n, this.parentOf(c), id)) return this.toast('同一层已有这个分类名');
    c.name = n;
    this.persistCategories();
  }
  /** 把分类挪到另一个分类下（ROOT = 最外层）；不能挪进自己或子孙 */
  moveCategory(id: string, parentId: string): boolean {
    const c = this.cat(id);
    if (!c || this.parentOf(c) === parentId) return false;
    if (this.subtree(id).has(parentId)) { this.toast('不能把分类移到它自己里面'); return false; }
    if (this.siblingTaken(c.name, parentId)) { this.toast(`目标位置已有「${c.name}」`); return false; }
    if (parentId === ROOT) delete c.parentId; else c.parentId = parentId;
    delete c.order;
    this.persistCategories();
    this.toast(`「${c.name}」移到${parentId === ROOT ? '最外层' : `「${this.cat(parentId)?.name}」`}`);
    return true;
  }
  /** 删除分类只删“文件夹”：里面的 Mod 和子分类挪到上一级 */
  deleteCategory(id: string) {
    const c = this.cat(id);
    if (!c) return;
    const parent = this.parentOf(c);
    const mods = this.mods.filter((m) => m.categoryId === id);
    const subs = this.categories.filter((k) => k.parentId === id);
    for (const m of mods) m.categoryId = parent === ROOT ? 'cat-none' : parent;
    for (const k of subs) { if (parent === ROOT) delete k.parentId; else k.parentId = parent; delete k.order; }
    this.categories = this.categories.filter((x) => x.id !== id);
    if (this.modFilter.category === id) this.modFilter.category = parent;
    this.persistCategories();
    const where = parent === ROOT ? '最外层' : `「${this.cat(parent)?.name}」`;
    this.toast(mods.length || subs.length ? `已删除「${c.name}」，里面的内容移到${where}` : `已删除「${c.name}」`);
  }
  private persistCategories() {
    void api.saveCategories($state.snapshot(this.categories), Object.fromEntries(this.mods.map((m) => [m.id, m.categoryId]))).catch(e => this.toast(errorText(e)));
  }

  // ---------- 删除 → Matcha 回收站 ----------
  /** 返回是否真的删除了（用户取消、失败时为 false） */
  async deleteMods(ids: string[]): Promise<boolean> {
    if (!ids.length) return false;
    if (this.game.running) { this.toast('游戏运行中，退出后再删除'); return false; }
    let done = false;
    await this.perform('删除 Mod', async () => {
      const { mods: list, sizeBytes } = await api.previewDeleteMods(ids);
      if (!list.length) return;
      const one = list.length === 1 ? list[0] : null;
      const files = list.flatMap((t) => t.files);
      const names = [...new Set(list.flatMap((t) => t.profileIds))].map((id) => this.profile(id)?.name).filter(Boolean);
      const subscribed = list.filter((t) => t.files.some((f) => f.file.startsWith('workshop/')));
      const extra: ConfirmExtra = {
        items: list.slice(0, 12).map((t) => ({ modId: t.modId, title: t.title, files: t.files, sizeBytes: t.sizeBytes })),
        more: Math.max(0, list.length - 12),
        facts: [
          { label: '文件', value: `${files.length} 个 · ${mib(sizeBytes)}` },
          { label: '方案', value: names.length ? `从 ${names.join('、')} 中移除` : '不在任何方案里' },
          { label: '去向', value: 'Matcha 回收站，可以还原或永久删除' },
        ],
        warn: subscribed.length ? {
          title: one ? '这是 Steam 创意工坊订阅项' : `其中 ${subscribed.length} 个是 Steam 创意工坊订阅项`,
          text: '只删文件的话，Steam 会重新下载。请先在 Steam 里取消订阅。',
          links: subscribed.map((t) => workshopLink(t.workshopId ?? '')),
        } : undefined,
      };
      if (!await this.confirm(one ? `删除「${one.title}」` : `删除 ${list.length} 个 Mod`, '', '移到回收站', extra)) return;
      const { trashed } = await api.deleteMods(list.map((t) => t.modId));
      done = true;
      const trashIds = trashed.map((t) => t.trashId);
      this.toast(one ? `「${one.title}」已移到回收站` : `${trashed.length} 个 Mod 已移到回收站`, { label: '撤销', run: () => void this.restoreTrash(trashIds) });
    });
    return done;
  }
  async restoreTrash(trashIds: string[]) {
    if (!trashIds.length) return;
    if (this.game.running) return this.toast('游戏运行中，退出后再还原');
    const list = this.trash.filter((t) => trashIds.includes(t.trashId));
    await this.perform('还原 Mod', async () => {
      const { restored, conflicts } = await api.restoreMods(trashIds);
      const drafts = list.some((t) => restored.includes(t.modId) && t.profileIds.length);
      const what = restored.length === 1 ? `「${list.find((t) => t.modId === restored[0])?.title ?? restored[0]}」` : ` ${restored.length} 个 Mod`;
      if (conflicts.length) this.toast(`${restored.length ? `已还原${what}；` : ''}${conflicts.length} 个没有还原：${conflicts[0].reason}`, undefined, 6000);
      else this.toast(`已还原${what}${drafts ? '，已恢复方案里的勾选' : ''}`, undefined, drafts ? 5000 : undefined);
    });
  }
  /** 永久删除，不可撤销；'all' = 清空回收站 */
  async purgeTrash(trashIds: string[] | 'all') {
    const list = trashIds === 'all' ? this.trash : this.trash.filter((t) => trashIds.includes(t.trashId));
    if (!list.length) return;
    if (this.game.running) return this.toast('游戏运行中，退出后再删除');
    await this.perform('永久删除', async () => {
      const files = list.flatMap((t) => t.files);
      const size = files.reduce((n, f) => n + f.size, 0);
      const title = trashIds === 'all' ? '清空回收站' : list.length === 1 ? `永久删除「${list[0].title}」` : `永久删除 ${list.length} 个 Mod`;
      const extra: ConfirmExtra = {
        items: list.slice(0, 12).map((t) => ({ trashId: t.trashId, title: t.title, files: t.files, sizeBytes: t.sizeBytes })),
        more: Math.max(0, list.length - 12),
        facts: [
          { label: '文件', value: `${files.length} 个 · ${mib(size)}` },
          { label: '结果', value: '从磁盘上删除，无法撤销', danger: true },
        ],
      };
      if (!await this.confirm(title, '', '永久删除', extra)) return;
      const { purged } = await api.purgeTrash(trashIds === 'all' ? 'all' : list.map((t) => t.trashId));
      this.toast(purged.length === 1 && list.length === 1 ? `已永久删除「${list[0].title}」` : `已永久删除 ${purged.length} 个 Mod`);
    });
  }

  // ---------- 后台任务：下载、解包 ----------
  /** 快照里的任务列表按 taskId 合并；比快照新的事件结果保留 */
  private acceptTasks(list: ModTask[] | undefined) {
    if (!list) return;
    const mine = new Map(this.tasks.map((t) => [t.taskId, t]));
    const next = list.map((t) => { const old = mine.get(t.taskId); return old && old.updatedAt > t.updatedAt ? old : t; });
    // 快照之后才创建的任务只来自事件，先留着
    for (const t of mine.values()) if (!list.some((x) => x.taskId === t.taskId) && !ended(t)) next.push(t);
    this.tasks = next;
  }
  private onTask(t: ModTask) {
    const i = this.tasks.findIndex((x) => x.taskId === t.taskId);
    const prev = i >= 0 ? this.tasks[i] : undefined;
    if (prev && prev.updatedAt > t.updatedAt) return;
    if (i >= 0 && t.state === 'queued' && prev?.state !== 'queued') {
      this.tasks.splice(i, 1); this.tasks.push(t); // 继续 / 重试排到队尾，对齐 task-list 的顺序
    } else if (i >= 0) this.tasks[i] = t; else this.tasks.push(t);
    if (!prev || prev.state === t.state || ended(prev)) return;
    if (t.kind === 'platform-download' && t.sourceId?.startsWith('native:')) void this.onLibraryDownload(t);
    if (t.kind === 'pack' && t.state === 'done') {
      this.notify({ kind: t.warning ? 'error' : 'ok', title: '打包完成', text: t.output ? '已打包到桌面：'+t.output : t.warning || (t.favoriteImport ? `${t.title} 已导入 Mod 库，可选择目标方案` : `${t.title} 已导入并启用，下次启动生效`) });
    }
    if (t.state === 'done' && t.kind === 'extract') {
      const dir = t.dir;
      this.notify({ kind: 'ok', title: '解包完成', text: `「${t.title}」已解包到桌面`, actions: dir ? [{ label: '打开文件夹', run: () => this.reveal(dir) }] : [], ms: 6000 });
    }
    if (t.state === 'done' && t.kind === 'download') {
      systemNotify({ ok: true, name: t.title });
      // 一批下载陆续完成，合成一条提示和一声提示音
      this.doneDownloads.push(t);
      clearTimeout(this.doneTimer);
      this.doneTimer = setTimeout(() => this.announceDownloads(), 1200);
    }
    // 外部平台任务由发起它的流程自己报告结果
    if (t.kind.startsWith('platform-')) return;
    if (t.state === 'failed') {
      if (t.kind === 'download') systemNotify({ ok: false, name: t.title });
      sfx.play('error');
      const id = t.taskId;
      this.notify({ kind: 'error', title: `${t.kind === 'download' ? '下载' : t.kind === 'pack' ? '打包' : '解包'}失败`, text: `${t.title} · ${t.error?.message ?? '未知错误'}`, actions: [{ label: '重试', run: () => void this.retryTask(id) }], ms: 9000 });
    }
  }
  /** 一批下载完成（后端已把新 Mod 加进启动方案）：单个时带封面，多个时合成一条 */
  private announceDownloads() {
    const done = this.doneDownloads;
    this.doneDownloads = [];
    if (!done.length) return;
    sfx.play('done');
    const ids = done.map((t) => t.modId).filter((id): id is string => !!id);
    const inbox = { label: '去整理', run: () => { this.route = 'mods'; this.modFilter.category = INBOX; } };
    if (done.length === 1) {
      const t = done[0];
      const id = t.modId;
      this.notify({ kind: 'ok', title: '下载完成', text: `「${t.title}」已放进「新下载」并启用`, modId: id, actions: [id ? { label: '查看', run: () => { this.focusMod = id; this.route = 'mods'; } } : inbox], ms: 9000 });
    } else {
      this.notify({ kind: 'ok', title: '下载完成', text: `${done.length} 个 Mod 已放进「新下载」并启用`, modId: ids[0], actions: [inbox], ms: 9000 });
    }
  }
  /** 等任务结束；事件流丢了也每 2 秒拉一次任务列表 */
  private waitTask(taskId: string, timeoutMs = 10 * 60_000): Promise<ModTask> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      let polls = 0;
      const tick = async () => {
        const t = this.tasks.find((x) => x.taskId === taskId);
        if (t && ended(t)) return resolve(t);
        if (Date.now() - started > timeoutMs) return reject(new Error('等待任务超时，请在 DLL 模组页查看状态。'));
        if (++polls % 5 === 0) { try { this.acceptTasks(await api.taskList()); } catch { /* 下次再试 */ } }
        setTimeout(tick, 400);
      };
      void tick();
    });
  }

  // ---------- 外部平台（Skeeto）管理：先预览，确认后带 planId 执行 ----------
  /** GitHub 最新发布，按平台缓存 10 分钟 */
  platformReleases = $state<Record<string, { release?: PlatformRelease; error?: string; at: number }>>({});
  async platformCheckUpdate(id: string, force = false): Promise<PlatformRelease | undefined> {
    const cached = this.platformReleases[id];
    if (!force && cached && Date.now() - cached.at < 600_000) return cached.release;
    try {
      const release = await api.platformCheckUpdate(id);
      this.platformReleases[id] = { release, at: Date.now() };
      return release;
    } catch (e) {
      this.platformReleases[id] = { error: errorText(e), at: Date.now() };
      return undefined;
    }
  }
  /** 计划 → 确认框内容 */
  private planExtra(plan: PlatformPlan): ConfirmExtra {
    if (plan.operation === 'recover') return {
      facts: [{ label: '目标', value: plan.gameRoot }],
      lists: [{ title: '恢复文件', rows: plan.recovery.files.map((f) => ({ k: f.path, v: f.before === f.after ? '保持现状' : f.after === null ? '移除' : '还原' })) }],
    };
    const action = { create: '新增', replace: '替换', remove: '移除', backup: '备份' } as const;
    const occupant = { absent: '入口空闲', skeeto: '接管已有的 Skeeto 入口', 'foreign-unknown': '入口被未知代理占用' } as const;
    const changed = plan.modules.filter((m) => m.changed);
    return {
      facts: [
        { label: '目标', value: plan.gameRoot },
        ...(plan.version ? [{ label: '版本', value: plan.version }] : []),
        ...(plan.sizeBytes ? [{ label: '写入', value: mib(plan.sizeBytes) }] : []),
        ...(plan.loader ? [{ label: '入口', value: `${occupant[plan.loader.occupant]}${plan.loader.replaced ? '，原文件先备份' : ''}` }] : []),
        ...(plan.operation === 'install' ? [{ label: '核验', value: '未核验：没有签名和审核' }] : []),
        ...(plan.operation === 'install' && plan.enabled === false ? [{ label: '安装后', value: '保持停用' }] : []),
      ],
      lists: [
        ...(plan.files.length ? [{ title: '游戏目录里的变化', rows: plan.files.map((f) => ({ k: f.path, v: `${action[f.action]}${f.sizeBytes ? ` · ${mib(f.sizeBytes)}` : ''}` })) }] : []),
        ...(changed.length ? [{ title: '模块调整', rows: changed.map((m) => ({ k: m.name, v: platformReason(m.reason) })) }] : []),
      ],
      warn: plan.warnings.length ? { title: '注意', text: plan.warnings.join(' ') } : undefined,
    };
  }
  private async runPlatformPlan(plan: PlatformPlan, done: string, enabled?: boolean) {
    const { taskId } = await api.platformExecute(plan.operation as PlatformOperation, plan.id, plan.planId, enabled);
    const t = await this.waitTask(taskId);
    if (t.state !== 'done') throw new Error(t.error?.message ?? '操作没有完成');
    await this.refresh();
    this.toast(done);
  }
  /** 安装或更新；没下载过的版本先确认下载 */
  async platformInstall(id: string) {
    const p = this.platforms.find((x) => x.id === id);
    if (!p) return;
    if (this.game.running) return this.toast('游戏运行中，退出后再安装');
    await this.perform(`准备安装 ${p.name}`, async () => {
      const release = await this.platformCheckUpdate(id, true);
      if (!release) throw new Error(this.platformReleases[id]?.error ?? '没有拿到发布信息');
      const v = release.version;
      let plan: PlatformChangePlan;
      try { plan = await api.platformPreviewInstall(id, v); }
      catch (e) {
        if ((e as { code?: string }).code !== 'platform_download_required') throw e;
        if (!await this.confirm(`下载 ${p.name} ${v}`, '', '下载', { facts: [
          { label: '来源', value: `${p.source.repo.replace(/^https?:\/\//, '')} 的 Release` },
          { label: '文件', value: `${release.asset.name} · ${mib(release.asset.size)}` },
          { label: '核验', value: '未核验：没有签名和审核' },
        ] })) return;
        const t = await this.waitTask((await api.platformDownload(id, v)).taskId);
        if (t.state !== 'done') throw new Error(t.error?.message ?? '下载没有完成');
        plan = await api.platformPreviewInstall(id, v);
      }
      if (plan.requiresManualMigrate) {
        await this.confirm(`${p.name} ${v} 需要手动迁移`, `这个版本要求用 ${p.name} 自己的安装器迁移，Matcha 不会替它执行。`, '知道了', this.planExtra(plan));
        return;
      }
      const verb = p.managed ? '更新' : '安装';
      if (!await this.confirm(`${verb} ${p.name} ${v}`, '', verb, this.planExtra(plan))) return;
      await this.runPlatformPlan(plan, `${p.name} ${v} 已${verb}`);
    });
  }
  /** 启停、卸载、关闭自更新、恢复中断 */
  async platformOperation(id: string, operation: Exclude<PlatformOperation, 'install'>, enabled?: boolean) {
    const p = this.platforms.find((x) => x.id === id);
    if (!p) return;
    if (this.game.running) return this.toast('游戏运行中，退出后再操作');
    const text = {
      'set-enabled': enabled ? ['启用', '已启用'] : ['停用', '已停用'],
      uninstall: ['卸载', '已卸载'],
      'set-self-update': ['关闭工坊自更新', '已关闭工坊自更新'],
      recover: ['恢复中断的操作', '已恢复'],
    }[operation];
    await this.perform(`准备${text[0]} ${p.name}`, async () => {
      const plan = await api.platformPreviewOperation(id, operation, enabled);
      if (!await this.confirm(`${text[0]} ${p.name}`, '', text[0], this.planExtra(plan))) return;
      await this.runPlatformPlan(plan, `${p.name} ${text[1]}`, enabled);
    });
  }
  /** 启动前的平台规则预览；没有受管平台时为 null */
  private async launchPreview(mode: LaunchMode, profileId: string, serverId?: string) {
    if (mode === 'clean') return null;
    if (!this.platforms.some((p) => p.managed || p.pendingOperation)) return null;
    const preview = await api.platformPreviewLaunch(mode, profileId, serverId);
    return preview.required ? preview : null;
  }
  private launchExtra(plan: PlatformChangePlan): ConfirmExtra {
    const name = this.platforms.find((p) => p.id === plan.id)?.name ?? '外部平台';
    const changed = plan.modules.filter((m) => m.changed);
    return {
      lists: [{ title: `${name} 本次启动的模块调整`, rows: changed.length ? changed.map((m) => ({ k: m.name, v: platformReason(m.reason) })) : [{ k: '无调整', v: '按已保存的设置启动' }] }],
      warn: plan.warnings.length ? { title: '注意', text: plan.warnings.join(' ') } : undefined,
    };
  }
  /** 带平台规则的启动是一个任务：等它提交完启动请求 */
  private async afterLaunch(r: { status: 'requested'; pid?: number } | { taskId: string }) {
    if (!('taskId' in r)) return;
    const t = await this.waitTask(r.taskId, 3 * 60_000);
    if (t.state !== 'done') throw new Error(t.error?.message ?? '启动没有完成');
  }

  async cancelTask(taskId: string) {
    try { this.onTask(await api.taskCancel(taskId)); } catch (e) { this.toast(errorText(e)); }
  }
  async retryTask(taskId: string) {
    try { await api.taskRetry(taskId); } catch (e) { this.toast(errorText(e)); }
  }
  /** quiet：批量暂停时，刚进入校验 / 提交的任务（task_not_pausable）按最新事件显示，不提示 */
  async pauseTask(taskId: string, quiet = false) {
    try { this.onTask(await api.taskPause(taskId)); }
    catch (e) {
      if ((e as { code?: string }).code === 'task_not_pausable') { if (!quiet) this.toast('这一步已经在收尾，不能暂停了'); return; }
      this.toast(errorText(e));
    }
  }
  /** 回到队尾；本版不续传，进度从头开始 */
  async resumeTask(taskId: string) {
    try { this.onTask(await api.taskResume(taskId)); } catch (e) { this.toast(errorText(e)); }
  }
  /** 删除结束的任务记录；返回真的删掉的 id。磁盘上的文件和已导入的 Mod 都保留 */
  async removeTasks(taskIds: string[]): Promise<string[]> {
    if (!taskIds.length) return [];
    const { removed } = await api.taskRemove(taskIds);
    const gone = new Set(removed);
    if (gone.size) this.tasks = this.tasks.filter((t) => !gone.has(t.taskId));
    return removed;
  }
  /** 每个 Mod 解包到桌面上一个同名文件夹；进度在任务托盘（新任务会自动展开托盘，不另外提示） */
  async extractMods(ids: string[]) {
    for (const id of ids) {
      try { await api.extractMod(id); }
      catch (e) { this.toast(`${this.mod(id)?.title ?? id}：${errorText(e)}`); break; }
    }
  }
  /** 创意工坊条目加入下载队列；返回成功加入的数量 */
  async downloadWorkshop(ids: string[]): Promise<number> {
    let queued = 0;
    for (let i = 0; i < ids.length; i += 32) {
      try { queued += (await api.workshopDownload(ids.slice(i, i + 32))).taskIds.length; }
      catch (e) { this.toast(errorText(e)); break; }
    }
    if (queued) sfx.play('download');
    return queued;
  }
  reveal(path: string) {
    void api.revealPath(path).catch((e) => this.toast(errorText(e)));
  }

  // ---------- 插件 ----------
  isPluginOn(id: string, _profile = this.editingProfile) { return !!this.plugins.find(p => p.id === id)?.enabled; }
  async maintainPlugin(id:string,operation:'uninstall'|'rollback'){
    const action=operation==='rollback'?'回滚':'卸载';
    await this.perform(action+'模组',async()=>{
      const p=await api.previewPluginMaintenance(id,operation);
      const note=operation==='rollback'?'保留当前启停和兼容的配置，当前整包留作备份。':'将整个模组目录移出加载列表并保留备份，方案草稿和独立数据保留。';
      if(!await this.confirm(action+' '+p.name,note,action,{
        facts:[{label:'游戏目录',value:p.gameRoot},{label:'版本',value:p.targetVersion?p.version+' → '+p.targetVersion:p.version}],
        lists:[{title:'当前包内文件',rows:p.files.map(k=>({k,v:''}))}]}))return;
      const r=await api.applyPluginMaintenance(p.planId);
      this.toast('已'+action+'，原包保存在 '+r.previousDirectory+(r.metadataWarning?'；来源资料需重新核对':''));
    });
  }
  async togglePlugin(id: string, _profile = this.editingProfile) {
    const plugin = this.plugins.find(p => p.id === id);
    if (!plugin) return;
    await this.perform('更新模组启用列表', async () => {
      const enabled = !plugin.enabled;
      if (!await this.confirm(enabled ? '启用模组' : '停用模组', `${plugin.name} · ${plugin.version}\n${this.game.root}\n\n更新 enabled.txt，下次完整启动生效。启用时同时纳入所需依赖。`)) return;
      await api.setPluginEnabled(id, enabled); this.toast('启用列表已保存，下次完整启动生效');
    });
  }
  async setL4nLaunch(enabled:boolean) {
    await this.perform('保存 L4N 启动偏好',()=>gameSettings.setL4nLaunch(enabled,this.game.root),enabled?'平台模式下次启动加载 L4N':'平台模式下次启动跳过 L4N，子插件选择已保留');
  }
  async setNativeLibrary(id: 'l4n', enabled: boolean) {
    const name='L4N 整包';
    await this.perform('准备 L4N', async () => {
      const plan=await api.libraryPreview(id,enabled);
      const title=(enabled?'启用':'停用')+' L4N 整包',note='切换 L4N 入口，保留个人设置。';
      if (!await this.confirm(title, `${this.game.root}\n\n${note}\n旧文件会保存在组件操作备份里。`, '确认执行', {
        lists: [{ title: `文件变化 · ${plan.files.length}`, rows: plan.files.map(f => ({ k: f.path, v: f.action === 'create' ? '新增' : f.action === 'restore/remove' ? '还原原状态' : '替换并保留备份' })) }],
      })) return;
      await api.libraryApply(plan.planId);
      this.toast(`${name}已${enabled ? '启用' : '停用'}，下次完整启动生效`);
    });
  }
  async recoverNativeLibrary(id: string) {
    await this.perform('恢复组件操作', async () => {
      if (!await this.confirm('恢复组件操作', `${this.game.root}\n\n按操作记录恢复上次中断的文件变更。`)) return;
      await api.libraryRecover(id);
    });
  }

  // ---------- L4N / DXVK 按需下载、DLL 更新、危险筛查（docs/dll-safety-updates-handoff.md） ----------
  /** 第一次检测到本机缺 L4N / DXVK：提醒一次有这两个可选组件，去 DLL 页看好处再决定。每个组件这台电脑上只提一次 */
  private offerNativeOnce() {
    const env = this.nativeLibraries;
    if (!env || !this.game.installed || this.route === 'plugins') return;
    const missing = [env.l4n].filter(l => needsDownload(l) && !offerDismissed(l.id) && !offerNotified(l.id));
    if (!missing.length) return;
    missing.forEach(l => markOfferNotified(l.id));
    const names = missing.map(l => (l.id === 'l4n' ? 'L4N' : 'DXVK')).join(' 和 ');
    this.notify({ kind: 'ok', title: `${names} 还没下载`, text: missing.length > 1 ? '两个都是可选组件，不装也能玩。想知道装了有什么用，去 DLL 模组页看看' : '这是可选组件，不装也能玩。想知道装了有什么用，去 DLL 模组页看看', actions: [{ label: '去看看', run: () => (this.route = 'plugins') }], ms: 10000 });
  }
  /** 下载完要接着启用的组件 */
  private enableAfterDownload = new Map<string,string>();
  /** 正在下载的组件或模组新版本：key 为 native:<id> / plugin:<id> */
  downloadTask(key: string) { return this.tasks.find(t => t.kind === 'platform-download' && t.sourceId === key && !ended(t)); }

  /** 按需下载 L4N / DXVK：先说清从哪下、多大、怎么校验，下载完接着给玩家看要改的游戏文件 */
  async downloadNativeLibrary(id: 'l4n', thenEnable = true) {
    const name = id === 'l4n' ? 'L4N 整包' : 'DXVK';
    await this.perform(`准备下载 ${name}`, async () => {
      const plan = await api.libraryDownloadPreview(id);
      const size = sizeLabel(plan.sizeBytes);
      if (!await this.confirm(`下载 ${name}`, `v${plan.version}${size ? ` · 约 ${size}` : ''}\n来源：${plan.source}`, '下载', {
        facts: [
          { label: '下载地址', value: plan.url },
          { label: '校验', value: `SHA-256 ${plan.sha256.slice(0, 16)}…，对不上就丢弃，不会装` },
          { label: '保存到', value: `${plan.target}（Matcha 数据目录，不碰游戏目录）` },
          ...(plan.license ? [{ label: '许可', value: plan.license }] : []),
          { label: '下载后', value: thenEnable ? '接着给你看要改的游戏文件，确认后才启用' : '先存着，启用时再改游戏文件' },
        ],
      })) return;
      if (thenEnable) this.enableAfterDownload.set(id,this.game.root); else this.enableAfterDownload.delete(id);
      try { await api.libraryDownload(plan.planId); } catch (e) { this.enableAfterDownload.delete(id); throw e; }
      this.toast(`开始下载 ${name}，进度在 DLL 模组页`);
    });
  }
  private async onLibraryDownload(t: ModTask) {
    const id=t.sourceId?.slice('native:'.length); if(id!=='l4n') return;
    const name = id === 'l4n' ? 'L4N 整包' : 'DXVK';
    if (t.state === 'canceled') { this.enableAfterDownload.delete(id); return; }
    if (t.state === 'failed') {
      this.enableAfterDownload.delete(id);
      sfx.play('error');
      this.notify({ kind: 'error', title: `${name} 下载失败`, text: t.error?.message ?? '未知错误', actions: [{ label: '重试', run: () => void this.downloadNativeLibrary(id) }], ms: 9000 });
      return;
    }
    if (t.state !== 'done') return;
    await this.refresh();
    const requestedRoot=this.enableAfterDownload.get(id); this.enableAfterDownload.delete(id);
    if (!requestedRoot || requestedRoot!==this.game.root) { this.toast(`${name} 下载好了`); return; }
    if (this.busy) { this.notify({ kind: 'ok', title: `${name} 下载好了`, text: '去 DLL 模组页打开开关就能启用', actions: [{ label: '去看看', run: () => (this.route = 'plugins') }], ms: 8000 }); return; }
    await this.setNativeLibrary(id, true);
  }

  /** 加载器、L4N / DXVK、来源有新版的模组。顶栏「插件」的小点和 DLL 页的更新条都看它 */
  dllUpdates = $derived.by(() => {
    const env = this.nativeLibraries;
    const out: { key: string; kind: 'runtime' | 'library' | 'plugin'; id: string; name: string; from: string | null; to: string }[] = [];

    for (const lib of [env?.l4n]) {
      const to = libraryUpdate(lib);
      if (lib && to) out.push({ key: lib.id, kind: 'library', id: lib.id, name: lib.id === 'l4n' ? 'L4N 整包' : 'DXVK', from: lib.version, to });
    }
    for (const p of this.plugins) if (p.update && p.installed !== false) out.push({ key: `plugin:${p.id}`, kind: 'plugin', id: p.id, name: p.name, from: p.version, to: p.update.version });
    return out;
  });
  dllUpdatesCheckedAt = $state('');
  /** 立刻查一遍来源（平时后台每天查一次） */
  async checkDllUpdates() {
    await this.perform('检查 DLL 更新', async () => {
      try {
        const r = await api.dllUpdatesCheck();
        this.dllUpdatesCheckedAt = r.checkedAt;
        this.toast(r.updates ? `有 ${r.updates} 个模组可以更新` : '都是最新的');
      } catch (e) {
        if (!isMissingCommand(e)) throw e;
        this.toast('这个版本还不能自动查更新，可以在模组详情里让茶茶检查');
      }
    });
  }
  /** 更新一个模组：后台下新版到暂存区、核对签名、做危险筛查，再走同一个导入确认。
   *  签名换了或没签名，不一键更新，交给茶茶先讲清楚变化。 */
  async updatePluginFromSource(p: PlatformPlugin) {
    const u = p.update;
    if (!u) return;
    if (u.signer === 'changed' || (u.signer === 'unsigned' && p.verification?.state === 'verified-development')) {
      const go = await this.confirm('新版本的签名变了', `${p.name} · v${p.version} → v${u.version}\n\n${u.signer === 'changed' ? '新版不是同一个开发者证书签的' : '已装的版本有签名，新版没有'}。可能是作者换了证书，也可能不是作者发的。先让茶茶核对来源和发布者，再决定要不要装。`, '交给茶茶核对');
      if (go) {
        const { askAgent, changesPrompt } = await import('../plugins/intake');
        this.toast(askAgent(changesPrompt(p)) === 'sent' ? '已交给茶茶，进度在右侧对话里' : '茶茶还没准备好，指令先放进对话框了');
      }
      return;
    }
    const intake = await this.perform(`下载 ${p.name} v${u.version}`, async () => {
      try { return await api.pluginUpdateFetch(p.id); }
      catch (e) { if (await this.offerAgent(e, p.id)) return undefined; throw e; }
    });
    if (!intake) return;
    if (intake.outcome === 'sdk-ready') { await this.importIntake(intake); return; }
    await this.offerAgent({ code: intake.outcome === 'rejected' ? 'plugin_package_rejected' : 'plugin_needs_agent', details: intake }, p.id);
  }
  /** 重新做一次危险筛查 */
  async screenPlugin(id: string) {
    await this.perform('危险筛查', async () => {
      try { await api.dllScreen({ pluginId: id }); this.toast('检查完了'); }
      catch (e) { if (!isMissingCommand(e)) throw e; this.toast('这个版本还没有危险筛查，等后端更新'); }
    });
  }

  // ---------- L4N 子插件 ----------
  // 子插件由 L4N 自己扫描 bin\neko\plugins 加载；Matcha 只把整个 DLL 移进移出这个目录。
  private l4nFiles(plan: L4nPluginPlan): ConfirmExtra['lists'] {
    const action = { create: '放入', replace: '替换', remove: '移走' } as const;
    return [{ title: `文件变化 · ${plan.files.length}`, rows: plan.files.map(f => ({ k: f.path.replace(/\//g, '\\'), v: action[f.action] ?? f.action })) }];
  }
  async maintainL4nPlugin(id:string,operation:'uninstall'|'rollback'|'update'){
    const action={uninstall:'卸载',rollback:'回滚',update:'更新'}[operation];
    await this.perform(action+' L4N 子插件',async()=>{
      const file=operation==='update'?await pickDll():undefined;
      if(operation==='update'&&!file)return;
      const plan=await api.l4nPluginPreview({pluginId:id,operation,file:file??undefined});
      if(!await this.confirm(action+' '+plan.plugin.file,this.game.root+'\n原 DLL 进入操作备份，个人配置保留。',action,{lists:this.l4nFiles(plan)}))return;
      await api.l4nPluginApply(plan.planId);this.toast('已'+action+' '+plan.plugin.file);
    });
  }
  async setL4nPlugin(id: string, enabled: boolean) {
    const p = this.l4nPlugins?.plugins.find(x => x.id === id);
    if (!p) return;
    await this.perform(`准备${enabled ? '启用' : '停用'} ${p.name}`, async () => {
      const plan = await api.l4nPluginPreview({ operation: 'set-enabled', pluginId: id, enabled });
      const note = enabled
        ? '把 DLL 移回 bin\\neko\\plugins，L4N 下次启动时加载它。'
        : '把 DLL 移到 .matcha-l4n-plugins\\disabled，L4N 扫描不到它；个人配置留在原处。';
      if (!await this.confirm(`${enabled ? '启用' : '停用'} L4N 子插件`, `${p.name} · ${p.file}\n${this.game.root}\n\n${note}${this.l4nPlugins?.hostEnabled ? '' : '\nL4N 整包当前停用，子插件要等整包启用后才会加载。'}`, enabled ? '启用' : '停用', {
        lists: this.l4nFiles(plan),
      })) return;
      await api.l4nPluginApply(plan.planId);
      this.toast(`${p.name} 已${enabled ? '启用' : '停用'}，下次完整启动生效`);
    });
  }
  async importL4nPlugin() {
    const file = await pickDll();
    if (!file) return;
    await this.perform('导入 L4N 子插件', async () => {
      const plan = await api.l4nPluginPreview({ operation: 'import', file });
      if (!await this.confirm('导入 L4N 子插件', '', '导入', {
        facts: [
          { label: '文件', value: plan.plugin.file },
          { label: '来源', value: file },
          { label: '核对', value: 'x86 · 导出 GetL4NPluginInstance' },
          { label: '导入后', value: '默认停用，打开开关后下次启动加载' },
          { label: '提醒', value: 'DLL 会在游戏进程里运行，请确认来源可信', danger: true },
        ],
        lists: this.l4nFiles(plan),
      })) return;
      await api.l4nPluginApply(plan.planId);
      this.toast(`已导入 ${plan.plugin.file}，默认停用`);
    });
  }
  async recoverL4nPlugins() {
    await this.perform('恢复子插件操作', async () => {
      if (!await this.confirm('恢复 L4N 子插件操作', `${this.game.root}\n\n按操作记录恢复上次没做完的子插件文件变更。`)) return;
      await api.l4nPluginRecover();
    });
  }

  // ---------- 服务器 ----------
  /** 正在查询时再请求的 id 排队，本轮结束后补查，不丢 */
  async refreshServers(ids = this.servers.map(s => s.id)) {
    if (!this.capabilities.servers || !ids.length) return;
    if (this.serversRefreshing) { ids.forEach(id => this.queuedQueries.add(id)); return; }
    this.serversRefreshing = true;
    try { this.servers = await serverApi.query(ids); }
    catch (e) { this.toast(errorText(e)); }
    finally {
      this.serversRefreshing = false;
      const next = [...this.queuedQueries].filter(id => this.servers.some(s => s.id === id));
      this.queuedQueries.clear();
      if (next.length) void this.refreshServers(next);
    }
  }
  async toggleFavorite(id: string) {
    const s = this.servers.find((x) => x.id === id);
    if (s) await this.setServersFavorite([id], !s.favorite);
  }
  async setServersFavorite(ids: string[], favorite: boolean) {
    const list = ids.filter(id => { const s = this.servers.find(x => x.id === id); return s && s.favorite !== favorite; });
    if (!list.length) return;
    try { for (const id of list) this.servers = await serverApi.favorite(id, favorite); }
    catch (e) { this.toast(errorText(e)); return; }
    if (list.length > 1) this.toast(favorite ? `已收藏 ${list.length} 台服务器` : `已取消收藏 ${list.length} 台服务器`);
  }
  /** 逐个添加；新服务器放进合集 groupId（LOOSE = 未分组）。备注和连接端口只在单个添加时使用 */
  async addServers(addresses: string[], opts: { label?: string; gamePort?: string; groupId?: string; onProgress?: (done: number) => void } = {}) {
    const added: string[] = [], failed: { address: string; message: string; code?: string }[] = [];
    const single = addresses.length === 1;
    for (const [i, address] of addresses.entries()) {
      const before = new Set(this.servers.map(s => s.id));
      try {
        this.servers = await serverApi.add(address, single ? opts.label ?? '' : '', single ? opts.gamePort ?? '' : '');
        const id = this.servers.find(s => !before.has(s.id))?.id;
        if (id) added.push(id);
      } catch (e) {
        const code = (e as { code?: string }).code;
        failed.push({ address, message: errorText(e), code });
        if (code === 'server_limit') break;
      }
      opts.onProgress?.(i + 1);
    }
    if (added.length && opts.groupId && opts.groupId !== LOOSE) this.moveServers(added, opts.groupId);
    if (added.length) void this.refreshServers(added);
    return { added, failed };
  }
  async removeServers(ids: string[]) {
    const list = this.servers.filter(s => ids.includes(s.id));
    if (!list.length) return;
    const what = list.length === 1 ? `「${list[0].name}」` : ` ${list.length} 台服务器`;
    const names = list.length > 1 ? '\n\n' + list.slice(0, 8).map(s => `· ${s.name}`).join('\n') + (list.length > 8 ? `\n· …另 ${list.length - 8} 台` : '') : '';
    if (!await this.confirm('移除服务器', `从 Matcha 列表移除${what}？\n收藏和合集位置一并删除，之后可重新添加。${names}`)) return;
    const done = await this.dropServers(list.map(s => s.id));
    if (done > 1) this.toast(`已移除 ${done} 台服务器`);
  }
  removeServer(id: string) { return this.removeServers([id]); }
  private async dropServers(ids: string[]) {
    let done = 0;
    try { for (const id of ids) { this.servers = await serverApi.remove(id); done++; } }
    catch (e) { this.toast(errorText(e)); }
    this.pruneLayout();
    return done;
  }
  /** 改备注。后端还没有 update-server 时，移除后用同一地址重新添加，再恢复收藏和合集位置 */
  async renameServer(id: string, label: string) {
    const s = this.servers.find(x => x.id === id);
    const next = label.trim();
    if (!s || next === s.label || (!s.label && next === s.name)) return;
    if (next.length > 80) return this.toast('备注最多 80 个字符');
    try { this.servers = await serverApi.update(id, next, s.gamePort); return; }
    catch (e) { if ((e as { code?: string }).code !== 'unsupported_capability') return this.toast(errorText(e)); }
    const layout = this.explicitLayout();
    const port = s.gamePort === null ? '' : String(s.gamePort);
    let list: Server[];
    try {
      list = await serverApi.remove(id);
      const before = new Set(list.map(x => x.id));
      try { list = await serverApi.add(s.addr, next, port); }
      catch (e) { this.toast(errorText(e)); list = await serverApi.add(s.addr, s.label, port); }
      const fresh = list.find(x => !before.has(x.id))?.id;
      if (!fresh) { this.servers = list; return; }
      if (s.favorite) list = await serverApi.favorite(fresh, true);
      const swap = (ids: string[]) => ids.map(x => (x === id ? fresh : x));
      this.serverLayout = { groups: layout.groups.map(g => ({ ...g, serverIds: swap(g.serverIds) })), loose: swap(layout.loose) };
      this.persistLayout();
      this.servers = list;
      void this.refreshServers([fresh]);
    } catch (e) { this.toast(errorText(e)); void serverApi.list().then(rows => { this.servers = rows; }); }
  }

  // ---------- 服务器合集 ----------
  serverGroup(id: string) { return this.serverLayout.groups.find(g => g.id === id); }
  serverSection(id: string) { return this.serverSections.find(s => s.id === id); }
  freshServerGroupName(base = '新合集') {
    for (let i = 1; ; i++) { const n = i === 1 ? base : `${base} ${i}`; if (!this.serverGroupTaken(n)) return n; }
  }
  private serverGroupTaken(name: string, except?: string) {
    return name === '未分组' || this.serverLayout.groups.some(g => g.name === name && g.id !== except);
  }
  createServerGroup(name: string, ids: string[] = []): ServerGroup | undefined {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    if (this.serverGroupTaken(n)) { this.toast(`已有合集「${n}」`); return; }
    const id = newId('sg');
    this.serverLayout.groups.push({ id, name: n, serverIds: [] });
    if (ids.length) this.moveServers(ids, id); else this.persistLayout();
    return this.serverGroup(id);
  }
  renameServerGroup(id: string, name: string) {
    const g = this.serverGroup(id);
    const n = name.trim().slice(0, 40);
    if (!g || !n || n === g.name) return;
    if (this.serverGroupTaken(n, id)) return this.toast(`已有合集「${n}」`);
    g.name = n;
    this.persistLayout();
  }
  shiftServerGroup(id: string, step: -1 | 1) {
    const groups = this.serverLayout.groups;
    const i = groups.findIndex(g => g.id === id), j = i + step;
    if (i < 0 || j < 0 || j >= groups.length) return;
    [groups[i], groups[j]] = [groups[j], groups[i]];
    this.persistLayout();
  }
  /** 只删合集本身，里面的服务器回到未分组 */
  deleteServerGroup(id: string) {
    const g = this.serverGroup(id);
    if (!g) return;
    const layout = this.explicitLayout();
    const moved = layout.groups.find(x => x.id === id)?.serverIds ?? [];
    this.serverLayout = { groups: layout.groups.filter(x => x.id !== id), loose: [...layout.loose, ...moved] };
    this.persistLayout();
    this.toast(moved.length ? `已删除合集「${g.name}」，${moved.length} 台服务器移到未分组` : `已删除合集「${g.name}」`);
  }
  async deleteServerGroupWithServers(id: string) {
    const g = this.serverGroup(id), sec = this.serverSection(id);
    if (!g || !sec) return;
    if (!sec.servers.length) return this.deleteServerGroup(id);
    if (!await this.confirm('删除合集和其中的服务器', `删除合集「${g.name}」，并从 Matcha 移除其中 ${sec.servers.length} 台服务器？\n收藏状态一并删除，之后可重新添加。`)) return;
    const name = g.name;
    this.serverLayout.groups = this.serverLayout.groups.filter(x => x.id !== id);
    const done = await this.dropServers(sec.servers.map(s => s.id));
    this.toast(`已删除合集「${name}」和 ${done} 台服务器`);
  }
  /** 把服务器移到合集（LOOSE = 未分组）的第 index 位；index 按去掉这些服务器后的目标列表计，缺省放到最后 */
  moveServers(ids: string[], groupId: string, index?: number) {
    const moving = new Set(ids);
    const layout = this.explicitLayout();
    const lists = new Map<string, string[]>([...layout.groups.map(g => [g.id, g.serverIds] as const), [LOOSE, layout.loose]]);
    const order = [...lists.values()].flat().filter(id => moving.has(id));
    const target = lists.get(groupId);
    if (!order.length || !target) return;
    for (const [k, v] of lists) lists.set(k, v.filter(id => !moving.has(id)));
    const rest = lists.get(groupId)!;
    rest.splice(index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length)), 0, ...order);
    this.serverLayout = { groups: layout.groups.map(g => ({ ...g, serverIds: lists.get(g.id)! })), loose: lists.get(LOOSE)! };
    this.persistLayout();
  }
  /** 当前布局写成显式列表（未分组里没登记顺序的也写进去），便于原位替换和移动 */
  private explicitLayout(): ServerLayout {
    const ids = (sec: ServerSection | undefined) => sec?.servers.map(s => s.id) ?? [];
    return {
      groups: this.serverLayout.groups.map(g => ({ id: g.id, name: g.name, serverIds: ids(this.serverSection(g.id)) })),
      loose: ids(this.serverSection(LOOSE)),
    };
  }
  /** 只在确认移除后调用；列表临时为空（如查询失败）时不清理，避免丢布局 */
  private pruneLayout() {
    const alive = new Set(this.servers.map(s => s.id));
    this.serverLayout = {
      groups: this.serverLayout.groups.map(g => ({ id: g.id, name: g.name, serverIds: g.serverIds.filter(id => alive.has(id)) })),
      loose: this.serverLayout.loose.filter(id => alive.has(id)),
    };
    this.persistLayout();
  }
  private acceptLayout(remote: ServerLayout | undefined) {
    if (remote && Array.isArray(remote.groups)) {
      if (this.layoutSaving) return;
      const clean = cleanLayout(remote);
      const local = readLocal<unknown>(LAYOUT_KEY, null);
      if (!this.layoutRemote && local) {
        // 首次接入或重试未完成的保存，收到回执后再清理本机副本。
        this.layoutRemote = true;
        this.layoutBase = structuredClone(remote);
        this.serverLayout = cleanLayout(local);
        this.layoutDirty = true;
        if (this.serverLayoutConflict) this.markLayoutConflict(); else this.persistLayout();
      } else if (this.layoutDirty) {
        if (this.layoutBase && JSON.stringify(this.layoutBase) !== JSON.stringify(remote)) this.markLayoutConflict();
        else if (!this.serverLayoutConflict) this.persistLayout();
      } else {
        this.layoutBase = structuredClone(remote);
        if (JSON.stringify(clean) !== JSON.stringify($state.snapshot(this.serverLayout))) this.serverLayout = clean;
        this.serverLayoutConflict = false; removeLocal('flare.serverLayout.conflict');
      }
      this.layoutRemote = true;
    } else if (!this.layoutLoaded) {
      this.serverLayout = cleanLayout(readLocal<unknown>(LAYOUT_KEY, null));
    }
    this.layoutLoaded = true;
  }
  private persistLayout() {
    const layout = $state.snapshot(this.serverLayout) as ServerLayout;
    writeLocal(LAYOUT_KEY, layout);
    this.layoutDirty = true;
    if (!this.layoutRemote) return;
    this.layoutSaving++;
    this.layoutWrites = this.layoutWrites.then(async () => {
      try {
        if (this.serverLayoutConflict) return;
        await serverApi.saveLayout(layout, this.layoutBase);
        this.layoutBase = structuredClone(layout);
        if (this.layoutSaving === 1) { this.layoutDirty = false; removeLocal(LAYOUT_KEY); }
      } catch (e) {
        if ((e as { code?: string }).code === 'server_layout_stale') this.markLayoutConflict();
        else this.toast(errorText(e));
      }
      finally { this.layoutSaving--; }
    });
  }
  private markLayoutConflict() {
    const notify = !this.serverLayoutConflict;
    this.serverLayoutConflict = true; writeLocal('flare.serverLayout.conflict', true);
    if (notify) this.toast('分类有新变化，本机草稿已保留，请在服务器页处理草稿。', { label: '查看草稿', run: () => { this.route = 'servers'; } });
  }
  async flushServerLayout(): Promise<boolean> {
    await this.layoutWrites;
    if (!this.layoutDirty && !this.serverLayoutConflict) return true;
    this.toast('分类草稿仍待保存，请先在服务器页处理草稿。'); return false;
  }
  async retryServerLayoutDraft() {
    try {
      const draft = $state.snapshot(this.serverLayout) as ServerLayout, original = JSON.stringify(draft);
      const state = await serverApi.state();
      const sections = sectionsOf(draft, state.servers);
      const layout = { groups: sections.filter(s => !s.loose).map(s => ({ id: s.id, name: s.name, serverIds: s.servers.map(x => x.id) })),
        loose: sections.find(s => s.loose)?.servers.map(x => x.id) ?? [] };
      const describe = (l: ServerLayout) => sectionsOf(l, state.servers).map(g => ({ k: g.name,
        v: g.servers.length ? g.servers.map(s => `${s.name} (${s.addr})`).join('、') : '空类别' }));
      if (!await this.confirm('重新提交分类草稿', '核对已保存分类和本机草稿；确认后按草稿重新归类，备注和收藏保留。已移除的服务器会从草稿引用中清理。', '保存本机草稿', {
        lists: [{ title: '已保存的类别', rows: describe(state.serverLayout) }, { title: '本机草稿中的类别', rows: describe(layout) }],
      })) return;
      await this.layoutWrites;
      if (JSON.stringify($state.snapshot(this.serverLayout)) !== original) return this.toast('草稿刚有新修改，请重新预览。');
      this.servers = state.servers; this.layoutBase = structuredClone(state.serverLayout); this.serverLayout = layout;
      this.serverLayoutConflict = false; removeLocal('flare.serverLayout.conflict');
      this.persistLayout(); await this.layoutWrites;
    } catch (e) { this.toast(errorText(e)); }
  }
  async useSavedServerLayout() {
    const original = JSON.stringify($state.snapshot(this.serverLayout));
    if (!await this.confirm('采用已保存分类', '采用后端当前已保存的分类，并清除本机这份待保存草稿。服务器、备注和收藏保持原样。', '采用已保存分类')) return;
    await this.layoutWrites;
    if (JSON.stringify($state.snapshot(this.serverLayout)) !== original) return this.toast('草稿刚有新修改，请重新确认。');
    try {
      const state = await serverApi.state();
      if (JSON.stringify($state.snapshot(this.serverLayout)) !== original) return this.toast('草稿刚有新修改，请重新确认。');
      this.servers = state.servers; this.serverLayout = cleanLayout(state.serverLayout); this.layoutBase = structuredClone(state.serverLayout);
      this.layoutDirty = false; this.serverLayoutConflict = false; removeLocal(LAYOUT_KEY); removeLocal('flare.serverLayout.conflict');
    } catch (e) { this.toast(errorText(e)); }
  }
  /** 合集里最适合加入的服务器：在线、有空位、无密码；人多优先，其次延迟低 */
  bestServer(list: Server[]): Server | undefined {
    return list
      .filter(s => s.status === 'online' && !s.password && s.players !== null && s.maxPlayers !== null && s.players < s.maxPlayers)
      .sort((a, b) => b.players! - a.players! || (a.ping ?? 9999) - (b.ping ?? 9999))[0];
  }
  async copyText(text: string, done: string) {
    try { await navigator.clipboard.writeText(text); this.toast(done); }
    catch { this.toast('无法写入剪贴板'); }
  }
  async copyServer(server: Server) {
    try { await navigator.clipboard.writeText(`connect ${server.connectAddr ?? server.addr}`); this.toast('已复制连接命令'); }
    catch { this.toast(`连接命令：connect ${server.connectAddr ?? server.addr}`); }
  }
  async connectServer(id: string, discovered?: Server) {
    const server = discovered ?? this.servers.find(s => s.id === id);
    if (!server) return;
    if (this.launchState === 'running') return this.copyServer(server);
    if (server.vac && this.launchConfig.vacMode === 'insecure') { this.toast('此服务器启用了 VAC，请切换到纯净对抗。'); return this.copyServer(server); }
    if (this.launchState !== 'idle' || this.busy) return;
    const clean = this.launchConfig.mode === 'clean';
    if (!this.game.installed || (!clean && !this.runtime.installed && !this.nativeLibraries?.l4n.enabled)) { this.route = 'plugins'; return; }
    try { if (!clean) await gameSettings.flush(); }
    catch (e) { this.toast(errorText(e), undefined, 6000); return; }
    const profile = this.activeProfile;
    if (!profile) return;
    const config = $state.snapshot(this.launchConfig);
    config.launchOptions = gameSettings.effective?.[config.mode] ?? config.launchOptions;
    // 有受管外部平台（Skeeto）时，先看这台服务器会让哪些模块关闭
    let plan: PlatformChangePlan | null = null;
    try { plan = await this.launchPreview(config.mode, profile.id, id); }
    catch (e) { this.toast(errorText(e), undefined, 6000); return; }
    const setup = clean ? `游戏目录：${this.game.root}` : `先刷新服务器状态，再应用「${profile.name}」的 VPK 及已选模块。`;
    if (!await this.confirm('启动并连接服务器', `${server.name}${server.vac ? ' · VAC' : ''}\n${server.connectAddr ?? server.addr}\n\n${modeLabel(config.mode)}：${config.launchOptions.join(' ')}\n${setup}\n\n${this.launchNotice(config)}`, undefined, plan ? this.launchExtra(plan) : undefined)) return;
    await this.perform('提交服务器连接请求', async () => {
      this.launchState = 'launching'; sfx.play('launch');
      try {
        await this.afterLaunch(await serverApi.connect(id, profile.id, config.mode, plan?.planId));
        this.requestedMode = config.mode;
        this.requestedAt = Date.now(); this.launchState = 'requested';
        this.toast('已提交启动与连接请求，等待游戏响应');
      } catch (e) { this.launchState = 'idle'; throw e; }
    });
  }

  // ---------- 配置 ----------
  setCfg(key: string, value: string) {
    const e = this.cfg.find((x) => x.key === key);
    if (e && e.value !== value) { e.value = value; this.cfgDirty = true; }
  }
  async saveCfg() {
    await api.writeCfg($state.snapshot(this.cfg));
    this.cfgDirty = false;
    this.toast('已写入 cfg/autoexec.cfg');
  }
  setLaunchOptions(value: string, profile = this.editingProfile) {
    if (!profile) return;
    profile.launchOptions = value;
    this.touch(profile);
  }

  // ---------- 启动 ----------
  async setLaunchMode(mode: LaunchMode) {
    if (this.launchState !== 'idle') return;
    await this.perform('保存启动方式', async () => { this.launchConfig = await api.setLaunchMode(mode); });
  }
  /** 按这次真实的启动参数说明，不按模式名猜 */
  private launchNotice(config: LaunchConfiguration) {
    if (config.mode === 'clean') return '使用 Steam 登记的原版目录和默认渲染；L4N 启动偏好和 Mod 方案保留。若选中的目录仍有 L4N、渲染代理或启用的附加内容，检查会停在启动前。';
    if(config.launchOptions.some(arg=>arg.toLowerCase()==='-hide_neko')) return '此次跳过 L4N 及依赖它的模组，沿用所选 VPK 方案和游戏渲染入口。';
    return config.launchOptions.includes('-insecure')
      ? '沿用游戏渲染入口，按配置加载 L4N 和 DLL 模组。本次参数带 -insecure，只能进入非 VAC 服务器。'
      : '沿用游戏渲染入口，按配置加载 L4N 和 DLL 模组，使用游戏默认 VAC 模式。请保持 Steam 登录。';
  }
  async launch(connect?: string) {
    if (this.launchState !== 'idle') return;
    if (connect) {
      const server = this.servers.find(s => s.addr === connect || s.connectAddr === connect);
      return server ? this.connectServer(server.id) : this.toast('请先在服务器页添加这个地址。');
    }
    const clean = this.launchConfig.mode === 'clean';
    try { if (!clean) await gameSettings.flush(); }
    catch (e) { this.toast(errorText(e), undefined, 6000); return; }
    const profile = this.activeProfile!;
    const config = $state.snapshot(this.launchConfig);
    config.launchOptions = gameSettings.effective?.[config.mode] ?? config.launchOptions;
    let plan: PlatformChangePlan | null = null;
    try { plan = await this.launchPreview(config.mode, profile.id); }
    catch (e) { this.toast(errorText(e), undefined, 6000); return; }
    const setup = clean ? '' : `先应用「${profile.name}」的 ${profile.modIds.length} 个 VPK 启用项。\n`;
    if (!await this.confirm(`${modeLabel(config.mode)} · 启动 L4D2`, `${this.game.root}\n\n${setup}参数：${config.launchOptions.join(' ')}\n\n${this.launchNotice(config)}${!clean && this.activeConflicts(profile).length ? '\n\n方案包含资源路径重叠，可返回 Mod 页处理。' : ''}`, undefined, plan ? this.launchExtra(plan) : undefined)) return;
    await this.perform('提交启动请求', async () => {
      this.launchState = 'launching'; sfx.play('launch');
      try {
        await this.afterLaunch(await api.launch(profile.id, config.mode, plan?.planId)); this.requestedMode = config.mode; this.requestedAt = Date.now(); this.launchState = 'requested';
        this.toast('启动请求已提交，等待检测到游戏进程');
      } catch (e) { this.launchState = 'idle'; throw e; }
    });
  }
  stopGame() {
    void this.refresh();
  }

  // ---------- 通用 ----------
  /** action：提示里带一个按钮（撤销、打开文件夹…），带按钮时默认多停留一会儿 */
  toast(text: string, action?: ToastAction, ms = action ? 8000 : 2600) {
    this.notify({ text, actions: action ? [action] : [], ms });
  }
  /**
   * 带样式的提示：kind 决定图标（成功勾 / 错误三角），modId 有图时显示 Mod 缩略图，可带多个按钮。
   * 同样的文字还在屏幕上就替换掉旧的；最多同时 3 条，多了先挤掉最早的。鼠标停在提示上时暂停倒计时（holdToast / releaseToast）。
   */
  notify(o: { text: string; title?: string; kind?: ToastKind; actions?: ToastAction[]; modId?: string; ms?: number }) {
    const actions = o.actions ?? [];
    const ms = o.ms ?? (actions.length || o.title ? 8000 : 2600);
    for (const t of this.toasts) if (t.text === o.text && t.title === o.title) this.dismissToast(t.id);
    while (this.toasts.length >= 3) this.dismissToast(this.toasts[0].id);
    const id = ++uid;
    this.toasts.push({ id, text: o.text, title: o.title, kind: o.kind ?? 'info', actions, modId: o.modId, ms });
    this.toastClock.set(id, { left: ms, since: Date.now(), timer: setTimeout(() => this.dismissToast(id), ms) });
  }
  dismissToast(id: number) {
    clearTimeout(this.toastClock.get(id)?.timer);
    this.toastClock.delete(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
  holdToast(id: number) {
    const c = this.toastClock.get(id);
    if (!c?.timer) return;
    clearTimeout(c.timer);
    c.left = Math.max(800, c.left - (Date.now() - c.since));
    c.timer = undefined;
  }
  releaseToast(id: number) {
    const c = this.toastClock.get(id);
    if (!c || c.timer) return;
    c.since = Date.now();
    c.timer = setTimeout(() => this.dismissToast(id), c.left);
  }
  private toastClock = new Map<number, { left: number; since: number; timer: ReturnType<typeof setTimeout> | undefined }>();
  private touch(p: Profile) {
    p.updatedAt = today();
    void api.saveProfile($state.snapshot(p) as Profile).catch(e => this.toast(errorText(e)));
  }
}

function today() { return new Date().toISOString().slice(0, 10); }
const platformReason = (reason: string) => ({ blocked: '关闭 · 禁止模块', 'local-only': '关闭 · 仅限本地', 'no-versus': '关闭 · 对抗类受限', 'flare-managed': '关闭 · 由 Matcha 管理更新' }[reason] ?? reason);
export interface ToastAction { label: string; run: () => void }
export type ToastKind = 'info' | 'ok' | 'error';
export interface Toast { id: number; text: string; title?: string; kind: ToastKind; actions: ToastAction[]; modId?: string; ms: number }
const ended = (t: ModTask) => t.state === 'done' || t.state === 'failed' || t.state === 'canceled';
/** 文件大小；不到 1 MiB 的用 KiB，免得显示成 0.0 MiB */
export const mib = (bytes: number) => (bytes < 1048576 ? `${bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : 0} KiB` :`${(bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1)} MiB`);
export const workshopLink = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

// 后端接入 modMeta 之前的本机暂存；接入后 acceptMeta 会合并上去并清掉
const META_KEY = 'flare.modMeta.pending';
function readLocalMeta(): Record<string, ModMeta> {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function writeLocalMeta(meta: Record<string, ModMeta>) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* 无本机存储时只在本次会话有效 */ }
}
function clearLocalMeta() {
  try { localStorage.removeItem(META_KEY); } catch { /* 同上 */ }
}

// 服务器合集：后端接入 serverLayout 之前的本机暂存；接入后 acceptLayout 会推上去并清掉
const LAYOUT_KEY = 'flare.serverLayout.pending';
function readLocal<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 无本机存储时只在本次会话有效 */ }
}
function removeLocal(key: string) {
  try { localStorage.removeItem(key); } catch { /* 同上 */ }
}
function cleanLayout(raw: unknown): ServerLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ServerLayout>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const used = new Set<string>();
  const groups = (Array.isArray(r.groups) ? r.groups : []).flatMap((g): ServerGroup[] => {
    if (!g || typeof g.id !== 'string' || typeof g.name !== 'string' || g.id === LOOSE || used.has(g.id)) return [];
    used.add(g.id);
    return [{ id: g.id, name: g.name.slice(0, 40), serverIds: ids(g.serverIds) }];
  });
  return { groups, loose: ids(r.loose) };
}
/** 查询中的条目沿用上次在线结果显示，避免每轮刷新时卡片清空闪烁 */
const lastOnline = new Map<string, Server>();
function stable(s: Server): Server {
  if (s.status === 'online') lastOnline.set(s.id, s);
  if (s.status !== 'querying') return s;
  const prev = lastOnline.get(s.id);
  return prev ? { ...prev, label: s.label, favorite: s.favorite, gamePort: s.gamePort,
    name: s.name || prev.name, connectAddr: s.connectAddr ?? prev.connectAddr, status: 'querying' } : s;
}
function sectionsOf(layout: ServerLayout, servers: Server[]): ServerSection[] {
  const byId = new Map(servers.map(s => [s.id, stable(s)]));
  const seen = new Set<string>();
  const take = (ids: string[]) => ids.flatMap(id => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return [];
    seen.add(id);
    return [s];
  });
  const out: ServerSection[] = layout.groups.map(g => ({ id: g.id, name: g.name, servers: take(g.serverIds) }));
  const loose = take(layout.loose);
  out.push({ id: LOOSE, name: '未分组', loose: true, servers: [...loose, ...servers.filter(s => !seen.has(s.id)).map(s => byId.get(s.id)!)] });
  return out;
}

export const app = new AppState();
