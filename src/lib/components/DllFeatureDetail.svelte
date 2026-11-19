<script lang="ts">
  import type { PlatformPlugin } from '../types';
  import { GAME_MODES, pluginSummary, pluginUsage } from '../plugins/catalog';
  import { pageBlocks, pageHero } from '../plugins/page';
  import DllAsset from './DllAsset.svelte';
  import DllCover from './DllCover.svelte';
  import DllPage from './DllPage.svelte';
  import DllPluginControl from './DllPluginControl.svelte';
  import Keys from './Keys.svelte';
  import PluginActions from './PluginActions.svelte';
  import DllScreening from './DllScreening.svelte';
  import DllInfoEditor from './DllInfoEditor.svelte';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Pencil from '@lucide/svelte/icons/pencil';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { browser } from '../browser/browser.svelte';
  import { app } from '../stores/app.svelte';
  import { askAgent, changesPrompt, checkPrompt, provenanceSummary, refillPrompt, SOURCE_LABEL, sourceHasUpdate } from '../plugins/intake';
  import { desktop, errorText, pickDllPackage } from '../api/bridge';
  let { p, context = '' }: { p: PlatformPlugin; context?: string } = $props();
  /** 右栏比窗口高时，改成贴着底边停住：往下滚到右栏末尾再固定，下面的安全检查等卡片才看得到 */
  function stickyFit(node: HTMLElement) {
    const scroller = node.closest<HTMLElement>('.plugins') ?? document.scrollingElement as HTMLElement;
    const fit = () => { node.style.top = `${Math.min(0, scroller.clientHeight - node.offsetHeight - 48)}px`; };
    const ro = new ResizeObserver(fit);
    ro.observe(node); ro.observe(scroller);
    fit();
    return { destroy: () => ro.disconnect() };
  }
  let editor = $state<DllInfoEditor>();
  const prov = $derived(provenanceSummary(p));
  const update = $derived(sourceHasUpdate(p));
  const when = (iso?: string) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(+d) ? iso : d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  function ask(text: string) { app.toast(askAgent(text) === 'sent' ? '已交给茶茶，进度在右侧对话里' : '茶茶还没准备好，指令先放进对话框了'); }
  function open(url: string) { browser.open(url); app.route = 'browser'; }
  const blocked = $derived(app.game.running ? '退出游戏后可更新' : app.busy ? '正在' + app.busy : '');
  // 更新携带当前模组 ID；需整理的来源转交 Agent 时继续保留这个目标。
  async function importNewer() {
    const targetId = p.id;
    try { const file = await pickDllPackage(); if (file) await app.importPlugin(file, targetId); }
    catch (e) { app.toast(errorText(e)); }
  }
  const usage = $derived(pluginUsage(p));
  const hero = $derived(pageHero(p));
  const blocks = $derived(pageBlocks(p));
  const trustLabel = $derived(p.verification?.state === 'rejected' ? '加载核验失败' : p.verification?.state === 'verified-development' ? '开发签名已核验' : '本地开发 · 未核验');
  const now = $derived(p.installed === false ? '未安装' : p.runtimeState === 'initialized' ? '运行中' : p.runtimeState === 'failed' ? '加载失败' : '游戏未运行或未加载');
  const next = $derived(p.installed === false ? '安装后默认停用' : p.enabled ? '加载' : '不加载');
  const modes = $derived(usage.modes.length ? GAME_MODES.filter(([id]) => usage.modes.includes(id)).map(([, label]) => label).join(' · ') : '');
  const showUsage = $derived(usage.inGameMenu || usage.hotkeys.length > 0 || usage.modes.length > 0);
</script>

