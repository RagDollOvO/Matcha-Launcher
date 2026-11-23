import type { BrowserDownload } from './browser.svelte';
import { START_URL, type TabsState } from './dsh/store';
import { displayLabel, tryParseHttp } from './dsh/url';

const requestUrl = (url: string) => tryParseHttp(url)?.split('#', 1)[0];
type DownloadSource = Pick<BrowserDownload, 'url' | 'pageUrl' | 'pageTitle' | 'view'>;

/** A navigation that returned an attachment leaves the native view on its old page (or blank). */
export function settleDownloadTabs(state: TabsState, downloads: readonly DownloadSource[]): TabsState {
  let changed = false;
  const tabs = state.tabs.map(tab => {
    const current = requestUrl(tab.url);
    if (!current) return tab;
    const row = downloads.find(d => d.view === 'browser-' + tab.id &&
      requestUrl(d.url) === current && requestUrl(d.pageUrl) !== current);
    if (!row) return tab;

    changed = true;
    const page = tryParseHttp(row.pageUrl);
    if (!page) return { ...tab, url: START_URL, label: '', stack: [], index: -1 };
    const stack = tab.stack.filter(url => requestUrl(url) !== current);
    const index = stack.lastIndexOf(page);
    return { ...tab, url: page, label: row.pageTitle || displayLabel(page),
      stack: index === -1 ? [page] : stack, index: Math.max(0, index) };
  });
  return changed ? { ...state, tabs } : state;
}
