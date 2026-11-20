import { call } from './bridge';
import type { FavoriteCollection, FavoriteEdit, FavoriteReference } from '../types';
import type { LaunchConfiguration, LaunchMode, ModCreator, ModTask, ModSound, TrashEntry, WorkshopItem, WorkshopQuery, WorkshopPage, NativeLibrariesState, NativeLibraryPlan, NativeLibraryDownloadPlan, DllScreening, L4nPluginsState, L4nPluginPlan, PluginOverlayFields, IntakeResult, IntakeDetails, IntakeImportPlan } from '../types';
import type { Category, CfgEntry, Conflict, DxvkRuntime, ExternalPlatform, GameInfo, Mod, ModMeta, PlatformChangePlan, PlatformLaunchPreview, PlatformOperation, PlatformPlan, PlatformPlugin, PlatformRelease, PlatformRuntime, Profile, Server, ServerLayout, SteamProfile } from '../types';

export interface BrowserArchive { items: { name: string; size: number }[] }
interface VpkPreview { file: string; name: string; title: string; sizeMB: number; fileCount: number; files: { name: string; size: number }[]; warning: string }
export type LocalModInput = { targetExists: boolean } & (({ kind: 'vpk' } & VpkPreview)
  | { kind: 'folder'; file: string; name: string; prefix: string; sourceStamp: string });
