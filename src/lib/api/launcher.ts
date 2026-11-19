// 启动器自身的桥接命令：应用信息、缓存、窗口行为、检查更新。
// 契约见 docs/settings-backend-handoff.md。旧版本地服务没有这些命令时返回 unsupported_capability，
// 界面据此显示「即将支持」而不是报错。
import { call, errorText } from './bridge';

export interface AppInfo {
  version: string;
  /** Matcha 数据目录（设置、任务记录、回收站等） */
  dataDir: string;
  storageDir?: string;
  /** 日志目录；没有单独日志时缺省 */
  logsDir?: string;
  /** 助手（pi）配置目录 */
  piConfigDir?: string;
}
export interface CacheItem {
  id: string;
  label: string;
  bytes: number;
  /** 一句说明：里面是什么、清掉会怎样 */
  detail?: string;
}
export interface CacheStatus { items: CacheItem[]; totalBytes: number }
export interface LauncherBehavior {
  /** 点关闭按钮时缩到系统托盘，而不是退出 */
  closeToTray: boolean;
  /** 登录 Windows 时启动 Matcha（启动后缩在托盘） */
  autostart: boolean;
}
export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  /** 发布页 */
  url?: string;
  notes?: string;
  publishedAt?: string;
  checkedAt: string;
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; missing: boolean; error: string };

const MISSING = new Set(['unsupported_capability', 'unknown_command', 'COMMAND_SCOPE']);
export const isMissingCommand = (e: unknown) => MISSING.has((e as { code?: string })?.code ?? '');

async function attempt<T>(command: string, params: Record<string, unknown> = {}, approved = false): Promise<Attempt<T>> {
  try { return { ok: true, value: await call<T>(command, params, approved) }; }
  catch (e) { return { ok: false, missing: isMissingCommand(e), error: errorText(e).replace(/\s*\[[\w-]+\]$/, '') }; }
}

export const launcherApi = {
  appInfo: () => attempt<AppInfo>('app-info'),
  cacheStatus: () => attempt<CacheStatus>('cache-status'),
  cacheClear: (ids: string[]) => attempt<{ cleared: string[]; freedBytes: number }>('cache-clear', { ids }, true),
  behavior: () => attempt<LauncherBehavior>('launcher-behavior-get'),
  setBehavior: (patch: Partial<LauncherBehavior>) => attempt<LauncherBehavior>('launcher-behavior-set', patch),
  checkUpdate: () => attempt<UpdateInfo>('update-check'),
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : +v.toFixed(1)} ${units[i]}`;
}
