// B站搜索结果「是不是 Mod 发布视频」的打分。规则按 2026-11-17 实际搜「求生之路2 mod」最新 60 条整理：
// 噪音主要是几十分钟的实况 / 群车录像 / 服务器流程、沙雕整活、手游转卖；
// Mod 视频通常很短，标题带「替换 / 模组 / 贴皮 / MOD / 展示」或武器名，简介里有工坊 / 网盘链接或「原模、授权」致谢。
import type { BiliVideo } from './api/bilibili';
import { extractLinks, isDisk, type FoundLink } from './bilibili-links';

export type Verdict = 'mod' | 'maybe' | 'noise';
export type ModKind = '武器' | '人物' | '地图' | '界面' | '音效' | '脚本' | '工具';
export interface Scored {
  v: BiliVideo; links: FoundLink[]; score: number; verdict: Verdict; kind?: ModKind; reasons: string[]; minutes: number;
  /** 被关键词规则隐藏的原因；和「只看 Mod」无关，切到「全部」也隐藏 */
  ruled?: string;
}

const L4D2 = /求生之路|l4d2?\b|left\s*4\s*dead|\bcfm?\b/i;
const TITLE_MOD = /mod|模组|模型|替换|replace|贴皮|皮肤|涂装|换肤|主题|hud|主界面|音效包|材质|贴图|插件|vscript|人物包|角色包|武器包|移植|定制|公开|分享|发布|展示|演示|试做|预览|测试/i;
const TAG_MOD = /^(mod|模组|贴皮|演示|mod推荐|模组推荐|模组分享|求生之路mod|二次元mod|vscript)$/i;
const DESC_MOD = /工坊|原模|原mod|模型来自|授权|替换|mod名称|下载|链接|提取码|网盘|订阅|贴皮|插件|mod/i;
const WEAPON = /m1\s*garand|ak-?47|\bak\b|m4a1|m16|scar|awp|sg\s*552|mp5|uzi|mac-?10|沙鹰|散弹|霰弹|连喷|军狙|猎枪|狙|步枪|冲锋枪|手枪|马格南|砍刀|武士刀|电锯|榴弹|平底锅|撬棍|球棒|吉他|消防斧|m60|格洛克|scout|qbz|sa-?58|30连|15连/i;
const GAMEPLAY = /实况|通关|单通|速通|专家|绝境|多特|\d+\s*特|写专|开荒|群车|车队|录像|录屏|直播|服务器|小破服|包子服|mo服|xtt|part\s*\d|第.{1,3}[期集章关]|合作|多人|双人|四人|跟兄弟|好友|萌新|娱乐|日常|沙雕|整活|搞笑|鬼畜|解说|剧情|攻略|流程|体验|挑战|\bvs\b|对抗|尸潮|无伤|黑枪|\d{4}-\d{2}-\d{2}/i;
const TAG_PLAY = /^(游戏实况|第一视角|录屏|直播录像|沙雕|服务器|整活|游戏解说|娱乐)$/;
const NOT_MOD = /手游|安卓|ios|破解|免安装|官方中文|完整版|下载安装/i;
const TOOL = /程序|管理器|工具|教程|安装方法|怎么装|下载慢/;
const MAPWORD = /三方图|新图|地图|\bmap\b|战役/i;

const KINDS: [ModKind, RegExp][] = [
  ['工具', /程序|管理器|工具/],
  ['地图', /三方图|新图|地图|\bmap\b|战役|救援关/i],
  ['界面', /hud|主界面|界面|菜单|背景|ui\b|准星/i],
  ['音效', /音效|声音|配音|语音|bgm|音乐/i],
  ['脚本', /vscript|脚本|插件|技能|sourcemod|sm\b/i],
  ['人物', /人物|角色|生还者|幸存者|特感|witch|tank|坦克|女巫|小姐姐|皮套|替换(比尔|佐伊|弗朗西斯|路易斯|尼克|罗雪儿|教练|埃利斯)/i],
  ['武器', WEAPON],
  ['武器', /武器|枪械|枪|刀/],
];

