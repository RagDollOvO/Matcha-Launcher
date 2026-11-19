// 前端视图模型。字段命名即前端向后端（codex）要的数据契约，待架构会对齐后冻结。

export type Route = 'home' | 'mods' | 'workshop' | 'bilibili' | 'gamemaps' | 'browser' | 'downloads' | 'plugins' | 'servers' | 'settings';

export type LaunchMode = 'modded' | 'clean' | 'direct' | 'development';
export interface LaunchConfiguration {
  mode: LaunchMode;
  label: string;
  route: 'game-exe' | 'steam-applaunch';
  vacMode: 'game-default' | 'insecure';
  launchOptions: string[];
}

export interface GameInfo {
  installed: boolean;
  root: string; // ...\steamapps\common\Left 4 Dead 2
  steamId: string; // 550
  build: string; // 游戏版本号
  running: boolean;
  pid?: number;
}

export type ModSource = 'workshop' | 'local';
/** 网页下载的作者页：从内置浏览器的来源链里找到的 B站视频、爱发电作品 / 主页、创意工坊或 GameMaps 页面 */
export interface ModCreator { source: 'steam' | 'bilibili' | 'gamemaps' | 'afdian'; url: string; title: string; author?: string }

export interface Mod {
  id: string;
  file: string; // VPK 文件名
  title: string; // Matcha 显示名，默认使用来源标题
  sourceTitle?: string; // 作者标题、工坊标题或文件名
  author: string; // addonauthor
  version: string; // addonversion
  description: string;
  source: ModSource;
  workshopId?: string;
  sizeMB: number;
  fileCount: number;
  dirs: string[]; // VPK 内顶层覆盖目录，如 models/survivors
  categoryId: string;
  updatedAt: string;
  absolutePath?: string;
  /** 从内置浏览器下载导入的：下载页，以及找到的作者页（B站视频、爱发电作品等，见 docs/creator-source-handoff.md） */
  origin?: { pageUrl: string; title: string; downloadId: string; creators?: ModCreator[] };
  enabled?: boolean | null; // addonlist.txt: null = 游戏尚未登记
  /** VPK 内 addonimage.jpg 或同目录同名 .jpg 存在时为 true；经 `mod-thumbnail` 懒加载 */
  hasThumbnail?: boolean;
  soundCount?: number;
  storage?: 'addons' | 'library';
  deployed?: boolean;
  deploymentFile?: string;
  warning?: string;
  error?: string;
  /** 外部平台的创意工坊更新包（例如 Skeeto），不参与方案与重叠；在插件页管理 */
  kind?: 'platform-package';
  platformId?: string;
}