/** maxConcurrent：1–4，默认 2；speedLimit：B/s，0 = 不限。工坊和 GameMaps 合计共享这个额度 */
export interface DownloadSettings { maxConcurrent: number; speedLimit: number }
export interface WorkshopPreviewResult { dataUrl: string | null; detailOnly?: boolean }
export interface Snapshot {
  externalPacks?: import('../types').ExternalPackRecord[];
  game: GameInfo;
  launch: LaunchConfiguration;
  installations: { root: string; build: string }[];
  runtime: PlatformRuntime;
  dxvk: DxvkRuntime & { configured: boolean };
  plugins: PlatformPlugin[];
  availablePlugins?: PlatformPlugin[];
  nativeLibraries?: NativeLibrariesState;
  /** L4N 子插件；旧服务缺省 */
  l4nPlugins?: L4nPluginsState;
  mods: Mod[]; categories: Category[]; profiles: Profile[]; activeProfileId: string;
  conflicts: Conflict[]; servers: Server[]; cfg: CfgEntry[];
  modState: { writable: boolean; addonListPath: string };
  capabilities: { plugins: boolean; mods: boolean; servers: boolean; config: boolean; platforms?: boolean; platformManagement?: boolean; platformManagementVersion?: number };
  /** 外部平台包（Skeeto 等）；旧服务缺省 */
  platforms?: ExternalPlatform[];
  issues: { code: string; message: string }[];
  checkedAt: string;
  /** 后端持久化标记；兼容旧服务时缺省并暂存在本机 */
  modMeta?: Record<string, ModMeta>;
  favoriteCollections?: FavoriteCollection[];
  favoriteRefs?: Record<string, FavoriteReference>;
  tasks?: ModTask[];
  /** Matcha 回收站，按删除时间倒序 */
  trash?: TrashEntry[];
  /** 后端持久化的服务器合集；兼容旧服务时暂存在本机 */
  serverLayout?: ServerLayout;
}
export const api = {
  loadSnapshot: () => call<Snapshot>('snapshot'),
  /** 主页玩家卡片：本机最近登录的 Steam 账号；找不到账号时 profile 为 null（见 docs/steam-profile-handoff.md） */
  steamProfile: () => call<{ profile: SteamProfile | null }>('steam-profile'),
  libraryPreview: (id: string, enabled: boolean) => call<NativeLibraryPlan>('library-preview', { id, enabled }),
  libraryApply: (planId: string) => call('library-apply', { planId }, true),
  libraryRecover: (id: string) => call('library-recover', { id }, true),
  // L4N / DXVK 按需下载、DLL 模组更新、危险筛查：见 docs/dll-safety-updates-handoff.md
  libraryDownloadPreview: (id: 'l4n' | 'dxvk') => call<NativeLibraryDownloadPlan>('library-download-preview', { id }),
  /** 下载进度走 task_progress（kind platform-download，sourceId native:<id>），完成后发 objects_changed */
  libraryDownload: (planId: string) => call<{ taskId: string }>('library-download', { planId }, true),
  /** 立刻按清单声明的更新来源查一遍（平时后台每天查一次），只查不下载 */
  dllUpdatesCheck: () => call<{ checkedAt: string; updates: number }>('dll-updates-check', {}),
  /** 下载某个模组的新版本到暂存区，核对签名并做危险筛查；进度走 task_progress（sourceId plugin:<id>） */
  pluginUpdateFetch: (id: string) => call<IntakeResult>('plugin-update-fetch', { id }, true),
  /** 重新做一次危险筛查：已装的模组给 pluginId，暂存的包给 intakeId */
  dllScreen: (target: { pluginId: string } | { intakeId: string }) => call<DllScreening>('dll-screen', target),
  // L4N 子插件：整个 DLL 在 bin/neko/plugins 和停用目录之间移动，先预览再确认
  l4nPluginPreview: (req: { operation: 'import'; file: string } | { operation: 'set-enabled'; pluginId: string; enabled: boolean } | {operation:'update'|'rollback'|'uninstall';pluginId:string;file?:string}) => call<L4nPluginPlan>('l4n-plugin-preview', req),
  l4nPluginApply: (planId: string) => call<{ pluginId: string; enabled: boolean }>('l4n-plugin-apply', { planId }, true),
  l4nPluginRecover: () => call('l4n-plugin-recover', {}, true),
  pluginCover: (id: string, kind: 'module' | 'collection' | 'catalog', collectionId?: string) => call<{ dataUrl: string | null }>('plugin-cover', { id, kind, ...(collectionId ? { collectionId } : {}) }),
  /** 详情页内容块引用的包内图片；路径须在 presentation 里声明过（见 docs/dll-page-handoff.md） */
  pluginAsset: (id: string, path: string) => call<{ dataUrl: string | null }>('plugin-asset', { id, path }),
  /** 保存「编辑资料」：写入 Matcha 自己的补充资料，不改作者的包（见 docs/dll-source-handoff.md） */
  pluginOverlaySave: (id: string, fields: PluginOverlayFields) => call<{ ok: true }>('plugin-overlay-save', { id, fields }),
  selectGame: (gameRoot: string) => call<Snapshot>('select-game', { gameRoot }),
  saveProfile: (profile: Profile) => call('save-profile', { profile }),
  selectProfile: (id: string) => call('select-profile', { id }),
  deleteProfile: (id: string) => call('delete-profile', { id }),
  saveCategories: (categories: Category[], assignments: Record<string, string>) => call('save-categories', { categories, assignments }),
  previewMod: (file: string) => call<VpkPreview>('preview-mod', { file }),
  previewModInput: (file: string) => call<LocalModInput | { kind: 'shard' } | { kind: 'unsupported' }>('preview-mod-input', { file, replaceExisting: true }),
  importMod: (input: Extract<LocalModInput, { kind: 'vpk' }>, gameRoot: string, favoriteId?:string) => call<{ id: string; enabled: boolean; replaced?: boolean }>('import-mod', { file: input.file, replaceExisting: input.targetExists, gameRoot, favoriteId }, true),
  packModFolder: (input: Extract<LocalModInput, { kind: 'folder' }>, gameRoot: string, categoryId: string, favoriteId?:string) =>
    call<{ taskId: string }>('pack-mod-folder', { file: input.file, replaceExisting: input.targetExists, sourceStamp: input.sourceStamp, gameRoot, categoryId, favoriteId }, true),
  browserArchive: (id: string) => call<BrowserArchive>('browser-archive', { id }),
  /** creators：前端从来源链找到的作者页，后端存进 Mod 的 origin.creators（docs/creator-source-handoff.md） */
  browserImport: (id: string, selected?: string[], creators?: ModCreator[]) => call<{ imported: string[]; errors: string[] }>('browser-import', { id, selected, ...(creators?.length ? { creators } : {}) }, true),
  /** 返回 JPEG data URL，无图为 null */
  modThumbnail: (id: string) => call<{ dataUrl: string | null }>('mod-thumbnail', { id }),
  trashThumbnail: (trashId: string) => call<{ dataUrl: string | null; dirs?: string[] }>('trash-thumbnail', { trashId }),
  /** 按 id 替换记录；值为 null 表示删除该 id 的记录 */
  saveModMeta: (patch: Record<string, ModMeta | null>) => call('save-mod-meta', { patch }),
  editFavoriteCollection: (edit: FavoriteEdit) => call<{id: string; favoriteCollections: FavoriteCollection[]}>('edit-favorite-collection', edit),
  bookmarkFiles: (paths: string[], collectionId?: string) => call<{count:number; skipped:string[]}>('bookmark-files', {paths, collectionId}),
  favoriteToProfiles: (favoriteIds:string[],profileIds:string[],gameRoot:string) => call<{added:number;lines:string[]}>('favorite-to-profiles',{favoriteIds,profileIds,gameRoot},true),
  /** 只读：删除确认框用。预览里的 trashId 不是最终值 */
  previewDeleteMods: (ids: string[]) => call<{ mods: TrashEntry[]; sizeBytes: number }>('preview-delete-mods', { ids }),
  deleteMods: (ids: string[]) => call<{ trashed: { trashId: string; modId: string; files: string[] }[] }>('delete-mods', { ids }, true),
  restoreMods: (trashIds: string[]) => call<{ restored: string[]; conflicts: { trashId: string; reason: string }[] }>('restore-mods', { trashIds }, true),
  /** 永久删除，不可恢复 */
  purgeTrash: (trashIds: string[] | 'all') => call<{ purged: string[] }>('purge-trash', { trashIds }, true),
  extractMod: (id: string, target?: string) => call<{ taskId: string }>('extract-mod', { id, target }, true),
  /** 只读：外部平台适配描述里列出的说明文件，纯文本 */
  platformDoc: (id: string, path: string) => call<{ text: string }>('platform-doc', { id, path }),
  // ---------- 外部平台管理（docs/platform/SKEETO_EXPERIMENT.md 阶段 2）：先预览，再带 planId 确认执行 ----------
  /** 只读 GitHub 发布元数据 */
  platformCheckUpdate: (id: string) => call<PlatformRelease>('platform-check-update', { id }),
  platformDownload: (id: string, version: string) => call<{ taskId: string }>('platform-download', { id, version }, true),
  /** 需要先下载；未下载返回 platform_download_required */
  platformPreviewInstall: (id: string, version: string) => call<PlatformChangePlan>('platform-preview-install', { id, version }),
  platformPreviewOperation: (id: string, operation: Exclude<PlatformOperation, 'install'>, enabled?: boolean) =>
    call<PlatformPlan>('platform-preview-operation', { id, operation, enabled }),
  /** 执行预览过的计划 → 任务 */
  platformExecute: (operation: PlatformOperation, id: string, planId: string, enabled?: boolean) =>
    call<{ taskId: string }>(`platform-${operation}`, { id, planId, enabled }, true),
  /** 有受管平台时返回本次启动的模块调整；required=false 时照旧启动 */
  platformPreviewLaunch: (mode: LaunchMode, profileId: string, serverId?: string) =>
    call<PlatformLaunchPreview>('platform-preview-launch', { mode, profileId, serverId }),
  revealPath: (path: string) =>call<{ status: 'opened' }>('reveal-path', { path }),
  modSounds: (id: string) => call<ModSound[]>('mod-sounds', { id }),
  modSound: (id: string, path: string) => call<{ mime: string; base64: string; durationMs?: number }>('mod-sound', { id, path }),
  workshopResolve: (ids: string[]) => call<{ items: WorkshopItem[] }>('workshop-resolve', { ids }),
  workshopBrowse: (query: WorkshopQuery) => call<WorkshopPage>('workshop-browse', { ...query }),
  workshopDetail: (id: string) => call<WorkshopItem>('workshop-detail', { id }),
  workshopPreview: (id: string, size?: 'card' | 'detail', requestId?: string) =>
    call<WorkshopPreviewResult>('workshop-preview', { id, size, requestId }),
  cancelWorkshopPreview: (requestId: string) => call('workshop-preview-cancel', { requestId }),
  workshopOpen: (id?: string) => call('workshop-open', { id }),
  workshopDownload: (ids: string[]) => call<{ taskIds: string[] }>('workshop-download', { ids }, true),
  taskList: () => call<ModTask[]>('task-list'),
  taskCancel: (taskId: string) => call<ModTask>('task-cancel', { taskId }),
  taskRetry: (taskId: string) => call<{ taskId: string }>('task-retry', { taskId }, true),
  // ---------- 下载页（docs/downloads-handoff.md）：暂停保留进度、继续回到队尾从头传；删除只动记录，文件和 Mod 都留着 ----------
  taskPause: (taskId: string) => call<ModTask>('task-pause', { taskId }),
  taskResume: (taskId: string) => call<ModTask>('task-resume', { taskId }),
  /** 只删 done / failed / canceled；按回执里的 removed 移除行 */
  taskRemove: (taskIds: string[]) => call<{ removed: string[] }>('task-remove', { taskIds }),
  downloadSettingsGet: () => call<DownloadSettings>('download-settings-get'),
  /** 可以只传一个字段；返回保存后的完整设置 */
  downloadSettingsSet: (patch: Partial<DownloadSettings>) => call<DownloadSettings>('download-settings-set', { ...patch }),
  applyModProfile: (id: string) => call<{ status: string; enabledCount: number; backup: string | null }>('apply-mod-profile', { id }, true),
  planInstall: () => call<{ id: string; gameRoot: string; changes: string[] }>('plan-install'),
  applyInstall: (planId: string) => call('apply-install', { planId }, true),
  restore: () => call('restore', {}, true),
  resumeRuntime: () => call('resume-runtime', {}, true),
  recover: () => call('recover', {}, true),
  /** 目录或 ZIP；不是标准 SDK 包时抛 plugin_needs_agent / plugin_package_rejected，details 为 IntakeResult */
  validatePlugin: (pluginDirectory: string) => call<{ manifest: PlatformPlugin; preparedDirectory?: string; intakeId?: string; candidateId?: string }>('validate-plugin', { pluginDirectory }),
  // ---------- 本地包检查与导入（docs/dll-source-handoff.md）：只在 Matcha 数据目录暂存，作者文件和游戏目录不动 ----------
  pluginIntakeInspect: (file: string) => call<IntakeResult>('plugin-intake-inspect', { file }),
  pluginIntakeDetails: (intakeId: string) => call<IntakeDetails>('plugin-intake-details', { intakeId }),
  pluginIntakeImportPreview: (intakeId: string, candidateId: string) => call<IntakeImportPlan>('plugin-intake-import-preview', { intakeId, candidateId }),
  pluginIntakeImport: (planId: string) => call<{ id?: string; host: 'flare' | 'l4n'; operation: 'install' | 'update'; enabled: boolean; metadataWarning?: { message: string } }>('plugin-intake-import', { planId }, true),
  installPlugin: (pluginDirectory: string) => call('install-plugin', { pluginDirectory }, true),
  updatePlugin: (pluginDirectory: string) => call('update-plugin', { pluginDirectory }, true),
  previewPluginMaintenance: (pluginId:string, operation:'uninstall'|'rollback') => call<{
    planId:string; gameRoot:string; name:string; version:string; targetVersion?:string; directory:string; files:string[]; backupDirectory?:string;
  }>('plugin-maintenance-preview',{pluginId,operation}),
  applyPluginMaintenance: (planId:string) => call<{previousDirectory:string;metadataWarning?:{message:string}}>('plugin-maintenance-apply',{planId},true),
  setPluginEnabled: (pluginId: string, enabled: boolean) => call('set-plugin-enabled', { pluginId, enabled }, true),
  setRecordedDllEnabled: (id:string,enabled:boolean,gameRoot:string) => call<import('../types').ExternalPackRecord>('plugin-record-set-enabled',{id,enabled,gameRoot},true),
  invoke: (pid: number, pluginId: string, actionId: string, args: Record<string, unknown>, approved: boolean) => call('invoke', { pid, pluginId, actionId, args }, approved),
  /** 有受管外部平台时必须带 platformPlanId，返回 { taskId }；否则照旧返回 { status } */
  launch: (profileId: string, mode: LaunchMode, platformPlanId?: string) =>
    call<{ status: 'requested'; pid?: number } | { taskId: string }>('launch', { profileId, mode, platformPlanId }, true),
  setLaunchMode: (mode: LaunchMode) => call<LaunchConfiguration>('set-launch-mode', { mode }),
  queryServers: (ids: string[]) => call<Server[]>('query-servers', { ids }),
  writeCfg: (entries: CfgEntry[]) => call('write-cfg', { entries }),
};
