// 内置浏览器的「来源链」：每个标签页按顺序记下看过的页面，新标签页记下是从哪个页面打开的。
// 网页下载开始时，从下载所在的标签页往回找最近的作者页（B站视频、爱发电作品 / 主页、创意工坊、GameMaps），
// 点赞提醒和导入后 Mod 的「来源」都指向它。
// B站简介里的网盘链接大多点不动，要复制到地址栏打开，链就断了。所以打开 B站视频时顺手读简介和置顶评论，
// 把里面的链接登记下来：之后打开的页面对得上，就算这个视频的。
import { biliApi, type BiliDetail } from '../api/bilibili';
import { extractLinks } from '../bilibili-links';
import type { ModCreator } from '../types';

/** 作者页：点赞提醒和 Mod 来源指向这里 */
export interface CreatorPage extends ModCreator {
  /** steam:<工坊 id> / bili:<BV 号> / gm:<GameMaps id> / afdian:p/<作品 id> / afdian:a/<作者>；同一个只提醒一次 */
  key: string;
}
export const CREATOR_LABEL: Record<ModCreator['source'], string> = { steam: '创意工坊', bilibili: 'B站', gamemaps: 'GameMaps', afdian: '爱发电' };

interface Visit { url: string; title?: string; at: number }
interface Trail { visits: Visit[]; inherited: Visit[] }
interface Registered { link: string; video: CreatorPage; at: number }

/** 3 小时前看的页面不再算 */
const TTL = 3 * 3600_000;
const MAX_VISITS = 30, MAX_TABS = 40, MAX_LINKS = 120, MAX_CAPTURED = 300;
const LINKS = 'flare.trail.links', CAPTURED = 'flare.trail.downloads';

const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 只在本次会话有效 */ } };

// ---------- 认作者页 ----------
const host = (u: URL) => u.hostname.toLowerCase().replace(/^(www|m)\./, '');
const AFDIAN = /^(afdian\.(com|net)|ifdian\.net)$/;
/** 网页标题去掉站名尾巴 */
const strip = (title: string | undefined, tail: RegExp) => title?.replace(tail, '').trim() || '';
const videos = new Map<string, { title: string; author?: string }>();

