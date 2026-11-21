import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { desktop, errorText } from '../api/bridge';
import { TabsStore, initialState, START_URL } from './dsh/store';
import { readPersisted, createTabPersist } from './dsh/persist';
import { normalizeAddress, normalizeLinkAddress, tryParseHttp } from './dsh/url';
import { trail, toModCreators, type CreatorPage } from './trail';
import type { ModCreator } from '../types';

export interface BrowserDownload {
  id: string; name: string; path: string; url: string; pageUrl: string; pageTitle: string | null;
  state: 'downloading' | 'paused' | 'waiting' | 'done' | 'failed' | 'interrupted' | 'canceled'; cleaned?: boolean; size?: number;
  controllable?: boolean;
  /** 由 WebView2 报告；继续时由网站和 WebView2 决定是否从已有字节续传。 */
  canResume?: boolean;
  /** WebView2 约每 200ms 报告已收字节；总量未知为 null。旧历史记录可省略。 */
  received?: number; total?: number | null;
  startedAt?: string; finishedAt?: string;
  /** 发起下载的标签页 webview（browser-<标签 id>），用来查来源链 */
  view?: string;
  creators?: ModCreator[];
}
export type WebDownloadAction = 'pause' | 'resume' | 'cancel';
/** 卡片里直接给 Steam 创意工坊 / B站视频点赞的结果。login = 内置浏览器里那个网站没登录 */
export interface SteamVoteResult { status: 'voted' | 'already' | 'login' | 'failed'; message?: string }
export const tabs = new TabsStore(() => 10);
const persist = createTabPersist();
tabs.subscribe(() => persist.save(tabs.getSnapshot()));
window.addEventListener('pagehide', () => persist.flush());
let queue: Promise<unknown> = Promise.resolve();

class Browser {
  error = $state('');
  downloads = $state<BrowserDownload[]>([]);
  loading = $state<Record<string, boolean>>({});
  downloadsOpen = $state(false);
  initialized = false;
  bookmarks = $state<{ url: string; title: string }[]>(readBookmarks());
  // Drafts live only in this session. Native sync and persisted history still see a start tab.
  linkDrafts = $state<Record<string, { text: string; error?: string; onOpen: (url: string) => void }>>({});

  constructor() {
    tabs.subscribe(() => {
      const live = tabs.getSnapshot().tabs;
      for (const id of Object.keys(this.linkDrafts)) {
        if (!live.some(t => t.id === id && t.url === START_URL)) delete this.linkDrafts[id];
      }
    });
  }

