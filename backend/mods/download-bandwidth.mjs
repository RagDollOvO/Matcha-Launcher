import { fail } from './files.mjs';

export const downloadDefaults = Object.freeze({ maxConcurrent: 2, speedLimit: 0 });
export const DOWNLOAD_BLOCK = 256 * 1024;

export function downloadSettings(patch, current = downloadDefaults) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some(k => !Object.hasOwn(downloadDefaults, k))) fail('invalid_argument', '请检查下载设置字段。');
  const { maxConcurrent, speedLimit } = { ...current, ...patch };
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4) fail('invalid_argument', '同时任务数请选择 1–4。');
  if (!Number.isSafeInteger(speedLimit) || speedLimit < 0) fail('invalid_argument', '限速请填写每秒字节数，0 表示不限速。');
  return { maxConcurrent, speedLimit };
}

// One FIFO byte budget for all managed file bodies, including the native GameMaps
// reader. Each reader asks for at most one block at a time. Idle credit is bounded
// to 100 ms so a quiet queue cannot stockpile bandwidth for a later download.
export class DownloadBandwidth {
  rate = 0;
  credit = 0;
  at = performance.now();
  waiting = new Set();
  timer;
  get burst() { return Math.max(1, Math.floor(this.rate / 10)); }
  accrue() {
    const now = performance.now();
    this.credit = Math.min(this.burst, this.credit + (now - this.at) * this.rate / 1000);
    this.at = now;
  }
  setLimit(rate) {
    if (this.rate === rate) return;
    this.accrue();
    this.rate = rate;
    this.credit = Math.min(this.credit, this.burst);
    this.drain();
  }
  take(max, signal) {
    signal.throwIfAborted();
    max = Math.min(max, DOWNLOAD_BLOCK);
    if (!this.rate) return Promise.resolve(max);
    return new Promise((resolve, reject) => {
      const entry = { max, resolve, signal, abort: () => {
        this.waiting.delete(entry); reject(signal.reason); this.drain();
      } };
      signal.addEventListener('abort', entry.abort, { once: true });
      this.waiting.add(entry); this.drain();
    });
  }
  drain() {
    clearTimeout(this.timer);
    this.accrue();
    for (const entry of this.waiting) {
      const bytes = this.rate ? Math.min(entry.max, this.burst) : entry.max;
      if (this.rate && this.credit < bytes) {
        this.timer = setTimeout(() => this.drain(), Math.ceil((bytes - this.credit) * 1000 / this.rate));
        break;
      }
      if (this.rate) this.credit -= bytes;
      this.waiting.delete(entry);
      entry.signal.removeEventListener('abort', entry.abort);
      entry.resolve(bytes);
    }
  }
}
