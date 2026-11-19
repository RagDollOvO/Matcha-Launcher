// 下载完成后提醒「去给作者点个赞」：Steam 创意工坊 / B站 / GameMaps / 爱发电。
// 网页下载的作者页由内置浏览器的来源链找（browser/trail.ts）；找不到再按「发现 → B站」里点开过的网站对。
// 只存本机：点过「前往点赞」的条目以后不再提醒；「下次一定」的下次再下载还会提醒（说好的下次）。
import { app } from './app.svelte';
import { prefs } from './prefs.svelte';
import { browser, type BrowserDownload } from '../browser/browser.svelte';
import { trail, type CreatorPage } from '../browser/trail';
import { gmUrl } from '../api/gamemaps';
import { desktop, errorText } from '../api/bridge';
import { ALREADY, BYE, VOTED, idleLine, pick } from '../support-lines';
import type { ModCreator, ModTask } from '../types';

export type SupportSource = ModCreator['source'];
export interface SupportItem {
  /** steam:<工坊 id> / bili:<BV 号> / gm:<GameMaps id> / afdian:p/<作品 id>，同一个只提醒一条 */
  key: string;
  source: SupportSource;
  title: string;
  author?: string;
  url: string;
}
/** 从哪个 B站视频找到的资源 */
export interface BiliOrigin { bvid: string; title: string; author: string; url: string }

export const SOURCE_LABEL: Record<SupportSource, string> = { steam: 'Steam 创意工坊', bilibili: 'B站', gamemaps: 'GameMaps', afdian: '爱发电' };
/** 能在卡片里直接点赞的网站：用内置浏览器里的登录，Cookie 不出 WebView */
type Direct = 'steam' | 'bilibili';
const DIRECT_NAME: Record<Direct, string> = { steam: 'Steam', bilibili: 'B站' };
const isDirect = (s: SupportSource): s is Direct => s === 'steam' || s === 'bilibili';

const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 只在本次会话有效 */ } };

const LIKED = 'flare.support.liked', LATER = 'flare.support.later', VIA = 'flare.support.via';
/** 工坊下载可能排很久的队；网盘链接打开后一般很快就下 */
const WORKSHOP_TTL = 24 * 3600_000, LINK_TTL = 3 * 3600_000;
/** 几个下载前后脚完成时合成一张卡片 */
const GATHER_MS = 1200;
/** 「下次一定」后告别多久再收起 */
const BYE_MS = 2600;
const MAX_PENDING = 20;
const ARCHIVE = /\.(vpk|zip|rar|7z)$/i;

type Via = { workshop: Record<string, BiliOrigin & { at: number }>; links: (BiliOrigin & { site: string; at: number })[] };

/** 网盘会在子域名之间跳（pan.baidu.com → d.pcs.baidu.com，蓝奏云换着域名用），按站点比 */
function site(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('lanzou')) return 'lanzou';
    return host.split('.').slice(-2).join('.');
  } catch { return ''; }
}

