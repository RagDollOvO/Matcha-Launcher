<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import FileText from '@lucide/svelte/icons/file-text';
  import X from '@lucide/svelte/icons/x';
  import TrustBadge from './TrustBadge.svelte';
  import { app } from '../stores/app.svelte';
  import { api } from '../api';
  import { errorText } from '../api/bridge';
  import type { ExternalPlatform, PlatformOnline } from '../types';

  let { p }: { p: ExternalPlatform } = $props();

  const STATE: Record<ExternalPlatform['state'], string> = { 'not-installed': '未安装', enabled: '已启用', disabled: '已停用', broken: '文件异常' };
  const SCOPES: [PlatformOnline, string, string][] = [
    ['blocked', '禁止', 'Matcha 管理时强制关闭'],
    ['local-only', '只限本地', '连非本地服务器时关闭'],
    ['no-versus', '对抗类停用', '对抗、清道夫模式关闭'],
    ['review', '待定', '等你决定'],
    ['any', '任何服务器', '外观、自身信息、稳定性'],
  ];
  /** 总开关与已接入的预览协议同时就绪时开放管理。 */
  const manage = $derived(!!app.capabilities.platformManagement && (app.capabilities.platformManagementVersion ?? 0) >= 1);
  const lock = $derived(app.game.running ? '游戏运行中，退出后再操作' : app.busy ? `正在${app.busy}` : '');
  // 最新发布：打开时查一次，store 里缓存 10 分钟
  $effect(() => { if (manage && p.distribution !== 'source-ports') void app.platformCheckUpdate(p.id); });
  const rel = $derived(app.platformReleases[p.id]);
  const canUpdate = $derived(!!p.managed && !!rel?.release?.updateAvailable);
  // 进行中的平台任务（下载、安装、启停……）
  const running = $derived(app.tasks.filter((t) => (t.kind === 'platform-download' || t.kind === 'platform-operation') && !['done', 'failed', 'canceled'].includes(t.state)));
  const pct = (done: number, total: number | null) => (total ? Math.min(100, Math.round((done / total) * 100)) : null);
  const trust = $derived(p.verification.state === 'rejected' ? 'blocked' as const : 'unverified' as const);
  const groups = $derived(SCOPES.map(([k, label, about]) => ({ k, label, about, mods: p.modules.filter((m) => m.online === k && m.kind !== 'update') })).filter((g) => g.mods.length));
  const total = $derived(groups.reduce((n, g) => n + g.mods.length, 0));
  const notes = $derived([
    ...p.issues.map((i) => i.message),
    ...(p.coexist.beacon === 'warn' && p.coexist.note ? [p.coexist.note] : []),
  ]);

  const loadText = $derived(!p.loader.present ? '入口空闲' : p.loader.owned ? '和清单一致' : (p.loader.foreign ?? '被其他文件占用'));
  const fileText = $derived(p.integrity.state === 'match' ? '和作者清单一致' : p.integrity.state === 'mismatch' ? '和清单有差异' : p.installed ? '没有清单，未核对' : '—');
  const updateText = $derived(
    canUpdate ? `有新版本 v${rel!.release!.version}`
    : rel?.release ? `最新 v${rel.release.version}${p.managed ? ' · 已是最新' : ''}`
    : rel?.error ? '查不到最新版本'
    : p.update.selfUpdate ? '工坊自更新开着' : '由 Matcha 提示',
  );

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); app.toast('已复制仓库地址'); } catch { app.toast('复制失败'); }
  }

  // ---------- 说明文档：只读纯文本，在对话框里看 ----------
  let reader = $state<HTMLDialogElement>();
  let doc = $state<{ title: string; text: string; error: string; loading: boolean } | null>(null);
  const present = $derived(p.docs.filter((d) => d.present));
  async function openDoc(d: { title: string; path: string }) {
    doc = { title: d.title, text: '', error: '', loading: true };
    reader?.showModal();
    try { doc.text = (await api.platformDoc(p.id, d.path)).text; } catch (e) { doc.error = errorText(e); } finally { doc.loading = false; }
  }
  function closeDoc() { reader?.close(); doc = null; }
</script>

