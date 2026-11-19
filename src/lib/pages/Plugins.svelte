<script lang="ts">
  import { tick } from 'svelte';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Plus from '@lucide/svelte/icons/plus';
  import Package from '@lucide/svelte/icons/package';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import X from '@lucide/svelte/icons/x';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Search from '@lucide/svelte/icons/search';
  import { app } from '../stores/app.svelte';
  import { desktop, pickDirectory, errorText } from '../api/bridge';
  import DllCover from '../components/DllCover.svelte';
  import DllSourceDialog from '../components/DllSourceDialog.svelte';
  import LocalRender from '../components/LocalRender.svelte';
  import { askAgent } from '../plugins/intake';
  import DllEnvStrip from '../components/DllEnvStrip.svelte';
  import DllModuleCard from '../components/DllModuleCard.svelte';
  import RecordedDllDetails from '../components/RecordedDllDetails.svelte';
  import { recordEnabled, recordStatus } from '../plugins/recorded-dll';
  import RecordedDllSwitch from '../components/RecordedDllSwitch.svelte';
  import DllOffers from '../components/DllOffers.svelte';
  import DllUpdates from '../components/DllUpdates.svelte';
  import DllModuleRow from '../components/DllModuleRow.svelte';
  import DllLoadList from '../components/DllLoadList.svelte';
  import Menu from '../components/Menu.svelte';
  import type { MenuState } from '../components/menu';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Globe from '@lucide/svelte/icons/globe';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import DllFeatureDetail from '../components/DllFeatureDetail.svelte';
  import NativeLibraryDetail from '../components/NativeLibraryDetail.svelte';
  import RichText from '../components/RichText.svelte';
  import Toggle from '../components/Toggle.svelte';
  import { dllCatalogs, enabledCount, featureCount, pluginSummary, type DllCatalog } from '../plugins/catalog';
  import type { PlatformPlugin } from '../types';
  const RUNTIME: Record<string,string> = { absent:'未部署', installed:'已部署', restored:'已恢复原入口', installing:'安装待恢复', unowned:'目录归属待检查' };
  const SHELF = 6;

  let catalogId = $state<string | null>(null), featureId = $state<string | null>(null), group = $state<string | null>(null);
  let libraryOpen = $state(false), query = $state(''), filter = $state<'all' | 'enabled' | 'available'>('all');
  let env = $state<HTMLDialogElement>(), standard = $state<HTMLDialogElement>(), scroller = $state<HTMLElement>();
  let gamePath = $state('');
  let sources = $state<DllSourceDialog>();

  const all = $derived(dllCatalogs([...app.plugins, ...app.availablePlugins], app.platforms, app.externalPacks));
  const features = $derived([...new Map(all.flatMap(c => c.plugins).map(p => [p.id, p])).values()]);
  const records = $derived(all.flatMap(c=>c.record?[c.record]:[]));
  const counts = $derived({ all: features.length+records.length, enabled: features.filter(p => p.installed !== false && p.enabled).length+records.filter(recordEnabled).length, available: features.filter(p => p.installed === false).length+records.filter(p=>p.state==='absent').length });
  const catalog = $derived(all.find(c => c.id === catalogId));
  const feature = $derived(catalog?.plugins.find(p => p.id === featureId));
  const featureContext = $derived(catalog && feature ? [catalog.title, catalog.collections.find(c => c.plugins.some(p => p.id === feature.id) && c.id !== 'all')?.title].filter(Boolean).join(' / ') : '');
  const blocked = $derived(!app.runtime.installed ? '先部署 Matcha 加载器' : app.game.running ? '退出游戏后可修改' : app.busy ? '正在' + app.busy : '');

  const q = $derived(query.trim().toLowerCase());
  const hit = (p: PlatformPlugin) => !q || [p.name, p.id, p.author ?? '', pluginSummary(p), ...(p.presentation?.tags ?? [])].join(' ').toLowerCase().includes(q);
  const keep = (p: PlatformPlugin) => filter === 'all' || (filter === 'enabled' ? p.installed !== false && p.enabled : p.installed === false);
  // 总览：每个合集一排，合集名命中时整排保留，否则只留命中的功能
  const shelves = $derived(all.map(c => {
    const named = !!q && [c.title, c.author, c.summary].join(' ').toLowerCase().includes(q);
    const plugins = c.plugins.filter(p => (named || hit(p)) && keep(p));
    const r = c.record;
    const record = r && (!q || named || r.files.some(f=>f.path.toLowerCase().includes(q))) &&
      (filter==='all' || (filter==='enabled'?recordEnabled(r):r.state==='absent')) ? r : undefined;
    return { c, plugins, record };
  }).filter(s => s.plugins.length || s.record || (!q && filter === 'all' && s.c.platform))
    // 有功能的合集在前，空的外部平台垫底
    .sort((a, b) => Number(!a.plugins.length) - Number(!b.plugins.length)));
  const groups = $derived(catalog?.collections.filter(c => c.plugins.length) ?? []);

  async function top() { await tick(); scroller?.scrollTo({ top: 0 }); }
  function openCatalog(id: string) { libraryOpen = false; catalogId = id; featureId = null; group = null; void top(); }
  function openFeature(c: DllCatalog, id: string) { libraryOpen = false; catalogId = c.id; featureId = id; void top(); }
  function home() { libraryOpen = false; catalogId = null; featureId = null; group = null; app.platformOpen = null; void top(); }
  function back() { if (feature) featureId = null; else home(); void top(); }
  /** 更新条里点模组名：找到它所在的合集再打开 */
  function openPlugin(id: string) { const c = all.find(c => c.plugins.some(p => p.id === id)); if (c) openFeature(c, id); }
  // 「添加」：三种来源直接摊开，本机文件也在这里
  let addMenu = $state<MenuState>(null);
  function openAdd(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    addMenu = { x: r.right - 220, y: r.bottom + 6, items: [
      { label: '本机 DLL / ZIP / 文件夹', icon: FilePlus, hint: '直接导入', run: () => sources?.show('local') },
      { kind: 'sep' },
      { label: 'GitHub 仓库', icon: GitBranch, hint: '茶茶整理', run: () => sources?.show('github') },
      { label: '创意工坊链接', icon: Globe, hint: '茶茶整理', run: () => sources?.show('workshop') },
    ] };
  }
  async function browseGame() { try { const dir = await pickDirectory('选择 Left 4 Dead 2 根目录'); if (dir) { gamePath = dir; await app.selectGame(dir); } } catch (e) { app.error = errorText(e); } }
