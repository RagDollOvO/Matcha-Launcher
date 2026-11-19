// B站搜索：后端命令 bilibili-search / bilibili-detail（契约见 docs/bilibili-backend.md）。
// 开发预览加 ?mockbili 用假数据。
import { call } from './bridge';

export type BiliOrder = 'totalrank' | 'pubdate' | 'click' | 'stow';
export interface BiliQuery { keyword: string; order: BiliOrder; page: number }
export interface BiliVideo {
  bvid: string; title: string; cover: string; author: string; mid?: number;
  /** "4:32" */
  duration: string; play: number; favorites?: number; danmaku?: number;
  /** ISO */
  pubdate: string; description: string; tags?: string[]; url: string;
}
export interface BiliPage { items: BiliVideo[]; page: number; totalPages: number; total: number }
export interface BiliDetail extends BiliVideo { pinnedComment?: string }

/** 兼容尚未提供命令的旧版后端 */
export const biliMissing = (e: unknown) => ['unsupported_capability', 'unknown_command'].includes((e as { code?: string })?.code ?? '');
/** 被 B站风控 */
export const biliBlocked = (e: unknown) => (e as { code?: string })?.code === 'bilibili_blocked';

const mock = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('mockbili');

export const biliApi = {
  search: (q: BiliQuery) => (mock ? mockSearch(q) : call<BiliPage>('bilibili-search', { ...q })),
  detail: (id: string) => (mock ? mockDetail(id) : call<BiliDetail>('bilibili-detail', { id })),
};

/** B站封面：缩成卡片尺寸，https；配合 <img referrerpolicy="no-referrer"> 绕开防盗链 */
export function cover(url: string, w = 480, h = 270) {
  if (!url) return '';
  const u = url.startsWith('//') ? `https:${url}` : url.replace(/^http:/, 'https:');
  return /hdslb\.com/.test(u) && !u.includes('@') ? `${u}@${w}w_${h}h_1c.webp` : u;
}
export const playCount = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)} 亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)} 万` : String(n));

// ---------------- 开发预览假数据 ----------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SAMPLES: Omit<BiliVideo, 'bvid' | 'url'>[] = [
  { title: '【求生之路2】M4A1-S 印花集 武器替换 MOD 展示', cover: '', author: '炸鸡不加冰', duration: '3:12', play: 48210, favorites: 2210, pubdate: '2026-11-12T10:00:00Z', description: '工坊链接：https://steamcommunity.com/sharedfiles/filedetails/?id=2331192184\n喜欢的话点个赞～' },
  { title: '求生之路2 自制地图「枪店」发布！附下载', cover: '', author: 'Whitaker', duration: '8:45', play: 15322, favorites: 980, pubdate: '2026-11-10T08:00:00Z', description: '百度网盘：https://pan.baidu.com/s/1AbCdEfGh?pwd=l4d2\n蓝奏云：https://wwi.lanzoux.com/iXyZ123 密码:6666\n工坊 ID：3061234567' },
  { title: 'L4D2 生还者模型合集 第三期（原神 / 鸣潮）', cover: '', author: 'MOD搬运工', duration: '12:03', play: 230411, favorites: 15400, pubdate: '2026-11-08T12:00:00Z', description: '全部资源在爱发电：https://afdian.com/a/modporter\n夸克：https://pan.quark.cn/s/8f2c1a\n提取码：ab12' },
  { title: '求生之路2 粉色水面材质 MOD', cover: '', author: '粉水', duration: '1:05', play: 3302, favorites: 120, pubdate: '2026-11-05T12:00:00Z', description: 'https://steamcommunity.com/sharedfiles/filedetails/?id=2553133332' },
  { title: '【L4D2】这把枪的音效也太爽了吧', cover: '', author: '音效狂魔', duration: '2:40', play: 88210, favorites: 4500, pubdate: '2026-11-03T12:00:00Z', description: '素材来源见评论区' },
  { title: 'Beacon 插件开发入门：给 L4D2 写一个原生 DLL', cover: '', author: 'Matcha 开发组', duration: '24:10', play: 6021, favorites: 830, pubdate: '2026-11-01T12:00:00Z', description: '源码：https://github.com/example/beacon-sample' },
];
async function mockSearch(q: BiliQuery): Promise<BiliPage> {
  await sleep(500);
  const items = SAMPLES.map((s, i) => ({ ...s, bvid: `BV1mock${q.page}${i}xx1`, url: `https://www.bilibili.com/video/BV1mock${q.page}${i}xx1` }))
    .filter((s) => !q.keyword.includes('音效') || s.title.includes('音效'));
  if (q.order === 'click') items.sort((a, b) => b.play - a.play);
  if (q.order === 'pubdate') items.sort((a, b) => b.pubdate.localeCompare(a.pubdate));
  return { items, page: q.page, totalPages: 5, total: 98 };
}
async function mockDetail(id: string): Promise<BiliDetail> {
  await sleep(400);
  const i = Number(id.match(/BV1mock\d(\d)/)?.[1] ?? 0);
  const s = SAMPLES[i] ?? SAMPLES[0];
  return { ...s, bvid: id, url: `https://www.bilibili.com/video/${id}`, description: `${s.description}\n\n更多作品看主页～`, pinnedComment: i === 4 ? '音效包：https://pan.baidu.com/s/1sound 提取码：snd1' : undefined };
}
