// 跨页跳转到设置页的某一节（首页「启动设置」、助手面板齿轮等）
import { app } from './app.svelte';
import { isAgentView, sendToMain } from '../agent/window.svelte';

export const nav = $state({ settings: '' });

export function openSettings(section = '') {
  // 助手独立窗口里没有设置页：让主窗口去打开
  if (isAgentView) { void sendToMain({ type: 'settings', section }); return; }
  nav.settings = section;
  app.route = 'settings';
}