/** 这个网址是不是作者页；不是就 null */
export function creatorOf(raw: string, title?: string): CreatorPage | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const h = host(u);
  if (h === 'bilibili.com') {
    const bv = u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})/)?.[1];
    if (!bv) return null;
    const v = videos.get(bv);
    return { key: `bili:${bv}`, source: 'bilibili', url: `https://www.bilibili.com/video/${bv}`, title: v?.title || strip(title, /_哔哩哔哩_bilibili$|[-_|]\s*bilibili.*$/i) || bv, author: v?.author };
  }
  if (AFDIAN.test(h)) {
    const [, kind, id] = u.pathname.match(/^\/(p|a)\/([^/?#]+)/) ?? [];
    if (!kind) return null;
    const name = strip(title, /\s*[|_\-–—]\s*爱发电.*$/);
    return kind === 'p'
      ? { key: `afdian:p/${id}`, source: 'afdian', url: `https://${u.hostname}/p/${id}`, title: name || '爱发电作品' }
      : { key: `afdian:a/${id}`, source: 'afdian', url: `https://${u.hostname}/a/${id}`, title: name || `${id} 的爱发电` };
  }
  if (h === 'steamcommunity.com' && /^\/(sharedfiles|workshop)\/filedetails\/?$/.test(u.pathname)) {
    const id = u.searchParams.get('id');
    if (!id || !/^\d{6,20}$/.test(id)) return null;
    return { key: `steam:${id}`, source: 'steam', url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`, title: strip(title, /^.*?::/) || `创意工坊 ${id}` };
  }
  if (h === 'gamemaps.com') {
    const id = u.pathname.match(/^\/details\/(\d+)/)?.[1];
    if (!id) return null;
    return { key: `gm:${id}`, source: 'gamemaps', url: `https://www.gamemaps.com/details/${id}`, title: strip(title, /\s*[-|–]\s*GameMaps.*$/i) || `GameMaps ${id}` };
  }
  return null;
}

// ---------- B站简介里的链接 ----------
/** 只比站点和路径：提取码、页内锚点不同也算同一个分享 */
function linkKey(raw: string) {
  try { const u = new URL(raw); return host(u) + u.pathname.replace(/\/+$/, ''); } catch { return ''; }
}
let links = read<Registered[]>(LINKS, []).filter((r) => Date.now() - r.at <= TTL);
const fetched = new Map<string, number>();

function registeredFor(raw: string): CreatorPage | null {
  const k = linkKey(raw);
  if (!k) return null;
  const now = Date.now();
  for (let i = links.length - 1; i >= 0; i--) {
    const r = links[i];
    if (now - r.at <= TTL && (k === r.link || k.startsWith(r.link + '/'))) return r.video;
  }
  return null;
}

/** 登记一个 B站视频简介和置顶评论里的资源链接 */
export function registerVideo(d: Pick<BiliDetail, 'bvid' | 'title' | 'author' | 'description'> & { pinnedComment?: string }) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(d.bvid)) return;
  videos.set(d.bvid, { title: d.title, author: d.author || undefined });
  const video: CreatorPage = { key: `bili:${d.bvid}`, source: 'bilibili', url: `https://www.bilibili.com/video/${d.bvid}`, title: d.title, author: d.author || undefined };
  const now = Date.now();
  const found = extractLinks(`${d.description ?? ''}\n${d.pinnedComment ?? ''}`).filter(l => !l.editFirst).map(l => linkKey(l.url)).filter(Boolean);
  if (!found.length) return;
  links = [...links.filter((r) => now - r.at <= TTL && !found.includes(r.link)), ...found.map((link) => ({ link, video, at: now }))].slice(-MAX_LINKS);
  write(LINKS, links);
}

/** 内置浏览器里打开了 B站视频：去读一次简介（一小时内同一个视频只读一次） */
function noteBili(url: string) {
  const c = creatorOf(url);
  if (c?.source !== 'bilibili') return;
  const bv = c.key.slice(5), now = Date.now();
  if (now - (fetched.get(bv) ?? 0) < 3600_000) return;
  fetched.set(bv, now);
  biliApi.detail(bv).then(registerVideo).catch(() => { /* 读不到简介就只靠来源链 */ });
}

// ---------- 标签页 ----------
const trails = new Map<string, Trail>();
function trailOf(tab: string) {
  let t = trails.get(tab);
  if (!t) {
    trails.set(tab, t = { visits: [], inherited: [] });
    if (trails.size > MAX_TABS) trails.delete(trails.keys().next().value!);
  }
  return t;
}

let captured = read<Record<string, CreatorPage[]>>(CAPTURED, {});

export const trail = {
  /** 标签页打开或跳到了一个页面 */
  visit(tab: string, url: string) {
    const t = trailOf(tab);
    if (t.visits.at(-1)?.url === url) return;
    t.visits = [...t.visits, { url, at: Date.now() }].slice(-MAX_VISITS);
    noteBili(url);
  },
  /** 页面标题出来了（作者页的名字从这里来） */
  title(tab: string, url: string, title: string) {
    const v = trails.get(tab)?.visits.findLast((x) => x.url === url);
    if (v) v.title = title;
  },
  /** 这个标签页是从另一个标签页，或「发现」里的某个作者页打开的 */
  opened(tab: string, from: string | CreatorPage) {
    const now = Date.now();
    let inherited: Visit[];
    if (typeof from === 'string') {
      const parent = trails.get(from);
      if (!parent || from === tab) return;
      inherited = [...parent.inherited, ...parent.visits];
    } else inherited = [{ url: from.url, title: from.title, at: now }];
    trailOf(tab).inherited = inherited.filter((v) => now - v.at <= TTL).slice(-MAX_VISITS);
  },
  /** 在地址栏输入了新地址、回了首页：之前看过的页面不再算这个标签页的来源 */
  restart(tab: string) { trails.set(tab, { visits: [], inherited: [] }); },

  /** 网页下载开始：记下它的作者页，最多两个、每个网站一个，离下载最近的在前 */
  capture(d: { id: string; view?: string; url: string; pageUrl: string; pageTitle?: string | null }) {
    if (captured[d.id]) return;
    const now = Date.now();
    const t = d.view?.startsWith('browser-') ? trails.get(d.view.slice('browser-'.length)) : undefined;
    const chain = [...(t?.inherited ?? []), ...(t?.visits ?? [])].filter((v) => now - v.at <= TTL);
    if (d.pageUrl && chain.at(-1)?.url !== d.pageUrl) chain.push({ url: d.pageUrl, title: d.pageTitle ?? undefined, at: now });
    const found: CreatorPage[] = [];
    const add = (c: CreatorPage | null) => { if (c && found.length < 2 && !found.some((f) => f.source === c.source)) found.push(c); };
    for (const v of chain.reverse()) {
      add(creatorOf(v.url, v.title));
      add(registeredFor(v.url));
    }
    if (!found.length) add(registeredFor(d.url));
    if (!found.length) return;
    captured[d.id] = found;
    const ids = Object.keys(captured);
    if (ids.length > MAX_CAPTURED) for (const id of ids.slice(0, ids.length - MAX_CAPTURED)) delete captured[id];
    write(CAPTURED, captured);
  },
  /** 这个网页下载来自哪个作者页 */
  creatorsOf(d: { id: string; creators?: ModCreator[] }): CreatorPage[] {
    const saved = (d.creators ?? []).flatMap(c => {
      const page = creatorOf(c.url, c.title);
      return page && page.source === c.source ? [{ ...page, title: c.title || page.title, author: c.author ?? page.author }] : [];
    });
    return saved.length ? saved : captured[d.id] ?? [];
  },
};

/** 给后端的 Mod 来源：不带内部用的 key */
export const toModCreators = (list: CreatorPage[]): ModCreator[] => list.map(({ key: _, ...c }) => c);
