<script lang="ts">
  // 设置页「关于」：版本与检查更新、快捷键、用到的开源组件。检查更新走后端 update-check。
  import { onMount } from 'svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Keys from '../components/Keys.svelte';
  import { desktop } from '../api/bridge';
  import { launcherApi, type UpdateInfo } from '../api/launcher';
  import { appInfo, loadAppInfo } from '../stores/app-info.svelte';
  import { app } from '../stores/app.svelte';
  import { browser } from '../browser/browser.svelte';
  import { showWelcome } from '../stores/welcome.svelte';

  let update = $state<UpdateInfo | null>(null);
  let checking = $state(false);
  let updateMissing = $state(!desktop);
  onMount(() => { void loadAppInfo(); });

  async function check() {
    checking = true;
    const r = await launcherApi.checkUpdate();
    checking = false;
    if (r.ok) update = r.value;
    else if (r.missing) updateMissing = true;
    else app.toast(r.error);
  }
  function open(url: string) { browser.open(url); app.route = 'browser'; }

  const SHORTCUTS = [
    { keys: ['Ctrl', 'K'], label: '叫出茶茶，光标放进输入框' },
    { keys: ['Esc'], label: '收起茶茶' },
    { keys: ['Ctrl', 'F7'], label: '游戏里打开 Matcha 模组菜单' },
  ];
  const CREDITS = [
    { name: 'pi', note: '茶茶的模型连接与工具调用', license: 'MIT' },
    { name: 'Steam++ 3.2.0', note: 'Steam 社区加速', license: 'GPL-3.0', url: 'https://github.com/BeyondDimension/SteamTools/tree/3.2.0' },
    { name: 'DSH Browser 0.4.1', note: '内置浏览器的标签页', license: 'Apache-2.0', url: 'https://github.com/Nono-neko/dsh-browser' },
    { name: '荆南麦圆体 1.20', note: '默认界面字体', license: 'OFL-1.1', url: 'https://github.com/maoken-fonts/KNMaiyuan' },
    { name: 'Tauri · Svelte · Lucide · Geist', note: '桌面壳、界面框架、图标和等宽字体', license: 'MIT · MIT · ISC · OFL-1.1' },
  ];
</script>

<section id="set-about">
  <h2>关于</h2>
  <div class="card">
    <div class="line app">
      <img src="/matcha.png" alt="" width="40" height="40" />
      <div class="lt"><b>Matcha<span class="w mono">v{appInfo.version}</span></b></div>
    </div>
    <div class="line">
      <div class="lt"><b>检查更新{#if desktop && updateMissing}<span class="soon">即将支持</span>{/if}</b>
        {#if update}<span class="sub">{update.hasUpdate ? `有新版本 v${update.latest}${update.publishedAt ? ` · ${new Date(update.publishedAt).toLocaleDateString()}` : ''}` : '已经是最新版本'}</span>{:else if !desktop}<span class="sub">桌面版可用</span>{/if}</div>
      <div class="row">
        {#if update?.hasUpdate && update.url}<button class="btn primary" onclick={() => open(update!.url!)}><ExternalLink size={14} />查看新版本</button>{/if}
        <button class="btn" disabled={updateMissing || checking} onclick={check}>{#if checking}<LoaderCircle size={14} class="spin" />{:else}<RefreshCw size={14} />{/if}检查</button>
      </div>
    </div>
    {#if update?.hasUpdate && update.notes}<p class="note notes">{update.notes}</p>{/if}
    <div class="line">
      <div class="lt"><b>欢迎引导</b></div>
      <button class="btn" onclick={showWelcome}>再看一遍</button>
    </div>
  </div>

  <h3>快捷键</h3>
  <div class="card">
    {#each SHORTCUTS as s (s.label)}
      <div class="line short"><span class="sub">{s.label}</span><Keys keys={s.keys} /></div>
    {/each}
  </div>

  <h3>开源组件</h3>
  <div class="card">
    {#each CREDITS as c (c.name)}
      <div class="line short">
        <div class="lt"><b>{#if c.url}<button class="link" onclick={() => open(c.url!)}>{c.name}</button>{:else}{c.name}{/if}</b><span class="sub">{c.note}</span></div>
        <span class="w mono">{c.license}</span>
      </div>
    {/each}
  </div>
</section>

<style>
  .app { gap: 14px; min-height: 72px; }
  .app img { flex: none; border-radius: 10px; }
  .app .lt b { font-size: 15px; }
  .short { min-height: 46px; padding-block: 8px; }
  .short > .sub { color: var(--fg-2); font-size: 12.5px; }
  .lt b .link { font-size: inherit; font-weight: inherit; color: var(--fg); }
  .notes { white-space: pre-line; max-height: 180px; overflow-y: auto; font-size: 12px; color: var(--fg-2); }
</style>
