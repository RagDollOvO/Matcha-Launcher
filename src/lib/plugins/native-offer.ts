// 没装 L4N / DXVK 时的「要不要下载」：好处、代价都说清楚，让玩家自己选。
// L4N 的功能清单以后端按作者说明整理的 features 为准；没有时只说确定的事，不替作者吹。
import type { NativeLibraryState } from '../types';

export interface NativeOffer {
  title: string;
  /** 一句话：它是什么 */
  pitch: string;
  /** 装上的好处 */
  gains: string[];
  /** 代价和要留意的地方 */
  costs: string[];
}

const L4N_GENERIC: string[] = [
  '能用 L4N 子插件：放进 bin\\neko\\plugins 的第三方插件，在 Matcha 里单独开关',
  '平台自带的功能在游戏里 L4N 自己的菜单里设置',
];

export function nativeOffer(lib: NativeLibraryState): NativeOffer {
  return {
    title: 'L4N 整包',
    pitch: '社区做的求生之路 2 插件平台（作者 Starfelll / nekonacho），作为一个整体接入 Matcha。',
    gains: lib.features?.length ? lib.features : L4N_GENERIC,
    costs: [
      'L4N 作者提醒：它会给游戏打内存补丁，联机时要自己留意风险',
      '用「L4N 平台启动」进游戏才会加载；想要原版体验就用「纯净对抗」',
    ],
  };
}

/** 本机缺这个组件，要先下载 */
export const needsDownload = (lib: NativeLibraryState | undefined) => lib?.id === 'l4n' && lib.availability === 'missing' && !lib.installed;
/** 装着的版本比能拿到的旧：按需下载的看 download，随包的看 availableVersion */
export function libraryUpdate(lib: NativeLibraryState | undefined): string | null {
  if (lib?.id !== 'l4n' || !lib.installed || !lib.version || lib.unmanaged) return null;
  const to = lib.download?.version ?? (lib.availability !== 'missing' ? lib.availableVersion : null);
  return to && to.localeCompare(lib.version, 'en', { numeric: true }) > 0 ? to : null;
}

export const sizeLabel = (n: number | null | undefined) =>
  !n ? '' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// 「先不用」：记在本机，这台电脑上不再主动问。启动时的提醒也只提一次。
const DISMISS = 'flare.native.offer.dismissed', NOTIFIED = 'flare.native.offer.notified';
const has = (key: string, id: string) => { try { return (JSON.parse(localStorage.getItem(key) || '[]') as string[]).includes(id); } catch { return false; } };
const add = (key: string, id: string) => {
  try { const list = new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]); list.add(id); localStorage.setItem(key, JSON.stringify([...list])); }
  catch { /* 只在本次有效 */ }
};
export const offerDismissed = (id: string) => has(DISMISS, id);
export const dismissOffer = (id: string) => add(DISMISS, id);
export const offerNotified = (id: string) => has(NOTIFIED, id);
export const markOfferNotified = (id: string) => add(NOTIFIED, id);
