// 助手独立窗口：在启动器主窗口的右边贴着弹出一个真正的系统窗口（Tauri WebviewWindow，标签 "agent"）。
// - 主窗口负责建窗口、贴边跟随（主窗口移动 / 改大小时一起挪）、显示 / 隐藏；收起只是隐藏，聊天不丢。
// - 两个窗口之间用 Tauri 事件互发消息：主窗口 →「交给 Agent」的指令、当前页面；助手窗口 → 跳页面、开链接、打开设置、弹提示。
// - 不在桌面壳里（5173 浏览器预览），或建窗口失败（壳还没放行权限）时，退回到主窗口里的分栏面板。
// 壳那边要配合的权限见 docs/agent-window-handoff.md。
import { desktop } from '../api/bridge';
import { invoke } from '@tauri-apps/api/core';
import { prefs } from '../stores/prefs.svelte';

export const AGENT_LABEL = 'agent';

/** 当前这个页面是不是助手窗口（index.html?view=agent） */
export const isAgentView = typeof location !== 'undefined' && new URLSearchParams(location.search).get('view') === 'agent';

/** 主窗口 → 助手窗口 */
export type ToAgent =
  | { type: 'send'; text: string }
  | { type: 'route'; route: string }
  | { type: 'focus' }
  | { type: 'sync' }
  | { type: 'ping' };
/** 助手窗口 → 主窗口 */
export type ToMain =
  | { type: 'ready' }
  | { type: 'hidden' }
  | { type: 'browse'; url: string }
  | { type: 'settings'; section: string }
  | { type: 'toast'; text: string }
  /** 首见卡片上点了「开始体检」：指令要读游戏设置，由主窗口拼好再发回来 */
  | { type: 'checkup' };

const TO_AGENT = 'matcha://to-agent';
const TO_MAIN = 'matcha://to-main';

/** window：用独立窗口；inline：在主窗口里分栏（浏览器预览、设置里关掉了独立窗口、或独立窗口开不起来时） */
export const agentWin = $state<{ mode: 'window' | 'inline' }>({ mode: desktop && !isAgentView && prefs.agentWindow ? 'window' : 'inline' });

/** 设置页「助手打开方式」：切到分栏时先把独立窗口收起来 */
export async function setAgentWindowPref(on: boolean) {
  prefs.agentWindow = on;
  if (!desktop || isAgentView) return;
  if (on) { agentWin.mode = 'window'; return; }
  await hideAgentWindow();
  agentWin.mode = 'inline';
}

// ---------------- 消息 ----------------

let ready = false;
let queue: ToAgent[] = [];

async function emitRaw(event: string, payload: unknown) {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(event === TO_AGENT ? AGENT_LABEL : 'main', event, payload);
}

/** 发给助手窗口；窗口还没准备好时先排队，ready 后按顺序补发（页面切换只留最新一条） */
export async function sendToAgent(msg: ToAgent) {
  if (!desktop) return;
  if (!ready) {
    if (msg.type === 'route') queue = queue.filter((m) => m.type !== 'route');
    queue.push(msg);
    return;
  }
  await emitRaw(TO_AGENT, msg);
}

export async function sendToMain(msg: ToMain) {
  if (!desktop) return;
  await emitRaw(TO_MAIN, msg);
}

export async function onAgentMessage(fn: (m: ToAgent) => void): Promise<() => void> {
  if (!desktop) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<ToAgent>(TO_AGENT, (e) => fn(e.payload), { target: AGENT_LABEL });
}

/** 主窗口监听助手窗口的消息；ready 由这里处理，其余交给 fn */
export async function onMainMessage(fn: (m: ToMain) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<ToMain>(TO_MAIN, (e) => {
    const m = e.payload;
    if (m.type === 'ready') {
      ready = true;
      const pending = queue;
      queue = [];
      for (const q of pending) void emitRaw(TO_AGENT, q);
      return;
    }
    fn(m);
  }, { target: 'main' });
}

// ---------------- 主窗口：建窗口、贴边、显示隐藏 ----------------

type WebviewWindow = import('@tauri-apps/api/webviewWindow').WebviewWindow;
let win: WebviewWindow | null = null;
let creating: Promise<WebviewWindow> | undefined;
let revision = 0;

async function ensureWindow(): Promise<WebviewWindow> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel(AGENT_LABEL);
  if (existing) {
    // 主窗口刷新过页面，助手窗口还活着：问它一声，让它重新报 ready
    if (!ready) void emitRaw(TO_AGENT, { type: 'ping' } satisfies ToAgent);
    return existing;
  }
  ready = false;
  const w = new WebviewWindow(AGENT_LABEL, {
    url: 'index.html?view=agent',
    title: '茶茶 · Matcha',
    width: 420,
    height: 760,
    minWidth: 340,
    minHeight: 360,
    maxWidth: 560,
    maximizable: false,
    decorations: false,
    resizable: true,
    visible: false,
    focus: true,
    skipTaskbar: true,
    // 归主窗口所有：主窗口最小化时一起收起，始终在主窗口上面
    parent: 'main',
  });
  await new Promise<void>((resolve, reject) => {
    void w.once('tauri://created', () => resolve());
    void w.once<string>('tauri://error', (e) => reject(new Error(String(e.payload))));
  });
  void w.once('tauri://destroyed', () => { win = null; ready = false; });
  return w;
}

/** 定位由桌面壳串行处理；异步创建中的再次开关以最后一次操作为准。 */
export async function showAgentWindow(): Promise<boolean> {
  const request = ++revision;
  const resuming = !!win;
  try {
    const w = await (creating ??= ensureWindow().finally(() => { creating = undefined; }));
    win = w;
    if (request !== revision) return false;
    await invoke('dock_agent_window');
    if (request !== revision) return false;
    await w.show();
    if (request === revision) {
      await w.setFocus();
      if (resuming) void sendToAgent({ type: 'sync' });
    }
    return true;
  } catch (e) {
    if (request !== revision) return false;
    console.warn('助手独立窗口打开失败，改用分栏', e);
    try { await win?.hide(); } catch { /* 创建失败时没有窗口 */ }
    agentWin.mode = 'inline';
    return false;
  }
}

export async function hideAgentWindow() {
  ++revision;
  try { await win?.hide(); } catch { /* 窗口已经关闭 */ }
}

// ---------------- 助手窗口自己 ----------------

export async function hideSelf() {
  if (!desktop) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}