export const minutesOf = (d: string) => {
  const p = d.split(':').map(Number);
  if (p.some(Number.isNaN)) return 0;
  return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p.length === 2 ? p[0] + p[1] / 60 : p[0] / 60;
};

/** 用户写的关键词：普通词不分大小写按包含算；/…/ 包起来按正则（写错的正则忽略） */
export interface Keyword { word: string; re: RegExp }
export const splitKeywords = (src: string) => src.split(/[,，、\n]+/).map((s) => s.trim()).filter(Boolean);
export const badRegex = (word: string) => {
  const m = word.match(/^\/(.+)\/([a-z]*)$/i);
  if (!m) return false;
  try { new RegExp(m[1]); return false; } catch { return true; }
};
export function compileKeywords(words: string[]): Keyword[] {
  const out: Keyword[] = [];
  for (const word of words) {
    const m = word.match(/^\/(.+)\/([a-z]*)$/i);
    try { out.push({ word, re: new RegExp(m ? m[1] : word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }); } catch { /* 正则写错了 */ }
  }
  return out;
}
/** 「必须包含」(include)：有词时必须命中一个；「屏蔽词」(exclude)：命中任何一个就隐藏，优先 */
export interface KeywordRules { include: Keyword[]; exclude: Keyword[] }

export function score(v: BiliVideo, rules: KeywordRules): Scored {
  const title = v.title, desc = v.description ?? '', tags = v.tags ?? [];
  const links = extractLinks(desc);
  const minutes = minutesOf(v.duration);
  const reasons: string[] = [];
  let s = 0;
  const res = links.filter((l) => l.kind === 'workshop' || isDisk(l.kind) || l.kind === 'afdian');
  if (res.length) { s += 4; reasons.push('有下载链接'); }
  if (res.some((l) => l.kind === 'workshop') && MAPWORD.test(title)) s += 3;
  if (TITLE_MOD.test(title)) { s += 3; reasons.push('标题像 Mod'); }
  if (WEAPON.test(title)) s += 2;
  if (tags.some((t) => TAG_MOD.test(t.trim()))) s += 2;
  if (DESC_MOD.test(desc)) s += 1;
  if (minutes > 30) { s -= 4; reasons.push(`${Math.round(minutes)} 分钟长视频`); }
  else if (minutes > 15) { s -= 2; reasons.push(`${Math.round(minutes)} 分钟`); }
  else if (minutes > 0 && minutes <= 5) s += 1;
  if (GAMEPLAY.test(title)) { s -= 3; reasons.push('像实况 / 流程'); }
  s -= Math.min(2, tags.filter((t) => TAG_PLAY.test(t.trim())).length);
  if (NOT_MOD.test(title)) { s -= 8; reasons.push('像游戏本体分享'); }
  if (TOOL.test(title)) s -= 2;
  if (!L4D2.test(`${title} ${tags.join(' ')} ${desc}`)) { s -= 3; reasons.push('没提到求生之路'); }
  const verdict: Verdict = s >= 3 ? 'mod' : s >= 0 ? 'maybe' : 'noise';
  const text = `${title} ${tags.join(' ')}`;
  const kind = KINDS.find(([, re]) => re.test(text))?.[0];
  // 关键词看标题、简介、标签和 UP 主
  const all = `${title}\n${desc}\n${tags.join(' ')}\n${v.author}`;
  const out = rules.exclude.find((k) => k.re.test(all));
  const ruled = out ? `命中屏蔽词「${out.word}」` : rules.include.length && !rules.include.some((k) => k.re.test(all)) ? '不含「必须包含」里的词' : undefined;
  return { v, links, score: s, verdict, kind, reasons, minutes, ruled };
}

/** 按发布时间分组：今天 / 昨天 / 本周 / 更早 */
export function dayGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return '今天';
  if (t >= start - 86400000) return '昨天';
  if (t >= start - 6 * 86400000) return '本周';
  return '更早';
}
