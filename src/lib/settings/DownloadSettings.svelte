<script lang="ts">
  // 设置页「下载」：并发、限速（后端保存在 download-settings.json）+ 下载完成后的提醒（只在本机）
  import BellRing from '@lucide/svelte/icons/bell-ring';
  import Toggle from '../components/Toggle.svelte';
  import DownloadLimits from '../components/DownloadLimits.svelte';
  import { desktop } from '../api/bridge';
  import { prefs } from '../stores/prefs.svelte';
  import { testNotify } from '../stores/system-notify';
  import { app } from '../stores/app.svelte';

  let sent = $state(false);
  async function test() {
    if (await testNotify()) { sent = true; setTimeout(() => (sent = false), 2400); }
    else app.toast('系统没有允许 Matcha 发通知，可以在 Windows 设置 › 通知里打开');
  }
</script>

<section id="set-downloads">
  <h2>下载</h2>
  <p class="lead">限速适用于创意工坊和 GameMaps；网页下载单独排队。</p>
  <div class="card"><DownloadLimits /></div>

  <h3>下载完成后</h3>
  <div class="card">
    <div class="line">
      <div class="lt"><b>窗口在后台时发系统通知</b>
        {#if !desktop}<span class="sub">桌面版可用</span>{/if}</div>
      <div class="row">
        {#if desktop && prefs.systemNotify}<button class="btn ghost" title={import.meta.env.DEV ? '开发模式下通知会显示成 PowerShell 的名字和图标' : undefined} onclick={test}><BellRing size={13} />{sent ? '已发送' : '试一条'}</button>{/if}
        <Toggle on={desktop && prefs.systemNotify} disabled={!desktop} onchange={() => (prefs.systemNotify = !prefs.systemNotify)} label="窗口在后台时发系统通知" />
      </div>
    </div>
    <div class="line">
      <div class="lt"><b>提醒给作者点赞</b></div>
      <Toggle on={prefs.likePrompt} onchange={() => (prefs.likePrompt = !prefs.likePrompt)} label="提醒给作者点赞" />
    </div>
  </div>
</section>
