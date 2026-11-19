<script lang="ts">
  import { onMount } from 'svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Toggle from '../components/Toggle.svelte';
  import { call, connectEvents, desktop, errorText, onBridgeEvent } from '../api/bridge';
  import { app } from '../stores/app.svelte';
  import { browser } from '../browser/browser.svelte';

  interface Status {
    supported: boolean;
    version: string;
    enabled: boolean;
    active: boolean;
    phase: 'off' | 'starting' | 'running' | 'stopping' | 'error' | 'recovery';
    message: string;
    consentRequired: boolean;
    recoveryRequired: boolean;
  }
  interface Probe { ok: boolean; route: 'steampp' | 'system'; status?: number; elapsedMs: number; message?: string }
  let info = $state<Status>();
  let working = $state(false);
  let checking = $state(false);
  let problem = $state('');
  let probe = $state('');
  const busy = $derived(working || info?.phase === 'starting' || info?.phase === 'stopping');
  const statusLabel = $derived(info?.phase === 'recovery' ? '需要恢复' : info?.phase === 'starting' ? '正在启动' :
    info?.phase === 'stopping' ? '正在关闭' : info?.active ? '已启用' : info?.phase === 'error' ? '启动失败' : '已关闭');

  async function refresh() {
    try { info = await call<Status>('community-status'); }
    catch (e) { problem ||= errorText(e); }
  }
  onMount(() => {
    if (!desktop) return;
    const unsubscribe = onBridgeEvent(event => {
      if (event.type === 'community_acceleration') { info = event.status as Status; probe = ''; }
    });
    void connectEvents().catch(() => {});
    void refresh();
    return unsubscribe;
  });

  async function toggle(recover = false) {
    if (!info?.supported || busy) return;
    const enabled = !info.enabled && !recover;
    const consent = enabled && info.consentRequired;
    working = true; problem = ''; probe = '';
    try {
      if (consent && !await app.confirm('启用 Steam 社区加速',
        'Steam++ 会在本机生成并信任一张根证书，通过本地服务处理加速站点的 HTTPS，再按 Steam++ 规则连接上游。启用时临时修改 Windows hosts；关闭加速或退出 Matcha 时恢复这些记录。\n\n证书留在本机供下次启用。若 Windows 弹出管理员授权，请确认后继续。',
        '同意并启用')) return;
      info = recover ? await call<Status>('community-recover', {}, true)
        : await call<Status>('community-set', { enabled, consent }, true);
    } catch (e) {
      await refresh();
      const message=errorText(e);
      problem=info?.message && (message===info.message || message.startsWith(info.message+' [')) ? '' : message;
    }
    finally { working = false; }
  }

  async function check() {
    checking = true; probe = '';
    try {
      const r = await call<Probe>('community-check');
      const route = r.route === 'steampp' ? 'Steam++' : '当前网络';
      probe = r.ok ? `工坊已连通 · ${route} · ${(r.elapsedMs / 1000).toFixed(1)} 秒`
        : `工坊连接失败 · ${r.status ? `HTTP ${r.status}` : r.message ?? route}`;
    } catch (e) { probe = errorText(e); }
    finally { checking = false; }
  }
</script>

<section id="set-network">
  <h2>社区加速</h2>
  <p class="lead">仅加速创意工坊和 Steam 社区的列表、封面。</p>
  <div class="card">
    {#if !desktop}
      <div class="line"><div class="lt"><b>Steam 社区加速</b><span class="sub">桌面版可用</span></div><Toggle on={false} disabled label="Steam 社区加速" onchange={() => {}} /></div>
    {:else if info?.supported}
      <div class="line">
        <div class="lt">
          <b>Steam 社区加速
            <span class="state" class:active={info.active} role="status">{#if busy}<LoaderCircle size={11} class="spin" />{:else}<i></i>{/if}{statusLabel}</span></b>
          {#if info.message}<span class="sub">{info.message}</span>{:else if info.active}<span class="sub">刷新已打开的工坊页面后生效</span>{/if}
        </div>
        <Toggle on={info.enabled} disabled={busy || info.recoveryRequired} onchange={() => void toggle()} label="Steam 社区加速" />
      </div>
      <div class="line">
        <div class="lt">
          {#if probe}<span class="sub" role="status">{probe}</span>
          {:else if problem && problem !== info.message}<span class="sub err" role="alert">{problem}</span>
          {:else}<span class="sub">基于 <button class="link" onclick={() => { browser.open('https://github.com/BeyondDimension/SteamTools/releases/tag/' + info?.version); app.route = 'browser'; }}>Steam++ {info.version}</button>（开源项目）</span>{/if}
        </div>
        {#if info.recoveryRequired}
          <button class="btn primary" disabled={busy} onclick={() => void toggle(true)}>关闭并恢复网络</button>
        {:else}
          <button class="btn" disabled={busy || checking} onclick={() => void check()}>{#if checking}<LoaderCircle size={13} class="spin" />{/if}{checking ? '检测中…' : '检测工坊连接'}</button>
        {/if}
      </div>
    {:else if problem}
      <div class="line"><div class="lt"><b>Steam 社区加速</b><span class="sub err" role="alert">{problem}</span></div><button class="btn" onclick={() => void refresh()}>重试</button></div>
    {:else if info}
      <div class="line"><div class="lt"><b>Steam 社区加速</b><span class="sub">{info.message || '这台电脑上的 Matcha 没有带 Steam++ 组件。'}</span></div></div>
    {:else}
      <div class="line"><div class="lt"><b>Steam 社区加速</b><span class="sub"><LoaderCircle size={11} class="spin" /> 正在读取加速状态…</span></div></div>
    {/if}
  </div>
</section>

<style>
  .state { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 400; color: var(--fg-3); }
  .state i { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-4); }
  .state.active { color: var(--md-primary); }
  .state.active i { background: var(--md-primary); }
  .err { color: var(--danger); }
</style>