// ---------- 外部平台包（snapshot.platforms，见 docs/platform/SKEETO_EXPERIMENT.md） ----------
export interface ExternalPackRecord {
  id: string; name: string; author?: string; version?:string; source: string; launch: string; maintenance: string; enable?: string; disable?: string;
  state: 'absent'|'installed'|'partial'|'occupied'|'unchecked';
  runtime: 'offline'|'loaded'|'not-seen'|'unknown';
  control?: {enabled:boolean|null;reason:string;pending:boolean};
  switching?: {kind:'park-entry'|'ini-flag';path:string;key?:string;on?:number};
  files: {path:string; role:string; state:'missing'|'match'|'different'|'unchecked'; mapped?:boolean;parked?:boolean}[];
  conflicts: {path:string; other:string; present:boolean}[];
  lastCheck: {at:string; state:ExternalPackRecord['state']; runtime:ExternalPackRecord['runtime']}|null;
}
export type PlatformModuleKind = 'cosmetic' | 'self-info' | 'intel' | 'input' | 'bypass' | 'local' | 'system' | 'loader' | 'update';
export type PlatformOnline = 'any' | 'no-versus' | 'local-only' | 'blocked' | 'review';
export interface PlatformSwitch {
  type: string; file?: string; key: string; aliases?: string[]; off: number; source?: string;
  /** 已保存设置里的值；读不到为 null，未读取时缺省 */
  value?: boolean | null;
}
export interface PlatformModule {
  id: string; name: string; kind: PlatformModuleKind; online: PlatformOnline;
  from: string[]; commands?: string[]; touches: string[]; note?: string;
  state: 'on' | 'off' | 'unknown';
  stateSource: 'saved-settings';
  /** 找到了能完整关掉它的开关 */
  switchable: boolean;
  switchCoverage: 'complete' | 'partial' | 'unknown';
  switches: PlatformSwitch[];
  switchNote?: string;
}
export interface ExternalPlatform {
  distribution?: 'source-ports';
  id: string;
  name: string;
  kind: 'external-platform';
  installed: boolean;
  version: string | null;
  state: 'not-installed' | 'enabled' | 'disabled' | 'broken';
  source: { repo: string; license: string; visibility: 'public' | 'private' | 'closed'; author?: string };
  identity: { verified: boolean; claimed: string };
  verification: { state: 'unverified' | 'verified-development' | 'rejected'; error?: { message: string } };
  loader: { kind: 'proxy-dll'; file: string; present: boolean; owned: boolean; foreign?: string };
  integrity: { state: 'match' | 'mismatch' | 'unknown'; scope?: string; files: { path: string; role: string; ok: boolean; reason?: string }[] };
  runtime: { loaded: boolean | null };
  update: { channel: 'steam-workshop' | 'flare' | 'none'; workshopId?: string; selfUpdate: boolean | null; packagePresent: boolean; packageVersion?: string };
  subPlugins: { platformOn: boolean | null; items: { file: string; name?: string; version?: string }[] };
  modules: PlatformModule[];
  docs: { title: string; path: string; present: boolean }[];
  coexist: { beacon: 'ok' | 'warn' | 'unknown'; note?: string };
  issues: { code: string; message: string }[];
  /** 由 Matcha 安装账本管理 */
  managed?: boolean;
  /** 上次平台操作中断，需要先恢复 */
  pendingOperation?: boolean;
}
/** platform-check-update：GitHub 最新发布 */
export interface PlatformRelease {
  version: string; publishedAt: string; summary: string; url: string;
  asset: { name: string; size: number };
  installedVersion: string | null; updateAvailable: boolean;
}
export type PlatformOperation = 'install' | 'set-enabled' | 'uninstall' | 'set-self-update' | 'recover';
/** 平台操作的预览计划；执行时带 planId，最长有效 15 分钟 */
interface PlatformPlanBase {
  planId: string; id: string; gameRoot: string;
}
export interface PlatformChangePlan extends PlatformPlanBase {
  operation: Exclude<PlatformOperation, 'recover'> | 'launch-policy';
  version?: string; enabled?: boolean;
  requiresManualMigrate?: boolean; sizeBytes?: number; packageBytes?: number;
  loader?: { file: string; occupant: 'absent' | 'skeeto' | 'foreign-unknown'; replaced: boolean };
  files: { path: string; action: 'create' | 'replace' | 'remove' | 'backup'; before: string | null; after: string | null; sizeBytes: number }[];
  modules: { id: string; name: string; reason: string; changed: boolean }[];
  warnings: string[];
  verification?: { state: string };
}
export interface PlatformRecoveryPlan extends PlatformPlanBase {
  operation: 'recover';
  recovery: { transactionId: string; status: string; files: { path: string; before: string | null; after: string | null }[] };
}
export type PlatformPlan = PlatformChangePlan | PlatformRecoveryPlan;
/** platform-preview-launch：没有受管平台时 required=false */
export type PlatformLaunchPreview = { required: false; modules: [] } | ({ required: true } & PlatformChangePlan);

/** 库里每个 Mod 的附加标记，跨方案、跨分类，通过 save-mod-meta 持久化。 */
export interface ModMeta {
  favorite?: boolean;
  /** 新下载、尚未整理 */
  inbox?: boolean;
}

