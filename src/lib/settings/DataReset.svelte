<script lang="ts">
  // 设置页「数据与重置」：数据放在哪、缓存占多大、界面偏好导出 / 导入 / 恢复默认。
  // 目录和缓存来自后端（app-info、cache-status / cache-clear），没接上时显示「即将支持」。
  import { onMount } from 'svelte';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import FileDown from '@lucide/svelte/icons/file-down';
  import FileUp from '@lucide/svelte/icons/file-up';
  import BrushCleaning from '@lucide/svelte/icons/brush-cleaning';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { desktop } from '../api/bridge';
  import { launcherApi, formatBytes, type CacheStatus } from '../api/launcher';
  import { appInfo, loadAppInfo } from '../stores/app-info.svelte';
  import { app } from '../stores/app.svelte';
  import { agent } from '../agent';
  let { changeStorage }: { changeStorage: () => Promise<void> } = $props();

  // 界面偏好：都在 localStorage 里。书签、B站关键词是用户自己攒的，导出带上、恢复默认时保留。
  const RESET_KEYS = ['flare.prefs', 'flare.theme', 'l4d2-launcher.sound', 'matcha.ui-font', 'flare.mods.view.v2', 'flare.mods.expanded',
    'flare.servers.view', 'flare.servers.sort', 'flare.servers.hideEmpty', 'flare.servers.hideFull', 'flare.servers.auto', 'flare.servers.collapsed'];
  const EXPORT_KEYS = [...RESET_KEYS, 'flare.bili.filter', 'flare.browser.bookmarks'];

  let cache = $state<CacheStatus | null>(null);
  let cacheMissing = $state(false);
  let cleaning = $state(false);
  let importer = $state<HTMLInputElement>();

  onMount(() => { void loadAppInfo(); void loadCache(); });
  async function loadCache() {
    const r = await launcherApi.cacheStatus();
    if (r.ok) cache = r.value; else cacheMissing = r.missing || !desktop;
  }
  const folders = $derived([
    appInfo.info?.dataDir ? { label: '设置和记录', path: appInfo.info.dataDir } : null,
    appInfo.info?.storageDir ? { label:'下载与缓存位置',path:appInfo.info.storageDir } : null,
    appInfo.info?.logsDir ? { label: '日志', path: appInfo.info.logsDir } : null,
    appInfo.info?.piConfigDir || agent.configDir ? { label: '茶茶的配置', path: appInfo.info?.piConfigDir || agent.configDir! } : null,
  ].filter((f): f is { label: string; path: string } => !!f));

  async function clean() {
    if (!cache?.items.length) return;
    const ok = await app.confirm('清理缓存', '', '清理', {
      lists: [{ title: `将清理 · ${formatBytes(cache.totalBytes)}`, rows: cache.items.map(i => ({ k: i.label, v: formatBytes(i.bytes) })) }],
      facts: [{ label: '保留', value: '已下载的 Mod、方案、设置和回收站不受影响；封面等会在用到时重新下载' }],
    });
    if (!ok) return;
    cleaning = true;
    const r = await launcherApi.cacheClear(cache.items.map(i => i.id));
    cleaning = false;
    if (r.ok) app.notify({ text: `已清理 ${formatBytes(r.value.freedBytes)}`, kind: 'ok' });
    else app.toast(r.error);
    await loadCache();
  }

  function stamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
  function exportPrefs() {
    const data: Record<string, string> = {};
    for (const k of EXPORT_KEYS) { try { const v = localStorage.getItem(k); if (v !== null) data[k] = v; } catch { /* 读不到就跳过 */ } }
    const blob = new Blob([JSON.stringify({ app: 'matcha', kind: 'ui-prefs', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `matcha-界面偏好-${stamp()}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    app.toast(`已导出 ${Object.keys(data).length} 项界面偏好`);
  }
  async function importPrefs(e: Event) {
    const input = e.currentTarget as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let entries: [string, string][];
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.app !== 'matcha' || parsed?.kind !== 'ui-prefs' || typeof parsed.data !== 'object') throw new Error();
      entries = Object.entries(parsed.data as Record<string, unknown>)
        .filter((x): x is [string, string] => EXPORT_KEYS.includes(x[0]) && typeof x[1] === 'string')
        .filter(([, v]) => { try { JSON.parse(v); return true; } catch { return false; } });
      if (!entries.length) throw new Error();
    } catch { app.toast('这不是 Matcha 导出的界面偏好文件'); return; }
    if (!await app.confirm('导入界面偏好', `${file.name}\n\n覆盖这台电脑上的 ${entries.length} 项界面偏好，完成后重新载入界面。壁纸图片和导入的字体文件不在里面。`, '导入并重新载入')) return;
    try { for (const [k, v] of entries) localStorage.setItem(k, v); }
    catch { app.toast('写入本机存储失败，请检查磁盘空间'); return; }
    location.reload();
  }
  async function resetPrefs() {
    if (!await app.confirm('恢复界面默认', '', '恢复并重新载入', {
      facts: [
        { label: '恢复', value: '配色、字体、声音、缩放、聊天和下载提醒等偏好，以及 Mod 页、服务器页的视图' },
        { label: '保留', value: '游戏目录、启动项、Mod 方案、密钥、浏览器书签、B站关键词，以及导入过的壁纸和字体文件' },
      ],
    })) return;
    try { for (const k of RESET_KEYS) localStorage.removeItem(k); } catch { /* 读不到存储就没东西可清 */ }
    location.reload();
  }
</script>

<section id="set-data">
  <h2>数据与重置</h2>

  <div class="card">
    {#each folders as f (f.label)}
      <div class="line">
        <div class="lt"><b>{f.label}</b><span class="path" title={f.path}>{f.path}</span></div>
        {#if f.label === '下载与缓存位置'}
          <button class="icon-btn" title="更改下载与缓存位置" aria-label="更改下载与缓存位置" disabled={!desktop} onclick={changeStorage}><FolderSearch size={15} /></button>
        {:else}
          <button class="icon-btn" title={`打开${f.label}目录`} aria-label={`打开${f.label}`} onclick={() => app.reveal(f.path)}><FolderOpen size={15} /></button>
        {/if}
      </div>
    {/each}
    {#if desktop && appInfo.missing}
      <div class="line"><div class="lt"><b>数据目录与日志<span class="soon">即将支持</span></b></div></div>
    {/if}
    <div class="line">
      <div class="lt"><b>缓存{#if cacheMissing && desktop}<span class="soon">即将支持</span>{/if}</b>
        <span class="sub">{cache ? (cache.items.length ? `${formatBytes(cache.totalBytes)} · ${cache.items.map(i => i.label).join('、')}` : '没有可清理的缓存') : cacheMissing ? '封面、预览图和临时解包文件，清掉后用到时再下载' : '正在统计…'}</span></div>
      <button class="btn" disabled={!cache?.items.length || cleaning} onclick={clean}>{#if cleaning}<LoaderCircle size={14} class="spin" />{:else}<BrushCleaning size={14} />{/if}清理…</button>
    </div>
  </div>

  <h3>界面偏好</h3>
  <div class="card">
    <div class="line">
      <div class="lt"><b>导出与导入</b><span class="sub">配色、声音、聊天偏好、书签和 B站关键词</span></div>
      <div class="row">
        <input type="file" accept="application/json,.json" hidden bind:this={importer} onchange={importPrefs} />
        <button class="btn ghost" onclick={() => importer?.click()}><FileUp size={14} />导入…</button>
        <button class="btn" onclick={exportPrefs}><FileDown size={14} />导出</button>
      </div>
    </div>
    <div class="line">
      <div class="lt"><b>恢复界面默认</b><span class="sub">保留游戏目录、Mod 方案和密钥</span></div>
      <button class="btn" onclick={resetPrefs}><RotateCcw size={14} />恢复…</button>
    </div>
  </div>
  {#if agent.sessionFile}<p class="hint">当前和茶茶的会话：<span class="path">{agent.sessionFile}</span></p>{/if}
</section>
