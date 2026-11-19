// 主窗口在后台（失焦或最小化）时，把下载完成 / 失败合成一条 Windows 系统通知。
// 带 extra.route = 'downloads'：点屏幕上的弹窗，Rust 唤起主窗口并发 open_downloads，主界面切到下载页。
// 弹窗进了通知中心后 Windows 不再回传点击，那时只是普通通知。窗口在前台时只用应用内提示条。
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { desktop } from '../api/bridge';
import { prefs } from './prefs.svelte';

/** web：内置浏览器里的网页下载，下好后还要到下载页导入 */
export interface NotifyItem { ok: boolean; name: string; web?: boolean }

/** 一批陆续结束的任务等这么久再合并发送 */
const MERGE_MS = 1500;
let focused = true;
let buffer: NotifyItem[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let granted = false;

if (desktop) {
  const win = getCurrentWindow();
  void win.isFocused().then((v) => { focused = v; }).catch(() => {});
  // 回到前台前还没发出去的，应用内提示条已经说过了，丢掉
  void win.onFocusChanged(({ payload }) => { focused = payload; if (payload) { buffer = []; clearTimeout(timer); } }).catch(() => {});
}

async function away() {
  if (!focused) return true;
  try { return await getCurrentWindow().isMinimized(); } catch { return false; }
}

async function allowed() {
  if (granted) return true;
  try { granted = await isPermissionGranted() || await requestPermission() === 'granted'; } catch { granted = false; }
  return granted;
}

const names = (xs: NotifyItem[]) => {
  const head = xs.slice(0, 3).map((x) => `「${x.name}」`).join('');
  return xs.length > 3 ? `${head} 等 ${xs.length} 个` : head;
};

function compose(items: NotifyItem[]) {
  const ok = items.filter((x) => x.ok), bad = items.filter((x) => !x.ok);
  const landed = !ok.some((x) => x.web) ? '已放进「新下载」' : ok.every((x) => x.web) ? '已下载好，回到下载页导入' : '已下载好';
  if (items.length === 1) return ok.length ? { title: '下载完成', body: `${names(ok)}${landed}` } : { title: '下载失败', body: `${names(bad)}没有下载成功，点这里回到下载页查看` };
  if (!bad.length) return { title: `${ok.length} 个下载完成`, body: `${names(ok)}${landed}` };
  if (!ok.length) return { title: `${bad.length} 个下载失败`, body: `${names(bad)}没有下载成功，点这里回到下载页查看` };
  return { title: `${ok.length} 个下载完成，${bad.length} 个失败`, body: `失败：${names(bad)}\n完成：${names(ok)}` };
}

async function flush() {
  const items = buffer;
  buffer = [];
  if (!items.length || !await away() || !await allowed()) return;
  try { sendNotification({ ...compose(items), extra: { route: 'downloads' } }); }
  catch (e) { console.warn('系统通知发送失败', e); }
}

/** 下载结束时调用；窗口在前台、桌面版以外、或用户关掉了这一项时什么都不做 */
export function systemNotify(item: NotifyItem) {
  if (!desktop || !prefs.systemNotify) return;
  buffer.push(item);
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), MERGE_MS);
}

/** 设置页「发一条试试」：不管窗口在不在前台都发 */
export async function testNotify(): Promise<boolean> {
  if (!desktop || !await allowed()) return false;
  sendNotification({ title: 'Matcha 下载通知', body: '点这条通知会回到下载页。进了通知中心后再点就只是普通通知。', extra: { route: 'downloads' } });
  return true;
}
