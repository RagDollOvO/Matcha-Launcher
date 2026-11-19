<script lang="ts">
  // 设置页「存储」：下载与缓存放哪个盘、各部分占多少、逐项清理。契约见 docs/storage-handoff.md。
  // 后端没接上时：位置一行显示「即将支持」，回收站仍用 snapshot 里的真实大小，并能清空。
  import { onMount } from 'svelte';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import BrushCleaning from '@lucide/svelte/icons/brush-cleaning';
  import Link2 from '@lucide/svelte/icons/link-2';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Toggle from '../components/Toggle.svelte';
  import { desktop, onBridgeEvent, pickDirectory } from '../api/bridge';
  import { formatBytes } from '../api/launcher';
  import { storageApi, type CleanKind, type StorageStatus, type StorageUsage, type UsageId, type Volume } from '../api/storage';
  import { appInfo, loadAppInfo } from '../stores/app-info.svelte';
  import { app } from '../stores/app.svelte';

  let status = $state<StorageStatus | null>(null);
  let missing = $state(false);
  let loadError = $state('');
  let loading = $state(false);
  let working = $state('');

  async function load() {
    loading = true;
    const r = await storageApi.get();
    loading = false;
    if (r.ok) { if(appInfo.info)appInfo.info.storageDir=r.value.location.displayPath ?? r.value.location.path;status = r.value; missing = false; loadError = ''; }
    else { missing = r.missing || !desktop; loadError = r.missing ? '' : r.error; }
  }
  onMount(() => {
    void loadAppInfo(); void load();
    const off = onBridgeEvent((e) => { if (e.type === 'storage_changed') void load(); });
    return off;
  });
  // 搬家期间每秒刷新一次进度（后端也会发 storage_changed）
  $effect(() => {
    if (status?.move?.state !== 'moving') return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  });

  // ---------- 位置 ----------
  const loc = $derived(status?.location);
  const drive = (v: Volume) => v.label ? `${v.label}（${v.root.replace(/\\$/, '')}）` : v.root.replace(/\\$/, '');
  const usedPct = (v: Volume) => (v.totalBytes ? Math.min(100, Math.max(0, (1 - v.freeBytes / v.totalBytes) * 100)) : 0);
  const moving = $derived(status?.move?.state === 'moving');
  const busy = $derived(!!working || moving);
  /** 会跟着位置一起搬走的部分 */
  const movable = $derived((status?.usage ?? []).filter(u => u.where === 'storage').reduce((n, u) => n + u.bytes, 0));

  async function moveTo(path: string) {
    if (!status || busy) return;
    const key = (v: string) => v.replace(/[\\/]+$/, '').toLowerCase();
    const same = [status.location.path, status.location.displayPath].some(v => v && key(path) === key(v));
    if (same && !status.location.pendingBytes && !status.move) { app.toast('已在使用这个位置'); return; }
    if (same) path = status.location.path;
    const ok = await app.confirm(same ? '把旧位置的文件搬过来' : '更换下载与缓存位置', '', same ? '搬过来' : '换到这里', {
      facts: [
        ...(same ? [{ label: '从', value: status.location.pendingPath ?? '旧位置' }] : [{ label: '从', value: status.location.path }]),
        { label: '到', value: path },
        { label: '要搬', value: formatBytes(same ? status.location.pendingBytes ?? 0 : movable) },
        { label: '注意', value: '搬的时候不能下载；内置浏览器的缓存下次打开 Matcha 时生效。设置、方案和茶茶的配置不动' },
      ],
    });
    if (!ok) return;
    working = 'move';
    const r = await storageApi.move(path);
    working = '';
    if (!r.ok) { app.toast(r.missing ? '当前版本还不能更换位置' : r.error); return; }
    await load();
  }
  export async function browse() {
    if (!desktop) return;
    if (busy) { app.toast('正在处理存储文件，请稍后更换位置'); return; }
    if (!status) { await load(); if (!status) { app.toast(loadError || '下载与缓存位置尚未就绪'); return; } }
    try { const dir = await pickDirectory('选择下载与缓存位置'); if (dir) await moveTo(dir); }
    catch (e) { app.toast(String(e)); }
  }

  // ---------- 占用 ----------
  const META: Record<UsageId, { label: string; detail: string; color: string }> = {
    library: { label: 'Mod 独立库', detail: '从 Matcha 下载的创意工坊 Mod', color: 'var(--md-primary)' },
    deployed: { label: '已启用的副本', detail: '', color: 'color-mix(in srgb, var(--md-primary) 55%, var(--md-surface))' },
    trash: { label: '回收站', detail: '删掉的 Mod 先放这里，清空后才腾出空间', color: 'var(--md-error)' },
    downloads: { label: '网页和 GameMaps 下载', detail: '下载下来的压缩包和文件', color: 'var(--md-tertiary)' },
    'browser-cache': { label: '内置浏览器缓存', detail: '网页的图片和脚本，清掉不会退出登录', color: 'var(--md-secondary)' },
    components: { label: '组件与模组缓存', detail: 'L4N、DXVK 和 DLL 模组的下载包', color: 'color-mix(in srgb, var(--md-secondary) 50%, var(--md-surface))' },
    'app-data': { label: '设置与记录', detail: '方案、任务记录、日志和茶茶的配置，很小，留在 C 盘', color: 'var(--md-outline)' },
  };
  const ORDER: UsageId[] = ['library', 'deployed', 'downloads', 'trash', 'browser-cache', 'components', 'app-data'];
  const WHERE = { game: '游戏盘', storage: '下载位置', appdata: 'C 盘' } as const;

  // 回收站：后端没给时用 snapshot 里的条目
  const trashBytes = $derived(app.trash.reduce((n, t) => n + t.sizeBytes, 0));
  const rows = $derived.by((): StorageUsage[] => {
    const list = status?.usage ?? [];
    const out = ORDER.map(id => list.find(u => u.id === id)).filter((u): u is StorageUsage => !!u);
    if (!out.some(u => u.id === 'trash')) out.splice(Math.min(3, out.length), 0, { id: 'trash', bytes: trashBytes, where: 'game' });
    return out;
  });
  const total = $derived(rows.reduce((n, u) => n + u.bytes, 0));

  function detail(u: StorageUsage) {
    if (u.id === 'deployed') return u.mode === 'link' ? '硬链接，不额外占空间' : '每个启用的独立库 Mod 在 addons 里复制了一份';
    if (u.id === 'downloads' && u.reclaimableBytes) return `其中 ${formatBytes(u.reclaimableBytes)} 是已经导入过的压缩包，可以清理`;
    if (u.id === 'trash') return app.trash.length ? `${app.trash.length} 个 Mod · ${META.trash.detail}` : '空的';
    return META[u.id].detail;
  }

  async function clean(kind: CleanKind, title: string) {
    if (busy) return;
    working = kind;
    const p = await storageApi.cleanPreview([kind]);
    if (!p.ok) { working = ''; app.toast(p.missing ? '当前版本还不能在这里清理' : p.error); return; }
    if (!p.value.totalBytes) { working = ''; app.toast('没有可以清理的内容'); return; }
    const ok = await app.confirm(title, '', kind === 'relink-deployed' ? '改成硬链接' : '清理', {
      lists: [{ title: `${kind === 'relink-deployed' ? '可以省下' : '将清理'} · ${formatBytes(p.value.totalBytes)}`, rows: p.value.items.map(i => ({ k: i.label, v: `${i.files} 个文件 · ${formatBytes(i.bytes)}` })) }],
      facts: kind === 'imported-downloads' ? [{ label: '保留', value: '导入好的 Mod 和下载记录都留着，想要原文件时可以重新下载' }]
        : kind === 'browser-cache' ? [{ label: '保留', value: '登录状态、书签和标签页' }]
        : [{ label: '说明', value: '启用的 Mod 不变，只是 addons 里的副本和库里的文件共用同一份数据' }],
    });
    if (!ok) { working = ''; return; }
    const r = await storageApi.clean([kind]);
    working = '';
    if (r.ok) app.notify({ text: `腾出了 ${formatBytes(r.value.freedBytes)}`, kind: 'ok' });
    else app.toast(r.error);
    await load();
  }
  async function setArchives(on: boolean) {
    const r = await storageApi.set({ deleteArchivesAfterImport: on });
    if (r.ok) status = r.value; else app.toast(r.missing ? '当前版本还不能修改这个开关' : r.error);
  }
  const ago = $derived(status ? new Date(status.scannedAt).toLocaleTimeString().slice(0, 5) : '');
