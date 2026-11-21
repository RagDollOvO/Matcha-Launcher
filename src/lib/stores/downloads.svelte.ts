// 下载页与侧栏共用的下载状态：创意工坊下载 / 解包任务 + 内置浏览器下载的文件。
// 两种「拿掉」：
//   收进历史（archived）：从「当前」里拿走，「历史」里还在——下载页上的「×」和「全部收进历史」，只在本机记；
//   删除记录：只在「历史」里做。Mod 任务走后端 task-remove（文件和 Mod 都留着）；网页下载和旧后端只在本机隐藏（hidden）。
import { SvelteSet } from 'svelte/reactivity';
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window';
import { app } from './app.svelte';
import { browser, type BrowserDownload, type WebDownloadAction } from '../browser/browser.svelte';
import { sfx } from '../sound/sfx.svelte';
import { transfer, span } from './transfer.svelte';
import { desktop, errorText } from '../api/bridge';
import { api, type DownloadSettings } from '../api';
import { support } from './support.svelte';
import { systemNotify } from './system-notify';
import type { ModTask } from '../types';

const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 只在本次会话有效 */ } };

/** 「当前」只放最近 7 天结束的，更早的只在「历史」里 */
export const RECENT_MS = 7 * 86_400_000;
export const ended = (t: ModTask) => t.state === 'done' || t.state === 'failed' || t.state === 'canceled';
const rank = (t: ModTask) => (t.state === 'running' || t.state === 'verifying' ? 0 : t.state === 'queued' ? 1 : t.state === 'paused' ? 2 : 3);
/** 结束时间：本次尝试结束时固定；旧记录没有就用 updatedAt */
export const endAt = (t: ModTask) => t.finishedAt ?? t.updatedAt;
/** 网页下载的时间：结束时间，没有就用开始时间；旧记录两个都没有时为 null */
export const webAt = (d: BrowserDownload) => d.finishedAt ?? d.startedAt ?? null;
/** 后端还没有这个命令（旧版本地服务） */
const missing = (e: unknown) => ['unsupported_capability', 'unknown_command'].includes((e as { code?: string })?.code ?? '');

