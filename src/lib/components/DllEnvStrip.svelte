<script lang="ts">
  // DLL 页顶部的一条运行环境：加载器、DXVK、L4N 整包。一行就够，不抢列表的分量。
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Cpu from '@lucide/svelte/icons/cpu';
  import Layers from '@lucide/svelte/icons/layers';
  import Boxes from '@lucide/svelte/icons/boxes';
  import { app } from '../stores/app.svelte';
  import LocalRender from './LocalRender.svelte';
  import Toggle from './Toggle.svelte';
  import { libraryUpdate, needsDownload } from '../plugins/native-offer';
  let { onmanage, onl4n }: { onmanage: () => void; onl4n: () => void } = $props();
  const env = $derived(app.nativeLibraries);
  // 为什么开关是灰的：写进开关的悬停提示，不再单独占一行
  const lock = $derived(app.game.running ? '退出游戏后可修改' : app.busy ? '操作中' : '');
  const loader = $derived(
    app.runtime.status === 'absent' ? { text: env?.l4n.enabled ? '可选模组运行时' : '启用 L4N 后可部署', action: env?.l4n.enabled ? '部署' : '', run: () => app.installRuntime() }
    : app.runtime.status === 'restored' ? { text: '已恢复原入口', action: '重新启用', run: () => app.resumeRuntime() }
    : app.runtime.installed ? { text: '已部署', action: '', run: () => {} }
    : { text: app.runtime.status, action: '', run: () => {} });
  // 按需下载：本机没有组件文件时，开关换成「下载」
  const dlLock = $derived(app.game.running ? '退出游戏后再下载' : app.busy ? `正在${app.busy}` : '');
  const pct = (id: string) => { const t = app.downloadTask(`native:${id}`); return t ? (t.total ? `${Math.floor((t.done / t.total) * 100)}%` : '下载中') : ''; };
  const l4nLock = $derived(!env || app.game.running || !!app.busy || (!env.l4n.enabled && !!lock) || env.l4n.pending);
</script>

<section class="env" aria-label="运行环境">
  <div class="item" class:alert={!!loader.action}>
    <span class="ic"><Cpu size={16}/></span>
    <div class="txt">
      <button class="name" onclick={onmanage} title="游戏目录、加载器部署与检测提示">Matcha 加载器<ChevronRight size={12}/></button>
      <span class="val">{loader.text}<span class="conn" class:on={app.runtime.connected}><i></i>{app.runtime.connected ? `已连接 · PID ${app.game.pid}` : '游戏未运行'}</span></span>
    </div>
    {#if loader.action}<button class="btn sm primary" disabled={!app.game.installed || app.game.running || !!app.busy} onclick={loader.run}>{loader.action}</button>{/if}
  </div>

  <div class="item">
    <span class="ic"><Layers size={16}/></span>
    <div class="txt">
      <button class="name" onclick={onmanage} title="查看两个游戏渲染入口">DXVK 渲染<ChevronRight size={12}/></button>
      <span class="val"><LocalRender entries={env?.dxvk.entries}/></span>
    </div>
  </div>

  <div class="item">
    <span class="ic"><Boxes size={16}/></span>
    <div class="txt">
      <button class="name" onclick={onl4n} title="查看整包里的功能">L4N 整包<ChevronRight size={12}/></button>
      <span class="val">{env ? (needsDownload(env.l4n) ? '未下载' : env.l4n.enabled ? (env.l4n.launchEnabled===false ? '平台启动时跳过' : '平台启动时加载') : env.l4n.installed ? '已停用' : '未安装') : '读取中'}{#if env}<small>{env.l4n.unmanaged ? '手动安装 · ' : ''}{env.l4n.version ? 'v'+env.l4n.version : env.l4n.installed ? '版本未知' : ''}{#if libraryUpdate(env.l4n)} · 可更新到 v{libraryUpdate(env.l4n)}{/if}{#if app.l4nPlugins?.plugins.length} · {app.l4nPlugins.plugins.filter(p => p.enabled).length}/{app.l4nPlugins.plugins.length} 子插件{/if}{#if app.l4nPlugins?.pending} · 待恢复{/if}</small>{/if}</span>
    </div>
    {#if env && needsDownload(env.l4n)}
      {#if pct('l4n')}<span class="dl mono" role="status">{pct('l4n')}</span>{:else}<button class="btn sm" disabled={!!dlLock} title={dlLock || '先确认来源和大小再下载'} onclick={() => app.downloadNativeLibrary('l4n')}>下载</button>{/if}
    {:else if env?.l4n.unmanaged && env.l4n.supportsLaunchToggle}<span class="sw" title="随 Matcha 启动 L4N，仅作用于平台模式"><Toggle on={env.l4n.launchEnabled!==false} disabled={l4nLock} onchange={()=>app.setL4nLaunch(env!.l4n.launchEnabled===false)} label="随 Matcha 启动 L4N"/></span>
    {:else if env && !env.l4n.unmanaged}<span class="sw" title={l4nLock ? (lock || '暂不能切换') : '整体启停，下次启动游戏生效'}><Toggle on={env.l4n.enabled} disabled={l4nLock} onchange={() => app.setNativeLibrary('l4n', !env.l4n.enabled)} label={`${env.l4n.enabled ? '停用' : '启用'} L4N 整包`}/></span>{/if}
  </div>
</section>

<style>
  /* 一条浮岛：三段等宽，中间细分隔，不再有表格框 */
  .env {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--island-line); border-radius: 16px;
    background: color-mix(in srgb, var(--md-surface-bright) 55%, transparent);
  }
  .item { position: relative; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 16px; }
  .item + .item::before { content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 1px; background: var(--line-soft); }
  .ic { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 11px; background: color-mix(in srgb, var(--md-secondary-container) 80%, transparent); color: var(--md-on-secondary-container); }
  .alert .ic { background: var(--md-primary-container); color: var(--md-on-primary-container); }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { display: inline-flex; align-items: center; gap: 2px; align-self: flex-start; font-size: 12px; color: var(--fg-3); transition: color var(--dur); }
  .name :global(svg) { color: var(--fg-4); transition: transform var(--dur) var(--ease-out); }
  button.name:hover { color: var(--fg); }
  button.name:hover :global(svg) { transform: translateX(2px); }
  .val { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 14px; font-weight: 600; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .alert .val { color: var(--md-primary); }
  .val small { font: 11px var(--font-mono); font-weight: 400; color: var(--fg-3); }
  .conn { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 400; color: var(--fg-3); }
  .conn i { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-4); }
  .conn.on { color: var(--fg-2); }
  .conn.on i { background: var(--md-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-primary) 22%, transparent); }
  .item .btn { flex: none; height: 28px; padding: 0 14px; border-radius: 10px; font-size: 12px; }
  .sw { display: inline-flex; flex: none; padding: 6px; }
  .dl { flex: none; font-size: 12px; color: var(--fg-2); }
  .mono { font-family: var(--font-mono); }

  @container dll (max-width: 900px) {
    .conn { display: none; }
  }
  @container dll (max-width: 700px) {
    .env { grid-template-columns: 1fr; }
    .item + .item::before { left: 16px; right: 16px; top: 0; bottom: auto; width: auto; height: 1px; }
    .conn { display: inline-flex; }
  }
  @media (prefers-reduced-motion: reduce) { .name :global(svg) { transition: none; } }
</style>
