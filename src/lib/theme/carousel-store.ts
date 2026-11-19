// 壁纸轮播的图片：记录存在本机 IndexedDB（和主壁纸一样只在这台电脑上）。
// 桌面版只记原图路径，不复制（IndexedDB 在 C 盘）；浏览器预览拿不到路径，存压到屏幕大小的图。
// 两种都预先算好缩略图、氛围底和种子色（每张几十 KB），切换时不用再算。
export interface SlideRecord {
  id: string;
  /** 浏览器预览：主页显示的图（超过屏幕大小的已经压成 WebP） */
  image?: Blob;
  /** 桌面版：本机原图路径 */
  path?: string;
  /** 设置里的小图，约 240px */
  thumb: Blob;
  /** 预先模糊的小图，非主页页面当底 */
  ambient: Blob;
  seed: string;
  /** 来自内置预设时是预设 id */
  preset: string | null;
  added: number;
}

const DB = 'matcha-carousel', STORE = 'slides';

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<R>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
  const db = await open();
  try {
    return await new Promise<R>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error ?? req.error);
    });
  } finally { db.close(); }
}

export const slideStore = {
  all: () => run<SlideRecord[]>('readonly', (s) => s.getAll()).then((list) => list.sort((a, b) => a.added - b.added)),
  get: (id: string) => run<SlideRecord | undefined>('readonly', (s) => s.get(id)),
  put: (rec: SlideRecord) => run('readwrite', (s) => s.put(rec)),
  remove: (id: string) => run('readwrite', (s) => s.delete(id)),
};
