<script lang="ts">
  // 本机没有 L4N / DXVK 时问一句要不要下载：好处、代价、大小、来源说清楚，玩家自己选。
  // 「先不用」记在本机，不再主动问；之后还能在运行环境条上点「下载」。
  import Check from '@lucide/svelte/icons/check';
  import Dot from '@lucide/svelte/icons/dot';
  import Layers from '@lucide/svelte/icons/layers';
  import Boxes from '@lucide/svelte/icons/boxes';
  import { app } from '../stores/app.svelte';
  import { dismissOffer, needsDownload, nativeOffer, offerDismissed, sizeLabel } from '../plugins/native-offer';
  import type { NativeLibraryState } from '../types';

  let dismissed = $state<string[]>([]);
  const env = $derived(app.nativeLibraries);
  const missing = $derived([env?.l4n].filter((l): l is NativeLibraryState => needsDownload(l) && !offerDismissed(l!.id) && !dismissed.includes(l!.id)));
  const lock = $derived(app.game.running ? '退出游戏后再下载' : app.busy ? `正在${app.busy}` : '');
  function later(id: string) { dismissOffer(id); dismissed = [...dismissed, id]; }
  const pct = (done: number, total: number | null) => (total ? Math.min(100, Math.floor((done / total) * 100)) : null);
</script>

{#if missing.length}
  <section class="offers" aria-label="可下载的组件">
    <header>
      <h2>{missing.length > 1 ? '这两个组件还没下载' : `${nativeOffer(missing[0]).title} 还没下载`}</h2>
      <p>可选组件。安装前可查看游戏文件改动。</p>
    </header>
    <div class="grid" class:one={missing.length === 1}>
      {#each missing as lib (lib.id)}
        {@const o = nativeOffer(lib)}
        {@const task = app.downloadTask(`native:${lib.id}`)}
        {@const size = sizeLabel(lib.download?.sizeBytes)}
        <article class="offer">
          <div class="who">
            <span class="ic"><Boxes size={16}/></span>
            <div><strong>{o.title}</strong><small>{lib.download ? `v${lib.download.version}` : ''}{size ? ` · 约 ${size}` : ''}</small></div>
          </div>
          <p class="pitch">{o.pitch}</p>
          <ul class="gains">{#each o.gains as g (g)}<li><Check size={13}/>{g}</li>{/each}</ul>
          <ul class="costs">{#each o.costs as c (c)}<li><Dot size={13}/>{c}</li>{/each}</ul>
          {#if lib.download?.source}<p class="src">来源：{lib.download.source}</p>{/if}
          {#if task}
            {@const v = pct(task.done, task.total)}
            <div class="progress" role="status">
              <span class="bar"><i style:transform="scaleX({(v ?? 0) / 100})" class:indet={v === null}></i></span>
              <span class="mono">{task.state === 'verifying' ? '校验中…' : v === null ? '下载中…' : `${v}%`}</span>
            </div>
          {:else}
            <div class="acts">
              <button class="btn primary sm" disabled={!!lock} title={lock || '先确认来源和大小，下载完再确认要改的游戏文件'} onclick={() => app.downloadNativeLibrary(lib.id)}>下载并启用…</button>
              <button class="btn ghost sm" onclick={() => later(lib.id)}>先不用</button>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .offers { display: flex; flex-direction: column; gap: 14px; margin-top: 12px; padding: 18px 20px; border: 1px solid var(--island-line); border-radius: 16px; background: color-mix(in srgb, var(--md-surface-bright) 55%, transparent); }
  header h2 { margin: 0; font-size: 15px; font-weight: 600; }
  header p { margin: 4px 0 0; font-size: 12px; color: var(--fg-3); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .grid.one { grid-template-columns: minmax(0, 1fr); }
  @media (max-width: 760px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  .offer { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 14px 16px; border: 1px solid var(--line-soft); border-radius: 12px; background: color-mix(in srgb, var(--md-surface-bright) 40%, transparent); }
  .who { display: flex; align-items: center; gap: 10px; }
  .who div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .who strong { font-size: 14px; font-weight: 600; }
  .who small { font-size: 12px; color: var(--fg-3); }
  .ic { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 9px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .pitch { margin: 0; font-size: 13px; color: var(--fg-2); line-height: 1.6; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  li { display: flex; gap: 6px; align-items: flex-start; font-size: 12.5px; line-height: 1.55; }
  li :global(svg) { flex: none; margin-top: 3px; }
  .gains li { color: var(--fg); }
  .gains li :global(svg) { color: var(--accent); }
  .costs li { color: var(--fg-3); }
  .src { margin: 0; font-size: 11.5px; color: var(--fg-3); overflow-wrap: anywhere; }
  .acts { display: flex; gap: 8px; margin-top: 2px; }
  .progress { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--fg-2); }
  .bar { flex: 1; height: 4px; border-radius: 2px; background: var(--line-soft); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); transform-origin: left; transition: transform 200ms linear; }
  .bar i.indet { width: 30%; transform: none !important; animation: slide 1.2s ease-in-out infinite; }
  @keyframes slide { from { margin-left: -30%; } to { margin-left: 100%; } }
  .mono { font-family: var(--font-mono); }
</style>
