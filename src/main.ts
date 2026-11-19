import { mount } from 'svelte';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/700.css';
import './app.css';
import App from './App.svelte';
import AgentWindow from './lib/agent/AgentWindow.svelte';
import { initDisplay } from './lib/theme/display.svelte';

// 界面缩放、减弱动效：两个窗口都要套
initDisplay();

// 同一份前端，两种窗口：主窗口，或者 ?view=agent 的助手独立窗口
const Root = new URLSearchParams(location.search).get('view') === 'agent' ? AgentWindow : App;

let instance;
try {
  instance = mount(Root, { target: document.getElementById('app')! });
  document.getElementById('boot-status')?.remove();
} catch (error) {
  const message = document.querySelector('#boot-status p');
  if (message) message.textContent = `页面加载失败：${error instanceof Error ? error.message : String(error)}\n请关闭后重新打开 Matcha。`;
  console.error(error);
}
export default instance;