  call<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!desktop) return Promise.reject(new Error('请在 Matcha 桌面版中打开内置浏览器。'));
    const run = queue.then(() => invoke<T>('browser_call', { action, params }));
    queue = run.catch(e => { this.error = errorText(e); });
    return run;
  }
  controlDownload(id: string, action: WebDownloadAction) {
    return invoke('browser_call', { action: `download-${action}`, params: { id } });
  }
  /** 用内置浏览器里 Steam 页面的登录给工坊条目点赞，Cookie 留在 WebView 里。
   *  要加载一次 Steam 页面，可能要几秒，所以不排进标签页队列，失败也不写到浏览器页的报错里。 */
  steamVote(workshopId: string): Promise<SteamVoteResult> {
    if (!desktop) return Promise.reject(new Error('请在 Matcha 桌面版中点赞。'));
    return invoke<SteamVoteResult>('browser_call', { action: 'steam-vote', params: { workshopId } });
  }
  /** 同上，给 B站视频点赞：只点赞，不投币、不收藏。见 docs/creator-source-handoff.md */
  biliLike(bvid: string): Promise<SteamVoteResult> {
    if (!desktop) return Promise.reject(new Error('请在 Matcha 桌面版中点赞。'));
    return invoke<SteamVoteResult>('browser_call', { action: 'bili-like', params: { bvid } });
  }
  private annotationsSupported = true;
  private async saveCreators(row: BrowserDownload) {
    if (row.creators?.length || !this.annotationsSupported) return;
    const creators = toModCreators(trail.creatorsOf(row));
    if (!creators.length) return;
    try {
      const saved = await invoke<{ creators: ModCreator[] }>('browser_call', { action: 'annotate', params: { id: row.id, creators } });
      const current = this.downloads.find(d => d.id === row.id);
      if (current && saved.creators.length) current.creators = saved.creators;
    } catch (e) {
      if (/浏览器操作无效/.test(errorText(e))) this.annotationsSupported = false;
      else this.error = '作者页暂未写入下载记录：' + errorText(e);
    }
  }
  async init() {
    if (this.initialized || !desktop) return;
    this.initialized = true;
    await listen<any>('browser-event', ({ payload: e }) => {
      const tab = tabs.getSnapshot().tabs.find(t => t.id === e.id);
      if (e.type === 'page' && tab && tab.url !== START_URL && tryParseHttp(e.url)) {
        tabs.observe(e.id, e.url); this.loading[e.id] = e.loading; trail.visit(e.id, e.url);
      } else if (e.type === 'title' && tab && tab.url !== START_URL) { tabs.observe(e.id, tab.url, e.title); trail.title(e.id, tab.url, e.title); }
      // 网页里点开的新窗口记下是从哪个标签来的；Steam 加速标签跳出 Steam 时没带 from，就算当前标签
      else if (e.type === 'open') this.open(e.url, e.from ?? tabs.activeTab()?.id);
      else if (e.type === 'error') this.error = e.message;
      else if (e.type === 'download') {
        const row = e.download as BrowserDownload;
        const index = this.downloads.findIndex(d => d.id === row.id);
        // Keep simultaneous transfers in place instead of reordering on every progress event.
        if (index < 0) { trail.capture(row); this.downloads = [row, ...this.downloads]; void this.saveCreators(row); }
        else this.downloads[index] = row;
      }
    });
    const saved = await this.call<BrowserDownload[]>('downloads');
    const current = new Set(this.downloads.map(d => d.id));
    this.downloads = [...this.downloads, ...saved.filter(d => !current.has(d.id))];
    // Backfill sources still in this player's existing browser history, without consulting today's tabs.
    for (const row of saved) if (!current.has(row.id)) await this.saveCreators(row);
  }
  workspace(root: string) {
    root = root || 'global';
    if (tabs.getSnapshot().root === root) return;
    persist.flush();
    const saved = readPersisted(root);
    tabs.set(saved ? { root, ...saved, tabs: saved.tabs.map(t => ({ ...t, nonce: 0 })) } : initialState(root));
  }
  /** from：从哪个标签页（id）或哪个作者页打开的，来源链接着往下记 */
  open(url: string, from?: string | CreatorPage) {
    const parsed = normalizeAddress(url);
    if (!parsed) { this.error = '请输入网页地址或搜索词。'; return; }
    this.error = ''; this.downloadsOpen = false;
    tabs.openTab(parsed);
    const id = tabs.activeTab()?.id;
    if (id && from) trail.opened(id, from);
  }
  editAddress(raw: string, from: CreatorPage | undefined, onOpen: (url: string) => void) {
    this.error = ''; this.downloadsOpen = false;
    // A fresh tab has no native page (or in-flight download) to navigate away from.
    tabs.newTab();
    const id = tabs.activeTab()!.id;
    this.linkDrafts[id] = { text: raw.replace(/[\r\n]+/g, ' '), onOpen };
    if (from) trail.opened(id, from);
  }
  openEditedAddress() {
    const tab = tabs.activeTab(), edit = tab && this.linkDrafts[tab.id];
    if (!tab || !edit) return;
    const url = normalizeLinkAddress(edit.text);
    if (!url) { edit.error = '请只保留一个网址，例如 pan.quark.cn/s/…'; return; }
    this.error = '';
    edit.onOpen(url);
    tabs.navigate(tab.id, url); // The same native sync that opens a fresh web tab loads this once.
  }
  async navigate(input: string) {
    const url = normalizeAddress(input), tab = tabs.activeTab();
    if (!url || !tab) { this.error = '请输入 HTTP / HTTPS 地址或搜索词。'; return; }
    this.error = ''; this.downloadsOpen = false;
    trail.restart(tab.id);
    tabs.navigate(tab.id, url);
    await this.call('navigate', { id: tab.id, url });
  }
  async home() {
    const tab = tabs.activeTab(); if (!tab) return;
    if (this.linkDrafts[tab.id]) delete this.linkDrafts[tab.id];
    else await this.call('close', { id: tab.id });
    trail.restart(tab.id);
    tabs.navigate(tab.id, START_URL); this.error = ''; this.downloadsOpen = false;
  }
  async action(action: 'back' | 'forward' | 'reload' | 'stop') {
    this.error = '';
    await this.call(action, { id: tabs.activeTab()?.id });
    if (action === 'stop' && tabs.activeTab()) this.loading[tabs.activeTab()!.id] = false;
  }
  bookmark() {
    const tab = tabs.activeTab(); if (!tab || tab.url === START_URL) return;
    this.bookmarks = this.bookmarks.some(b => b.url === tab.url)
      ? this.bookmarks.filter(b => b.url !== tab.url)
      : [...this.bookmarks, { url: tab.url, title: tab.label }];
    try { localStorage.setItem('flare.browser.bookmarks', JSON.stringify(this.bookmarks)); }
    catch { this.error = '收藏已保留在本次会话，磁盘存储空间需要检查。'; }
  }
}
function readBookmarks(): { url: string; title: string }[] {
  try { return JSON.parse(localStorage.getItem('flare.browser.bookmarks') || '[]').filter((b: any) => typeof b.title === 'string' && typeof b.url === 'string' && tryParseHttp(b.url)); }
  catch { return []; }
}
export const browser = new Browser();
