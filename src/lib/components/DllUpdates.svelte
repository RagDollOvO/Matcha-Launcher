<script lang="ts">
  // DLL 页的「可以更新」：加载器、L4N / DXVK、来源有新版的模组，一处看全。
  // 签名换了或没签名的新版不给一键更新，先交给茶茶核对。
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { app } from '../stores/app.svelte';

  let { onopen }: { onopen?: (pluginId: string) => void } = $props();
  const list = $derived(app.dllUpdates);
  const lock = $derived(app.game.running ? '退出游戏后再更新' : app.busy ? `正在${app.busy}` : '');
  const plugin = (id: string) => app.plugins.find(p => p.id === id);
  const pct = (done: number, total: number | null) => (total ? Math.min(100, Math.floor((done / total) * 100)) : null);

  function run(u: (typeof list)[number]) {

    if (u.kind === 'library') return app.updateNativeLibrary();
    const p = plugin(u.id);
    if (p) return app.updatePluginFromSource(p);
  }
  const warn = (id: string) => { const s = plugin(id)?.update?.signer; return s === 'changed' ? '签名换了' : s === 'unsigned' ? '新版没签名' : ''; };
</script>

{#if list.length}
  <section class="updates" aria-label="可以更新">
    <header><h2>可以更新 <span class="n">{list.length}</span></h2><p>先查看文件变化，再确认更新。旧版本会备份。</p></header>
    <ul>
      {#each list as u (u.key)}
        {@const task = u.kind === 'plugin' ? app.downloadTask(`plugin:${u.id}`) : u.kind === 'library' ? app.downloadTask(`native:${u.id}`) : undefined}
        {@const notes = u.kind === 'plugin' ? plugin(u.id)?.update?.notes?.split('\n').find(l => l.trim()) : ''}
        {@const w = u.kind === 'plugin' ? warn(u.id) : ''}
        <li>
          <div class="who">
            {#if u.kind === 'plugin' && onopen}<button class="name" onclick={() => onopen(u.id)}>{u.name}</button>{:else}<strong class="name">{u.name}</strong>{/if}
            <span class="ver mono">{u.from ? `v${u.from}` : ''}<ArrowRight size={11}/>{u.to.startsWith('新') ? u.to : `v${u.to}`}</span>
            {#if w}<span class="warn">{w}</span>{/if}
          </div>
          {#if notes}<p class="notes" title={notes}>{notes}</p>{/if}
          {#if task}
            {@const v = pct(task.done, task.total)}
            <span class="prog mono" role="status">{task.state === 'verifying' ? '核对中…' : v === null ? '下载中…' : `${v}%`}</span>
          {:else}
            <button class="btn sm" class:primary={!w} disabled={!!lock || (u.kind === 'library' && !!app.nativeLibraries?.l4n.pending)} title={lock || undefined} onclick={() => run(u)}>{w ? '让茶茶核对' : u.kind === 'library' && !app.nativeLibraries?.l4n.enabled ? '更新并启用…' : '更新…'}</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .updates { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; padding: 16px 20px; border: 1px solid var(--island-line); border-radius: 16px; background: color-mix(in srgb, var(--md-surface-bright) 55%, transparent); }
  header h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 600; }
  .n { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--md-primary); color: var(--md-on-primary); font-size: 12px; line-height: 20px; text-align: center; }
  header p { margin: 4px 0 0; font-size: 12px; color: var(--fg-3); }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'who act' 'notes act'; align-items: center; column-gap: 16px; padding: 10px 0; border-top: 1px solid var(--line-soft); }
  li:first-child { border-top: 0; }
  .who { grid-area: who; display: flex; align-items: center; gap: 10px; min-width: 0; }
  .name { font-size: 13.5px; font-weight: 500; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button.name:hover { text-decoration: underline; }
  .ver { display: inline-flex; align-items: center; gap: 4px; flex: none; font-size: 12px; color: var(--fg-3); }
  .warn { flex: none; padding: 0 7px; border: 1px solid var(--danger); border-radius: 9px; font-size: 11px; line-height: 16px; color: var(--danger); }
  .notes { grid-area: notes; margin: 2px 0 0; font-size: 12px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li > .btn, .prog { grid-area: act; }
  .prog { font-size: 12px; color: var(--fg-2); }
  .mono { font-family: var(--font-mono); }
</style>
