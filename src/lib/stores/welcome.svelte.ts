// 首次启动的欢迎引导。走完或跳过后记在本机；设置页「关于」可以再看一遍，地址带 ?welcome 时强制打开（调试用）。
const KEY = 'flare.welcome';

function seen() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
const forced = typeof location !== 'undefined' && new URLSearchParams(location.search).has('welcome');

export const welcome = $state({ open: forced || !seen() });

export function finishWelcome() {
  welcome.open = false;
  try { localStorage.setItem(KEY, '1'); } catch { /* 读不到存储时下次还会再见 */ }
}

export function showWelcome() {
  welcome.open = true;
}
