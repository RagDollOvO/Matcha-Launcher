<script lang="ts">
  import { app } from '../stores/app.svelte';
  import Keys from './Keys.svelte';
  import Toggle from './Toggle.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import { desktop } from '../api/bridge';
  import { libraryUpdate, needsDownload, sizeLabel } from '../plugins/native-offer';
  import type { L4nSubPlugin } from '../types';
  const env = $derived(app.nativeLibraries);
  const busy = $derived(app.game.running || !!app.busy);
  const lock = $derived(app.game.running ? '退出游戏后可修改' : app.busy ? `正在${app.busy}` : '');

  // 子插件：不依赖 Matcha 加载器，只要游戏没在运行、上次操作做完了就能切
  const l4n = $derived(app.l4nPlugins);
  const subs = $derived(l4n?.plugins ?? []);
  const subLock = $derived(app.game.running ? '退出游戏后可修改' : app.busy ? `正在${app.busy}` : l4n?.pending ? '先恢复上次没做完的操作' : '');
  const root = $derived(app.game.root?.replace(/[\\/]+$/, '') ?? '');
  const win = (p: string) => p.replace(/\//g, '\\');
  function tone(p: L4nSubPlugin) {
    const s = p.loadStatus?.state ?? p.runtimeState;
    return s === 'failed' || p.error ? 'danger' : s === 'loaded' || s === 'initialized' ? 'live' : s === 'pending' ? 'next' : 'muted';
  }
  const label = (p: L4nSubPlugin) => p.loadStatus?.label ?? (p.error ? '需要核对' : p.enabled ? '下次启动加载' : '已停用');
  const reason = (p: L4nSubPlugin) => p.error ?? p.loadStatus?.message ?? p.loadStatus?.nextLaunchError?.message;
</script>

<article aria-label="L4N 整包详情">
  <header class="hero">
    <div class="text">
      <div class="eyebrow">整包 · 外部平台</div>
      <h1>L4N</h1>
      <p class="byline"><span>Starfelll / nekonacho</span><span class="mono">{env?.l4n.version ? '本机 v'+env.l4n.version : env?.l4n.installed ? '本机版本待识别' : '本机未安装'}</span></p>
      <p class="summary">{env?.l4n.unmanaged ? '沿用这个游戏目录已有的 L4N，子插件在下方管理。' : '由 Matcha 安装的整包可以整体启停。'} 内部功能在 L4N 的游戏内菜单里设置。</p>
    </div>
  </header>

  <div class="body">
    <div class="main">
      <section class="subs" aria-label="L4N 子插件">
        <div class="sh">
          <h3>子插件{#if subs.length}<span class="count">{subs.length}</span>{/if}</h3>
          {#if root}<button class="ghost-link" onclick={() => app.reveal(`${root}\\bin\\neko\\plugins`)}><FolderOpen size={13}/>打开目录</button>{/if}
          {#if desktop}<button class="btn sm" disabled={!!subLock} title={subLock || '选一个 L4N SDK 的 x86 DLL，导入后默认停用'} onclick={() => app.importL4nPlugin()}><Plus size={13}/>导入 DLL…</button>{/if}
        </div>
        <p class="lead">放在 <code>bin\neko\plugins</code> 的第三方 L4N 插件，每个 DLL 单独启停。停用的 DLL 移到 L4N 扫描不到的目录，个人配置留在原处。</p>

        {#if l4n?.pending}
          <div class="recover" role="alert"><span>上次子插件操作没有做完，先恢复再改开关。</span><button class="btn sm primary" disabled={app.game.running || !!app.busy} onclick={() => app.recoverL4nPlugins()}>恢复</button></div>
        {/if}

        {#if subs.length}
          <ul class="list">
            {#each subs as p (p.id)}
              {@const t = tone(p)}
              {@const why = reason(p)}
              <li class={t} class:off={!p.enabled}>
                <i class="dot" aria-hidden="true"></i>
                <div class="who">
                  <strong>{p.name}</strong>
                  <span class="file" title={win(p.enabled ? p.entry : (p.parkedPath ?? p.entry))}>{p.file}{#if p.managed === false}<em>手动放入</em>{/if}</span>
                  {#if why && t === 'danger'}<span class="why">{why}</span>{/if}
                  {#if p.managed}
                    <div class="actions">
                      {#if desktop}<button class="btn sm ghost" disabled={!!subLock || !!p.error} onclick={()=>app.maintainL4nPlugin(p.id,'update')}>更新…</button>{/if}
                      {#if p.canRollback}<button class="btn sm ghost" disabled={!!subLock || !!p.error} onclick={()=>app.maintainL4nPlugin(p.id,'rollback')}>回滚上一版…</button>{/if}
                      <button class="btn sm ghost" disabled={!!subLock || !!p.error} onclick={()=>app.maintainL4nPlugin(p.id,'uninstall')}>卸载…</button>
                    </div>
                  {/if}
                </div>
                <span class="state" title={why || undefined}>{label(p)}</span>
                <span title={subLock || (p.error ? '文件位置和记录对不上，先核对' : '下次完整启动生效')}>
                  <Toggle on={p.enabled} disabled={!!subLock || !!p.error} onchange={() => app.setL4nPlugin(p.id, !p.enabled)} label={`${p.enabled ? '停用' : '启用'} ${p.name}`}/>
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">{l4n ? '还没有子插件。' : '读取中…'}{#if l4n && desktop}点「导入 DLL…」添加，或直接放进 <code>bin\neko\plugins</code>。{/if}</p>
        {/if}

        {#if l4n?.issues.length}
          <ul class="issues">{#each l4n.issues as it, i (i)}<li>{it.file ? `${it.file}：` : ''}{it.message}</li>{/each}</ul>
        {/if}
        {#if subs.length && app.launchConfig.mode==='clean'}<p class="note">纯净对抗使用原版目录，子插件选择留给平台模式。</p>
        {:else if subs.length && env && (!env.l4n.enabled || env.l4n.launchEnabled===false)}<p class="note">下次平台启动会跳过 L4N，子插件的开关选择已保留。</p>{/if}
      </section>
      <section>
        <h3>游戏里怎么用</h3>
        <ol class="steps">
          <li><span class="n">01</span><p>首页选「L4N 平台启动」进入游戏。</p></li>
          <li><span class="n">02</span><p>进入地图后打开控制台（<Keys keys={['~']}/>），输入 <code>l4n_menu</code> 打开 L4N 菜单。</p></li>
          <li><span class="n">03</span><p>Matcha 模组（例如物资雷达）仍在 <Keys keys={['Ctrl', 'F7']}/> 菜单里设置。</p></li>
        </ol>
      </section>
      <section>
        <h3>L4N 本体为什么只能整体启停</h3>
        <p>L4N 没有按 Matcha 的模块接口拆分，加载的是它自带的完整入口。Matcha 只负责切换入口文件：停用时还原安装前的文件，保留个人设置和素材；启用时从所选版本包恢复。上面的子插件是另外的 DLL，可以单独开关。</p>
      </section>
      <section>
        <h3>组件来源</h3>
        <dl class="facts">
          <div><dt>L4N</dt><dd>{env?.l4n.sourceKind === 'release-archive' ? 'STC214/l4n-releases 版本备份仓库' : '作者 Steam 工坊 3558049615'} · v{env?.l4n.availableVersion ?? '—'}</dd></div>
          
        </dl>
        <p class="muted">切换前展示文件清单，原文件随操作记录备份。游戏内兼容性以实际游玩为准。</p>
      </section>
    </div>

    <aside>
      {#if env}
        <div class="card">
          {#each [env.l4n] as lib (lib.id)}
            {@const title = 'L4N 整体加载'}
            {@const to = libraryUpdate(lib)}
            {#if lib.unmanaged}<div class="line"><strong>本机已有 L4N</strong><small>{lib.enabled ? '入口已启用' : '入口已停用'}</small></div>
            {:else if needsDownload(lib)}
              <!-- 本机没有组件文件：先下载，下载完再确认启用 -->
              <div class="line"><div><strong>{title}</strong><small>还没下载{lib.download ? ` · v${lib.download.version}${sizeLabel(lib.download.sizeBytes) ? ` · 约 ${sizeLabel(lib.download.sizeBytes)}` : ''}` : ''}</small></div>
                {#if app.downloadTask(`native:${lib.id}`)}<span class="dling">下载中…</span>{:else}<button class="btn sm" disabled={!!lock} title={lock || '先确认来源和大小再下载'} onclick={() => app.downloadNativeLibrary(lib.id)}>下载…</button>{/if}</div>
            {:else}
              <div class="line"><div><strong>{title}</strong><small>{lib.installed ? `已安装${lib.version ? ' v' + lib.version : ''}` : lib.availability === 'downloaded' ? `已下载 v${lib.download?.version ?? lib.availableVersion}，启用时装进游戏` : '首次启用时安装随包版本'}</small></div>
                <Toggle on={lib.enabled} disabled={busy || lib.pending} onchange={() => app.setNativeLibrary(lib.id, !lib.enabled)} label={`${lib.enabled ? '停用' : '启用'} ${lib.id === 'l4n' ? 'L4N 整包' : 'DXVK'}`}/></div>
              {#if to}<button class="btn sm" disabled={!!lock || lib.pending} onclick={() => (lib.download ? app.downloadNativeLibrary(lib.id) : app.setNativeLibrary(lib.id, true))}>更新到 v{to}{lib.download ? '…' : ''}</button>{/if}
            {/if}
          {/each}
          {#if env.l4n.supportsLaunchToggle}<div class="line"><div><strong>随 Matcha 启动 L4N</strong><small>仅作用于平台模式。关闭后跳过 L4N 及依赖它的模组。</small></div>
            <Toggle on={env.l4n.launchEnabled!==false} disabled={busy || env.l4n.pending} onchange={()=>app.setL4nLaunch(env!.l4n.launchEnabled===false)} label="随 Matcha 启动 L4N"/></div>{/if}
          {#each [env.l4n, env.dxvk] as item (item.id)}{#if item.pending}<div class="pending"><span>{item.name} 上次操作待恢复</span><button class="btn sm" disabled={app.game.running || !!app.busy} onclick={() => app.recoverNativeLibrary(item.id)}>恢复</button></div>{/if}{/each}
          <p class="note">{lock || '子插件开关在下次完整启动游戏时生效。'}</p>
        </div>
      {/if}
    </aside>
  </div>
</article>

<style>
  .eyebrow { font: 11px var(--font-mono); letter-spacing: .1em; color: var(--fg-3); }
  h1 { margin: 12px 0 0; font-size: 38px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; }
  .byline { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 18px 0 0; font-size: 13px; color: var(--fg-3); }
  .mono { font-family: var(--font-mono); }
  .summary { margin: 16px 0 0; max-width: 58ch; font-size: 15px; line-height: 1.8; color: var(--fg-2); }
  .hero { padding-bottom: 40px; border-bottom: 1px solid var(--line); }
  .body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 56px; align-items: start; padding-top: 40px; }
  section + section { margin-top: 40px; }
  h3 { margin: 0 0 14px; font-size: 15px; font-weight: 550; }
  section > p { margin: 0; max-width: 68ch; font-size: 14px; line-height: 1.9; color: var(--fg-2); }
  .dling { flex: none; font-size: 12px; color: var(--fg-2); }
  .muted { margin-top: 12px !important; font-size: 12px !important; color: var(--fg-3) !important; }
  .steps { list-style: none; margin: 0; padding: 0; }
  .steps li { display: grid; grid-template-columns: 48px 1fr; padding: 12px 0; border-top: 1px solid var(--line-soft); }
  .steps li:first-child { border-top: 0; padding-top: 0; }
  .n { font: 500 22px/1.2 var(--font-display); color: var(--fg-3); }
  .steps p { margin: 0; font-size: 14px; line-height: 1.8; color: var(--fg-2); }
  code { padding: 1px 6px; border-radius: var(--r-sm); background: var(--bg-2); color: var(--fg); font: 12px var(--font-mono); }
  .facts { margin: 0; display: grid; }
  .facts div { display: flex; gap: 16px; padding: 10px 0; border-top: 1px solid var(--line-soft); font-size: 13px; }
  .facts div:first-child { border-top: 0; padding-top: 0; }
  .facts dt { width: 56px; flex: none; color: var(--fg-3); }
  .facts dd { margin: 0; color: var(--fg-2); user-select: text; overflow-wrap: anywhere; }
  aside { position: sticky; top: 0; }
  .card { display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); }
  .line { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .line + .line, .btn + .line { padding-top: 14px; border-top: 1px solid var(--line-soft); }
  .line div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .line strong { font-size: 14px; font-weight: 550; }
  .line small { font-size: 12px; color: var(--fg-3); }
  .card .btn { align-self: flex-start; }
  .pending { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; color: var(--fg-2); }
  .note { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-3); }

  /* 子插件列表 */
  .sh { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .sh h3 { margin: 0 auto 0 0; display: inline-flex; align-items: center; gap: 8px; }
  .count { font: 500 11px var(--font-mono); padding: 1px 7px; border-radius: 999px; background: var(--bg-2); color: var(--fg-3); }
  .ghost-link { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 9px; font-size: 12px; color: var(--fg-2); transition: background var(--dur), color var(--dur); }
  .ghost-link:hover { background: var(--hover); color: var(--fg); }
  .subs .lead { margin: 0 0 14px; font-size: 13px; line-height: 1.8; color: var(--fg-3); }
  .recover { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 10px 12px; border-radius: var(--r); font-size: 13px; color: var(--md-on-error-container); background: var(--md-error-container); }
  .list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); }
  .list li { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; align-items: center; gap: 14px; padding: 12px 14px; }
  .list li + li { border-top: 1px solid var(--line-soft); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-4); }
  .next .dot { background: color-mix(in srgb, var(--md-primary) 60%, transparent); }
  .live .dot { background: var(--md-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-primary) 22%, transparent); }
  .danger .dot { background: var(--danger); }
  .who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .who strong { font-size: 14px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .off .who strong { color: var(--fg-2); }
  .file { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font: 11px var(--font-mono); color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .file em { font: 11px var(--font-sans); font-style: normal; padding: 0 6px; border-radius: 6px; background: var(--bg-2); color: var(--fg-3); }
  .why { font-size: 12px; line-height: 1.5; color: var(--danger); }
  .state { font-size: 12px; color: var(--fg-3); white-space: nowrap; }
  .live .state { color: var(--md-primary); }
  .danger .state { color: var(--danger); }
  .empty { max-width: none; margin: 0; padding: 18px; border: 1px dashed var(--line); border-radius: var(--r); font-size: 13px; color: var(--fg-3); }
  .issues { margin: 10px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--danger); }
  .subs .note { margin-top: 10px; }
  @container dll (max-width: 900px) { .body { grid-template-columns: 1fr; gap: 40px; } aside { position: static; order: -1; } }
  @container dll (max-width: 700px) { h1 { font-size: 30px; } }
</style>