export interface ModTask {
  taskId: string;
  workshopId?: string;
  /** 下载来源；gamemaps 的任务用 sourceId 对应 GameMaps 条目 id */
  source?: 'workshop' | 'gamemaps';
  sourceId?: string;
  /** platform-* 是外部平台的下载、操作和带规则的启动，在插件页显示，不进 Mod 任务托盘。
   *  L4N / DXVK 按需下载、DLL 模组拉新版本也用 platform-download，sourceId 为 native:l4n / native:dxvk / plugin:<模组 ID> */
  kind: 'extract' | 'pack' | 'download' | 'platform-download' | 'platform-operation' | 'platform-launch';
  gameRoot: string;
  title: string;
  state: 'queued' | 'running' | 'paused' | 'verifying' | 'done' | 'failed' | 'canceled';
  /** platform-launch 完成时的启动结果 */
  status?: string;
  pid?: number;
  done: number;
  total: number | null;
  unit: 'bytes' | 'files';
  cancelable: boolean;
  pausable: boolean;
  /** 继续时可从已接收的字节处续传；继续按钮由 state === 'paused' 决定。 */
  resumable: boolean;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  bytesPerSecond?: number;
  archiveCleaned?: boolean;
  archiveName?: string;
  error?: { code: string; message: string };
  dir?: string;
  modId?: string;
  fileCount?: number;
  /** 文件已入库，附属分类资料保存失败时的说明。 */
  warning?: string;
}
export interface ModSound { path: string; bytes: number; durationMs?: number }
/** Matcha 回收站里的一项。moving / restoring = 中断后待还原；purging = 待完成永久删除 */
export interface TrashEntry {
  trashId: string;
  modId: string;
  title: string;
  file: string;
  sizeMB: number;
  sizeBytes: number;
  deletedAt: string;
  categoryId: string;
  profileIds: string[];
  workshopId?: string;
  /** addons 相对路径，或 .matcha-library/... 路径；size 为字节 */
  files: { file: string; size: number }[];
  state: 'moving' | 'trashed' | 'restoring' | 'purging';
}
export interface WorkshopItem {
  id: string;
  kind: 'item' | 'collection';
  appId: number;
  title: string;
  author: string; // Steam creator ID; VPK author metadata replaces this after download.
  sizeBytes: number;
  preview: string | null;
  updatedAt: string;
  inLibrary: boolean;
  downloadable: boolean;
  workshopUrl: string;
  reason?: string;
  error?: string;
  children?: string[];
  authorName?: string;
  description?: string;
  tags?: string[];
  subscriptions?: number;
  childCount?: number;
  hasPreview?: boolean;
}

export interface WorkshopQuery {
  search: string;
  sort: 'trend' | 'mostrecent' | 'lastupdated' | 'totaluniquesubscribers';
  tag: string;
  kind: 'item' | 'collection';
  page: number;
}
export interface WorkshopPage {
  items: WorkshopItem[];
  page: number;
  totalPages: number;
  total: number;
  workshopUrl: string;
}

export interface Category {
  id: string;
  name: string;
  builtin?: boolean; // “未分类”不可删除；前端把它当作最外层，不显示成文件夹
  parentId?: string; // 上级分类；缺省 = 最外层。后端原样存取
}

/** 方案 = 一组启用的 Mod + 一组 DLL 插件 + 一套启动项/CFG */
export interface Profile {
  id: string;
  name: string;
  note: string;
  modIds: string[];
  pluginIds: string[];
  launchOptions: string;
  updatedAt: string;
  modsInitialized?: boolean;
  modsGameRoot?: string;
}

export interface Conflict {
  id: string;
  a: string; // mod id
  b: string;
  paths: string[]; // 两个 VPK 都包含的文件
  pathCount?: number;
  winner?: string; // 演示数据兼容；实际扫描仅报告同路径资源
}

export interface L4NRuntime {
  installed: boolean;
  version: string;
  dir: string; // bin/neko
  apiVersion: string;
}

export interface DxvkRuntime {
  installed: boolean;
  enabled: boolean;
  version: string;
  dll: string; // d3d9.dll
}

export interface Plugin {
  id: string;
  file: string;
  name: string;
  version: string;
  author: string;
  description: string;
  api: string;
}

export type ServerMode = '战役' | '写实' | '对抗' | '生存' | '清道夫' | '自定义' | '未知';

export interface Server {
  id: string;
  name: string;
  addr: string;
  map: string;
  mode: ServerMode;
  players: number | null;
  maxPlayers: number | null;
  ping: number | null;
  tags: string[];
  vac: boolean | null;
  password: boolean | null;
  favorite: boolean;
  status: 'unqueried' | 'querying' | 'online' | 'timeout' | 'error' | 'wrong-game';
  checkedAt: string | null;
  lastSeen: string | null;
  error: string;
  connectAddr: string | null;
  label: string;
  gamePort: number | null;
  bots: number | null;
  modeId: string;
  /** A2S_PLAYER 名单（含协议返回的 Bot）；null = 暂无可用名单，空数组 = 空服 */
  playerList?: ServerPlayer[] | null;
}

