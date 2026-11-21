// 从 B站视频简介 / 置顶评论里认出 Mod 资源链接：创意工坊、网盘（带提取码）、爱发电、GitHub。
import { parseWorkshopIds } from './workshop';

export type LinkKind = 'workshop' | 'baidu' | 'lanzou' | 'quark' | 'pan123' | 'aliyun' | 'xunlei' | 'afdian' | 'github' | 'other';
export interface FoundLink { kind: LinkKind; url: string; label: string; code?: string; workshopId?: string; raw?: string; editFirst?: boolean }

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

const WRAPPED = '(?:\\(删除?\\)|（删除?）|\\[删除?\\]|【删除?】)';
const MARK = `(?:${WRAPPED}|删除?)`;
const DELETION = new RegExp(MARK, 'g');
const SCHEME = ['h', 't', 't', 'p', 's?', ':', '/', '/'].join(`(?:${MARK})*`);
const TAIL = `(?:${WRAPPED}|[^\\s"'<>，。；、）)】」\\]])`;
// Match the whole bare host before checking the provider. A hostname inside an
// email, another URL, or a path is not a standalone resource.
const BARE = String.raw`(?<![\w@./\\?#=%-])(?<![a-z]:)((?:[a-z\d-]+\.)+[a-z\d-]+)(?::\d+)?(?=$|[/?#\s"'<>，。；、）)】」\]]|[.,;!](?=\s|$))`;
const URL_RE = new RegExp(`(${SCHEME})${TAIL}+|${BARE}(?:[/?#]${TAIL}*)?`, 'gi');
const CODE_RE = /(?:提取码|提取碼|访问码|密码|pwd|code)\s*[:：=]?\s*([A-Za-z0-9]{4,8})/i;
const INLINE_CODE = new RegExp(`(?:${MARK})*(?:提取码|提取碼|访问码|密码)[:：=]`);
const kindOf = (host: string) => HOSTS.find(([re]) => re.test(host))?.[1] ?? 'other';
const strip = (text: string) => text.replace(DELETION, '');
const trimPunctuation = (text: string) => text.replace(/[.,;:!?]+$/, '');

function readLink(raw: string, scheme: string): { u: URL; suffix?: string; editFirst?: boolean } {
  const [, authority = '', rest = ''] = /^([^/?#]+)(.*)$/.exec(raw.slice(scheme.length)) ?? [];
  const host = strip(authority);
  const kind = kindOf(host.replace(/:\d+$/, '').toLowerCase());
  if (!isDisk(kind) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i.test(host)) {
    const u = new URL(trimPunctuation(raw));
    // 只用域名的 ASCII 部分判断是否提示编辑，原文不改；正规的中文域名仍可直接打开。
    const asciiHost = authority.toLowerCase().replace(/[^\x00-\x7f]/g, '').replace(/:\d+$/, '');
    return { u, editFirst: !isDisk(kindOf(u.hostname)) && isDisk(kindOf(asciiHost)) && u.pathname.startsWith('/s/') };
  }

  // 只修已知网盘的协议、域名和 ASCII 分享码。文件名、其它参数、百分号编码照旧。
  let target = rest, suffix: string | undefined;
  const share = /^(\/[^/?#]+\/)([^/?#]+)(.*)$/.exec(rest)
    ?? (kind === 'lanzou' ? /^(\/)([^/?#]+)(.*)$/.exec(rest) : null);
  let asciiShare = false;
  let editFirst = false;
  if (share && (strip(share[1]) === '/s/' || share[1] === '/')) {
    const [, route, segment, remainder] = share;
    const inline = remainder ? -1 : segment.search(INLINE_CODE);
    const id = strip(inline < 0 ? segment : segment.slice(0, inline));
    if (/^[a-z0-9_-]+$/i.test(id)) {
      asciiShare = true;
      target = strip(route) + id + remainder;
      if (inline >= 0) suffix = segment.slice(inline);
    } else if (/[^\x00-\x7f]/.test(segment)) editFirst = true;
  }
  const [, path, query = '', fragment = ''] = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(target)!;
  const cleanedQuery = query.replace(/([?&])([^?&=]+)=([^&]*)/g, (part, sep, key, value) => {
    const name = strip(key), code = strip(value);
    return asciiShare && kind === 'baidu' && name === 'pwd' && /^[a-z0-9]{4}$/i.test(code) ? `${sep}pwd=${code}` : part;
  });
  return { u: new URL(trimPunctuation(strip(scheme) + host + path + cleanedQuery + fragment)), suffix, editFirst };
}

function* urlsIn(text: string) {
  for (const m of text.matchAll(URL_RE)) {
    const bare = !m[1];
    if (bare && kindOf(m[2].toLowerCase()) === 'other' && !/(^|\.)steamcommunity\.com$/i.test(m[2])) continue;
    try {
      const { u, suffix = '', editFirst } = readLink(bare ? 'https://' + m[0] : m[0], m[1] || 'https://');
      const raw = m[0].slice(0, m[0].length - suffix.length);
      yield { u, raw, start: m.index!, end: m.index! + raw.length, editFirst };
    } catch {
      yield { u: undefined, raw: m[0], start: m.index!, end: m.index! + m[0].length, editFirst: true };
    }
  }
}

/** Keep the author's wording, with the same click target as the resource card. */
export function linkSegments(text: string) {
  const parts: { url?: string; text: string; editFirst?: boolean }[] = [];
  let index = 0;
  for (const { u, raw, start, end, editFirst } of urlsIn(text)) {
    if (start > index) parts.push({ text: text.slice(index, start) });
    parts.push({ text: raw, url: u?.href, editFirst });
    index = end;
  }
  if (index < text.length) parts.push({ text: text.slice(index) });
  return parts;
}

export function extractLinks(text: string): FoundLink[] {
  if (!text) return [];
  const out = new Map<string, FoundLink>();
  const lines = text.split(/\n/);
  const byLine = lines.map(line => [...urlsIn(line)]);
  lines.forEach((line, i) => {
    const urls = byLine[i];
    for (const [j, { u, raw, start, end, editFirst }] of urls.entries()) {
      if (!u) continue;
      const host = u.hostname.toLowerCase();
      if (IGNORE.test(host)) continue;
      // 创意工坊
      if (/(^|\.)steamcommunity\.com$/.test(host)) {
        const id = parseWorkshopIds(u.href)[0];
        if (id) { out.set(`ws:${id}`, { kind: 'workshop', url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`, label: KIND_LABEL.workshop, workshopId: id }); continue; }
      }
      const kind = kindOf(host);
      // 提取码：链接里的 pwd=，否则同一行或下一行的「提取码：xxxx」
      let code = u.searchParams.get('pwd') ?? undefined;
      if (!code && isDisk(kind)) {
        const after = line.slice(end, urls[j + 1]?.start);
        code = after.match(CODE_RE)?.[1] ?? (j === 0 ? line.slice(0, start).match(CODE_RE)?.[1] : undefined)
          ?? (j === urls.length - 1 && !byLine[i + 1]?.length ? lines[i + 1]?.match(CODE_RE)?.[1] : undefined);
      }
      if (!out.has(u.href)) out.set(u.href, { kind, url: u.href, label: KIND_LABEL[kind], code, raw, editFirst });
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
