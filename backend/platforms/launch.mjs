import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExternalPlatforms } from './manager.mjs';
import { PlatformLifecycle } from './lifecycle.mjs';
import { fail } from './files.mjs';
import { APP_DATA, DEV_DATA, currentDataDir } from '../legacy-names.mjs';

const localBase = () => process.env.LOCALAPPDATA ?? fileURLToPath(new URL('../../', import.meta.url));

export const platformDataDir = () => process.env.BEACON_DATA_DIR ?? currentDataDir(DEV_DATA, localBase());
export async function platformLocation(gameRoot, inspectGame, explicitDataDir) {
  const dirs = explicitDataDir ? [explicitDataDir] : process.env.BEACON_DATA_DIR ? [platformDataDir()]
    : [...new Set([platformDataDir(), currentDataDir(APP_DATA, localBase())])];
  const found = []; let fallback;
  for (const dataDir of dirs) {
    const readOnly = new ExternalPlatforms(), lifecycle = new PlatformLifecycle({ dataDir, readOnly, inspectGame });
    readOnly.managed = lifecycle;
    const state = await lifecycle.find(gameRoot, 'skeeto'), location = { readOnly, lifecycle, state };
    fallback ??= location; if (state) found.push(location);
  }
  if (found.length > 1) fail('platform_ledger_conflict', '桌面版与开发版各有此游戏的活动账本，请先核对管理来源。');
  return found[0] ?? fallback;
}
// Only loopback is established as local. LAN and public hosts use the remote policy.
export const remoteTarget = connect => !!connect && !/^(localhost|127(?:\.\d{1,3}){3}):\d+$/i.test(connect);

// Shared CLI / Pi / desktop entry: read-only check. Settings changes belong to a confirmed preview.
export async function assertPlatformLaunch({ gameRoot, connect, modeId = '', dataDir, inspectGame }) {
  const { lifecycle, state } = await platformLocation(gameRoot, inspectGame, dataDir);
  if (!state) return;
  if (state.pending) fail('platform_recovery_required', '请先恢复上次中断的平台操作。');
  const built = await lifecycle.build(gameRoot, 'skeeto', 'launch-policy', { remote: remoteTarget(connect), modeId });
  if (built.changes.length) fail('platform_launch_preview_required', 'Skeeto 启动规则需要调整，请在 Matcha 中预览并确认本次启动。');
}
