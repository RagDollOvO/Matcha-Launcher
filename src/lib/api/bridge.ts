import { isTauri, invoke } from '@tauri-apps/api/core';

export interface BridgeEvent { type: string; [key: string]: any }
type Envelope<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string; details?: unknown } };
const listeners = new Set<(event: BridgeEvent) => void>();
let token: Promise<string> | undefined;
let events: Promise<void> | undefined;
const emit = (event: BridgeEvent) => listeners.forEach(fn => fn(event));

export const desktop = isTauri();
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '操作失败，请刷新状态后重试。';
}
export async function call<T>(command: string, params: Record<string, unknown> = {}, approved = false): Promise<T> {
  const confirmation = approved ? { approved: true, source: 'user' } : undefined;
  let reply: Envelope<T>;
  if (desktop) reply = await invoke('beacon_call', { command, params, confirmation });
  else {
    token ??= fetch('/__beacon/session').then(async r => {
      if (!r.ok) throw new Error('本地桥接未连接，请通过 npm run dev 打开 Matcha。');
      return (await r.json()).token as string;
    }).catch(e => { token = undefined; throw e; });
    const r = await fetch('/__beacon/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Beacon-Token': await token }, body: JSON.stringify({ command, params, confirmation }) });
    if (!r.ok) { token = undefined; throw new Error('本地桥接连接已更新，请刷新页面后重试。'); }
    reply = await r.json();
  }
  if (!reply.ok) throw Object.assign(new Error(`${reply.error.message} [${reply.error.code}]`), { code: reply.error.code, details: reply.error.details });
  return reply.result;
}
export function onBridgeEvent(listener: (event: BridgeEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function connectEvents(): Promise<void> {
  events ??= (async () => {
    if (desktop) {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<BridgeEvent>('beacon-event', e => emit(e.payload));
    } else {
      await new Promise<void>((resolve, reject) => {
        const source = new EventSource('/__beacon/events');
        const timer = setTimeout(() => { source.close(); reject(new Error('连接本地事件流超时。')); }, 5000);
        source.onopen = () => { clearTimeout(timer); resolve(); };
        source.onmessage = e => { try { emit(JSON.parse(e.data)); } catch { emit({ type: 'bridge_fault', error: { message: '事件流格式错误。' } }); } };
        source.onerror = () => emit({ type: 'bridge_fault', error: { message: '本地事件流已断开，正在重连。' } });
        window.addEventListener('beforeunload', () => source.close(), { once: true });
      });
    }
  })().catch(e => { events = undefined; throw e; });
  return events;
}
export async function pickDirectory(title: string): Promise<string | null> {
  if (!desktop) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  return await open({ title, directory: true, multiple: false }) as string | null;
}
export async function pickVpk(): Promise<string | null> {
  if (!desktop) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  return await open({ title: '导入 VPK Mod（分卷包请选择 _dir.vpk）', multiple: false, filters: [{ name: 'Source VPK', extensions: ['vpk'] }] }) as string | null;
}
export async function pickDll(): Promise<string | null> {
  if (!desktop) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  return await open({ title: '选择本地 x86 DLL', multiple: false, filters: [{ name: 'Windows DLL', extensions: ['dll'] }] }) as string | null;
}
/** 本地 DLL 来源：标准 SDK 压缩包，或单个 DLL（交给 Agent 整理） */
export async function pickDllPackage(): Promise<string | null> {
  if (!desktop) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  return await open({ title: '选择 Matcha SDK 压缩包或 DLL', multiple: false, filters: [
    { name: 'SDK 压缩包或 DLL', extensions: ['zip', 'dll'] }, { name: 'SDK 压缩包', extensions: ['zip'] }, { name: 'Windows DLL', extensions: ['dll'] },
  ] }) as string | null;
}
export type FileDrop = { type: 'enter' | 'drop'; paths: string[] } | { type: 'over' | 'leave' };
/** Dispatch only to the surface under the pointer, including in split view. */
export async function onFileDrop(handler: (event: FileDrop) => void, target?: () => Element | null | undefined): Promise<() => void> {
  if (!desktop) return () => {};
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'leave') return handler({ type: 'leave' });
    const hit = document.elementFromPoint(payload.position.x / window.devicePixelRatio, payload.position.y / window.devicePixelRatio);
    if (target && (!hit || !target()?.contains(hit))) return handler({ type: 'leave' });
    if (payload.type === 'over') handler({ type: 'over' });
    else handler({ type: payload.type, paths: payload.paths });
  });
}
export async function windowAction(action: 'minimize' | 'maximize' | 'close') {
  if (!desktop) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  if (action === 'maximize') await win.toggleMaximize();
  else await win[action]();
}
/** 游戏退出后把最小化的主窗口叫回前台（需要壳放行 unminimize；没放行时退而求其次 show + focus） */
export async function restoreWindow() {
  if (!desktop) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  try { await win.unminimize(); } catch { try { await win.show(); } catch { /* 壳没放行 */ } }
  try { await win.setFocus(); } catch { /* 壳没放行 */ }
}