<article class="pane">
  <header class="hero">
    <span class="tile" aria-hidden="true">{p.name.slice(0, 1)}</span>
    <div class="who">
      <div class="kicker">
        <span>外部平台</span><span class="dot">·</span>
        <span class="mono">{p.source.repo.replace(/^https?:\/\//, '')}</span>
        <button class="icon-btn mini" type="button" title="复制仓库地址" aria-label="复制仓库地址" onclick={() => copy(p.source.repo)}><Copy size={11} /></button>
      </div>
      <h1>{p.name}{#if p.version}<span class="ver mono">v{p.version}</span>{/if}</h1>
      <p class="desc">Left 4 Dead 2 客户端增强平台。通过 <span class="mono">{p.loader.file}</span> 加载，不经过 Beacon。</p>
      <div class="badges">
        <TrustBadge size="sm" level={trust} label={p.verification.state === 'verified-development' ? '开发签名已核验' : undefined} />
        <span class="tag">{STATE[p.state]}</span>
        <span class="by">作者自填 {p.identity.claimed} · {p.source.license}</span>
      </div>
    </div>
    <div class="acts">
      {#if !manage}
        <button class="btn" disabled title="即将开放">{p.installed ? '管理…' : '安装…'}</button>
      {:else if p.pendingOperation}
        <button class="btn primary" disabled={!!lock} title={lock || undefined} onclick={() => app.platformOperation(p.id, 'recover')}>恢复中断的操作</button>
      {:else if p.distribution === 'source-ports'}
        {#if p.managed}
          {#if p.state === 'enabled'}<button class="btn" disabled={!!lock} onclick={() => app.platformOperation(p.id, 'set-enabled', false)}>停用旧整包</button>{/if}
          <button class="btn" disabled={!!lock} onclick={() => app.platformOperation(p.id, 'uninstall')}>卸载旧整包…</button>
        {:else}<span class="muted">旧整包由原安装器管理</span>{/if}
      {:else if !p.installed}
        <button class="btn" disabled={!!lock} title={lock || '从 GitHub Release 下载，安装前先看计划'} onclick={() => app.platformInstall(p.id)}>安装…</button>
      {:else if !p.managed}
        <button class="btn" disabled={!!lock} title={lock || `现在由 ${p.name} 自己的安装器管理`} onclick={() => app.platformInstall(p.id)}>交给 Matcha 管理…</button>
      {:else}
        {#if canUpdate}<button class="btn" disabled={!!lock} title={lock || undefined} onclick={() => app.platformInstall(p.id)}>更新到 v{rel?.release?.version}…</button>{/if}
        <button class="btn" disabled={!!lock} title={lock || undefined} onclick={() => app.platformOperation(p.id, 'set-enabled', p.state !== 'enabled')}>{p.state === 'enabled' ? '停用' : '启用'}</button>
        <button class="btn ghost" disabled={!!lock} title={lock || undefined} onclick={() => app.platformOperation(p.id, 'uninstall')}>卸载…</button>
      {/if}
    </div>
  </header>

  {#each running as t (t.taskId)}
    {@const v = pct(t.done, t.total)}
    <div class="task" role="status">
      <span class="tt">{t.kind === 'platform-download' ? '下载' : '执行'} · {t.title}</span>
      <span class="mono tp">{v === null ? (t.state === 'queued' ? '排队中' : '进行中') : `${v}%`}</span>
      <span class="tb"><i style:width="{v ?? 8}%"></i></span>
    </div>
  {/each}

  <dl class="facts">
    <div><dt>加载</dt><dd>{loadText}</dd></div>
    <div><dt>文件</dt><dd>{fileText}</dd></div>
    <div><dt>更新</dt><dd>{updateText}{#if manage && p.managed && p.update.selfUpdate}<button class="inline" disabled={!!lock} onclick={() => app.platformOperation(p.id, 'set-self-update', false)}>关闭工坊自更新</button>{/if}</dd></div>
    <div><dt>子插件</dt><dd>{p.subPlugins.items.length ? `${p.subPlugins.items.length} 个 DLL` : '无'}</dd></div>
  </dl>

  {#each notes as n (n)}<p class="notice">{n}</p>{/each}

  <section class="mods" aria-label="模块">
    <div class="sh"><h2>{total} 个功能模块</h2><span>另有 1 个更新模块，由 Matcha 管理</span></div>
    <div class="bar" role="img" aria-label={groups.map((g) => `${g.label} ${g.mods.length}`).join('，')}>
      {#each groups as g (g.k)}<span class="seg {g.k}" style:flex={g.mods.length}></span>{/each}
    </div>
    {#each groups as g (g.k)}
      <div class="grp">
        <div class="gl"><span class="sw {g.k}"></span><b>{g.label}</b><span class="mono n">{g.mods.length}</span><span class="about">{g.about}</span></div>
        <div class="chips">
          {#each g.mods as m (m.id)}
            <span class="chip" title={m.note ?? m.name}><i class="st {m.state}" aria-label={m.state === 'on' ? '开' : m.state === 'off' ? '关' : '状态未知'}></i>{m.name}</span>
          {/each}
        </div>
      </div>
    {/each}
    <p class="legend"><i class="st on"></i>开 <i class="st off"></i>关 <i class="st unknown"></i>未知 · 读自 {p.name} 已保存的设置</p>
  </section>

  <section class="docs" aria-label="说明">
    <h2>说明</h2>
    {#if present.length}
      <div class="doclinks">{#each present as d (d.path)}<button class="btn sm ghost" type="button" onclick={() => openDoc(d)}><FileText size={13} />{d.title}</button>{/each}</div>
    {:else}
      <p class="muted">{p.installed ? '这次安装没有附带说明文件。' : '安装后可以在这里读作者的说明。'}</p>
    {/if}
  </section>
</article>

<dialog bind:this={reader} class="reader" aria-labelledby="doc-title" oncancel={(e) => { e.preventDefault(); closeDoc(); }}>
  {#if doc}
    <header>
      <h2 id="doc-title">{doc.title}</h2>
      <span class="from">{p.name} 提供 · 纯文本</span>
      <button class="icon-btn" type="button" aria-label="关闭" onclick={closeDoc}><X size={16} /></button>
    </header>
    <div class="text">{#if doc.loading}<span class="muted">读取中…</span>{:else if doc.error}<span class="danger">{doc.error}</span>{:else}{doc.text}{/if}</div>
  {/if}
</dialog>

<style>
  .pane { display: flex; flex-direction: column; gap: 28px; }
  .btn:disabled, .icon-btn:disabled { opacity: .4; cursor: default; }
  .muted { color: var(--fg-3); }

  .hero { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
  .tile { display: grid; place-items: center; width: 64px; height: 64px; flex: none; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-1); font-family: var(--font-display); font-size: 30px; }
  .who { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .kicker { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-3); }
  .kicker .dot { color: var(--fg-4); }
  .icon-btn.mini { width: 20px; height: 20px; }
  h1 { margin: 0; font-size: 26px; font-weight: 500; letter-spacing: -0.01em; }
  .ver { margin-left: 10px; font-size: 14px; font-weight: 400; color: var(--fg-3); }
  .desc { margin: 0; max-width: 60ch; font-size: 13px; line-height: 1.7; color: var(--fg-2); }
  .badges { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
  .by { font-size: 12px; color: var(--fg-3); }
  .acts { display: flex; flex-wrap: wrap; gap: 8px; flex: none; }
  .acts .btn { height: 32px; }
  .task { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; margin-top: -12px; font-size: 12px; color: var(--fg-2); }
  .task .tp { color: var(--fg-3); }
  .task .tb { grid-column: 1 / -1; height: 2px; background: var(--line-strong); border-radius: 1px; overflow: hidden; }
  .task .tb i { display: block; height: 100%; background: var(--fg); transition: width var(--dur); }
  .inline { display: block; margin-top: 4px; padding: 0; font-size: 12px; color: var(--fg-2); text-decoration: underline; text-underline-offset: 3px; }
  .inline:hover { color: var(--fg); }

  .facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .facts div { min-width: 0; padding: 12px 16px 12px 0; }
  .facts div + div { padding-left: 16px; border-left: 1px solid var(--line); }
  dt { font-size: 11px; font-family: var(--font-mono); letter-spacing: .06em; color: var(--fg-3); }
  dd { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; }
  .notice { margin: -12px 0 0; font-size: 12px; line-height: 1.6; color: var(--fg-2); }

  h2 { margin: 0; font-size: 14px; font-weight: 500; }
  .sh { display: flex; align-items: baseline; gap: 10px; }
  .sh span { font-size: 12px; color: var(--fg-3); }
  .mods { display: flex; flex-direction: column; gap: 14px; }
  .bar { display: flex; gap: 2px; height: 6px; border-radius: 3px; overflow: hidden; }
  .seg, .sw { background: var(--fg-4); }
  .blocked { background: var(--danger); }
  .local-only { background: var(--fg); }
  .no-versus { background: var(--fg-2); }
  .review { background: repeating-linear-gradient(135deg, var(--fg-3) 0 2px, transparent 2px 4px); }
  .any { background: #333; }
  .grp { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 12px; padding-top: 12px; border-top: 1px solid var(--line-soft); }
  .gl { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; align-content: flex-start; font-size: 13px; }
  .gl b { font-weight: 500; }
  .gl .n { font-size: 12px; color: var(--fg-3); }
  .gl .about { flex-basis: 100%; padding-left: 16px; font-size: 12px; color: var(--fg-3); }
  .sw { width: 8px; height: 8px; border-radius: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 13px; font-size: 12px; color: var(--fg-2); white-space: nowrap; }
  .st { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .st.on { background: var(--fg); }
  .st.off { background: var(--fg-4); }
  .st.unknown { border: 1px solid var(--fg-3); }
  .legend { display: flex; align-items: center; gap: 6px; margin: 2px 0 0; font-size: 12px; color: var(--fg-3); }
  .legend .st { margin-left: 4px; }

  .docs { display: flex; flex-direction: column; gap: 10px; }
  .docs p { margin: 0; font-size: 13px; }
  .doclinks { display: flex; flex-wrap: wrap; gap: 4px; margin-left: -8px; }

  .reader { width: min(720px, 92vw); max-height: min(760px, 86vh); padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-1); color: var(--fg); flex-direction: column; overflow: hidden; }
  .reader[open] { display: flex; }
  .reader::backdrop { background: #000c; }
  .reader header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px 20px; border-bottom: 1px dashed #3d3d3d; }
  .reader h2 { font-size: 15px; }
  .reader .from { flex: 1; font-size: 12px; color: var(--fg-3); }
  .reader .text { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 22px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.75; user-select: text; }

  @container pmain (max-width: 700px) {
    .grp { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  }
  @container pmain (max-width: 640px) {
    .tile { width: 48px; height: 48px; font-size: 22px; }
    .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .facts div:nth-child(odd) { padding-left: 0; border-left: 0; }
    .facts div:nth-child(n + 3) { border-top: 1px solid var(--line); }
  }
</style>
