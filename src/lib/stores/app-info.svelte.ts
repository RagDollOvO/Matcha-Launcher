// 关于、数据与重置两节共用：版本号和各个目录。后端 app-info 没接上时，版本号退回桌面壳 / 构建时的版本。
import { desktop } from '../api/bridge';
import { launcherApi, type AppInfo } from '../api/launcher';

export const appInfo = $state<{ info: AppInfo | null; version: string; missing: boolean; loaded: boolean }>({
  info: null, version: __APP_VERSION__, missing: false, loaded: false,
});

let pending: Promise<void> | null = null;
export function loadAppInfo(): Promise<void> {
  if (appInfo.loaded) return Promise.resolve();
  pending ??= (async () => {
    const r = await launcherApi.appInfo();
    if (r.ok) { appInfo.info = r.value; appInfo.version = r.value.version || appInfo.version; }
    else {
      appInfo.missing = r.missing;
      if (desktop) {
        try { const { getVersion } = await import('@tauri-apps/api/app'); appInfo.version = await getVersion(); } catch { /* 用构建时的版本 */ }
      }
    }
    appInfo.loaded = true;
  })().finally(() => { pending = null; });
  return pending;
}
