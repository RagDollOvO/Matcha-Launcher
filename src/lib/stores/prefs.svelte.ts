// 只存在本机的界面偏好（设置页的助手、下载、外观、启动器几节）。和后端无关的选项都放这里。
export const PREFS_KEY = 'flare.prefs';
const KEY = PREFS_KEY;

export interface Prefs {
  /** 运行中发送的消息：等这轮结束再发（followUp），还是插话打断（steer） */
  busySend: 'followUp' | 'steer';
  /** 思考过程：自动（进行中展开，结束后收起）/ 始终展开 / 始终收起 / 不显示 */
  thinking: 'auto' | 'expanded' | 'collapsed' | 'hidden';
  /** 一轮回复结束时的提示音 */
  replySound: boolean;
  /** 用第一句话给会话命名 */
  autoTitle: boolean;
  /** 输入框旁显示上下文用量 */
  showUsage: boolean;
  /** Enter 发送；关掉后 Ctrl+Enter 发送 */
  enterSends: boolean;
  /** 助手面板宽度 */
  panelWidth: number;
  /** 助手面板放大（占窗口约六成） */
  panelWide: boolean;
  /** 下载完成后提醒去给作者点赞 */
  likePrompt: boolean;
  /** 窗口在后台时，下载完成 / 失败发 Windows 系统通知 */
  systemNotify: boolean;
  /** 从 Matcha 启动游戏、检测到游戏进程后：保持窗口 / 最小化（游戏退出时回到前台） */
  afterLaunch: 'keep' | 'minimize';
  /** 桌面版助手用独立窗口；关掉后在主窗口里分栏 */
  agentWindow: boolean;
  /** 界面缩放（桌面版 WebView 缩放） */
  zoom: number;
  /** 减弱动效：关掉大部分过渡和动画；系统开了「减少动画」时总是生效 */
  reduceMotion: boolean;
}

const defaults: Prefs = { busySend: 'followUp', thinking: 'auto', replySound: true, autoTitle: true, showUsage: true, enterSends: true, panelWidth: 380, panelWide: false, likePrompt: true, systemNotify: true, afterLaunch: 'keep', agentWindow: true, zoom: 1, reduceMotion: false };

function load(): Prefs {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; }
}

export const prefs = $state<Prefs>(load());

$effect.root(() => {
  $effect(() => {
    const raw = JSON.stringify(prefs);
    try { localStorage.setItem(KEY, raw); } catch { /* 只在本次会话有效 */ }
  });
});
