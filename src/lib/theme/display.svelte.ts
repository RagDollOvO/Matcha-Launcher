// 界面缩放与减弱动效。两个窗口（主窗口、助手窗口）都在启动时调用 initDisplay()；
// 一个窗口改了偏好，另一个通过 localStorage 的 storage 事件跟着变。
import { desktop } from '../api/bridge';
import { PREFS_KEY, prefs } from '../stores/prefs.svelte';

export const ZOOMS = [0.9, 1, 1.1, 1.25] as const;

/** null：还没试过；false：桌面壳没放行缩放权限，或在浏览器预览里 */
export const display = $state<{ zoomSupported: boolean | null }>({ zoomSupported: desktop ? null : false });

function motion(reduce: boolean) {
  document.documentElement.toggleAttribute('data-reduce-motion', reduce);
}

async function zoom(level: number): Promise<boolean> {
  if (!desktop) return false;
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().setZoom(level);
    display.zoomSupported = true;
    return true;
  } catch {
    display.zoomSupported = false;
    return false;
  }
}

/** 设置页打开时探一下桌面壳是否放行了缩放 */
export function probeZoom() {
  if (display.zoomSupported === null) void zoom(prefs.zoom);
}

export async function setZoom(level: number) {
  const before = prefs.zoom;
  prefs.zoom = level;
  if (!await zoom(level)) prefs.zoom = before;
}

export function setReduceMotion(on: boolean) {
  prefs.reduceMotion = on;
  motion(on);
}

export function initDisplay() {
  motion(prefs.reduceMotion);
  if (prefs.zoom !== 1) void zoom(prefs.zoom);
  window.addEventListener('storage', (e) => {
    if (e.key !== PREFS_KEY || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue) as Partial<typeof prefs>;
      if (typeof next.reduceMotion === 'boolean') motion(next.reduceMotion);
      if (typeof next.zoom === 'number' && display.zoomSupported !== false) void zoom(next.zoom);
    } catch { /* 别的窗口写坏了就不跟 */ }
  });
}