class Support {
  pending = $state<SupportItem[]>([]);
  /** 卡片是否弹出；攒一小会儿再弹，前后脚完成的合成一张 */
  open = $state(false);
  /** 这张卡片的鼓励语 */
  line = $state('');
  /** 连着按了几次「下次一定」；点一次赞就清零 */
  later = $state(read<number>(LATER, 0));
  /** 按了「下次一定」后的告别台词；有值时卡片在告别，过一会儿收起 */
  farewell = $state('');
  /** 点了「前往点赞」：从浏览器回来时小火苗道个谢 */
  cheer = $state(false);
  /** 道谢时说的话；空着就由卡片挑一句「回来啦」 */
  cheerLine = $state('');
  /** 正在卡片里直接点赞的条目 */
  voting = $state<string | null>(null);
  /** Steam / B站条目能在卡片里直接点赞。后端还没有这个能力时关掉，退回打开作品页 */
  oneClick = $state<Record<Direct, boolean>>({ steam: desktop, bilibili: desktop });
  private liked = new Set<string>(read<string[]>(LIKED, []));
  /** 一共点过几个赞（夸夸用） */
  likedCount = $state(this.liked.size);
  private byeTimer: ReturnType<typeof setTimeout> | undefined;
  private byeKeys = new Set<string>();
  private via: Via = read<Via>(VIA, { workshop: {}, links: [] });
  private authors = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // 过期的出处顺手清掉
    const now = Date.now();
    for (const [id, o] of Object.entries(this.via.workshop)) if (now - o.at > WORKSHOP_TTL) delete this.via.workshop[id];
    this.via.links = this.via.links.filter((l) => now - l.at <= LINK_TTL);
    write(VIA, this.via);
  }

  /** 页面发起下载时顺手记下作者名，提醒里好显示 */
  author(key: string, name: string | undefined) { if (name?.trim()) this.authors.set(key, name.trim()); }

  /** B站视频里下载工坊资源：这个工坊条目的赞算给 B站视频 */
  viaBili(video: BiliOrigin, workshopId: string) {
    this.via.workshop[workshopId] = { ...origin(video), at: Date.now() };
    write(VIA, this.via);
  }
  /** B站视频里打开网盘等链接：之后从同一站点下载的 VPK / 压缩包算这个视频的 */
  viaBiliLink(video: BiliOrigin, url: string) {
    const s = site(url);
    if (!s || s === 'bilibili.com') return;
    this.via.links = [{ ...origin(video), site: s, at: Date.now() }, ...this.via.links.filter((l) => l.site !== s)].slice(0, 20);
    write(VIA, this.via);
  }

  /** 后端下载任务完成（创意工坊 / GameMaps） */
  task(t: ModTask) {
    if (t.kind !== 'download') return;
    if (t.source === 'gamemaps' && t.sourceId) {
      const key = `gm:${t.sourceId}`;
      return this.offer({ key, source: 'gamemaps', title: t.title, author: this.authors.get(key), url: gmUrl(t.sourceId) });
    }
    if (!t.workshopId) return;
    const bili = this.via.workshop[t.workshopId];
    if (bili && Date.now() - bili.at <= WORKSHOP_TTL) return this.offer(biliItem(bili));
    const key = `steam:${t.workshopId}`;
    const mod = t.modId ? app.mod(t.modId) : undefined;
    this.offer({ key, source: 'steam', title: mod?.title || t.title, author: this.authors.get(key) || mod?.author || undefined, url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${t.workshopId}` });
  }

  /** 内置浏览器下载完成：按来源链找到的作者页提醒（B站视频和爱发电都有时两个都列）；
   *  链上没有，再看是不是 GameMaps 详情页里下的，或「发现 → B站」里点开过的网站 */
  web(d: BrowserDownload) {
    if (!ARCHIVE.test(d.name)) return;
    const found = trail.creatorsOf(d);
    if (found.length) { for (const c of found) this.offer(this.fromCreator(c)); return; }
    const gm = d.pageUrl.match(/^https?:\/\/(?:www\.)?gamemaps\.com\/details\/(\d+)/i)?.[1];
    if (gm) {
      const key = `gm:${gm}`;
      return this.offer({ key, source: 'gamemaps', title: d.pageTitle?.replace(/\s*[-|–]\s*GameMaps.*$/i, '') || d.name, author: this.authors.get(key), url: gmUrl(gm) });
    }
    const sites = new Set([site(d.pageUrl), site(d.url)]);
    const now = Date.now();
    const bili = this.via.links.find((l) => sites.has(l.site) && now - l.at <= LINK_TTL);
    if (bili) this.offer(biliItem(bili));
  }
  private fromCreator(c: CreatorPage): SupportItem {
    return { key: c.key, source: c.source, title: c.title, author: c.author || this.authors.get(c.key), url: c.url };
  }

  private offer(item: SupportItem) {
    if (!prefs.likePrompt || this.liked.has(item.key) || this.pending.some((p) => p.key === item.key)) return;
    this.pending = [...this.pending, item].slice(-MAX_PENDING);
    if (this.open || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.pending.length) return;
      this.line = idleLine(this.pending.map((p) => p.source));
      this.open = true;
    }, GATHER_MS);
  }

  /** Steam 工坊、B站视频能在卡片里直接点赞 */
  direct(item: SupportItem) { return isDirect(item.source) && this.oneClick[item.source]; }
  /** 直接点赞用的是哪个网站的登录（悬停提示用） */
  directName(item: SupportItem) { return isDirect(item.source) ? DIRECT_NAME[item.source] : ''; }

  /** 点赞：Steam 工坊、B站视频用内置浏览器里登录的账号直接点，不离开启动器。
   *  其他来源、没登录或没点上，就在内置浏览器打开作品页（那里登录着 Steam / B站 / 爱发电） */
  async go(item: SupportItem) {
    if (this.voting) return;
    this.stopBye();
    if (this.direct(item)) {
      this.voting = item.key;
      const result = await this.vote(item);
      this.voting = null;
      if (result === 'voted' || result === 'already') {
        this.liked.add(item.key);
        this.settle(item);
        this.cheerLine = pick(result === 'voted' ? VOTED : ALREADY);
        return;
      }
      if (result === 'login') {
        const steam = item.source === 'steam';
        app.toast(steam ? '内置浏览器里还没登录 Steam。登录后会回到作品页，点一下大拇指就好' : '内置浏览器里还没登录 B站。登录后会回到视频页，点一下赞就好', undefined, 6000);
        return this.visit(item, steam ? steamLogin(item.url) : biliLogin(item.url));
      }
    }
    this.visit(item, item.url);
  }
  private async vote(item: SupportItem): Promise<'voted' | 'already' | 'login' | 'open'> {
    const source = item.source as Direct;
    const page = source === 'steam' ? '作品页' : '视频页';
    try {
      const r = source === 'steam' ? await browser.steamVote(item.key.slice('steam:'.length)) : await browser.biliLike(item.key.slice('bili:'.length));
      if (r.status === 'voted' || r.status === 'already' || r.status === 'login') return r.status;
      app.toast(`没能直接点上赞${r.message ? `：${r.message}` : ''}。已打开${page}，在页面上点就好`, undefined, 6000);
    } catch (e) {
      const text = errorText(e);
      // 旧版桌面壳不认识这个操作：以后都直接打开页面，不再提示
      if (/浏览器操作无效/.test(text)) this.oneClick[source] = false;
      else app.toast(`没能直接点上赞：${text}。已打开${page}，在页面上点就好`, undefined, 6000);
    }
    return 'open';
  }
  /** 去内置浏览器的作品页点；回来时小火苗道谢 */
  private visit(item: SupportItem, url: string) {
    this.liked.add(item.key);
    this.settle(item);
    this.cheerLine = '';
    browser.open(url);
    app.route = 'browser';
  }
  /** 点过的不再提醒，「下次一定」清零，卡片转去道谢 */
  private settle(item: SupportItem) {
    this.likedCount = this.liked.size;
    write(LIKED, [...this.liked].slice(-500));
    this.later = 0; write(LATER, 0);
    this.pending = this.pending.filter((p) => p.key !== item.key);
    if (!this.pending.length) this.open = false;
    this.cheer = true;
  }

  /** 下次一定：先委屈地告别一下，再收起；告别时再按一次直接收起 */
  dismiss() {
    if (this.voting) return;
    if (this.farewell) return this.finishBye();
    this.later++; write(LATER, this.later);
    this.byeKeys = new Set(this.pending.map((p) => p.key));
    this.farewell = pick(BYE);
    this.byeTimer = setTimeout(() => this.finishBye(), BYE_MS);
  }
  private finishBye() {
    // 告别期间新完成的下载留着，换句台词接着提醒
    const keys = this.byeKeys;
    this.stopBye();
    this.pending = this.pending.filter((p) => !keys.has(p.key));
    if (this.pending.length) this.line = idleLine(this.pending.map((p) => p.source));
    else this.open = false;
  }
  private stopBye() {
    clearTimeout(this.byeTimer);
    this.byeTimer = undefined;
    this.byeKeys = new Set();
    this.farewell = '';
  }
}

/** Steam 登录页，登录完回到这个作品页 */
function steamLogin(url: string) {
  const u = new URL(url);
  return `https://steamcommunity.com/login/home/?goto=${encodeURIComponent(u.pathname.slice(1) + u.search)}`;
}
/** B站登录页，登录完回到这个视频 */
const biliLogin = (url: string) => `https://passport.bilibili.com/login?gourl=${encodeURIComponent(url)}`;
const origin = (v: BiliOrigin): BiliOrigin => ({ bvid: v.bvid, title: v.title, author: v.author, url: v.url });
const biliItem = (v: BiliOrigin): SupportItem => ({ key: `bili:${v.bvid}`, source: 'bilibili', title: v.title, author: v.author || undefined, url: v.url });
export const support = new Support();
