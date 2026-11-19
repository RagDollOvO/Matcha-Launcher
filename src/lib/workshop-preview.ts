import { api, type WorkshopPreviewResult as Preview } from './api';

export type PreviewSize = 'card' | 'detail';
interface PreviewJob {
  key: string;
  id: string;
  size: PreviewSize;
  users: number;
  requestId?: string;
  promise: Promise<Preview>;
  resolve: (image: Preview) => void;
  reject: (error: unknown) => void;
}
const keyOf = (id: string, version: string, size: PreviewSize) => `${id}@${version}:${size}`;
const cache = new Map<string, Preview>();
const pending = new Map<string, PreviewJob>();
const waiting = new Set<PreviewJob>();
let running = 0;

export function peekWorkshopPreview(id: string, version: string, size: PreviewSize) {
  return cache.get(keyOf(id, version, size));
}

function pump() {
  while (running < 4 && waiting.size) {
    const job = waiting.values().next().value!;
    waiting.delete(job);
    const requestId = job.requestId = crypto.randomUUID();
    running++;
    void api.workshopPreview(job.id, job.size, requestId).then(preview => {
      if (pending.get(job.key) !== job) return;
      pending.delete(job.key);
      if (preview.dataUrl || preview.detailOnly) {
        cache.set(job.key, preview);
        while (cache.size > 48 || [...cache.values()].reduce((n, v) => n + (v.dataUrl?.length ?? 0), 0) > 24 * 1024 * 1024) cache.delete(cache.keys().next().value!);
      }
      job.resolve(preview);
    }, job.reject).finally(() => {
      if (pending.get(job.key) === job) pending.delete(job.key);
      running--;
      pump();
    });
  }
}

/** The last view to release a preview drops queued work or aborts its active transfer. */
export function workshopPreview(id: string, version: string, size: PreviewSize) {
  const key = keyOf(id, version, size);
  const saved = cache.get(key);
  if (saved) return { promise: Promise.resolve(saved), release: () => {} };
  let job = pending.get(key);
  if (!job) {
    let resolve!: PreviewJob['resolve'], reject!: PreviewJob['reject'];
    const promise = new Promise<Preview>((ok, fail) => { resolve = ok; reject = fail; });
    job = { key, id, size, users: 0, promise, resolve, reject };
    pending.set(key, job);
    waiting.add(job);
  }
  const request = job;
  request.users++;
  pump();
  let released = false;
  return {
    promise: request.promise,
    release() {
      if (released) return;
      released = true;
      if (--request.users > 0 || pending.get(key) !== request) return;
      pending.delete(key);
      waiting.delete(request);
      if (request.requestId) void api.cancelWorkshopPreview(request.requestId).catch(() => {});
      request.resolve({ dataUrl: null });
    },
  };
}