export const size = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GiB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MiB` : `${Math.max(0, Math.round(b / 1024))} KiB`);
const amount = (t: ModTask, n: number) => (t.unit === 'files' ? `${n}` : size(n));
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** 0..1；总量未知时为 null */
export const ratio = (t: ModTask) => (t.total ? Math.min(1, t.done / t.total) : null);

export function progressText(t: ModTask) {
  if (t.total === null) return t.done ? `已处理 ${amount(t, t.done)}${t.unit === 'files' ? ' 个文件' : ''}` : '';
  return `${amount(t, t.done)} / ${amount(t, t.total)}${t.unit === 'files' ? ' 个文件' : ''}`;
}

/** 正在传字节的下载（速度和剩余时间只算这些） */
export const streaming = (t: ModTask) => t.kind === 'download' && t.state === 'running' && t.unit === 'bytes';

/** 所有任务共用队列；继续和重试回到队尾。 */
const queuePosition = (t: ModTask) => app.tasks.filter((x) => x.state === 'queued').findIndex((x) => x.taskId === t.taskId) + 1;

/** 完成的下载：大小 · 用时 · 平均速度（后端最后一次的平均速度就是整段下载的平均） */
function doneStats(t: ModTask) {
  const bytes = t.unit === 'bytes' ? t.total ?? t.done : 0, bps = t.bytesPerSecond ?? 0;
  return [bytes ? size(bytes) : '', bytes && bps ? `用时 ${span(bytes / bps)}` : '', bps ? `平均 ${size(bps)}/s` : ''].filter(Boolean);
}

export function taskLine(t: ModTask): string {
  const other = t.gameRoot && app.game?.root && t.gameRoot.toLowerCase() !== app.game.root.toLowerCase() ? ' · 其他游戏目录' : '';
  switch (t.state) {
    case 'queued': { const n = queuePosition(t); return `排队中${n ? ` · 第 ${n} 位` : ''}${other}`; }
    case 'running': {
      const p = progressText(t);
      return `${t.kind === 'download' ? (t.done ? '下载中' : '连接中') : t.kind === 'pack' ? '打包中' : '解包中'}${p ? ` · ${p}` : ''}${other}`;
    }
    case 'verifying': return `校验中${progressText(t) ? ` · ${progressText(t)}` : ''}${other}`;
    case 'paused': {
      // 本版不续传：已经传了一部分的，继续时从头再来
      const redo = !t.resumable && t.done > 0 ? (t.kind === 'extract' ? '继续会重新解包' : '继续会重新下载') : '';
      return ['已暂停', progressText(t), redo].filter(Boolean).join(' · ') + other;
    }
    case 'done': return t.kind === 'pack' ? (t.output ? `已打包到桌面 · ${t.fileCount} 个资源` : t.warning || `已打包并导入 · ${t.fileCount} 个资源`) + other
      : t.kind === 'download' ? ['已下载', ...doneStats(t)].join(' · ') + other : `已解包到「${t.dir ? baseName(t.dir) : '桌面'}」${t.fileCount ? ` · ${t.fileCount} 个文件` : ''}${other}`;
    case 'failed': return `失败：${t.error?.message ?? '未知错误'}`;
    case 'canceled': return '已取消';
  }
}

const webPending = (state: BrowserDownload['state'] | undefined) => state === 'downloading' || state === 'paused' || state === 'waiting';
export const webEnded = (d: BrowserDownload) => !webPending(d.state);
/** 网页下载有字节进度；兼容没有字节数的旧下载记录 */
export const webSized = (d: BrowserDownload) => d.state === 'downloading' && d.received !== undefined;

class Downloads {
  hidden = new SvelteSet<string>(read<string[]>('flare.tasks.hidden', []));
  hiddenWeb = new SvelteSet<string>(read<string[]>('flare.downloads.web-hidden', []));
  archived = new SvelteSet<string>(read<string[]>('flare.tasks.archived', []));
  archivedWeb = new SvelteSet<string>(read<string[]>('flare.downloads.web-archived', []));
  /** 每完成一项 +1；侧栏按它播放「收到」动效 */
  pulse = $state(0);
  /** 没进下载页看过的已完成数量 */
  unseen = $state(0);
  /** 刚完成的任务 id：下载页给它们播一次勾选动画 */
  fresh = new SvelteSet<string>();

  /** 只管 Mod 的下载和解包；外部平台任务在插件页显示 */
  tasks = $derived(app.tasks.filter((t) => ['download', 'extract', 'pack'].includes(t.kind) && !this.hidden.has(t.taskId))
    .sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt)));
  active = $derived(this.tasks.filter((t) => !ended(t)));
  /** 排队、运行、校验中的；暂停的不占名额，也不算进速度、进度和角标 */
  live = $derived(this.active.filter((t) => t.state !== 'paused'));
  paused = $derived(this.active.filter((t) => t.state === 'paused'));
  /** 可以暂停的（工坊、GameMaps 下载和解包在排队或运行时） */
  pausable = $derived(this.active.filter((t) => t.pausable && t.state !== 'paused'));
  finished = $derived(this.tasks.filter(ended));
  web = $derived(browser.downloads.filter((d) => !this.hiddenWeb.has(d.id)));
  webActive = $derived(this.web.filter((d) => !webEnded(d)));
  webLive = $derived(this.webActive.filter((d) => d.state === 'downloading'));
  webPaused = $derived(this.webActive.filter((d) => d.state === 'paused'));
  webPausable = $derived(this.webLive.filter((d) => d.controllable));
  webResumable = $derived(this.webActive.filter((d) => d.controllable && d.canResume));
  webCancelable = $derived(this.webActive.filter((d) => d.controllable));
  webCommands = new SvelteSet<string>();
  /** 「当前」里显示的：最近 7 天结束、没收进历史的；旧网页记录没有时间，没收进历史的都算 */
  recent = $derived(this.finished.filter((t) => !this.archived.has(t.taskId) && Date.now() - Date.parse(endAt(t)) < RECENT_MS));
  webRecent = $derived(this.web.filter((d) => {
    if (!webEnded(d) || this.archivedWeb.has(d.id)) return false;
    const at = webAt(d);
    return !at || Date.now() - Date.parse(at) < RECENT_MS;
  }));
  /** 历史：所有结束的记录（删除记录的除外） */
  historyCount = $derived(this.finished.length + this.web.filter(webEnded).length);
  /** 侧栏角标：进行中的总数（暂停的不算） */
  busy = $derived(this.live.length + this.webLive.length);
  /** 总进度：全是字节就按字节加权（大文件不被小文件拉偏）；混了解包的文件数就取各自比例的平均 */
  overall = $derived.by(() => {
    const sized = [
      ...this.live.filter((t) => t.total).map(t => ({ done: t.done, total: t.total!, unit: t.unit })),
      ...this.webLive.filter(d => d.total && d.received !== undefined).map(d => ({ done: d.received!, total: d.total!, unit: 'bytes' })),
    ];
    if (!sized.length) return null;
    if (sized.every((t) => t.unit === 'bytes')) return Math.min(1, sized.reduce((n, t) => n + t.done, 0) / sized.reduce((n, t) => n + t.total, 0));
    return sized.reduce((n, t) => n + Math.min(1, t.done / t.total), 0) / sized.length;
  });

  /** 有下载没结束就一直测速（含排队和校验）：一个下完、下一个刚开始的空档里曲线不断开 */
  measuring = $derived(this.live.some((t) => t.kind === 'download') || this.webLive.some(webSized));
  /** 正在传字节的下载 id：创意工坊 / GameMaps 任务 + 有进度的网页下载 */
  streams = $derived([...this.active.filter(streaming).map((t) => t.taskId), ...this.webLive.filter(webSized).map((d) => d.id)]);
  /** 实时总速度（字节/秒）；还没结算出来时为 0 */
  speed = $derived(this.streams.reduce((n, id) => n + (transfer.rates[id]?.speed ?? 0), 0));
  /** 传输中的已下 / 总量；有任何一项总量未知就是 null */
  received = $derived.by(() => {
    let done = 0, total: number | null = 0;
    for (const t of this.active) if (streaming(t)) { done += t.done; total = total !== null && t.total ? total + t.total : null; }
    for (const d of this.webLive) if (webSized(d)) { done += d.received!; total = total !== null && d.total ? total + d.total : null; }
    return { done, total };
  });
  /** 正在传的这批全部下完还要多久：取最慢的那个（宁可说久一点）；任何一个估不出来就不估。排队的不算在内 */
  eta = $derived.by(() => {
    let most = 0;
    for (const id of this.streams) { const e = transfer.rates[id]?.eta; if (e == null) return null; most = Math.max(most, e); }
    return this.streams.length ? most : null;
  });
  /** 排队中的下载数（大小未知，不在剩余时间里） */
  waiting = $derived(this.active.filter((t) => t.kind === 'download' && t.state === 'queued').length);

  /** 并发和限速（后端 download-settings-*）；没读到时为 null，旧后端时 limitsMissing */
  limits = $state<DownloadSettings | null>(null);
  limitsMissing = $state(false);
  limitsError = $state('');

  constructor() {
    $effect.root(() => {
      // One writer for taskbar progress, alive on every page. Serialize updates
      // so an older percentage can never arrive after the final clear.
      let taskbarKey = '';
      let taskbarWrites = Promise.resolve();
      $effect(() => {
        if (!desktop) return;
        const status = !this.busy ? ProgressBarStatus.None :
          this.overall === null ? ProgressBarStatus.Indeterminate : ProgressBarStatus.Normal;
        const progress = status === ProgressBarStatus.Normal ? Math.floor(this.overall! * 100) : undefined;
        const key = `${status}:${progress}`;
        if (key === taskbarKey) return;
        taskbarKey = key;
        taskbarWrites = taskbarWrites.then(() => getCurrentWindow().setProgressBar({ status, progress }))
          .catch(e => console.warn('任务栏下载进度更新失败', e));
      });
      // 每条进度都喂给测速；结算每秒一次
      $effect(() => {
        for (const t of app.tasks) if (streaming(t)) transfer.feed({ id: t.taskId, done: t.done, total: t.total, at: Date.parse(t.updatedAt) || Date.now(), fallback: t.bytesPerSecond });
        for (const d of browser.downloads) if (webSized(d)) transfer.feed({ id: d.id, done: d.received!, total: d.total ?? null, at: Date.now() });
      });
      $effect(() => {
        if (!this.measuring) return;
        const timer = setInterval(() => transfer.tick(new Set(this.streams)), 1000);
        return () => { clearInterval(timer); transfer.reset(); };
      });
      $effect(() => write('flare.tasks.hidden', [...this.hidden]));
      $effect(() => write('flare.downloads.web-hidden', [...this.hiddenWeb]));
      $effect(() => write('flare.tasks.archived', [...this.archived]));
      $effect(() => write('flare.downloads.web-archived', [...this.archivedWeb]));
      // 记录已不存在的隐藏 / 收起 id 顺手清掉
      $effect(() => {
        if (!app.tasks.length) return;
        const alive = new Set(app.tasks.map((t) => t.taskId));
        for (const set of [this.hidden, this.archived]) for (const id of [...set]) if (!alive.has(id)) set.delete(id);
      });
      $effect(() => {
        if (!browser.downloads.length) return;
        const alive = new Set(browser.downloads.map((d) => d.id));
        for (const id of [...this.archivedWeb]) if (!alive.has(id)) this.archivedWeb.delete(id);
      });
      // 状态跳变 → 动效 / 提示音
      const taskStates = new Map<string, ModTask['state']>();
      $effect(() => {
        for (const t of app.tasks) {
          if (!['download', 'extract', 'pack'].includes(t.kind)) continue;
          const prev = taskStates.get(t.taskId);
          taskStates.set(t.taskId, t.state);
          if (prev && !ended({ state: prev } as ModTask) && t.state === 'done') { this.arrive(t.taskId); support.task(t); }
        }
      });
      const webStates = new Map<string, BrowserDownload['state']>();
      // 启动时读到的历史下载不提示；之后的新下载才出声
      let primed = false;
      setTimeout(() => (primed = true), 3000);
      $effect(() => {
        for (const d of browser.downloads) {
          const prev = webStates.get(d.id);
          webStates.set(d.id, d.state);
          if (!primed) continue;
          if (!prev && d.state === 'downloading') sfx.play('download');
          if (webPending(prev) && d.state === 'done') {
            this.arrive(d.id);
            sfx.play('done');
            support.web(d);
            systemNotify({ ok: true, name: d.name, web: true });
            const mod = /\.(vpk|zip)$/i.test(d.name);
            app.notify({ kind: 'ok', title: '网页下载完成', text: d.name, actions: mod ? [{ label: '去导入', run: () => (app.route = 'downloads') }] : [{ label: '打开文件夹', run: () => app.reveal(d.path) }], ms: 7000 });
          }
          if (webPending(prev) && (d.state === 'failed' || d.state === 'interrupted')) {
            sfx.play('error');
            systemNotify({ ok: false, name: d.name, web: true });
            app.notify({ kind: 'error', title: d.state === 'interrupted' ? '网页下载中断' : '网页下载失败', text: `${d.name} · 回到原网页重新下载`, actions: d.pageUrl ? [{ label: '打开原网页', run: () => { browser.open(d.pageUrl); app.route = 'browser'; } }] : [], ms: 8000 });
          }
        }
        primed = browser.downloads.length > 0 || primed;
      });
      // 进了下载页就算看过
      $effect(() => { if (app.route === 'downloads') this.unseen = 0; });
    });
  }

  private arrive(id: string) {
    this.pulse++;
    if (app.route !== 'downloads') this.unseen++;
    this.fresh.add(id);
    setTimeout(() => this.fresh.delete(id), 2400);
  }

  /** 依次提交，后端按顺序排队 */
  async retryFailed() {
    for (const t of this.finished.filter((x) => x.state === 'failed')) await app.retryTask(t.taskId);
  }

  /** 「全部收进历史」：结束的任务和未下完的网页记录离开「当前」；下好的网页文件还等着导入，留着 */
  clearEnded() {
    for (const t of this.recent) this.archived.add(t.taskId);
    for (const d of this.webRecent) if (d.state !== 'done') this.archivedWeb.add(d.id);
  }
  /** 删除任务记录：只在历史里用；已下载的文件、导入的 Mod、解包目录都不动。返回删掉的条数 */
  async forgetTasks(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    try {
      const removed = await app.removeTasks(ids);
      for (const id of removed) this.archived.delete(id);
      return removed.length;
    } catch (e) {
      if (!missing(e)) { app.notify({ kind: 'error', text: `删除记录失败：${errorText(e)}` }); return 0; }
      // 旧后端没有 task-remove：只在本机藏起来
      for (const id of ids) { this.hidden.add(id); this.archived.delete(id); }
      return ids.length;
    }
  }
  /** 网页下载的记录由内置浏览器管，这里只在本机藏起来；文件保留 */
  forgetWeb(ids: string[]) {
    for (const id of ids) { this.hiddenWeb.add(id); this.archivedWeb.delete(id); }
    return ids.length;
  }

  async controlWeb(d: BrowserDownload, action: WebDownloadAction) {
    const current = this.webActive.find((row) => row.id === d.id);
    if (!current?.controllable || this.webCommands.has(d.id)) return;
    if (action === 'pause' && current.state !== 'downloading') return;
    if (action === 'resume' && !current.canResume) return;
    this.webCommands.add(d.id);
    try { await browser.controlDownload(d.id, action); }
    catch (e) { app.notify({ kind: 'error', title: d.name, text: errorText(e) }); }
    finally { this.webCommands.delete(d.id); }
  }

  /** 全部暂停：先停排队的，再停正在跑的，免得刚停一个、后面排队的又顶上来开工 */
  async pauseAll() {
    const queued = this.pausable.filter((t) => t.state === 'queued'), rest = this.pausable.filter((t) => t.state !== 'queued');
    const web = this.webPausable;
    for (const t of [...queued, ...rest]) await app.pauseTask(t.taskId, true);
    for (const d of web) await this.controlWeb(d, 'pause');
  }
  /** 按原来的先后依次继续，回到队尾 */
  async resumeAll() {
    const web = [...this.webResumable].reverse();
    for (const t of [...this.paused].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) await app.resumeTask(t.taskId);
    for (const d of web) await this.controlWeb(d, 'resume');
  }

  async loadLimits() {
    try { this.limits = await api.downloadSettingsGet(); this.limitsMissing = false; this.limitsError = ''; }
    catch (e) { this.limitsMissing = missing(e); this.limitsError = this.limitsMissing ? '' : errorText(e); }
  }
  /** 可以只改一个字段；先显示新值，失败就退回原值 */
  async setLimits(patch: Partial<DownloadSettings>) {
    const prev = this.limits;
    if (prev) this.limits = { ...prev, ...patch };
    try { this.limits = await api.downloadSettingsSet(patch); }
    catch (e) { this.limits = prev; app.notify({ kind: 'error', text: `下载设置没有保存：${errorText(e)}` }); }
  }
}

export const downloads = new Downloads();