{#snippet art(ratio: string)}
  <div class="art" style:aspect-ratio={ratio}>
    {#if hero.image}<DllAsset plugin={p} path={hero.image} alt={p.name}/>{:else}<DllCover title={p.name} source={{ owner: p, kind: 'module' }} kind="module"/>{/if}
  </div>
{/snippet}

{#snippet identity(banner: boolean)}
  {#if !banner}<div class="eyebrow">{context || 'DLL 功能'}</div><h1>{p.name}</h1>{/if}
  {#if hero.tagline && !banner}<p class="tagline">{hero.tagline}</p>{/if}
  <p class="byline"><span>{p.author || '开发者未填写'}</span><span class="mono">v{p.version}</span>{#if modes}<span>{modes}</span>{/if}<span class="prov {prov.kind}">{#if prov.hasAgent}<Sparkles size={12}/>{:else if prov.hasUser}<Pencil size={12}/>{/if}{prov.label}</span></p>
  <p class="summary">{pluginSummary(p)}</p>
  {#if p.presentation?.tags?.length}<div class="tags">{#each p.presentation.tags as tag (tag)}<span>{tag}</span>{/each}</div>{/if}
{/snippet}

<article class="feature" style:--dev-accent={hero.accent} aria-label={p.name + ' 功能详情'}>
  <header class="hero {hero.layout}">
    {#if hero.layout === 'banner'}
      <div class="banner">
        {@render art('21 / 9')}
        <div class="over"><div class="eyebrow">{context || 'DLL 功能'}</div><h1>{p.name}</h1>{#if hero.tagline}<p class="tagline">{hero.tagline}</p>{/if}</div>
      </div>
      <div class="text">{@render identity(true)}</div>
    {:else if hero.layout === 'poster'}
      {@render art('3 / 4')}
      <div class="text">{@render identity(false)}</div>
    {:else if hero.layout === 'minimal'}
      <div class="text">{@render identity(false)}</div>
    {:else}
      <div class="text">{@render identity(false)}</div>
      {@render art('16 / 10')}
    {/if}
  </header>

  <div class="body">
    <div class="main">
      {#if prov.hasAgent}
        <div class="assist">
          <Sparkles size={15}/>
          <p>{prov.kind === 'agent' ? '这页资料' : '部分资料'}由茶茶根据「{p.provenance?.basis ?? '来源里的说明'}」整理，可能有出入。{#if p.provenance?.updatedAt}<span>整理于 {when(p.provenance.updatedAt)}</span>{/if}</p>
          <button class="btn sm ghost" onclick={() => editor?.show()}><Pencil size={12}/>编辑</button>
          <button class="btn sm ghost" onclick={() => ask(refillPrompt(p))}>重新整理</button>
        </div>
      {/if}
      {#if showUsage}
        <section class="usage" aria-label="怎么用">
          {#if usage.inGameMenu}<div><span class="k">游戏内设置</span><span class="v"><Keys keys={['Ctrl', 'F7']}/><span class="then">→</span>{p.name}</span></div>{/if}
          {#each usage.hotkeys as h, i (i)}<div><span class="k">{i ? '' : '快捷键'}</span><span class="v"><Keys keys={h.keys}/>{h.label}</span></div>{/each}
          {#if usage.modes.length}<div><span class="k">适用模式</span><span class="v modes">{#each GAME_MODES as [id, label] (id)}<span class:on={usage.modes.includes(id)} aria-label={label + (usage.modes.includes(id) ? ' 适用' : ' 不适用')}>{label}</span>{/each}</span></div>{/if}
        </section>
      {/if}
      {#if blocks.length}<DllPage plugin={p} {blocks}/>{:else}<p class="empty">开发者暂未填写功能说明。</p>{/if}
      {#if p.actions.length}
        <section class="actions"><h3>设置与操作</h3>
          {#if p.installed !== false}<PluginActions plugin={p}/>{:else}<p class="muted">安装并启用后，可在这里使用开发者提供的操作。</p>{/if}
        </section>
      {/if}
    </div>

    <aside use:stickyFit>
      <div class="card">
        <DllPluginControl {p}/>
        {#if p.managed && p.installed !== false}
          <div class="maintenance">
            {#if p.canRollback}<button class="btn sm" disabled={app.game.running || !!app.busy} onclick={()=>void app.maintainPlugin(p.id,'rollback')}>回滚上一版…</button>{/if}
            <button class="btn sm ghost" disabled={app.game.running || !!app.busy} onclick={()=>void app.maintainPlugin(p.id,'uninstall')}>卸载…</button>
          </div>
        {/if}
        <dl class="status">
          <div><dt>下次启动</dt><dd>{next}</dd></div>
          <div><dt>当前游戏</dt><dd class:live={p.runtimeState === 'initialized'} class:bad={p.runtimeState === 'failed'}>{now}</dd></div>
        </dl>
        {#if p.error}<p class="error">{p.error}</p>{/if}
        <p class="note">首页选「L4N 平台启动」进入游戏，开关在下次完整启动时生效。</p>
      </div>
      {#if p.update && p.installed !== false}
        {@const u = p.update}
        {@const risky = u.signer === 'changed' || (u.signer === 'unsigned' && p.verification?.state === 'verified-development')}
        <!-- 后台按清单声明的来源查到的新版本：先看说明，再更新 -->
        <div class="card source">
          <div class="src-head"><span>新版本</span><span class="new">v{u.version}</span></div>
          {#if u.notes}<p class="notes">{u.notes.split('\n').filter(l => l.trim()).slice(0, 4).join('\n')}</p>{/if}
          <dl class="status">
            <div><dt>当前</dt><dd>v{p.version}</dd></div>
            {#if u.publishedAt}<div><dt>发布于</dt><dd>{when(u.publishedAt)}</dd></div>{/if}
            <div><dt>签名</dt><dd class:bad={risky}>{u.signer === 'same' ? '和已装的同一个开发者' : u.signer === 'changed' ? '换了证书' : u.signer === 'unsigned' ? '新版没签名' : '没法确认'}</dd></div>
          </dl>
          {#if u.url}<button class="src-link" title={u.url} onclick={() => open(u.url!)}>查看发布页<ExternalLink size={12}/></button>{/if}
          {#if app.downloadTask(`plugin:${p.id}`)}<p class="note" role="status">正在下载新版本并做安全检查…</p>
          {:else}<button class="btn sm" class:primary={!risky} disabled={!!blocked} title={blocked || (risky ? '签名有变化，先让茶茶核对来源和发布者' : '下载到暂存区，核对签名、做危险筛查，再给你确认')} onclick={() => app.updatePluginFromSource(p)}>{risky ? '让茶茶核对' : `更新到 v${u.version}…`}</button>{/if}
        </div>
      {/if}
      {#if p.source}
        <div class="card source">
          <div class="src-head"><span>来源 · {SOURCE_LABEL[p.source.type]}</span>{#if update}<span class="new">有新版本</span>{/if}</div>
          {#if p.source.url}<button class="src-link" title={p.source.url} onclick={() => open(p.source!.url!)}>{p.source.label ?? p.source.url}<ExternalLink size={12}/></button>{:else}<span class="src-link plain">{p.source.label ?? '本地文件'}</span>{/if}
          {#if p.source.type !== 'local' || p.source.version || p.source.latest}<dl class="status">
            {#if p.source.version}<div><dt>接入时</dt><dd>{p.source.type === 'workshop' ? when(p.source.version) : p.source.version}</dd></div>{/if}
            {#if p.source.latest}<div><dt>来源最新</dt><dd class:live={update}>{#if p.source.latest.url}<button class="inline" title={p.source.latest.url} onclick={() => open(p.source!.latest!.url!)}>{p.source.latest.version ?? when(p.source.latest.publishedAt)}<ExternalLink size={11}/></button>{:else}{p.source.latest.version ?? when(p.source.latest.publishedAt)}{/if}</dd></div>{/if}
            {#if p.source.type !== 'local'}<div><dt>上次检查</dt><dd>{p.source.checkedAt ? when(p.source.checkedAt) : '还没检查过'}</dd></div>{/if}
          </dl>{/if}
          {#if p.source.type !== 'local'}
            <button class="btn sm" onclick={() => ask(update ? changesPrompt(p) : checkPrompt(p))}><Sparkles size={12}/>{update ? '让茶茶看看改了什么' : '让茶茶检查新版本'}</button>
          {:else}
            <p class="note">本地来源不会自动检查。拿到新版本后，选新的压缩包导入即可，设置和启停状态会保留。</p>
          {/if}
          {#if desktop && p.installed !== false && (update || p.source.type === 'local')}
            <button class="btn sm ghost" disabled={!!blocked} title={blocked || '选新的 SDK 压缩包，确认后替换，旧包会备份'} onclick={importNewer}>导入新版本…</button>
          {/if}
        </div>
      {/if}
      <dl class="facts">
        <div><dt>加载</dt><dd>{usage.library ? '整体加载' : `Matcha API ${p.apiVersion} · 按模块`}</dd></div>
        <div><dt>依赖</dt><dd>{p.dependencies.length ? p.dependencies.map(d => d.id).join('、') : '无'}</dd></div>
        <div><dt>架构</dt><dd>{p.architecture} · {p.phase}</dd></div>
        <div><dt>ID</dt><dd class="mono">{p.id}</dd></div>
      </dl>
      <DllScreening {p} signature={trustLabel}/>
      <button class="edit-link" onclick={() => editor?.show()}><Pencil size={12}/>编辑资料</button>
    </aside>
  </div>
</article>
<DllInfoEditor {p} bind:this={editor}/>

<style>
  .maintenance { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
  .feature { --dev-accent: var(--fg-2); }
  .eyebrow { font: 11px var(--font-mono); letter-spacing: .1em; color: var(--fg-3); }
  h1 { margin: 12px 0 0; font-size: 38px; font-weight: 600; line-height: 1.15; letter-spacing: -.02em; text-wrap: balance; }
  .tagline { margin: 12px 0 0; font-size: 17px; color: var(--dev-accent); line-height: 1.5; }
  .byline { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 18px 0 0; font-size: 13px; color: var(--fg-3); }
  .mono { font-family: var(--font-mono); }
  .summary { margin: 16px 0 0; max-width: 60ch; font-size: 15px; line-height: 1.8; color: var(--fg-2); }
  .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .tags span { padding: 2px 9px; border: 1px solid var(--line-strong); border-radius: 999px; font-size: 12px; color: var(--fg-2); }

  .hero { display: grid; gap: 40px; align-items: center; padding-bottom: 40px; border-bottom: 1px solid var(--line); }
  .hero.split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); }
  .hero.poster { grid-template-columns: minmax(160px, 280px) minmax(0, 1fr); align-items: end; }
  .hero.minimal { grid-template-columns: 1fr; }
  .hero.banner { grid-template-columns: 1fr; gap: 24px; }
  .art { width: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); }
  .banner { position: relative; }
  .banner .art { max-height: 420px; }
  .banner .over { position: absolute; left: 0; right: 0; bottom: 0; padding: 72px 32px 28px; background: linear-gradient(to top, #000000e6, #0000); border-radius: 0 0 var(--r) var(--r); }
  .banner .over h1 { font-size: 46px; }
  .banner .over .eyebrow { color: var(--fg-2); }

  .body { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 56px; align-items: start; padding-top: 40px; }
  .main { min-width: 0; }
  .usage { display: grid; margin-bottom: 40px; padding: 4px 20px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); }
  .usage > div { display: grid; grid-template-columns: 96px 1fr; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line-soft); }
  .usage > div:first-child { border-top: 0; }
  .usage .k { font-size: 13px; color: var(--fg-3); line-height: 24px; }
  .usage .v { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 13px; color: var(--fg); line-height: 24px; }
  .then { color: var(--fg-3); }
  .modes { gap: 16px; }
  .modes span { color: var(--fg-4); text-decoration: line-through; }
  .modes span.on { color: var(--fg); text-decoration: none; }
  .actions { margin-top: 48px; padding-top: 32px; border-top: 1px solid var(--line); }
  .actions h3 { margin: 0 0 18px; font-size: 15px; font-weight: 550; }
  .empty, .muted { color: var(--fg-3); font-size: 13px; }

  aside { position: sticky; top: 0; display: flex; flex-direction: column; gap: 20px; }
  .card { display: flex; flex-direction: column; gap: 16px; padding: 18px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); }
  .status, .facts { margin: 0; display: grid; }
  .status div, .facts div { display: flex; justify-content: space-between; gap: 16px; padding: 9px 0; border-top: 1px solid var(--line-soft); font-size: 13px; }
  .status div:first-child { border-top: 0; padding-top: 0; }
  dt { color: var(--fg-3); flex: none; }
  dd { margin: 0; color: var(--fg-2); text-align: right; overflow-wrap: anywhere; min-width: 0; }
  dd.live { color: var(--fg); }
  dd.bad { color: var(--danger); }
  .note { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-3); }
  .error { margin: 0; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
  .facts div:last-child { border-bottom: 1px solid var(--line-soft); }
  .prov { display: inline-flex; align-items: center; gap: 5px; }
  .prov.agent, .prov.mixed, .prov.user { color: var(--fg-2); }
  .assist { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; padding: 12px 14px 12px 16px; border: 1px dashed var(--line-strong); border-radius: var(--r); color: var(--fg-3); }
  .assist p { flex: 1; margin: 0; font-size: 13px; line-height: 1.6; color: var(--fg-2); }
  .assist p span { margin-left: 10px; font-size: 12px; color: var(--fg-3); }
  .assist .btn { gap: 5px; flex: none; }
  .source { gap: 12px; }
  .src-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--fg-3); }
  .notes { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-2); white-space: pre-line; overflow-wrap: anywhere; }
  .src-head .new { padding: 1px 7px; border: 1px solid var(--fg-3); border-radius: 999px; color: var(--fg); font-size: 11px; }
  .src-link { display: inline-flex; align-items: center; gap: 6px; padding: 0; font-size: 14px; color: var(--fg); text-align: left; overflow-wrap: anywhere; }
  button.src-link:hover { text-decoration: underline; text-underline-offset: 3px; }
  .src-link.plain { font-size: 13px; color: var(--fg-2); }
  .source .btn { align-self: flex-start; gap: 6px; height: 28px; padding: 0 10px; }
  .source .btn + .btn { margin-top: -4px; }
  .inline { display: inline-flex; align-items: center; gap: 4px; padding: 0; color: inherit; }
  .inline:hover { text-decoration: underline; text-underline-offset: 3px; }
  .edit-link { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; font-size: 12px; color: var(--fg-3); }
  .edit-link:hover { color: var(--fg); }

  @container dll (max-width: 900px) {
    .body { grid-template-columns: 1fr; gap: 40px; }
    aside { position: static; order: -1; }
  }
  @container dll (max-width: 700px) {
    .hero.split, .hero.poster { grid-template-columns: 1fr; gap: 28px; }
    .hero.split .art { order: -1; }
    .hero.poster .art { max-width: 240px; }
    h1, .banner .over h1 { font-size: 30px; }
    .banner .over { padding: 48px 20px 18px; }
  }
</style>
