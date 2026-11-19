<script lang="ts">
  // 设置页「启动器」：启动游戏后窗口怎么办、助手开在哪、关闭按钮和开机自启。
  // 后两项由桌面壳实现（launcher-behavior-get / set），没接上时显示「即将支持」。
  import { onMount } from 'svelte';
  import Toggle from '../components/Toggle.svelte';
  import { desktop } from '../api/bridge';
  import { launcherApi, type LauncherBehavior } from '../api/launcher';
  import { prefs } from '../stores/prefs.svelte';
  import { app } from '../stores/app.svelte';
  import { setAgentWindowPref } from '../agent/window.svelte';
  import { settingsEpoch } from '../stores/settings-sync.svelte';

  let behavior = $state<LauncherBehavior | null>(null);
  let missing = $state(!desktop);
  let saving = $state(false);
  async function load() {
    if (!desktop) return;
    const r = await launcherApi.behavior();
    if (r.ok) behavior = r.value; else { missing = true; if (!r.missing) app.toast(r.error); }
  }
  onMount(load);
  // 茶茶改过托盘 / 开机自启后重读一次
  let seenEpoch = settingsEpoch['launcher-behavior'];
  $effect(() => { const e = settingsEpoch['launcher-behavior']; if (e !== seenEpoch) { seenEpoch = e; void load(); } });
  async function set(patch: Partial<LauncherBehavior>) {
    if (!behavior || saving) return;
    saving = true;
    const r = await launcherApi.setBehavior(patch);
    saving = false;
    if (r.ok) behavior = r.value; else app.toast(r.error);
  }
  const soon = $derived(desktop && missing);
</script>

<section id="set-launcher">
  <h2>启动器</h2>
  <div class="card">
    <div class="line">
      <div class="lt"><b>启动游戏后</b>{#if prefs.afterLaunch === 'minimize'}<span class="sub">游戏退出后恢复窗口</span>{/if}</div>
      <div class="seg" role="radiogroup" aria-label="启动游戏后">
        <button role="radio" aria-checked={prefs.afterLaunch === 'keep'} class:on={prefs.afterLaunch === 'keep'} onclick={() => (prefs.afterLaunch = 'keep')}>保持窗口</button>
        <button role="radio" aria-checked={prefs.afterLaunch === 'minimize'} class:on={prefs.afterLaunch === 'minimize'} disabled={!desktop} onclick={() => (prefs.afterLaunch = 'minimize')}>最小化</button>
      </div>
    </div>
    <div class="line">
      <div class="lt"><b>茶茶在哪儿打开</b>{#if !desktop}<span class="sub">桌面版可用</span>{/if}</div>
      <div class="seg" role="radiogroup" aria-label="茶茶在哪儿打开">
        <button role="radio" aria-checked={prefs.agentWindow} class:on={prefs.agentWindow} disabled={!desktop} onclick={() => void setAgentWindowPref(true)}>独立窗口</button>
        <button role="radio" aria-checked={!prefs.agentWindow} class:on={!prefs.agentWindow} disabled={!desktop} onclick={() => void setAgentWindowPref(false)}>窗口内分栏</button>
      </div>
    </div>
    <div class="line">
      <div class="lt"><b>关闭窗口时收起到托盘</b><span class="sub">单击托盘图标恢复窗口，右键选择「退出」结束 Matcha。</span></div>
    </div>
    <div class="line">
      <div class="lt"><b>开机时启动{#if soon}<span class="soon">即将支持</span>{/if}</b><span class="sub">登录 Windows 后在托盘里待命</span></div>
      <Toggle on={!!behavior?.autostart} disabled={!behavior || saving} label="开机时启动" onchange={() => void set({ autostart: !behavior?.autostart })} />
    </div>
  </div>
</section>
