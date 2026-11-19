// B站信息流的过滤偏好：B站页的筛选条和设置页「B站过滤」共用，只存本机。
import { splitKeywords } from '../bilibili-filter';

const KEY = 'flare.bili.filter';

export interface BiliFilter {
  /** 只看 Mod：自动隐藏实况、录像、整活等 */
  mode: 'mod' | 'all';
  /** 只看简介里有下载链接的 */
  onlyRes: boolean;
  /** 必须包含：标题 / 简介 / 标签 / UP 主命中其中一个才显示；空 = 不限制 */
  include: string[];
  /** 屏蔽词：命中任何一个就隐藏，优先于「必须包含」 */
  exclude: string[];
}

function load(): BiliFilter {
  const base: BiliFilter = { mode: 'mod', onlyRes: false, include: [], exclude: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<BiliFilter> & { block?: string };
    const words = (v: unknown) => (Array.isArray(v) ? v.filter((w): w is string => typeof w === 'string' && !!w.trim()) : []);
    return {
      mode: raw.mode === 'all' ? 'all' : 'mod',
      onlyRes: !!raw.onlyRes,
      include: words(raw.include),
      // 旧版的「屏蔽词」是一整段文字，拆开并进 exclude（屏蔽词）
      exclude: [...new Set([...words(raw.exclude), ...splitKeywords(raw.block ?? '')])],
    };
  } catch { return base; }
}

export const biliFilter = $state<BiliFilter>(load());

$effect.root(() => {
  $effect(() => {
    const raw = JSON.stringify(biliFilter);
    try { localStorage.setItem(KEY, raw); } catch { /* 只在本次会话有效 */ }
  });
});
