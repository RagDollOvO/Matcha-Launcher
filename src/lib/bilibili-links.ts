// 从 B站视频简介 / 置顶评论里认出 Mod 资源链接：创意工坊、网盘（带提取码）、爱发电、GitHub。
import { parseWorkshopIds } from './workshop';

export type LinkKind = 'workshop' | 'baidu' | 'lanzou' | 'quark' | 'pan123' | 'aliyun' | 'xunlei' | 'afdian' | 'github' | 'other';
export interface FoundLink { kind: LinkKind; url: string; label: string; code?: string; workshopId?: string }

export const KIND_LABEL: Record<LinkKind, string> = {
  workshop: '创意工坊', baidu: '百度网盘', lanzou: '蓝奏云', quark: '夸克网盘', pan123: '123 云盘',
  aliyun: '阿里云盘', xunlei: '迅雷云盘', afdian: '爱发电', github: 'GitHub', other: '链接',
};
export const isDisk = (k: LinkKind) => ['baidu', 'lanzou', 'quark', 'pan123', 'aliyun', 'xunlei'].includes(k);

const HOSTS: [RegExp, LinkKind][] = [
  [/(^|\.)pan\.baidu\.com$/, 'baidu'],
  [/(^|\.)(i?lanzou[a-z]?|lanzn|lanzv)\.com$/, 'lanzou'],
  [/(^|\.)pan\.quark\.cn$/, 'quark'],
  [/(^|\.)(123pan|123684|123865|123912)\.(com|cn)$/, 'pan123'],
  [/(^|\.)(aliyundrive|alipan)\.com$/, 'aliyun'],
  [/(^|\.)pan\.xunlei\.com$/, 'xunlei'],
  [/(^|\.)(afdian\.(com|net)|ifdian\.net)$/, 'afdian'],
  [/(^|\.)github\.com$/, 'github'],
];
/** 其他 B站视频、动态、搜索之类不算资源 */
const IGNORE = /(^|\.)(bilibili\.com|b23\.tv|hdslb\.com|bilivideo\.com)$/;

const URL_RE = /https?:\/\/[^\s"'<>，。；、）)】」\]]+/gi;
const CODE_RE = /(?:提取码|提取碼|访问码|密码|pwd|code)\s*[:：=]?\s*([A-Za-z0-9]{4,8})/i;

export function extractLinks(text: string): FoundLink[] {
  if (!text) return [];
  const out = new Map<string, FoundLink>();
  const lines = text.split(/\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(URL_RE)) {
      const raw = m[0].replace(/[.,;:!?]+$/, '');
      let u: URL;
      try { u = new URL(raw); } catch { continue; }
      const host = u.hostname.toLowerCase();
      if (IGNORE.test(host)) continue;
      // 创意工坊
      if (/steamcommunity\.com$/.test(host)) {
        const id = parseWorkshopIds(raw)[0];
        if (id) { out.set(`ws:${id}`, { kind: 'workshop', url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`, label: KIND_LABEL.workshop, workshopId: id }); continue; }
      }
      const kind = HOSTS.find(([re]) => re.test(host))?.[1] ?? 'other';
      // 提取码：链接里的 pwd=，否则同一行或下一行的「提取码：xxxx」
      let code = u.searchParams.get('pwd') ?? undefined;
      if (!code && isDisk(kind)) {
        const after = line.slice((m.index ?? 0) + m[0].length);
        code = after.match(CODE_RE)?.[1] ?? line.slice(0, m.index).match(CODE_RE)?.[1] ?? lines[i + 1]?.match(CODE_RE)?.[1];
      }
      if (!out.has(u.href)) out.set(u.href, { kind, url: u.href, label: KIND_LABEL[kind], code });
    }
  });
  // 只写了「工坊 ID：123456」没有链接的
  for (const m of text.matchAll(/(?:工坊|workshop)\s*(?:id|ID|编号)?\s*[:：]?\s*(\d{6,12})/gi)) {
    const id = m[1];
    if (!out.has(`ws:${id}`)) out.set(`ws:${id}`, { kind: 'workshop', url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`, label: KIND_LABEL.workshop, workshopId: id });
  }
  const order: LinkKind[] = ['workshop', 'baidu', 'lanzou', 'quark', 'pan123', 'aliyun', 'xunlei', 'afdian', 'github', 'other'];
  return [...out.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** 卡片角标用：资源种类的简短概括 */
export function linkBadges(links: FoundLink[]): string[] {
  const kinds = new Set(links.map((l) => (isDisk(l.kind) ? 'disk' : l.kind)));
  const out: string[] = [];
  if (kinds.has('workshop')) out.push('工坊');
  if (kinds.has('disk')) out.push('网盘');
  if (kinds.has('afdian')) out.push('爱发电');
  if (kinds.has('github')) out.push('GitHub');
  return out;
}

/** 输入框里粘贴的是不是 B站视频（BV / av / 链接 / 短链） */
export const looksLikeBili = (text: string) => /(BV[0-9A-Za-z]{10}|\bav\d{4,}|bilibili\.com\/video\/|b23\.tv\/)/i.test(text.trim());
