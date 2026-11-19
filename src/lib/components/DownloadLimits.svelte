<script lang="ts">
  // 同时下载数 + 限速（后端 download-settings-*）。下载页标题区的小面板和设置页「下载」一节共用。
  // 改一项就只提交那一项；正在传的文件立刻按新额度走。
  import { onMount, tick } from 'svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { downloads } from '../stores/downloads.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  const MiB = 1048576;
  /** 常用档位（MiB/s），0 = 不限 */
  const PRESETS = [0, 1, 2, 5, 10];
  const lim = $derived(downloads.limits);
  const onPreset = $derived(!lim || PRESETS.includes(lim.speedLimit / MiB));
  let custom = $state(false);
  let draft = $state('');
  let input = $state<HTMLInputElement>();
  const showCustom = $derived(custom || !onPreset);

  onMount(() => { if (!downloads.limits) void downloads.loadLimits(); });

  const fmt = (b: number) => `${+(b / MiB).toFixed(2)}`;
  function pick(mib: number) {
    custom = false;
    if (lim?.speedLimit !== mib * MiB) void downloads.setLimits({ speedLimit: mib * MiB });
  }
  async function openCustom() {
    custom = true;
    draft = lim?.speedLimit ? fmt(lim.speedLimit) : '';
    await tick();
    input?.select();
  }
  const draftValue = $derived(Number.parseFloat(draft));
  const draftOk = $derived(Number.isFinite(draftValue) && draftValue >= 0.1 && draftValue <= 10240);
  function commit() {
    if (!draftOk) return;
    const bps = Math.round(draftValue * MiB);
    if (bps !== lim?.speedLimit) void downloads.setLimits({ speedLimit: bps });
  }
  function setConcurrent(n: number) { if (lim?.maxConcurrent !== n) void downloads.setLimits({ maxConcurrent: n }); }
</script>

<div class="lim" class:compact>
  {#if downloads.limitsMissing}
    <p class="note">本地服务还不支持下载设置，更新 Matcha 后可用。</p>
  {:else if downloads.limitsError}
    <p class="note">读不到下载设置：{downloads.limitsError} <button class="link" onclick={() => void downloads.loadLimits()}>重试</button></p>
  {:else if !lim}
    <p class="note"><LoaderCircle size={12} class="spin" />读取中…</p>
  {:else}
    <div class="item">
      <div class="lt"><b>同时下载</b><span class="sub">解包也占名额。调小后，已经开始的会先做完</span></div>
      <div class="seg" role="radiogroup" aria-label="同时下载数">
        {#each [1, 2, 3, 4] as n (n)}<button role="radio" aria-checked={lim.maxConcurrent === n} class:on={lim.maxConcurrent === n} onclick={() => setConcurrent(n)}><span class="mono">{n}</span></button>{/each}
      </div>
    </div>
    <div class="item">
      <div class="lt"><b>限速</b><span class="sub">工坊和 GameMaps 合计共用，立即生效</span></div>
      <div class="chips" role="radiogroup" aria-label="下载限速">
        {#each PRESETS as mib (mib)}
          {@const on = !showCustom && lim.speedLimit === mib * MiB}
          <button class="chip" role="radio" aria-checked={on} class:on onclick={() => pick(mib)}>{mib ? `${mib} MiB/s` : '不限'}</button>
        {/each}
        <button class="chip" role="radio" aria-checked={showCustom} class:on={showCustom} onclick={openCustom}>{!onPreset && !custom ? `${fmt(lim.speedLimit)} MiB/s` : '自定义'}</button>
      </div>
    </div>
    {#if showCustom}
      <form class="custom" onsubmit={(e) => { e.preventDefault(); commit(); }}>
        <label><input bind:this={input} bind:value={draft} type="number" inputmode="decimal" min="0.1" max="10240" step="0.1" placeholder="例如 1.5" aria-label="自定义限速（MiB/s）" /><span>MiB/s</span></label>
        <button class="btn sm tonal" disabled={!draftOk || Math.round(draftValue * MiB) === lim.speedLimit}>应用</button>
        <span class="now mono">{lim.speedLimit ? `当前 ${fmt(lim.speedLimit)} MiB/s` : '当前不限速'}</span>
      </form>
    {/if}
  {/if}
</div>

<style>
  .lim { display: flex; flex-direction: column; }
  .item { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 58px; padding: 11px 18px; }
  .item + .item { border-top: 1px solid var(--line-soft); }
  .lt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .lt b { font-size: 13.5px; font-weight: 550; }
  .sub { font-size: 12px; line-height: 1.6; color: var(--fg-3); }
  .note { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; padding: 14px 16px; font-size: 12px; color: var(--fg-3); }
  .link { font-size: 12px; color: var(--fg-2); text-decoration: underline; text-underline-offset: 3px; }
  .seg { display: inline-flex; gap: 2px; padding: 3px; flex: none; border-radius: 11px; background: color-mix(in srgb, var(--md-on-surface) 6%, transparent); }
  .seg button { min-width: 34px; height: 28px; padding: 0 10px; border-radius: 8px; font-size: 12px; color: var(--fg-2); transition: background var(--dur), color var(--dur); }
  .seg button:hover { color: var(--fg); }
  .seg button.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
  .custom { display: flex; align-items: center; gap: 8px; padding: 0 16px 12px; animation: rise 180ms var(--ease-out); }
  .custom label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-3); }
  .custom input { width: 96px; height: 28px; font-family: var(--font-mono); font-size: 12px; }
  .custom .btn { height: 28px; border-radius: 10px; }
  .tonal { background: var(--md-secondary-container); border-color: transparent; color: var(--md-on-secondary-container); }
  .tonal:hover { background: color-mix(in srgb, var(--md-secondary-container) 88%, var(--md-on-secondary-container)); border-color: transparent; }
  .btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .now { margin-left: auto; font-size: 11px; color: var(--fg-4); }

  /* 下载页的小面板：标签在上、控件在下 */
  .compact .item { flex-direction: column; align-items: stretch; gap: 8px; min-height: 0; padding: 12px 14px; }
  .compact .item + .item { border-top-color: var(--line-soft); }
  .compact .chips { justify-content: flex-start; }
  .compact .seg { align-self: flex-start; }
  .compact .custom { flex-wrap: wrap; padding: 0 14px 12px; }
  @media (prefers-reduced-motion: reduce) { .custom { animation: none; } }
</style>