export interface ServerPlayer {
  name: string;
  /** 本次连接时长（秒） */
  seconds: number;
  score: number;
}

/** 服务器合集：有序的服务器 id。一台服务器最多在一个合集里，不在任何合集里的算「未分组」 */
export interface ServerGroup {
  id: string;
  name: string;
  serverIds: string[];
}

/** 服务器页布局，经 save-server-layout 持久化；本机暂存待保存副本 */
export interface ServerLayout {
  groups: ServerGroup[];
  /** 未分组服务器的手动顺序；没列出的按添加顺序排在后面 */
  loose: string[];
}

export interface CfgEntry {
  key: string;
  value: string;
  group: '画面' | '网络' | '声音' | '其他';
  desc: string;
}

export interface LaunchFlag {
  flag: string;
  desc: string;
}

export interface PlatformRuntime {
  host?: 'legacy-dxvk'|'l4n'; installed: boolean; status: string; version: string; dir: string; apiVersion: string;
  connected: boolean; phase: string; pendingOperations: string[];
}
export interface NativeLibraryState {
  id: 'l4n'; name: string; availableVersion: string; source: string;
  sourceKind?: 'author-workshop' | 'release-archive';
  installed: boolean; enabled: boolean; version: string | null; pending: boolean; unmanaged?: boolean; supportsLaunchToggle?:boolean; launchEnabled?:boolean;
  /** 组件文件在不在本机：bundled 随包、downloaded 已下载、missing 要先下载。旧服务缺省，视为 bundled。见 docs/dll-safety-updates-handoff.md */
  availability?: 'bundled' | 'downloaded' | 'missing';
  /** 可下载的版本：没下载过，或者有比本机更新的版本时给出 */
  download?: { version: string; url: string; sizeBytes: number | null; sha256: string; source: string; license?: string } | null;
  /** 装上能做什么，按作者说明整理（每条一句）；缺省时界面用自己的通用说明 */
  features?: string[];
}
export interface RenderEntry { route:'default'|'vulkan'; path:string; kind:'dxvk'|'legacy-matcha'|'unknown'; version:string|null }
export interface NativeLibrariesState {
  packaged: boolean; runtimeUpdateAvailable: boolean; l4n: NativeLibraryState; dxvk: {id:'dxvk'; name:string; installed:boolean; pending:boolean; version:string|null; entries?: RenderEntry[]};
}
/** 一个 DLL 的加载状态。展示优先用 label。见 docs/dll-runtime-handoff.md */
export interface DllLoadStatus {
  state: 'available' | 'disabled' | 'pending' | 'loaded' | 'initialized' | 'failed' | 'unobserved' | 'host-disabled';
  label: string;
  host: 'flare' | 'l4n';
  nextLaunchEnabled: boolean;
  observed: boolean;
  mapped: boolean | null;
  initialized: boolean | null;
  pendingChange: boolean;
  code?: string; message?: string; detail?: string;
  /** 本局已装载、但下次启动会出问题（例如文件位置和记录对不上） */
  nextLaunchError?: { code: string; message: string };
}
/** L4N 子插件：由 L4N 自己加载，放在 bin/neko/plugins/ */
export interface L4nSubPlugin {
  canRollback?: boolean;
  id: string; file: string; name: string; enabled: boolean; managed?: boolean;
  /** 加载目录里的相对路径 */
  entry: string;
  /** 停用时 DLL 所在的相对路径（L4N 扫描目录之外） */
  parkedPath?: string;
  runtimeState: string; loadStatus?: DllLoadStatus; error?: string;
}
export interface L4nPluginsState {
  hostEnabled: boolean; pending: boolean; plugins: L4nSubPlugin[]; issues: { code: string; message: string; file?: string }[];
}
/** l4n-plugin-preview 的结果：确认后用 planId 执行，见 docs/dll-runtime-handoff.md */
export interface L4nPluginPlan {
  planId: string; operation: 'import' | 'set-enabled' | 'update' | 'rollback' | 'uninstall'; applies: 'next-launch';
  plugin: { id: string; file: string; enabled: boolean };
  files: { path: string; action: 'create' | 'replace' | 'remove'; bytes: number }[];
}
export interface NativeLibraryPlan {
  planId: string; id: string; enabled: boolean; version: string | null;
  files: { path: string; action: string; bytes: number }[];
}
/** 按需下载 L4N / DXVK 前的确认：从哪下、多大、按什么校验、存到哪 */
export interface NativeLibraryDownloadPlan {
  planId: string; id: 'l4n' | 'dxvk'; version: string;
  url: string; source: string; sizeBytes: number | null; sha256: string;
  /** 下载后保存到 Matcha 数据目录的哪里（不是游戏目录） */
  target: string;
  license?: string;
}
export interface Parameter {
  type: 'string' | 'boolean' | 'integer' | 'number' | 'enum';
  required?: boolean; default?: string | number | boolean; maxLength?: number;
  minimum?: number; maximum?: number; options?: string[];
}
export interface PluginAction {
  id: string; label: string; description: string; effect: 'read' | 'write'; requiresConfirmation: boolean;
  parameters: Record<string, Parameter>;
}
export interface PlatformPlugin extends Plugin {
  managed?: boolean; canRollback?: boolean;
  savedConfig?: Record<string, string | boolean | number>;
  configError?: string;
  installed?: boolean;
  packageDirectory?: string;
  presentation?: PluginPresentation;
  apiVersion: number; architecture: string; phase: string;
  loadRole?: 'dependency'; launchScope?: 'insecure';
  loadKind?: 'sdk' | 'library';
  dependencies: { id: string; version: string }[]; actions: PluginAction[]; config: unknown[];
  enabled: boolean; loadOrder: number; runtimeState: string; error?: string;
  /** 由哪个宿主加载；旧服务缺省（视为 flare） */
  host?: 'flare' | 'l4n';
  /** 下次启动选择与本局实际装载分开说，见 docs/dll-runtime-handoff.md；旧服务缺省 */
  loadStatus?: DllLoadStatus;
  /** 当前磁盘核验；旧服务缺省 */
  verification?: { state: 'unverified' | 'verified-development' | 'rejected'; error?: { message: string } };
  /** 危险筛查结果（静态检查，不运行 DLL）；还没查过时缺省 */
  screening?: DllScreening;
  /** 后台按清单声明的更新来源查到的新版本（只查不下载）；没有新版或没声明来源时缺省 */
  update?: PluginUpdate | null;
  /** 这个功能从哪来的；由 Agent 接入时记录，见 docs/dll-source-handoff.md */
  source?: PluginSource;
  /** presentation 里各字段的出处。缺省视为开发者提供。 */
  provenance?: PluginProvenance;
}

