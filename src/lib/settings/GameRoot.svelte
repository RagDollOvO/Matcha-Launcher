<script lang="ts">
  // 设置页「游戏目录」：Mod、DLL、启动都基于这个目录。DLL 页「运行环境」里的同一组操作留作快捷入口。
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import ScanSearch from '@lucide/svelte/icons/scan-search';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { app } from '../stores/app.svelte';
  import { desktop, errorText, pickDirectory } from '../api/bridge';

  const game = $derived(app.game);
  const root = $derived(game?.root?.replace(/[\\/]+$/, '') ?? '');
  const same = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
  const others = $derived(app.installations.filter(i => !root || !same(i.root, root)));
  const lock = $derived(game?.running ? '游戏运行中，退出后可更换' : app.busy ? `正在${app.busy}` : '');
  let manual = $state('');

  async function browse() {
    try { const dir = await pickDirectory('选择 Left 4 Dead 2 根目录'); if (dir) await app.selectGame(dir); }
    catch (e) { app.toast(errorText(e)); }
  }
</script>

<section id="set-root">
  <h2>游戏目录</h2>
  <div class="card">
    <div class="line">
      <div class="lt">
        <b>{game?.installed ? 'Left 4 Dead 2' : '还没有找到游戏'}
          {#if game?.running}<span class="w live">运行中</span>{/if}</b>
        {#if root}<span class="path" title={root}>{root}</span>{:else}<span class="sub">选择包含 left4dead2.exe 的文件夹。</span>{/if}
        {#if game?.build}<span class="sub">版本 {game.build}</span>{/if}
      </div>
      {#if root}<button class="icon-btn" title="打开目录" aria-label="打开游戏目录" onclick={() => app.reveal(root)}><FolderOpen size={15} /></button>{/if}
    </div>
    <div class="line">
      <div class="lt"><b>更换目录</b>{#if lock}<span class="sub">{lock}</span>{/if}</div>
      <div class="row">
        <button class="btn ghost" disabled={!!lock} onclick={() => app.selectGame('')}><ScanSearch size={14} />自动查找</button>
        {#if desktop}<button class="btn" disabled={!!lock} onclick={browse}><FolderSearch size={14} />选择文件夹…</button>{/if}
      </div>
    </div>
    {#each others as i (i.root)}
      <div class="line">
        <div class="lt"><b>另一个安装{#if i.build}<span class="w">版本 {i.build}</span>{/if}</b><span class="path">{i.root}</span></div>
        <button class="btn" disabled={!!lock} onclick={() => app.selectGame(i.root)}>改用这个</button>
      </div>
    {/each}
  </div>
  <details class="manual">
    <summary><ChevronRight size={14} class="chev" />手动输入路径</summary>
    <form onsubmit={(e) => { e.preventDefault(); if (manual.trim()) void app.selectGame(manual.trim()); }}>
      <input class="mono" aria-label="游戏根目录" spellcheck="false" placeholder="D:\SteamLibrary\steamapps\common\Left 4 Dead 2" bind:value={manual} />
      <button class="btn" disabled={!!lock || !manual.trim()}>检查并使用</button>
    </form>
  </details>
</section>

<style>
  .w.live { color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 13%, transparent); }
  .manual { margin-top: 10px; }
  .manual summary { display: inline-flex; align-items: center; gap: 6px; padding: 4px 2px; font-size: 12.5px; color: var(--fg-3); cursor: pointer; list-style: none; }
  .manual summary::-webkit-details-marker { display: none; }
  .manual summary:hover { color: var(--fg); }
  .manual summary :global(.chev) { transition: transform var(--dur) var(--ease-out); }
  .manual[open] summary :global(.chev) { transform: rotate(90deg); }
  .manual form { display: flex; gap: 8px; margin-top: 8px; }
  .manual input { flex: 1; min-width: 0; height: 32px; font-size: 12px; }
  .manual .btn { height: 32px; }
</style>
