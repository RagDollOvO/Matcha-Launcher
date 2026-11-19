import type { LaunchMode } from './types';

/**
 * 桌面只提供两种发射方式。启动参数由后端定义，这里只管名字。
 * 旧配置里保存的 direct / development 显示为「L4N 平台启动」，迁移交给后端。
 */
export const LAUNCH_MODES = [
  { id: 'modded', label: 'L4N 平台启动', detail: 'L4N 平台启动' },
  { id: 'clean', label: '纯净对抗', detail: '纯净对抗 · Steam 原版' },
] as const satisfies readonly { id: LaunchMode; label: string; detail: string }[];

export const shownMode = (mode: LaunchMode): 'modded' | 'clean' => (mode === 'clean' ? 'clean' : 'modded');
export const modeLabel = (mode: LaunchMode) => LAUNCH_MODES.find(m => m.id === shownMode(mode))!.label;