export type FieldOrigin = 'developer' | 'agent' | 'user';
export type ProvenanceField = 'name' | 'author' | 'summary' | 'description' | 'tags' | 'modes' | 'hotkeys' | 'cover' | 'links';
export interface PluginProvenance {
  fields: Partial<Record<ProvenanceField, FieldOrigin>>;
  /** Agent 依据的资料，例如「GitHub README 与 v1.6.0 Release 说明」 */
  basis?: string;
  updatedAt?: string;
}
export interface PluginSource {
  type: 'github' | 'workshop' | 'local';
  /** 来源页面；本地来源为空 */
  url?: string;
  /** 简短名称：owner/repo、工坊物品标题或本地目录名 */
  label?: string;
  /** 接入时的版本或工坊更新时间 */
  version?: string;
  checkedAt?: string;
  /** Agent 最近一次检查到的来源最新状态 */
  latest?: { version?: string; publishedAt?: string; url?: string } | null;
}
/** 本地包检查（plugin-intake-inspect）：标准 SDK ZIP 直接导入，其余交给 Agent。见 docs/dll-source-handoff.md */
export interface IntakeIssue { code: string; message: string; file?: string }
/** 核验四档：已核验（绿）/ 闭源·未发现问题（琥珀）/ 未核验（灰）/ 已拦截（红） */
export type TrustTier = 'verified' | 'closed' | 'unverified' | 'blocked';
/** 危险筛查：读 DLL 的导入表、字符串和区段，不运行它。结论只对这一版规则、这一次检查有效。见 docs/dll-safety-updates-handoff.md */
export interface DllScreening {
  tier: TrustTier;
  rulesVersion: string;
  checkedAt: string;
  /** 检查过的 DLL 和它们的 SHA-256 */
  files: { path: string; sha256: string }[];
  /** block = 命中禁止项，拦下不装；review = 敏感能力，装之前要让玩家知道；info = 补充说明 */
  findings: DllFinding[];
  /** 联网查过文件指纹（只发 SHA-256，玩家同意后才查）；没查时缺省 */
  reputation?: { provider: string; checkedAt: string; malicious: number; total: number; url?: string } | null;
}
export interface DllFinding {
  rule: string;
  severity: 'block' | 'review' | 'info';
  category: 'injection' | 'network' | 'process' | 'credential' | 'input-hook' | 'memory' | 'packed' | 'signature' | 'reputation' | 'other';
  /** 一句话，给玩家看 */
  title: string;
  /** 依据，例如导入了哪些函数、哪段字符串；不放大段原文 */
  detail?: string;
  file?: string;
}
/** 来源有新版本。signer：新版签名和已装的是不是同一个开发者证书 */
export interface PluginUpdate {
  version: string;
  publishedAt?: string;
  url?: string;
  /** 发布说明节选，纯文本 */
  notes?: string;
  sizeBytes?: number | null;
  signer: 'same' | 'changed' | 'unsigned' | 'unknown';
  checkedAt: string;
}
export interface IntakeResult {
  intakeId: string;
  outcome: 'sdk-ready' | 'needs-agent' | 'rejected' | 'prepared';
  source?: string;
  host?: 'flare' | 'l4n' | null;
  manifest?: Pick<PlatformPlugin, 'id' | 'name' | 'version' | 'dependencies'> & { loadKind?: 'sdk' | 'library'; author?: string } | null;
  files: { path: string; bytes: number }[];
  issues: IntakeIssue[];
  candidateId?: string;
  candidateFiles?: { path: string; bytes: number }[];
  updatePluginId?: string;
  agent: { available: boolean; label: string; prompt: string };
  /** 包里 DLL 的危险筛查；旧服务缺省 */
  screening?: DllScreening;
}
/** plugin-intake-details：在检查结果上附 README / manifest 节选和每个 DLL 的接口识别 */
export interface IntakeDetails extends IntakeResult {
  originalDirectory?: string;
  documents: { path: string; text: string; truncated: boolean }[];
  dlls: { path: string; architecture?: string; host?: 'l4n' | 'flare-sdk' | 'library'; exports?: string[]; error?: string }[];
}
export interface IntakeImportPlan {
  planId: string; gameRoot: string; host: 'flare' | 'l4n'; name: string;
  files: { path: string; bytes: number }[];
  operation: 'install' | 'update'; pluginId?: string;
  version: string | null; previousVersion: string | null;
  sourceVersion?: string | null; previousSourceVersion?: string | null;
  enabled: boolean;
  verification?: { state: string; integrity?: string; releaseSha256?: string };
  /** 最终要装的文件的危险筛查；tier 为 blocked 时后端拒绝导入 */
  screening?: DllScreening;
}
/** 用户在「编辑资料」里改的简单字段 */
export interface PluginOverlayFields {
  name?: string; author?: string; summary?: string; description?: string;
  tags?: string[]; modes?: string[]; hotkeys?: { keys: string; label: string }[];
}