</script>

{#snippet rows(c: DllCatalog, list: PlatformPlugin[])}
  <div class="rows">{#each list as p (p.id)}<DllModuleRow {p} onopen={() => openFeature(c, p.id)}/>{/each}</div>
{/snippet}

<section class="plugins" aria-label="DLL 模组" bind:this={scroller}>
  {#if libraryOpen || catalog}
    <nav class="crumbs" aria-label="位置">
      <button class="back" onclick={back} aria-label="返回"><ArrowLeft size={15}/></button>
      <button onclick={home}>DLL 模组</button>
      {#if libraryOpen}<span>/</span><span aria-current="page">L4N 整包</span>
      {:else if catalog}<span>/</span>{#if feature}<button onclick={() => { featureId = null; void top(); }}>{catalog.title}</button><span>/</span><span aria-current="page">{feature.name}</span>{:else}<span aria-current="page">{catalog.title}</span>{/if}{/if}
    </nav>
  {/if}

  {#if libraryOpen}
    <NativeLibraryDetail/>
  {:else if feature}
    {#key feature.id}<DllFeatureDetail p={feature} context={featureContext}/>{/key}
  {:else if catalog}
    <!-- 合集主页：介绍 + 按小合集分组的功能 -->
    <header class="catalog-hero" class:solo={!catalog.cover && !catalog.platform && !catalog.record}>
      <div class="text">
        <div class="eyebrow">{catalog.record ? 'DLL 模组' : catalog.platform ? '平台模组' : catalog.id === 'local-library' ? '本机文件' : '合集'}</div>
        <h1>{catalog.title}</h1>
        <p class="byline">{catalog.author}<span>{featureCount(catalog)} 个功能 · {enabledCount(catalog)} 个启用</span></p>
        <p class="summary">{catalog.summary}</p>
        {#if catalog.id === 'local-library'}<div class="actions"><button class="btn" onclick={() => sources?.show('github')}><Plus size={14}/>添加来源</button><button class="btn ghost" onclick={() => sources?.show('local')}><Package size={14}/>本地文件</button></div>{/if}
      </div>
      {#if catalog.cover || catalog.platform || catalog.record}<div class="art"><DllCover title={catalog.title} source={catalog.cover} platformId={catalog.record?.id ?? catalog.platform?.id} kind="catalog"/></div>{/if}
    </header>
    {#if catalog.description && catalog.description !== catalog.summary}<div class="intro"><RichText text={catalog.description}/></div>{/if}
    {#if groups.length > 1}
      <div class="chips" role="tablist" aria-label="按小合集筛选">
        <button role="tab" aria-selected={!group} class:on={!group} onclick={() => group = null}>全部 <span>{catalog.plugins.length}</span></button>
        {#each groups as g (g.id)}<button role="tab" aria-selected={group === g.id} class:on={group === g.id} onclick={() => group = g.id}>{g.title} <span>{g.plugins.length}</span></button>{/each}
      </div>
    {/if}
    {#if catalog.record}<RecordedDllDetails p={catalog.record}/>{:else}
    {#each groups.filter(g => !group || g.id === group) as g (g.id)}
      <section class="group">
        {#if g.id !== 'all' || groups.length > 1}<header><h2>{g.title}</h2><p>{g.summary}</p></header>{/if}
        {@render rows(catalog, g.plugins)}
      </section>
    {:else}
      <p class="empty">{catalog.id === 'local-library' ? '尚未导入 DLL。' : catalog.platform ? catalog.description : '这个合集还没有功能。'}</p>
    {/each}{/if}
  {:else}
    <!-- 总览：一行标题 → 一条运行环境 → 筛选 → 按合集分组的卡片 -->
    <header class="head">
      <div class="ttl">
        <h1>DLL 模组</h1>
      </div>
      <div class="acts">
        <button class="icon-btn" aria-label="刷新" title="刷新" disabled={app.refreshing || !!app.busy} onclick={() => app.refresh()}><RefreshCw size={15}/></button>
        <button class="btn ghost" disabled={!!app.busy} title="按各模组声明的来源查一遍新版本，只查不下载" onclick={() => app.checkDllUpdates()}>检查更新</button>
        <button class="btn ghost" onclick={() => standard?.showModal()}><BookOpen size={14}/>开发规范</button>
        <button class="btn primary add" aria-haspopup="menu" aria-expanded={!!addMenu} onclick={openAdd}><Plus size={14}/>添加<ChevronDown size={13}/></button>
      </div>
    </header>

    <DllEnvStrip onmanage={() => env?.showModal()} onl4n={() => { libraryOpen = true; void top(); }}/>
    <DllOffers/>
    <DllUpdates onopen={openPlugin}/>

    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="筛选">
        {#each [['all', '全部'], ['enabled', '已启用'], ['available', '未安装']] as const as [value, label] (value)}
          <button role="tab" aria-selected={filter === value} class:on={filter === value} onclick={() => filter = value}>{label}<span class="n">{counts[value]}</span></button>
        {/each}
      </div>
      <label class="search"><Search size={15}/><input aria-label="搜索 DLL 功能或合集" bind:value={query} placeholder="搜索功能、合集或作者"/>{#if query}<button class="clear" aria-label="清空搜索" onclick={() => query = ''}><X size={14}/></button>{/if}</label>
    </div>

    {#each shelves as { c, plugins, record } (c.id)}
        <section class="shelf">
          <header class="shelf-head">
            <button class="shelf-title" title={c.summary} onclick={() => openCatalog(c.id)}>{c.title}<ChevronRight size={15}/></button>
            <span class="shelf-meta">{enabledCount(c)} / {featureCount(c)} 已启用</span>
            {#if plugins.length > SHELF || c.collections.length > 1}<button class="all" onclick={() => openCatalog(c.id)}>全部 {c.plugins.length} 个<ArrowRight size={13}/></button>{/if}
          </header>
          {#if record}
            <div class="rows"><DllModuleCard name={record.name} sub={[record.version && 'v'+record.version,record.author].filter(Boolean).join(' · ') || '本地 DLL'}
              off={record.control?.enabled===false} state={{text:recordStatus(record),tone:record.runtime==='loaded'?'live':recordEnabled(record)?'next':'muted'}}
              onopen={()=>openCatalog(c.id)}>
              {#snippet cover()}<DllCover title={record.name} platformId={record.id} kind="module"/>{/snippet}
              {#snippet control()}{#if record.control && record.state!=='absent'}<RecordedDllSwitch p={record}/>{:else}<button class="btn sm" aria-label={'管理 '+record.name} onclick={()=>openCatalog(c.id)}>管理</button>{/if}{/snippet}
            </DllModuleCard></div>
          {:else if plugins.length}
            {@render rows(c, plugins.slice(0, SHELF))}
          {:else}
            <button class="blank" onclick={() => openCatalog(c.id)}><span>{c.description}</span><ArrowRight size={14}/></button>
          {/if}
        </section>
    {:else}
      <p class="empty">{#if q || filter !== 'all'}没有匹配的功能。<button class="link" onclick={() => { query = ''; filter = 'all'; }}>清除筛选</button>{:else}还没有 DLL 功能，点右上角「添加」导入。{/if}</p>
    {/each}

    {#if !q && filter === 'all'}<DllLoadList/>{/if}
  {/if}
</section>

<DllSourceDialog bind:this={sources}/>
{#if addMenu}<Menu items={addMenu.items} x={addMenu.x} y={addMenu.y} onclose={() => addMenu = null}/>{/if}

<dialog bind:this={env} class="envd" aria-labelledby="env-title" oncancel={(e) => { e.preventDefault(); env?.close(); }}>
  <header>
    <h2 id="env-title">运行环境</h2>
    <button class="icon-btn" type="button" aria-label="关闭" onclick={() => env?.close()}><X size={16} /></button>
  </header>
  <div class="body">
    <section>
      <div class="section-label">游戏目录</div>
      <p class="path mono">{app.game.root || '尚未找到完整的 Steam 游戏安装'}</p>
      <form onsubmit={(e) => { e.preventDefault(); void app.selectGame(gamePath.trim()); }}>
        <input aria-label="游戏根目录" placeholder="粘贴包含 left4dead2.exe 的目录" bind:value={gamePath} />
        <button class="btn" disabled={!!app.busy || !gamePath.trim()}>检查</button>
        {#if desktop}<button class="btn" type="button" disabled={!!app.busy} onclick={browseGame}>浏览…</button>{/if}
        <button class="btn ghost" type="button" disabled={!!app.busy} onclick={() => app.selectGame('')}>自动探测</button>
      </form>
    </section>
    <section>
      <div class="rh"><div class="section-label">Matcha 加载器</div><span class="tag">{RUNTIME[app.runtime.status] ?? app.runtime.status}</span><span class="grow"></span><span class="conn">{app.runtime.connected ? `● 已连接 · PID ${app.game.pid}` : '○ 等待游戏连接'}</span></div>
      <p class="mono small">ABI {app.runtime.apiVersion} · x86 · {app.runtime.phase} · {app.runtime.dir}</p>
       {#if app.runtime.host==='legacy-dxvk'}<p class="small">旧版加载器使用渲染入口。先恢复原入口，启用 L4N 后可用子插件方式重新启用 Matcha。</p>{/if}
      <div class="row">
        {#if app.runtime.status === 'absent' && app.nativeLibraries?.l4n.enabled}<button class="btn primary" disabled={!app.game.installed || app.game.running || !!app.busy} onclick={() => app.installRuntime()}>部署 Matcha 加载器</button>{/if}
        {#if app.runtime.status === 'restored'}<button class="btn primary" disabled={app.game.running || !!app.busy} onclick={() => app.resumeRuntime()}>重新启用加载器</button>{/if}
        {#if app.runtime.installed}<button class="btn" disabled={app.game.running || !!app.busy} onclick={() => app.restoreRuntime()}>恢复原入口</button>{/if}
        {#if app.runtime.pendingOperations.length || app.runtime.status === 'installing'}<button class="btn" disabled={app.game.running || !!app.busy} onclick={() => app.restoreRuntime(true)}>恢复在途操作</button>{/if}
        {#if app.game.running}<span class="muted small">游戏退出后可修改部署。</span>{/if}
      </div>
    </section>
    <section><div class="section-label">DXVK · 本机渲染入口</div>
      <LocalRender entries={app.nativeLibraries?.dxvk.entries} details/>
      {#if app.nativeLibraries?.dxvk.entries?.some(e=>e.kind==='unknown' || e.kind==='dxvk' && !e.version) || app.nativeLibraries?.l4n.installed && !app.nativeLibraries.l4n.version}
        <button class="btn sm" onclick={()=>{env?.close();askAgent('请只读核对当前游戏目录的 L4N、默认 d3d9.dll 和 bin/dxvk_d3d9.dll 的本机版本。区分文件和历史日志，报告证据，保持原文件。')}}>请茶茶核对版本</button>
      {/if}
    </section>
    {#if app.issues.length}
      <section>
        <div class="section-label">检测提示 · {app.issues.length}</div>
        {#each app.issues as issue, i (i)}<p class="small issue">{issue.message} <span class="mono muted">[{issue.code}]</span></p>{/each}
      </section>
    {/if}
  </div>
  <footer>
    <span class="muted small">最近检测 {app.checkedAt ? new Date(app.checkedAt).toLocaleTimeString() : '—'}</span>
    <span class="grow"></span>
    <button class="btn" disabled={app.refreshing || !!app.busy} onclick={() => app.refresh()}>{app.refreshing ? '检测中…' : '刷新状态'}</button>
  </footer>
</dialog>

<dialog bind:this={standard} class="envd" aria-labelledby="standard-title">
  <header><h2 id="standard-title">DLL 模组开发规范</h2><button class="icon-btn" aria-label="关闭规范" onclick={() => standard?.close()}><X size={16}/></button></header>
  <div class="body">
    <section><h3>快速开始<span class="ch">第 1 章</span></h3><p>先用自带的「物资雷达」走一遍完整流程：在本页点它的「安装」，「抹茶模组设置」会一起装上；打开开关，回主页用「L4N 平台」启动，进游戏按 Ctrl F7 选「物资雷达」。再回来点它的卡片，看 presentation 写出来的详情页长什么样。</p><p>做自己的模组，复制 demo.hello 起步：换成自己的 ID、显示名和作者，让 DLL 返回的 id、version 与 manifest 一致，构建后从「添加 → 本机 DLL / ZIP / 文件夹」导入。</p></section>
    <section><h3>一个功能，一个包<span class="ch">第 2–3 章</span></h3><p>目录里放 plugin.dll 和 manifest.json，封面、图片、游戏素材按需加。ID 用你自己的前缀（如 ragdoll.supply-radar），发布后保持不变；同一功能放进多个小合集时共享启停。</p></section>
    <section><h3>动作与结果<span class="ch">第 4 章</span></h3><p>在 actions 里声明动作和参数，详情页自动生成控件，写操作先经玩家确认，茶茶也用同一套动作。结果带上 flare.report.v1 就显示成报表。</p></section>
    <section><h3>详情页由你编排<span class="ch">第 5 章</span></h3><p>都写在 presentation 里：catalog / collections 决定放进哪个合集，hero 选头图版式和强调色，page 按顺序排内容块：文字、图片、截图墙、前后对比、按键、步骤、提示、参数表、更新记录、链接、致谢、视频。</p><p>图片用包内相对路径（PNG / JPEG / WebP / GIF，4 MiB 内），链接只收 https，文字一律按纯文本显示。</p></section>
    <section><h3>游戏内设置<span class="ch">第 6 章</span></h3><p>声明依赖 flare.game-ui，在 init 里注册模块，就会出现在 Ctrl F7 菜单里。用默认控件，或接管成自己的编辑器。</p></section>
    <section><h3>写代码<span class="ch">第 7–8 章</span></h3><p>x86 DLL 导出 L4P_GetPluginApi，身份和版本与 manifest 一致。要游戏帧、实体、绘制、声音或素材，依赖 beacon.source。</p></section>
    <section><h3>交付与更新<span class="ch">第 9.1 章</span></h3><p>一个功能发一个 ZIP，在「添加」里直接导入，首次默认停用；普通 DLL 和缺文件的包交给茶茶整理。同一个 ID 再导入就是更新：旧包整体备份，兼容的设置和启停保留。</p><p>在 developer.updates 指向 GitHub Release，玩家装的本地 ZIP 也能收到新版提醒；附件 label 写 matcha-signer:证书指纹，换签或撤签会在下载前提示。</p></section>
    <section><h3>安全检查与核验<span class="ch">第 9.2–9.3 章</span></h3><p>导入前会筛查 DLL 的导入表、字符串和签名。跨进程注入、凭据线索加联网这类组合直接拦下；联网、启动外部程序、全局钩子会列给玩家确认。想显示「开发签名已核验」，按 9.2 填 developer 声明，生成 release.json 并签名。</p></section>
    <section><h3>本地调试<span class="ch">第 10 章</span></h3><p>配好 x86 工具链后构建自己的目标，导入前用 validate-plugin 检查包。离线宿主不用进游戏就能调一次动作，确认身份、版本和返回结果都对，再进游戏实测。</p></section>
  </div>
  <footer class="spec-ref">
    <div><span class="section-label">完整规范</span><p class="mono">安装目录\docs\platform\DLL_SPEC.md</p></div>
    <div><span class="section-label">完整样例</span><p class="mono">ragdoll.supply-radar（包内 source\ 带源码）</p></div>
  </footer>
</dialog>

<style>
  .plugins { position: absolute; inset: 0; overflow-y: auto; padding: 22px 28px 64px; container: dll / inline-size; }
  .eyebrow { display: flex; align-items: center; gap: 8px; font: 11px var(--font-mono); letter-spacing: .12em; color: var(--fg-3); }
  h1 { margin: 12px 0 0; font-size: 34px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 20px; }
  .actions .btn { gap: 6px; }

  /* ---------- 总览：标题行 ---------- */
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  .ttl { min-width: 0; }
  .head h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0; line-height: 1.3; }
  .acts { display: flex; align-items: center; gap: 6px; flex: none; }
  .acts .btn { height: 32px; padding: 0 14px; border-radius: 12px; }
  .acts .icon-btn { width: 32px; height: 32px; border-radius: 12px; }
  .acts .add { padding-right: 10px; }
  .acts .add :global(svg:last-child) { margin-left: -2px; opacity: .8; }

  /* ---------- 筛选：和 Mod 页同一套填充胶囊 ---------- */
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 22px 0 4px; }
  .seg { display: inline-flex; flex: none; gap: 2px; padding: 3px; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); }
  .seg button { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; height: 26px; padding: 0 10px; border-radius: 9px; color: var(--fg-2); font-size: 13px; transition: background var(--dur), color var(--dur); }
  .seg button:hover { color: var(--fg); }
  .seg button.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .seg .n { font-size: 12px; color: var(--fg-3); }
  .seg button.on .n { color: inherit; opacity: .7; }
  .search { display: flex; align-items: center; gap: 6px; height: 32px; flex: 0 1 260px; min-width: 140px; padding: 0 8px 0 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); border: 1px solid transparent; border-radius: 12px; color: var(--fg-4); transition: border-color var(--dur), background var(--dur); }
  .search:focus-within { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); background: color-mix(in srgb, var(--md-surface-bright) 85%, transparent); }
  .search input { border: 0; background: none; padding: 0; flex: 1; min-width: 0; height: 100%; font-size: 13px; }
  .search .clear { display: grid; place-items: center; color: var(--fg-3); }
  .search .clear:hover { color: var(--fg); }

  /* ---------- 合集分组：一行小标题 + 卡片网格，组与组之间只靠留白 ---------- */
  .rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
  .shelf { padding-top: 22px; }
  .shelf-head { display: flex; align-items: center; gap: 12px; min-height: 28px; margin-bottom: 10px; }
  .shelf-title { display: inline-flex; align-items: center; gap: 2px; font-size: 15px; font-weight: 600; color: var(--fg); }
  .shelf-title :global(svg) { color: var(--fg-4); transition: transform var(--dur) var(--ease-out), color var(--dur); }
  .shelf-title:hover :global(svg) { color: var(--fg-2); transform: translateX(2px); }
  .shelf-meta { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .shelf-head .all { margin-left: auto; }
  .all { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: 9px; font-size: 12px; color: var(--fg-2); transition: background var(--dur), color var(--dur); }
  .all:hover { background: var(--hover); color: var(--fg); }
  .blank { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; padding: 16px 18px; border: 1px solid var(--island-line); border-radius: 16px; background: color-mix(in srgb, var(--md-surface-bright) 40%, transparent); text-align: left; font-size: 13px; line-height: 1.6; color: var(--fg-3); transition: background var(--dur), color var(--dur); }
  .blank:hover { background: color-mix(in srgb, var(--md-surface-bright) 70%, transparent); color: var(--fg-2); }
  .blank :global(svg) { flex: none; }

  .empty { padding: 48px 0; color: var(--fg-3); font-size: 13px; }
  .link { margin-left: 10px; color: var(--fg-2); text-decoration: underline; text-underline-offset: 3px; }

  .crumbs { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; font-size: 13px; color: var(--fg-3); flex-wrap: wrap; }
  .crumbs .back { display: grid; place-items: center; width: 28px; height: 28px; margin-right: 4px; border: 1px solid var(--line); border-radius: var(--r); color: var(--fg-2); }
  .crumbs .back:hover { border-color: var(--fg-4); color: var(--fg); }
  .crumbs button:not(.back):hover { color: var(--fg); }
  .crumbs [aria-current] { color: var(--fg-2); }

  .catalog-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 48px; align-items: center; padding-bottom: 36px; border-bottom: 1px solid var(--line); }
  .catalog-hero.solo { grid-template-columns: 1fr; }
  .catalog-hero .art { aspect-ratio: 16 / 10; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r); }
  .byline { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 16px 0 0; font-size: 13px; color: var(--fg-3); }
  .summary { margin: 14px 0 0; max-width: 56ch; font-size: 15px; line-height: 1.8; color: var(--fg-2); }
  .intro { max-width: 72ch; padding: 28px 0 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 28px 0 4px; }
  .chips button { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; color: var(--fg-2); }
  .chips button span { font: 11px var(--font-mono); color: var(--fg-4); }
  .chips button.on { border-color: var(--fg); color: var(--fg); }
  .group { padding-top: 28px; }
  .group header { display: flex; align-items: baseline; gap: 16px; padding-bottom: 12px; }
  .group h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .group header p { margin: 0; font-size: 12px; color: var(--fg-3); }

  @container dll (max-width: 700px) {
    .plugins { padding: 18px 16px 56px; }
    .head { flex-wrap: wrap; }
    .toolbar { flex-wrap: wrap; }
    .search { flex: 1 1 100%; }
    .catalog-hero { grid-template-columns: 1fr; gap: 24px; }
    .catalog-hero .art { order: -1; }
    h1 { font-size: 28px; }
  }
  @container dll (max-width: 360px) { .rows { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: reduce) { .shelf-title :global(svg) { transition: none; } }

  /* ---------- 对话框 ---------- */
  .envd { width: min(600px, 92vw); max-height: min(720px, 86vh); padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-1); color: var(--fg); flex-direction: column; overflow: hidden; }
  .envd[open] { display: flex; }
  .envd::backdrop { background: #000c; }
  .envd header { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 8px 20px; }
  .envd h2 { margin: 0; font-size: 16px; font-weight: 500; }
  .envd h3 { display: flex; align-items: baseline; gap: 10px; margin: 0; font-size: 14px; font-weight: 550; }
  .envd h3 .ch { margin-left: auto; font: 11px var(--font-mono); font-weight: 400; color: var(--fg-4); }
  .envd .spec-ref { align-items: flex-start; gap: 28px; }
  .envd .spec-ref > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .envd .spec-ref .mono { font-size: 12px; color: var(--fg-2); overflow-wrap: anywhere; }
  .envd .body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 20px 8px; display: flex; flex-direction: column; }
  .envd section { display: flex; flex-direction: column; gap: 8px; padding: 14px 0; }
  .envd section + section { border-top: 1px solid var(--line); }
  .envd p { margin: 0; color: var(--fg-2); line-height: 1.75; font-size: 13px; }
  .path { font-size: 12px; color: var(--fg) !important; overflow-wrap: anywhere; user-select: text; }
  .envd form, .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .envd input { flex: 1; min-width: 200px; height: 32px; }
  .envd .btn { height: 32px; }
  .rh { display: flex; align-items: center; gap: 8px; }
  .grow { flex: 1; }
  .conn, .small { font-size: 12px; }
  .conn { color: var(--fg-2); }
  .muted { color: var(--fg-3); }
  .mono { font-family: var(--font-mono); }
  .issue { overflow-wrap: anywhere; }
  .envd footer { display: flex; align-items: center; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--line); }
</style>
