import { api } from '../api';
import type { Mod, TrashEntry } from '../types';

export type ThumbMod = Pick<Mod, 'id' | 'title' | 'dirs' | 'updatedAt' | 'workshopId' | 'hasThumbnail'> & { trashId?: string };
export const trashThumb = (t: TrashEntry): ThumbMod => ({
  id: t.modId, title: t.title, dirs: [], updatedAt: t.deletedAt, trashId: t.trashId, hasThumbnail: t.state === 'trashed',
});

// 本地封面按需读取；工坊条目与数字工坊 ID 文件缺图时补齐并缓存，最多 4 路并发。
// 内存上限：后端可能返回原尺寸 JPEG，大于 SHRINK_OVER 的先缩到 MAX_EDGE；
// 缓存最多 MAX_ENTRIES 张、MAX_CHARS 字符（data URL 文本），超了按先进先出丢掉，滚回来时重新读。
const MAX_EDGE = 320;
const SHRINK_OVER = 80_000;
const MAX_ENTRIES = 400;
const MAX_CHARS = 32 * 1024 * 1024;

const cache = $state<Record<string, string>>({});
/** 确认没有封面的条目：只记 key，不占缓存额度 */
const none = new Set<string>();
const order: string[] = [];
let chars = 0;
const queue: ThumbMod[] = [];
const queued = new Set<string>();
let running = 0;
let unsupported = false;

const key = (m: ThumbMod) => m.trashId ? `trash:${m.trashId}` : `${m.id}@${m.updatedAt}`;
const artDirs = $state<Record<string, string[]>>({});

function put(k: string, url: string | null) {
  if (!url) { none.add(k); return; }
  if (k in cache) { chars -= cache[k].length; order.splice(order.indexOf(k), 1); }
  cache[k] = url; chars += url.length; order.push(k);
  while (order.length > MAX_ENTRIES || (chars > MAX_CHARS && order.length > 1)) {
    const old = order.shift()!;
    chars -= cache[old]?.length ?? 0;
    delete cache[old];
  }
}

/** 大图缩到 MAX_EDGE 再存成 JPEG；解码失败或环境不支持时原样返回 */
async function shrink(url: string): Promise<string> {
  if (url.length < SHRINK_OVER || typeof OffscreenCanvas === 'undefined' || !url.startsWith('data:')) return url;
  try {
    const comma = url.indexOf(',');
    const bin = atob(url.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: url.slice(5, url.indexOf(';')) || 'image/jpeg' }));
    try {
      const k = MAX_EDGE / Math.max(bmp.width, bmp.height);
      if (k >= 1) return url;
      const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
      const small = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(out);
      });
      return small.length < url.length ? small : url;
    } finally { bmp.close(); }
  } catch { return url; }
}

function pump() {
  while (running < 4 && queue.length) {
    const m = queue.shift()!;
    const k = key(m);
    running++;
    (m.trashId ? api.trashThumbnail(m.trashId).then(r => {
      if (r.dirs?.length) artDirs[k] = r.dirs;
      return r;
    }) : api.modThumbnail(m.id))
      .then(async (r) => put(k, r?.dataUrl ? await shrink(r.dataUrl) : null))
      .catch((e) => { if (!m.trashId && (e as { code?: string })?.code === 'unsupported_capability') unsupported = true; })
      .finally(() => { running--; queued.delete(k); pump(); });
  }
}

export const thumbs = {
  src(m: ThumbMod): string | null { return cache[key(m)] ?? null; },
  dirs(m: ThumbMod): string[] { return m.trashId ? artDirs[key(m)] ?? m.dirs : m.dirs; },
  load(m: ThumbMod) {
    const k = key(m);
    const canFetchCover = !!m.workshopId || /^(?:workshop\/)?[1-9][0-9]{0,19}\.vpk$/i.test(m.id);
    if ((!m.trashId && unsupported) || (!m.hasThumbnail && (m.trashId || !canFetchCover)) || k in cache || none.has(k) || queued.has(k)) return;
    queued.add(k);
    queue.push(m);
    pump();
  },
};