</script>

<section id="set-storage">
  <h2>存储</h2>

  <!-- ---------- 位置 ---------- -->
  <div class="card">
    {#if status && loc}
      <div class="line loc">
        <div class="lt">
          <b>下载与缓存位置
            {#if loc.volume.system}<span class="w warn"><TriangleAlert size={11} />系统盘</span>{:else if status.gameVolume && loc.volume.root === status.gameVolume.root}<span class="w ok">和游戏同盘</span>{/if}
          </b>
          <span class="path" title={loc.displayPath ?? loc.path}>{loc.displayPath ?? loc.path}</span>
          <span class="disk"><i style="width:{usedPct(loc.volume)}%" class:low={loc.volume.freeBytes < loc.volume.totalBytes * 0.1}></i></span>
          <span class="sub">{drive(loc.volume)} 还剩 {formatBytes(loc.volume.freeBytes)}，共 {formatBytes(loc.volume.totalBytes)}</span>
        </div>
        <div class="row">
          <button class="icon-btn" title="打开" aria-label="打开下载与缓存位置" onclick={() => app.reveal(loc.path)}><FolderOpen size={15} /></button>
          <button class="btn" disabled={busy || !desktop} title={desktop ? undefined : '桌面版可用'} onclick={browse}><FolderSearch size={14} />更改…</button>
        </div>
      </div>
      {#if loc.volume.system}
        {#each status.suggestions.filter(s => !s.volume.system) as s (s.path)}
          <div class="line">
            <div class="lt"><b>{s.label}</b><span class="path" title={s.path}>{s.path}</span><span class="sub">{drive(s.volume)} 还剩 {formatBytes(s.volume.freeBytes)}</span></div>
            <button class="btn primary" disabled={busy} onclick={() => moveTo(s.path)}><ArrowRightLeft size={14} />换到这里</button>
          </div>
        {/each}
      {/if}
      {#if status.move}
        <div class="line">
          <div class="lt">
            <b>{status.move.state === 'moving' ? '正在搬过去…' : '没搬完'}</b>
            <span class="disk prog"><i style="width:{status.move.totalBytes ? (status.move.doneBytes / status.move.totalBytes) * 100 : 0}%"></i></span>
            <span class="sub">{formatBytes(status.move.doneBytes)} / {formatBytes(status.move.totalBytes)}{status.move.error ? ` · ${status.move.error}` : ''}</span>
          </div>
          {#if status.move.state === 'failed'}<button class="btn" disabled={!!working} onclick={() => moveTo(status!.move!.to)}>继续</button>{/if}
        </div>
      {:else if loc.pendingBytes}
        <div class="line">
          <div class="lt"><b>旧位置还有 {formatBytes(loc.pendingBytes)}</b>{#if loc.pendingPath}<span class="path" title={loc.pendingPath}>{loc.pendingPath}</span>{/if}</div>
          <button class="btn" disabled={busy} onclick={() => moveTo(loc.path)}><ArrowRightLeft size={14} />搬过来…</button>
        </div>
      {/if}
      {#if status?.profileError}<p class="sub">{status.profileError}</p>{/if}
      <div class="line">
        <div class="lt"><b>导入成功后删掉下载的压缩包</b><span class="sub">仅清理网页和 GameMaps 地图压缩包，保留下载记录。</span></div>
        <Toggle on={status.deleteArchivesAfterImport} onchange={() => setArchives(!status!.deleteArchivesAfterImport)} label="导入成功后删掉下载的压缩包" />
      </div>
    {:else if loadError}
      <div class="line"><div class="lt"><b>下载与缓存位置</b><span class="sub">{loadError}</span></div><button class="btn" onclick={load}>重试</button></div>
    {:else if missing}
      <div class="line">
        <div class="lt"><b>下载与缓存位置<span class="soon">即将支持</span></b>
          <span class="sub">网页下载、GameMaps 和浏览器缓存使用数据目录。</span>
          {#if appInfo.info?.dataDir}<span class="path" title={appInfo.info.dataDir}>{appInfo.info.dataDir}</span>{/if}
        </div>
        {#if appInfo.info?.dataDir}<button class="icon-btn" title="打开" aria-label="打开数据目录" onclick={() => app.reveal(appInfo.info!.dataDir)}><FolderOpen size={15} /></button>{/if}
      </div>
    {:else}
      <div class="line"><div class="lt"><b>下载与缓存位置</b><span class="sub"><LoaderCircle size={12} class="spin" /> 正在统计…</span></div></div>
    {/if}
  </div>

  <!-- ---------- 占用 ---------- -->
  <h3>占用{#if total}<span class="w">{formatBytes(total)}</span>{/if}</h3>
  <div class="card">
    {#if total}
      <div class="stack-bar" role="img" aria-label="各部分占用比例">
        {#each rows.filter(u => u.bytes > 0) as u (u.id)}<i style="flex:{u.bytes};background:{META[u.id].color}" title="{META[u.id].label} · {formatBytes(u.bytes)}"></i>{/each}
      </div>
    {/if}
    {#each rows as u (u.id)}
      <div class="line use">
        <span class="dot" style="background:{META[u.id].color}"></span>
        <div class="lt">
          <b>{META[u.id].label}<span class="w">{WHERE[u.where]}</span></b>
          <span class="sub">{detail(u)}</span>
        </div>
        <span class="size mono">{u.id === 'deployed' && u.mode === 'link' ? '0' : formatBytes(u.bytes)}</span>
        <div class="row act">
          {#if u.id === 'trash'}
            <button class="btn" disabled={!app.trash.length || busy} onclick={() => app.purgeTrash('all')}><Trash2 size={14} />清空…</button>
          {:else if u.id === 'downloads'}
            <button class="btn" disabled={!u.reclaimableBytes || busy} onclick={() => clean('imported-downloads', '清理已导入的压缩包')}>{#if working === 'imported-downloads'}<LoaderCircle size={14} class="spin" />{:else}<BrushCleaning size={14} />{/if}清理…</button>
          {:else if u.id === 'browser-cache'}
            <button class="btn" disabled={!u.bytes || busy} onclick={() => clean('browser-cache', '清除内置浏览器缓存')}>{#if working === 'browser-cache'}<LoaderCircle size={14} class="spin" />{:else}<BrushCleaning size={14} />{/if}清除…</button>
          {:else if u.id === 'deployed' && u.mode === 'copy'}
            <button class="btn" disabled={!u.bytes || busy || app.game?.running} title={app.game?.running ? '游戏运行中，退出后再改' : undefined} onclick={() => clean('relink-deployed', '把副本改成硬链接')}>{#if working === 'relink-deployed'}<LoaderCircle size={14} class="spin" />{:else}<Link2 size={14} />{/if}改成硬链接…</button>
          {:else if u.path}
            <button class="icon-btn" title="打开" aria-label={`打开${META[u.id].label}`} onclick={() => app.reveal(u.path!)}><FolderOpen size={15} /></button>
          {/if}
        </div>
      </div>
    {/each}
    {#if missing}
      <p class="note">当前仅统计回收站。</p>
    {/if}
  </div>
  {#if status}
    <p class="hint">{ago} 统计<button class="link" disabled={loading} onclick={load}>{#if loading}<LoaderCircle size={12} class="spin" />{:else}<RefreshCw size={12} />{/if}重新统计</button></p>
  {/if}
</section>

<style>
  .w.warn { gap: 3px; color: var(--md-on-error-container); background: var(--md-error-container); }
  .w.ok { color: var(--md-on-primary-container); background: var(--md-primary-container); }
  .loc .lt { gap: 4px; }
  .disk { display: block; width: min(320px, 100%); height: 6px; margin: 3px 0 1px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--md-on-surface) 9%, transparent); }
  .disk i { display: block; height: 100%; border-radius: inherit; background: var(--md-primary); transition: width 400ms var(--ease-out); }
  .disk i.low { background: var(--md-error); }
  .disk.prog { width: 100%; }

  .stack-bar { display: flex; gap: 2px; height: 10px; margin: 16px 18px 6px; border-radius: 5px; overflow: hidden; }
  .stack-bar i { min-width: 3px; transition: flex 400ms var(--ease-out); }
  .use { gap: 14px; }
  .dot { flex: none; width: 10px; height: 10px; border-radius: 3px; }
  .size { flex: none; min-width: 72px; text-align: right; font-size: 12.5px; color: var(--fg); font-variant-numeric: tabular-nums; }
  .act { min-width: 112px; }
  .hint .link { margin-left: 6px; }
  .hint .link:disabled { opacity: .5; cursor: default; }
</style>
