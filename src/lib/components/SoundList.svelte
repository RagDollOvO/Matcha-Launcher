<script lang="ts">
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { player, bestShot } from '../stores/player.svelte';
  import { errorText } from '../api/bridge';
  import type { Mod, ModSound } from '../types';

  let { mod }: { mod: Pick<Mod,'id'|'updatedAt'> } = $props();

  let list = $state<ModSound[] | null>(null);
  let error = $state('');
  const open = new SvelteSet<string>();
  const LIMIT = 40;
  const showAll = new SvelteSet<string>();

  // 只在换 Mod 或 Mod 更新时重读；快照刷新换了对象不算
  $effect(() => {
    void mod.id; void mod.updatedAt;
    let dead = false;
    untrack(() => {
      list = null; error = ''; open.clear(); showAll.clear();
      player.sounds(mod).then((r) => {
        if (dead) return;
        list = r;
        // 默认展开枪声所在的目录
        const best = bestShot(r);
        const first = best ? dirOf(best.path) : groups(r)[0]?.dir;
        if (first) open.add(first);
      }, (e) => { if (!dead) error = errorText(e); });
    });
    return () => { dead = true; };
  });

  const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/') + 1).replace(/^sound\//i, '') || '/';
  const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
  function groups(r: ModSound[]) {
    const map = new Map<string, ModSound[]>();
    for (const s of r) { const d = dirOf(s.path); map.set(d, [...(map.get(d) ?? []), s]); }
    return [...map].map(([dir, items]) => ({ dir, items }));
  }
  const grouped = $derived(list ? groups(list) : []);
  const fmt = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
  const kb = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
  function toggle(dir: string) { if (open.has(dir)) open.delete(dir); else open.add(dir); }
</script>

<div class="sounds">
  {#if error}
    <p class="muted">{error}</p>
  {:else if !list}
    <p class="muted">正在读取声音列表…</p>
  {:else if !list.length}
    <p class="muted">没有可试听的 WAV / MP3</p>
  {:else}
    {#each grouped as g (g.dir)}
      {@const isOpen = open.has(g.dir)}
      <button class="dir" class:open={isOpen} type="button" onclick={() => toggle(g.dir)} aria-expanded={isOpen}>
        <ChevronRight size={12} /><span class="mono">{g.dir}</span><span class="n mono">{g.items.length}</span>
      </button>
      {#if isOpen}
        {@const items = showAll.has(g.dir) ? g.items : g.items.slice(0, LIMIT)}
        {#each items as s (s.path)}
          {@const on = player.isOn(mod.id, s.path)}
          {@const d = player.duration(mod.id, s.path) ?? s.durationMs}
          <button class="snd" class:on type="button" title={on ? '停止（空格）' : s.path} onclick={() => player.play(mod.id, s.path)}>
            <span class="pb">
              {#if on && player.loading}<LoaderCircle size={12} class="spin" />
              {:else if on}<Square size={10} fill="currentColor" />
              {:else}<Play size={11} fill="currentColor" />{/if}
            </span>
            <span class="nm mono">{nameOf(s.path)}</span>
            <span class="len mono">{d ? fmt(d) : kb(s.bytes)}</span>
          </button>
        {/each}
        {#if g.items.length > items.length}
          <button class="more" type="button" onclick={() => showAll.add(g.dir)}>显示全部 {g.items.length} 个</button>
        {/if}
      {/if}
    {/each}
  {/if}
</div>

<style>
  .sounds { display: flex; flex-direction: column; gap: 1px; }
  .muted { margin: 0; font-size: 12px; color: var(--fg-3); }
  .dir { display: flex; align-items: center; gap: 4px; height: 26px; padding: 0 4px; border-radius: var(--r-sm); color: var(--fg-2); font-size: 12px; text-align: left; }
  .dir:hover { background: var(--bg-1); color: var(--fg); }
  .dir :global(svg) { flex: none; color: var(--fg-3); transition: transform var(--dur); }
  .dir.open :global(svg) { transform: rotate(90deg); }
  .dir .mono { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dir .n { flex: none; font-size: 11px; color: var(--fg-4); }
  .snd { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 6px 0 18px; border-radius: var(--r-sm); color: var(--fg-2); text-align: left; transition: background var(--dur), color var(--dur); }
  .snd:hover { background: var(--bg-1); color: var(--fg); }
  .snd.on { background: var(--bg-2); color: var(--fg); }
  .pb { display: grid; place-items: center; width: 20px; height: 20px; flex: none; border-radius: 50%; border: 1px solid var(--line-strong); color: var(--fg-2); }
  .snd:hover .pb, .snd.on .pb { border-color: var(--fg-3); color: var(--fg); }
  .nm { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .len { flex: none; font-size: 11px; color: var(--fg-4); }
  .more { align-self: flex-start; height: 24px; margin-left: 18px; padding: 0 6px; font-size: 12px; color: var(--fg-3); border-radius: var(--r-sm); }
  .more:hover { color: var(--fg); background: var(--bg-1); }
</style>
