// GameMaps.com（L4D2 地图 / Mod 站）：后端命令 gamemaps-browse / gamemaps-detail / gamemaps-download。
// 契约见 docs/gamemaps-backend.md。开发预览加 ?mockgm 用假数据。
import { call } from './bridge';
import { app } from '../stores/app.svelte';
import type { ModTask } from '../types';

export type GmSection = 'maps' | 'mods';
export type GmSort = 'recent' | 'popular' | 'rviews';
export interface GmQuery { section: GmSection; category: string; sort: GmSort; page: number; q: string }
export interface GmItem {
  id: string; title: string;
  /** 站内相对地址或绝对地址都行，前端用 gmImage() 补全 */
  image: string;
  /** 站点给的类型标签，如 "Map"、"4 Maps"、"Mod" */
  typeLabel: string;
  summary?: string; author?: string; sizeBytes?: number; views?: number; likes?: number; updatedAt?: string;
  url: string;
}
export interface GmPage { items: GmItem[]; page: number; totalPages: number }
export interface GmDetail extends GmItem {
  authors: { name: string; role: string }[];
  description: string;
  /** 作者写的使用说明（例如需要 sv_consistency 0），很重要，单独显示 */
  instructions?: string;
  tags: string[];
  screenshots: string[];
  file?: { name: string; sizeBytes: number; date: string; version?: string };
  /** 作者同时发在创意工坊时的条目 id，可以走工坊下载 */
  workshopId?: string;
  linked: GmItem[];
}

export const gmMissing = (e: unknown) => ['unsupported_capability', 'unknown_command'].includes((e as { code?: string })?.code ?? '');
export const gmBlocked = (e: unknown) => (e as { code?: string })?.code === 'gamemaps_blocked';
export const GM_HOME = 'https://www.gamemaps.com/l4d2';
export const gmImage = (u: string) => (!u ? '' : u.startsWith('//') ? `https:${u}` : u.startsWith('/') ? `https://www.gamemaps.com${u}` : u);
export const gmUrl = (id: string) => `https://www.gamemaps.com/details/${id}`;

const mock = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('mockgm');

export const gmApi = {
  browse: (q: GmQuery) => (mock ? mockBrowse(q) : call<GmPage>('gamemaps-browse', { ...q })),
  detail: (id: string) => (mock ? mockDetail(id) : call<GmDetail>('gamemaps-detail', { id })),
  /** 后端建一个下载任务（进「下载」页），完成后 VPK 导入「新下载」 */
  download: (id: string, title: string) => (mock ? mockDownload(id, title) : call<{ taskId: string }>('gamemaps-download', { id }, true)),
};

// ---------------- 开发预览假数据 ----------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ITEMS: GmItem[] = [
  { id: '35511', title: '[CLASSIFIED] The Parish Reloaded V2.2/教区重装上阵 V2.2', image: '', typeLabel: '4 Maps', author: 'Scari', sizeBytes: 412_000_000, views: 18200, likes: 340, updatedAt: '2026-11-10', summary: 'The Parish Reloaded 2.0 out now.', url: gmUrl('35511') },
  { id: '36624', title: 'Glubtastic: Back 4 Glub', image: '', typeLabel: 'Map', author: 'DrFace', sizeBytes: 77_300_000, views: 3100, likes: 10, updatedAt: '2026-11-02', url: gmUrl('36624') },
  { id: '36645', title: 'City 5', image: '', typeLabel: '5 Maps', author: 'PlayGamesTB', sizeBytes: 520_000_000, views: 9200, likes: 120, updatedAt: '2026-11-14', url: gmUrl('36645') },
  { id: '22803', title: 'Atrocity Valley', image: '', typeLabel: '3 Maps', author: 'Valley Team', sizeBytes: 230_000_000, views: 52000, likes: 880, updatedAt: '2026-10-21', url: gmUrl('22803') },
  { id: '36516', title: 'Back 4 Blood M16A2 (L4D2 Animations)', image: '', typeLabel: 'Mod', author: 'Ryker', sizeBytes: 18_500_000, views: 1400, likes: 42, updatedAt: '2026-11-11', url: gmUrl('36516') },
  { id: '36586', title: 'Gears of War Menu Backgrounds', image: '', typeLabel: 'Mod', author: 'Marcus', sizeBytes: 96_000_000, views: 2100, likes: 37, updatedAt: '2026-11-09', url: gmUrl('36586') },
];
async function mockBrowse(q: GmQuery): Promise<GmPage> {
  await sleep(500);
  let items = ITEMS.filter((i) => (q.section === 'mods' ? i.typeLabel === 'Mod' : i.typeLabel !== 'Mod'));
  if (q.q) items = ITEMS.filter((i) => i.title.toLowerCase().includes(q.q.toLowerCase()));
  if (q.sort === 'popular') items = [...items].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  return { items, page: q.page, totalPages: q.section === 'maps' ? 77 : 120 };
}
async function mockDetail(id: string): Promise<GmDetail> {
  await sleep(400);
  const it = ITEMS.find((i) => i.id === id) ?? ITEMS[1];
  return {
    ...it, authors: [{ name: it.author ?? '作者', role: 'Author' }, { name: 'PlayGamesTB', role: 'Co-author' }],
    description: 'A 4-chapter custom campaign set in a rainy European city.\n\nFeatures: new finale, custom music, L4D1 survivors.',
    instructions: 'Before starting the map, "sv_consistency" must be set to 0 (disabled).',
    tags: ['Campaign', 'Co-op', 'City / Urban', 'Night', 'Rainy', 'Hard'], screenshots: ['', '', ''],
    file: { name: 'GLUB_B4G.zip', sizeBytes: it.sizeBytes ?? 0, date: '2026-11-02', version: '4.4 Final' },
    workshopId: id === '36624' ? '3361234567' : undefined,
    linked: ITEMS.filter((i) => i.id !== id).slice(0, 3),
  };
}
/** 假下载：只在前端造一个进度任务，演示下载页和侧栏动效，不碰后端 */
async function mockDownload(id: string, title: string): Promise<{ taskId: string }> {
  await sleep(200);
  const now = new Date().toISOString();
  const total = (ITEMS.find((i) => i.id === id)?.sizeBytes ?? 50_000_000);
  const task: ModTask = { taskId: `gm-mock-${id}-${Date.now()}`, kind: 'download', source: 'gamemaps', sourceId: id, gameRoot: app.game?.root ?? '', title, state: 'running', done: 0, total, unit: 'bytes', cancelable: true, pausable: false, resumable: false, createdAt: now, updatedAt: now, bytesPerSecond: total / 4 };
  app.tasks.push(task);
  const live = () => app.tasks.find((t) => t.taskId === task.taskId);
  void (async () => {
    for (let i = 1; i <= 8; i++) {
      await sleep(500);
      const t = live(); if (!t || t.state !== 'running') return;
      t.done = Math.round((total * i) / 8); t.updatedAt = new Date().toISOString();
    }
    const t = live();
    if (t && t.state === 'running') { t.state = 'done'; t.cancelable = false; t.finishedAt = t.updatedAt; }
  })();
  return { taskId: task.taskId };
}
