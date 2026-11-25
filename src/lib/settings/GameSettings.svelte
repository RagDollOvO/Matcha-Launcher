<script lang="ts">
  import { onMount } from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Check from '@lucide/svelte/icons/check';
  import Toggle from '../components/Toggle.svelte';
  import GameCfg from './GameCfg.svelte';
  import ImportExisting from './ImportExisting.svelte';
  import { app } from '../stores/app.svelte';
  import { gameSettings as g, launchFlags, type DisplayMode } from '../stores/game-settings.svelte';
  import { LAUNCH_MODES, modeLabel, shownMode } from '../launch-modes';

  const v = $derived(g.value);
  const insecure = $derived(/(?:^|\s)-insecure(?=\s|$)/i.test(v.extraArgs));
  const mode = $derived(app.launchConfig.mode);
  const shown = $derived(shownMode(mode));
  const args = $derived(g.args(mode).join(' '));
  onMount(() => { void g.load(); });

  const flags = [
    { key: 'novid', name: '跳过开场动画' },
    { key: 'console', name: '打开控制台' },
    { key: 'lowViolence', name: '低血腥度' },
  ] as const;
  const sizes = ['1280x720', '1600x900', '1920x1080', '2560x1440', '3840x2160', '1280x800', '1680x1050', '1920x1200', '2560x1600', '1024x768', '1280x960', '1440x1080', '1600x1200', '2560x1080', '3440x1440', '5120x1440'];
  const size = $derived(v.display.width && v.display.height ? `${v.display.width}x${v.display.height}` : '');
  let editSize = $state(false);
  const customSize = $derived(editSize || (!!(v.display.width || v.display.height) && !sizes.includes(size)));
  function pickSize(key: string) {
    editSize = key === 'custom';
    if (editSize) return;
    const [w, h] = key ? key.split('x').map(Number) : [null, null];
    v.display.width = w; v.display.height = h; g.change();
  }
  async function resetLaunch() {
    if (!await app.confirm('恢复默认启动项？', '清空自定义启动项，恢复默认开关和显示参数。游戏配置中的 CFG 保持原样。', '恢复启动项')) return;
    editSize = false; g.resetLaunch();
  }
</script>

