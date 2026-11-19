<script lang="ts">
  // 预设外观：宣传片里的三张原创壁纸，点一下换壁纸、切到「随壁纸」取色、用深色。
  // 欢迎引导的「配色」一步和 设置 › 外观 共用（都在 WindowLooks 里）。
  import Check from '@lucide/svelte/icons/check';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { theme, WALLPAPER_PRESETS, applyWallpaperPreset } from '../theme/theme.svelte';
  import { app } from '../stores/app.svelte';
  import { sfx } from '../sound/sfx.svelte';
  import { errorText } from '../api/bridge';

  const active = (id: string) => theme.look === 'wallpaper' && theme.preset === id && !!theme.wallpaper;
  async function pick(id: string) {
    if (theme.applying || active(id)) return;
    try { await applyWallpaperPreset(id); sfx.cute('sparkle'); }
    catch (e) { app.toast(`换外观没成功：${errorText(e)}`); }
  }
</script>

<fieldset class="presets">
  <legend>预设外观<span>壁纸 + 随壁纸取色</span></legend>
  <div class="options">
    {#each WALLPAPER_PRESETS as p (p.id)}
      <button type="button" class="choice" class:on={active(p.id)} aria-pressed={active(p.id)} disabled={!!theme.applying || theme.busy} data-sfx="none" onclick={() => pick(p.id)}>
        <span class="sample"><img src={p.thumb} alt="" draggable="false" />
          {#if theme.applying === p.id}<span class="busy"><LoaderCircle size={18} class="spin" /></span>{/if}
        </span>
        <span class="caption">{p.name}{#if active(p.id)}<Check size={15} strokeWidth={2.3} aria-hidden="true" />{/if}</span>
      </button>
    {/each}
  </div>
</fieldset>

<style>
  .presets { margin: 16px 0 0; padding: 0; min-width: 0; border: 0; }
  legend { display: flex; align-items: baseline; gap: 8px; padding: 0; margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--fg-2); }
  legend span { font-size: 12px; font-weight: 400; color: var(--fg-4); }
  .options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .choice { min-width: 0; padding: 0; text-align: left; cursor: pointer; }
  .choice:disabled { cursor: default; }
  .sample { position: relative; display: block; height: clamp(60px, 7vw, 80px); border-radius: 11px; overflow: hidden;
    outline: 1px solid var(--line); outline-offset: -1px; transition: outline-color var(--dur), transform 200ms var(--ease-out); }
  .sample img { display: block; width: 100%; height: 100%; object-fit: cover; user-select: none; transition: transform 320ms var(--ease-out); }
  .choice:hover:not(:disabled) .sample img { transform: scale(1.04); }
  .choice:active:not(:disabled) .sample { transform: scale(0.97); }
  .choice.on .sample { outline: 2px solid var(--accent); outline-offset: 2px; }
  .choice:focus-visible .sample { outline: 3px solid var(--fg); outline-offset: 3px; }
  .busy { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; background: rgb(0 0 0 / .35); }
  .caption { display: flex; justify-content: space-between; align-items: center; gap: 3px; padding: 8px 2px 0; font-size: 13px; color: var(--fg-2); }
  .choice.on .caption { color: var(--fg); font-weight: 600; }
  .caption :global(svg) { color: var(--accent); }
</style>
