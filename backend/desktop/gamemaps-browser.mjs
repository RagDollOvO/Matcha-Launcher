import { randomUUID } from 'node:crypto';
import { PlatformError } from '../errors.mjs';
import { DOWNLOAD_BLOCK } from '../mods/download-bandwidth.mjs';

// Private child-process protocol. Remote webviews never receive Matcha IPC privileges.
export class GameMapsBrowser {
  constructor(send) { this.send = send; this.pending = new Map(); }
  request(params, signal, progress, takeBytes) {
    signal?.throwIfAborted();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.pending.delete(id);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => {
        const paused = params.kind === 'download' && signal.reason?.name === 'TaskPaused';
        if (paused) pending.pauseReason = signal.reason;
        this.send({ type: 'gamemaps_cancel', id, ...(paused ? { paused: true } : {}) });
        // A pause awaits native cleanup; a success already in the pipe still gets its receipt.
        if (!paused) finish(signal.reason);
      };
      const timer = setTimeout(() => {
        this.send({ type: 'gamemaps_cancel', id });
        finish(new PlatformError('gamemaps_timeout', 'GameMaps 页面或下载等待超时，请稍后重试。'));
      }, params.kind === 'download' ? 45 * 60 * 1000 : 100000);
      const pending = { finish, progress, takeBytes, timer };
      this.pending.set(id, pending); signal?.addEventListener('abort', cancel, { once: true });
      try { this.send({ ...params, type: 'gamemaps_request', id }); } catch (e) { finish(e); }
    });
  }
  receive(record) {
    const pending = this.pending.get(record.id);
    if (!pending) return;
    if (pending.pauseReason && record.type !== 'gamemaps_response') return;
    pending.timer.refresh(); // A capped transfer can outlive the idle timeout.
    if (record.type === 'gamemaps_budget') {
      const max = record.bytes;
      if (!Number.isSafeInteger(max) || max < 1 || max > DOWNLOAD_BLOCK) {
        this.send({ type: 'gamemaps_cancel', id: record.id }); pending.finish(new PlatformError('gamemaps_transfer', '下载分块大小无效。')); return;
      }
      Promise.resolve().then(() => pending.takeBytes ? pending.takeBytes(max) : max).then(bytes => {
        if (!pending.pauseReason && this.pending.get(record.id) === pending) this.send({ type: 'gamemaps_grant', id: record.id, bytes });
      }).catch(e => {
        if (!pending.pauseReason && this.pending.get(record.id) === pending) { this.send({ type: 'gamemaps_cancel', id: record.id }); pending.finish(e); }
      });
    } else if (record.type === 'gamemaps_progress') pending.progress?.(record.progress);
    else pending.finish(record.error ? pending.pauseReason ?? new PlatformError(record.error.code, record.error.message) : null, record.result);
  }
  close() {
    for (const [id, pending] of this.pending) {
      this.send({ type: 'gamemaps_cancel', id });
      pending.finish(new PlatformError('service_closing', '服务正在关闭。'));
    }
  }
}