{#snippet saveState()}
  {#if g.status === 'missing'}<span class="w" title="当前版本的本地服务还不能保存启动项，先存在这台电脑上">仅存在本机</span>
  {:else if g.saving}<span class="saved"><LoaderCircle size={12} class="spin" />保存中</span>
  {:else if g.status !== 'error' && g.savedAt}<span class="saved"><Check size={12} />已保存</span>{/if}
{/snippet}

{#snippet numberBox(label: string, placeholder: string, n: number | null, min: number, max: number, apply: (n: number | null) => void, disabled = false)}
  <input class="num" type="number" aria-label={label} {min} {max} step="1" {placeholder} {disabled} value={n ?? ''}
    oninput={(e) => {
      const el = e.currentTarget, val = el.value === '' ? null : el.valueAsNumber;
      if (el.validity.valid && val !== n) { apply(val); g.change(); }
    }}
    onblur={(e) => { const el = e.currentTarget; if (!el.validity.valid) { app.toast(label + '：' + el.validationMessage); el.value = n?.toString() ?? ''; } }} />
{/snippet}

<section id="set-game" class="launch">
  <h2>启动项 {@render saveState()}</h2>
  {#if shown === 'clean'}<p class="lead">Steam 启动参数：<code>-steam -novid</code></p>{/if}
  {#if g.status === 'error'}<p class="hint err" role="alert">{g.error} <button class="link" onclick={() => void g.load()}>重试保存或读取</button></p>{/if}
  <ImportExisting />
  <fieldset disabled={!g.loaded}>
    <div class="card">
      <div class="line"><div class="lt"><b>启动方式</b></div>
        <div class="seg sm" role="radiogroup" aria-label="启动方式">
          {#each LAUNCH_MODES as m (m.id)}
            <button role="radio" aria-checked={shown === m.id} class:on={shown === m.id} disabled={!!app.busy || app.launchState !== 'idle'}
              onclick={() => { if (mode !== m.id) void app.setLaunchMode(m.id); }}>{m.label}</button>
          {/each}
        </div>
      </div>
      {#if shown !== 'clean'}
        <div class="flags">
          {#each flags as f (f.key)}
            <div class="flag"><span class="lt"><b>{f.name}</b><code class="sub mono">{launchFlags[f.key]}</code></span>
              <Toggle on={g.flagOn(f.key)} label={f.name} onchange={() => g.toggleFlag(f.key)} /></div>
          {/each}
        </div>
        <div class="line divider"><div class="lt"><b>帧率上限</b><span class="sub">留空沿用游戏设置；0 不限帧</span></div>
          <div class="inputs">{@render numberBox('帧率上限', '默认', v.fpsMax, 0, 1000, n => v.fpsMax = n)}<span>FPS</span></div></div>
        <label class="line custom"><span class="lt"><b>自定义启动项</b>{#if insecure}<span class="sub">带 -insecure：关闭 VAC，进不了带 VAC 的服务器</span>{/if}</span>
          <input class="mono" aria-label="自定义启动项" spellcheck="false" placeholder="例如 +mat_bumpmap 1 +mat_phong 1" value={v.extraArgs}
            oninput={(e) => { v.extraArgs = e.currentTarget.value; g.change(); }} /></label>
      {/if}
    </div>
    {#if shown !== 'clean'}
      <details class="advanced">
        <summary><ChevronRight size={14} class="chev" /><b>更多启动项</b><span>窗口、刷新率和诊断</span></summary>
        <div class="card">
          <div class="line"><div class="lt"><b>窗口模式</b></div>
            <select aria-label="窗口模式" value={v.display.mode} onchange={(e) => { v.display.mode = e.currentTarget.value as DisplayMode; g.change(); }}>
              <option value="default">游戏默认</option><option value="fullscreen">全屏</option><option value="windowed">窗口</option><option value="noborder">无边框</option>
            </select></div>
          <div class="line"><div class="lt"><b>分辨率</b>{#if customSize && (v.display.width == null || v.display.height == null)}<span class="sub">宽和高都填好后生效</span>{/if}</div>
            <div class="inputs"><select aria-label="分辨率" value={customSize ? 'custom' : size} onchange={(e) => pickSize(e.currentTarget.value)}>
              <option value="">游戏默认</option>{#each sizes as key (key)}<option value={key}>{key.replace('x', ' × ')}</option>{/each}<option value="custom">自定义…</option>
            </select>
            {#if customSize}
              {@render numberBox('分辨率宽度', '宽', v.display.width, 320, 7680, n => v.display.width = n)}<span>×</span>
              {@render numberBox('分辨率高度', '高', v.display.height, 320, 7680, n => v.display.height = n)}
            {/if}</div></div>
          <div class="line"><div class="lt"><b>全屏刷新率</b><span class="sub">全屏模式下生效</span></div>
            <div class="inputs">{@render numberBox('全屏刷新率', '默认', v.display.refreshHz, 24, 1000, n => v.display.refreshHz = n, v.display.mode !== 'fullscreen')}<span>Hz</span></div></div>
          <div class="line"><div class="lt"><b>记录控制台日志</b><span class="sub mono">-condebug</span></div>
            <Toggle on={v.consoleLog} label="记录控制台日志" onchange={() => { v.consoleLog = !v.consoleLog; g.change(); }} /></div>
          <div class="line"><div class="lt"><b>高优先级</b><span class="sub mono">-high</span></div>
            <Toggle on={v.highPriority} label="高优先级" onchange={() => { v.highPriority = !v.highPriority; g.change(); }} /></div>
        </div>
        <div class="preview"><span>下次启动参数 · {modeLabel(mode)}</span><code class="mono">{args}</code></div>
        <button class="link" onclick={() => void resetLaunch()}><RotateCcw size={12} />恢复默认启动项</button>
      </details>
    {/if}
  </fieldset>
</section>

<GameCfg {saveState} />

<style>
  .launch { container-type: inline-size; }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
  .saved, .link { display: inline-flex; align-items: center; gap: 4px; color: var(--fg-3); font-size: 12px; font-weight: 400; }
  .err { color: var(--danger) !important; }
  .link:hover { color: var(--fg); }
  .flags { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line-soft); }
  .flag { padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .flag + .flag { border-left: 1px solid var(--line-soft); }
  .flag code { font-size: 11px; }
  .divider { border-top: 1px solid var(--line-soft); }
  .inputs { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
  .inputs span, .advanced summary span { color: var(--fg-3); font-size: 12px; }
  .launch select, .num { height: 30px; padding: 0 9px; font-size: 12px; }
  .num { width: 80px; font-variant-numeric: tabular-nums; }
  .num:disabled { opacity: .55; }
  .custom input { width: min(70%, 370px); min-width: 0; height: 32px; font-size: 12px; }
  .advanced { margin-top: 6px; }
  .advanced summary { display: flex; align-items: center; gap: 7px; cursor: pointer; min-height: 36px; color: var(--fg-2); }
  .advanced summary b { font-size: 13px; font-weight: 500; }
  .advanced summary span { margin-left: auto; }
  .advanced summary :global(.chev) { transition: transform var(--dur); }
  .advanced[open] summary :global(.chev) { transform: rotate(90deg); }
  .preview { display: grid; gap: 5px; margin: 14px 0 8px; font-size: 12px; color: var(--fg-3); }
  .preview code { padding: 8px 12px; border-radius: 10px; background: color-mix(in srgb, var(--md-on-surface) 5%, transparent); color: var(--fg-2); line-height: 1.6; overflow-wrap: anywhere; user-select: text; }
  @container (max-width: 430px) {
    .flags { grid-template-columns: 1fr; }
    .flag { padding-block: 8px; }
    .flag .lt { flex-direction: row; align-items: baseline; gap: 8px; }
    .flag + .flag { border-left: 0; border-top: 1px solid var(--line-soft); }
    .launch .custom, .launch .line:has(.inputs select) { flex-direction: column; align-items: stretch; gap: 6px; }
    .custom input { width: 100%; }
    .inputs { justify-content: start; }
  }
</style>