export interface PluginPresentation {
  schema: 1;
  summary?: string;
  description?: string;
  cover?: string;
  tags?: string[];
  links?: { label: string; url: string; note?: string }[];
  catalog?: PluginCollectionInfo;
  collections?: PluginCollectionInfo[];
  /** Legacy single-level collection metadata. */
  collection?: PluginCollectionInfo;
  /** 可选：快捷键，如 { keys: "Ctrl+F8", label: "切换发光" }；前端按 catalog.pluginUsage 校验 */
  hotkeys?: { keys: string; label: string }[];
  /** 可选：适用模式 coop / realism / survival / versus / scavenge */
  modes?: string[];
  /** 可选：开发者编排的详情页内容块与头图，前端由 plugins/page.ts 清洗 */
  page?: unknown[];
  hero?: unknown;
}
export interface PluginCollectionInfo {
  id: string; title: string; author: string; summary: string; description?: string; cover?: string;
}

/** 主页玩家卡片：当前登录的 Steam 账号（见 docs/steam-profile-handoff.md） */
export interface SteamProfile {
  /** SteamID64 */
  steamId: string;
  /** Steam 昵称 */
  personaName: string;
  /** 头像 data URL（PNG/JPEG），本机没有缓存时为 null */
  avatar: string | null;
  /** Steam 客户端是否在运行且已登录；拿不到时省略 */
  online?: boolean;
}
