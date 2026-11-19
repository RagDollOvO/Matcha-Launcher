import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { errorRecord } from '../core.mjs';
import { writeJson, fail } from './files.mjs';
import { downloadDefaults, downloadSettings, DownloadBandwidth } from './download-bandwidth.mjs';

const terminal = s => ['done', 'failed', 'canceled'].includes(s);
const canPause = r => ['download', 'extract'].includes(r.kind) && r.cancelable === true && ['queued', 'running'].includes(r.state);
const PAUSE = new DOMException('任务已暂停。', 'TaskPaused');
const now = () => new Date().toISOString();
export class TaskManager {
  constructor({ dataDir, emit, run }) {
    this.file = path.join(dataDir, 'tasks.json'); this.emit = emit; this.run = run;
    this.settingsFile = path.join(dataDir, 'download-settings.json'); this.settings = downloadDefaults;
    this.bandwidth = new DownloadBandwidth(); this.settingsWrites = Promise.resolve();
    this.records = new Map(); this.queue = new Set(); this.live = new Map(); this.waiters=new Map(); this.writes = Promise.resolve(); this.stopping = false;
    this.ready = Promise.all([this.load(), this.loadSettings()]);
  }
  async load() {
    let data;
    try { data = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (data.version !== 1 || !Array.isArray(data.tasks)) fail('tasks_invalid', '任务记录格式需要检查。');
    let recovered = false;
    for (const r of data.tasks) {
      if (terminal(r.state)) r.finishedAt ??= r.updatedAt;
      else if (r.state !== 'paused') {
        const at = now();
        Object.assign(r, { state: 'failed', updatedAt: at, finishedAt: at, cancelable: false, error: { code: 'task_interrupted', message: '上次退出时任务中断，可重试。' } });
        recovered = true;
      }
      this.records.set(r.taskId, r);
    }
    if (recovered) await this.save();
  }
  async loadSettings() {
    try { this.settings = downloadSettings(JSON.parse(await fs.readFile(this.settingsFile, 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.bandwidth.setLimit(this.settings.speedLimit);
  }
  async setSettings(patch) {
    await this.ready;
    const result = this.settingsWrites.then(async () => {
      const settings = downloadSettings(patch, this.settings);
      await fs.mkdir(path.dirname(this.settingsFile), { recursive: true });
      await writeJson(this.settingsFile, settings);
      this.settings = settings; this.bandwidth.setLimit(settings.speedLimit); this.pump();
      return { ...settings };
    });
    this.settingsWrites = result.catch(() => {}); return result;
  }
  view(r) {
    const { request, ...view } = r;
    return structuredClone({ ...view, pausable: canPause(r), resumable: false, ...(r.kind === 'download' ? request.source === 'gamemaps'
      ? { source: 'gamemaps', sourceId: request.id } : { source: 'workshop', workshopId: request.id } : {}) });
  }
  list() { return [...this.records.values()].map(r => this.view(r)); }
  pendingCount() {
    let count = 0;
    for (const r of this.records.values()) if (!terminal(r.state)) count++;
    return count;
  }
  save() {
    const result = this.writes.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await writeJson(this.file, { version: 1, tasks: [...this.records.values()] });
    });
    this.writes = result.catch(() => {}); return result;
  }
  publish(r) {
    r.updatedAt = now();
    if (terminal(r.state)) r.finishedAt ??= r.updatedAt;
    this.emit({ type: 'task_progress', ...this.view(r) });
    if(terminal(r.state)){for(const resolve of this.waiters.get(r.taskId)??[])resolve(this.view(r));this.waiters.delete(r.taskId);}
  }
  enqueue(r) {
    if (r.state !== 'queued') return;
    this.queue.add(r.taskId);
    setImmediate(() => this.pump());
  }
  async create(kind, request, title) {
    await this.ready;
    if (this.stopping) fail('service_closing', '服务正在关闭。');
    if (this.pendingCount() >= 32) fail('task_limit', '请等待当前任务完成后再添加。');
    const taskId = randomUUID(), now = new Date().toISOString();
    const r = { taskId, kind, request, ...(kind==='platform-download' && request.sourceId ? {sourceId:request.sourceId}:{}), gameRoot: request.gameRoot, title, state: 'queued', done: 0, total: null, unit: 'bytes', cancelable: true, createdAt: now, updatedAt: now };
    this.records.set(taskId, r);
    try { await this.save(); } catch (e) { this.records.delete(taskId); throw e; }
    if (r.state === 'queued') { this.publish(r); this.enqueue(r); }
    return { taskId };
  }
  pump() {
    if (this.stopping) return;
    for (const id of this.queue) {
      if (this.live.size >= this.settings.maxConcurrent) break;
      if (this.live.has(id)) continue;
      this.queue.delete(id);
      const r = this.records.get(id);
      if (r?.state !== 'queued') continue;
      const controller = new AbortController();
      const live = { controller, promise: null }; this.live.set(r.taskId, live);
      live.promise = this.perform(r, controller).finally(() => { this.live.delete(r.taskId); this.pump(); });
    }
  }
  async perform(r, controller) {
    const signal = controller.signal; let last = 0;
    const update = (values, force = false) => {
      signal.throwIfAborted();
      const changed = values.state && values.state !== r.state;
      Object.assign(r, values);
      if (force || changed || Date.now() - last > 100) { last = Date.now(); this.publish(r); }
    };
    try {
      update({ state: 'running' }, true);
      const result = await this.run(r.kind, r.request, {
        taskId: r.taskId, signal, progress: update,
        takeBytes: (max, transferSignal = signal) => this.bandwidth.take(max, transferSignal),
        commit: async fn => { signal.throwIfAborted(); update({ state: 'verifying', cancelable: false }, true); return fn(); },
      });
      update({ ...result, state: 'done', cancelable: false, error: undefined }, true);
    } catch (e) {
      if (signal.reason === PAUSE) Object.assign(r, { state: 'paused', cancelable: true, bytesPerSecond: 0, error: undefined });
      else Object.assign(r, { state: signal.aborted ? 'canceled' : 'failed', cancelable: false, error: errorRecord(e) });
      this.publish(r);
    }
    try { await this.save(); } catch (e) { this.emit({ type: 'bridge_fault', error: errorRecord(e) }); return e; }
  }
  get(id) { const r = this.records.get(id); if (!r) fail('task_missing', '任务已不存在。'); return r; }
  async completed(id) {
    let row=this.view(this.get(id));
    if(!terminal(row.state))row=await new Promise(resolve=>{
      const pending=this.waiters.get(id)??new Set();pending.add(resolve);this.waiters.set(id,pending);
    });
    if(row.state==='done')return row;
    fail(row.error?.code??'task_canceled',row.error?.message??'任务已取消。');
  }
  async pause(id) {
    await this.ready; const r = this.get(id);
    if (r.state === 'paused') { await this.save(); return this.view(r); }
    if (!canPause(r)) fail('task_not_pausable', '当前任务阶段无法暂停。');
    const live = this.live.get(id);
    if (r.state === 'queued') {
      this.queue.delete(id); r.state = 'paused'; this.publish(r); await this.save();
    } else {
      if (live.controller.signal.aborted && live.controller.signal.reason !== PAUSE) fail('task_canceling', '任务正在取消。');
      live.controller.abort(PAUSE);
      const saveError = await live.promise; // Staging/reader is closed and the slot has passed to the next task.
      if (saveError) throw saveError;
    }
    return this.view(r);
  }
  async resume(id) {
    await this.ready; const r = this.get(id);
    if (r.state !== 'paused') fail('task_not_paused', '请选择已暂停的任务。');
    await this.requeue(r); return this.view(r);
  }
  async cancel(id) {
    await this.ready; const r = this.get(id);
    if (terminal(r.state)) return this.view(r);
    if (!r.cancelable) fail('task_committing', '正在保存最终结果，请等待完成。');
    if (['queued', 'paused'].includes(r.state)) {
      this.queue.delete(id); r.state = 'canceled'; r.cancelable = false; this.publish(r); await this.save();
    } else {
      const live = this.live.get(id);
      if (live?.controller.signal.reason === PAUSE) { await live.promise; return this.cancel(id); }
      live?.controller.abort();
    }
    return this.view(r);
  }
  async retry(id) {
    await this.ready; const r = this.get(id);
    if (!['failed', 'canceled'].includes(r.state)) fail('task_not_retryable', '请等待任务结束后重试。');
    await this.requeue(r); return { taskId: id };
  }
  async requeue(r) {
    if (this.stopping) fail('service_closing', '服务正在关闭。');
    const before = { ...r };
    Object.assign(r, { state: 'queued', done: 0, total: null, bytesPerSecond: undefined, finishedAt: undefined, error: undefined, cancelable: true });
    // Keep task-list's queue order consistent with scheduling after a resume or retry.
    this.records.delete(r.taskId); this.records.set(r.taskId, r);
    try { await this.save(); }
    catch (e) { if (r.state === 'queued') Object.assign(r, before); throw e; }
    if (r.state === 'queued') { this.publish(r); this.enqueue(r); }
  }
  async remove(ids) {
    await this.ready;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) fail('invalid_argument', '请提供任务 ID 列表。');
    const rows = [];
    for (const id of new Set(ids)) {
      const r = this.records.get(id);
      if (r && terminal(r.state)) { this.records.delete(id); rows.push(r); }
    }
    if (rows.length) {
      try { await this.save(); }
      catch (e) { for (const r of rows) this.records.set(r.taskId, r); throw e; }
    }
    return { removed: rows.map(r => r.taskId) };
  }
  async close() {
    this.stopping = true; await this.ready;
    this.queue.clear();
    for (const r of this.records.values()) if (r.state === 'queued') {
      r.state = 'canceled'; r.cancelable = false; this.publish(r);
    }
    for (const [id, live] of this.live) if (this.records.get(id)?.cancelable) live.controller.abort();
    await Promise.all([...this.live.values()].map(l => l.promise)); await this.settingsWrites; await this.save();
  }
}
