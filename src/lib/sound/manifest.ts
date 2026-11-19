// 采样清单：文件放在 public/sfx/ 下，缺失的条目自动回退到合成音。
// 来源与授权见 public/sfx/SOURCES.md。

import type { SfxName } from './sfx.svelte';

export interface SampleDef { files: string[]; gain?: number; rate?: [number, number] }

/** 界面音效 */
export const UI_SAMPLES: Partial<Record<SfxName, SampleDef>> = {
  hover: { files: ['ui/hover.ogg'], gain: 0.25, rate: [0.96, 1.04] },
  click: { files: ['ui/click.ogg'], gain: 0.6, rate: [0.97, 1.03] },
  tab: { files: ['ui/tab.ogg'], gain: 0.5 },
  toggleOn: { files: ['ui/toggle-on.ogg'], gain: 0.6 },
  toggleOff: { files: ['ui/toggle-off.ogg'], gain: 0.6 },
  // open / close 不用采样：原来的采样带沙沙的噪声，偏刺耳，改用 sfx.svelte.ts 里柔和的合成音
  send: { files: ['ui/send.ogg'], gain: 0.5 },
  reply: { files: ['ui/reply.ogg'], gain: 0.45 },
  approve: { files: ['ui/approve.ogg'], gain: 0.6 },
  deny: { files: ['ui/deny.ogg'], gain: 0.6 },
  error: { files: ['ui/error.ogg'], gain: 0.5 },
  menuOn: { files: ['sound-menu/on.wav'], gain: 1 },
  menuOff: { files: ['sound-menu/off.wav'], gain: 0.92, rate: [0.86, 0.86] },
  // 下载音没有采样时用合成音（sfx.svelte.ts）
  download: { files: ['ui/download.ogg'], gain: 0.5 },
  done: { files: ['ui/done.ogg'], gain: 0.6 },
};
