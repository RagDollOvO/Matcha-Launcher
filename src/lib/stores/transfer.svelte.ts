// 下载的实时速度 / 剩余时间 / 停滞检测 / 总速度曲线。
// 后端给的 bytesPerSecond 是「从开始到现在」的平均值：开头偏慢，中途掉速也看不出来。
// 这里按最近几秒的字节增量算速度，每秒结算一次，数字不会跟着 100ms 一次的进度事件乱跳。

const WINDOW = 4000;  // 速度取最近 4 秒
const STALL = 6000;   // 超过 6 秒没有新字节算停滞
const HISTORY = 60;   // 总速度曲线保留 60 秒

type Sample = { at: number; done: number };
export interface Feed {
  id: string;
  done: number;
  total: number | null;
  /** 这条进度的时间戳（毫秒） */
  at: number;
  /** 样本不够时先用的速度（后端的平均值） */
  fallback?: number;
}
export interface Rate {
  /** 字节/秒；样本不够时为 null */
  speed: number | null;
  /** 剩余秒数；总量未知、停滞或太慢时为 null */
  eta: number | null;
  /** 已停滞的秒数，正常为 0 */
  stalled: number;
}

class Transfer {
  rates = $state<Record<string, Rate>>({});
  /** 每秒一个点：所有传输中的下载速度之和 */
  history = $state<number[]>([]);
  private samples = new Map<string, Sample[]>();
  private latest = new Map<string, Feed>();
  private moved = new Map<string, number>();

  feed(f: Feed) {
    const list = this.samples.get(f.id) ?? [];
    const last = list.at(-1);
    if (last && f.at <= last.at) return;
    // 没变化的重复上报 1 秒内只记一次
    if (last && f.done === last.done && f.at - last.at < 1000) { this.latest.set(f.id, f); return; }
    // 重试会从 0 开始
    if (last && f.done < last.done) { list.length = 0; this.moved.delete(f.id); }
    if (!list.length || f.done !== list.at(-1)!.done) this.moved.set(f.id, f.at);
    list.push({ at: f.at, done: f.done });
    this.samples.set(f.id, list);
    this.latest.set(f.id, f);
  }

  /** 每秒结算一次；live 之外的记录丢掉 */
  tick(live: Set<string>, now = Date.now()) {
    const next: Record<string, Rate> = {};
    let sum = 0;
    for (const [id, list] of this.samples) {
      if (!live.has(id)) { this.samples.delete(id); this.latest.delete(id); this.moved.delete(id); continue; }
      const f = this.latest.get(id)!;
      // 窗口内的样本 + 窗口前最后一条当起点
      const inside = list.findIndex((s) => s.at >= now - WINDOW);
      const cut = (inside < 0 ? list.length : inside) - 1;
      if (cut > 0) list.splice(0, cut);
      const first = list[0], last = list.at(-1)!, span = now - first.at;
      const raw = list.length >= 2 && span >= 800 ? Math.max(0, (last.done - first.done) * 1000 / span) : f.fallback || null;
      const prev = this.rates[id]?.speed;
      const still = now - (this.moved.get(id) ?? now);
      const stalled = still > STALL ? Math.floor(still / 1000) : 0;
      const speed = stalled ? 0 : raw === null ? null : prev ? prev * 0.6 + raw * 0.4 : raw;
      const left = f.total !== null ? Math.max(0, f.total - last.done) : null;
      next[id] = { speed, eta: !stalled && speed && speed > 256 && left !== null ? left / speed : null, stalled };
      sum += speed ?? 0;
    }
    this.rates = next;
    this.history = [...this.history, sum].slice(-HISTORY);
  }

  reset() {
    this.samples.clear(); this.latest.clear(); this.moved.clear();
    this.rates = {}; this.history = [];
  }
}

export const transfer = new Transfer();

/** 剩余时间：越远越粗，避免每秒来回跳 */
export function eta(s: number): string {
  if (s < 3) return '即将完成';
  if (s < 20) return `${Math.ceil(s)} 秒`;
  if (s < 60) return `${Math.ceil(s / 5) * 5} 秒`;
  if (s < 600) { const r = Math.ceil(s / 10) * 10, m = Math.floor(r / 60), x = r % 60; return x ? `${m} 分 ${x} 秒` : `${m} 分钟`; }
  if (s < 3600) return `${Math.ceil(s / 60)} 分钟`;
  if (s < 172800) { const m = Math.ceil(s / 60), h = Math.floor(m / 60), x = m % 60; return x ? `${h} 小时 ${x} 分` : `${h} 小时`; }
  return '超过 2 天';
}

/** 行内用：「剩余 40 秒」，快完了直接说「即将完成」 */
export const left = (s: number) => (s < 3 ? '即将完成' : `剩余 ${eta(s)}`);

/** 用时 */
export function span(s: number): string {
  if (s < 1) return '不到 1 秒';
  if (s < 60) return `${Math.round(s)} 秒`;
  const r = Math.round(s);
  if (r < 3600) return `${Math.floor(r / 60)} 分${r % 60 ? ` ${r % 60} 秒` : '钟'}`;
  const m = Math.round(r / 60);
  return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`;
}

/** 完成时间：今天只写时刻 */
export function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(new Date()) - day(d)) / 86400000);
  return ago === 0 ? hm : ago === 1 ? `昨天 ${hm}` : `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}
