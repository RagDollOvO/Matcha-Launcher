// 存储位置与空间：下载与缓存放哪个盘、各部分占多少、清理。契约见 docs/storage-handoff.md。
// 旧版本地服务没有这些命令时返回 unsupported_capability，界面显示「即将支持」。
import { call, errorText } from './bridge';
import { isMissingCommand, type Attempt } from './launcher';

export interface Volume { root: string; label?: string; system: boolean; freeBytes: number; totalBytes: number }
export type UsageId = 'library' | 'deployed' | 'trash' | 'downloads' | 'browser-cache' | 'components' | 'app-data';
export interface StorageUsage {
  id: UsageId;
  bytes: number;
  /** 在游戏盘 / 下载位置 / C 盘配置目录 */
  where: 'game' | 'storage' | 'appdata';
  path?: string;
  /** 只有 deployed：硬链接不额外占空间 */
  mode?: 'link' | 'copy';
  reclaimableBytes?: number;
}
export interface StorageStatus {
  profileError?: string;
  location: { path: string; displayPath?: string; custom: boolean; volume: Volume; pendingBytes?: number; pendingPath?: string };
  suggestions: { path: string; label: string; volume: Volume }[];
  gameVolume?: Volume;
  usage: StorageUsage[];
  deleteArchivesAfterImport: boolean;
  move?: { from: string; to: string; doneBytes: number; totalBytes: number; state: 'moving' | 'failed'; error?: string };
  scannedAt: string;
}
export type CleanKind = 'imported-downloads' | 'browser-cache' | 'relink-deployed';
export interface CleanPreview { items: { kind: CleanKind; label: string; bytes: number; files: number }[]; totalBytes: number }

async function attempt<T>(command: string, params: Record<string, unknown> = {}, approved = false): Promise<Attempt<T>> {
  try { return { ok: true, value: await call<T>(command, params, approved) }; }
  catch (e) { return { ok: false, missing: isMissingCommand(e), error: errorText(e).replace(/\s*\[[\w-]+\]$/, '') }; }
}

export const storageApi = {
  get: () => attempt<StorageStatus>('storage-get'),
  set: (patch: { deleteArchivesAfterImport?: boolean }) => attempt<StorageStatus>('storage-set', patch),
  move: (path: string) => attempt<{ status: string }>('storage-move', { path }, true),
  cleanPreview: (kinds: CleanKind[]) => attempt<CleanPreview>('storage-clean-preview', { kinds }),
  clean: (kinds: CleanKind[]) => attempt<{ freedBytes: number }>('storage-clean', { kinds }, true),
};
