<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ImageIcon from '@lucide/svelte/icons/image';
  import { theme, setLook, type WindowLook } from '../theme/theme.svelte';
  import WallpaperPresets from './WallpaperPresets.svelte';

  const looks: { id: WindowLook; name: string }[] = [
    { id: 'matcha-dark', name: '墨绿深色' },
    { id: 'matcha-light', name: '薄荷浅色' },
    { id: 'wallpaper', name: '随壁纸' },
  ];
</script>

<fieldset class="looks">
  <legend>窗口配色</legend>
  <div class="options">
    {#each looks as look (look.id)}
      <label class="choice">
        <input type="radio" name="window-look" value={look.id} checked={theme.look === look.id}
          onchange={() => setLook(look.id)} />
        <span class="sample" data-look={look.id} aria-hidden="true">
          {#if look.id === 'wallpaper'}
            {#if theme.wallpaper}<img src={theme.wallpaper} alt="" />{:else}<ImageIcon size={24} strokeWidth={1.4} />{/if}
          {:else}
            <span class="mini-nav"><i></i><i></i><i></i></span>
            <span class="mini-clock">13:05</span><span class="mini-button"></span>
          {/if}
        </span>
        <span class="caption">{look.name}{#if theme.look === look.id}<Check size={15} strokeWidth={2.3} aria-hidden="true" />{/if}</span>
      </label>
    {/each}
  </div>
</fieldset>
<WallpaperPresets />

<style>
  .looks { margin: 0; padding: 0; min-width: 0; border: 0; }
  legend { padding: 0; margin: 6px 0 10px; font-size: 13px; font-weight: 600; color: var(--fg-2); }
  .options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .choice { position: relative; min-width: 0; cursor: pointer; }
  input { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; clip-path: inset(50%); border: 0; }
  .sample { height: clamp(68px, 8vw, 90px); border-radius: 11px; overflow: hidden; position: relative;
    display: grid; place-items: center; outline: 1px solid var(--line); outline-offset: -1px; }
  input:checked + .sample { outline: 2px solid var(--accent); outline-offset: 2px; }
  input:focus-visible + .sample { outline: 3px solid var(--fg); outline-offset: 3px; }
  .sample[data-look='matcha-dark'] { --key: #00e1ae; --nav: #204e48; color: #d8e6de; background: radial-gradient(ellipse at 97% 10%, #073c3e, transparent 72%), #101b16; }
  .sample[data-look='matcha-light'] { --key: #006c52; --nav: #bcece4; color: #121e19; background: radial-gradient(ellipse at 97% 10%, #b2eff0, transparent 72%), #e7f5ec; }
  .sample[data-look='wallpaper'] { color: #4f654d; background: radial-gradient(ellipse at 82% 95%, #accac1, transparent 65%), linear-gradient(120deg, #dbe5c5, #efe5cc 58%, #d6e6dd); }
  .sample img { width: 100%; height: 100%; object-fit: cover; }
  .mini-nav { position: absolute; top: 11%; left: 33%; width: 34%; height: 10%; display: flex; align-items: center; justify-content: center; gap: 5%;
    border-radius: 99px; background: color-mix(in srgb, var(--nav) 65%, transparent); }
  .mini-nav i { width: 13%; height: 33%; border-radius: 99px; background: currentColor; opacity: .46; }
  .mini-clock { position: absolute; left: 9%; top: 24%; font-size: clamp(15px, 1.55vw, 20px); letter-spacing: -.05em; line-height: 1.25; }
  .mini-button { position: absolute; left: 9%; bottom: 15%; width: 24%; height: 9%; border-radius: 99px; background: var(--key); }
  .caption { display: flex; justify-content: space-between; align-items: center; gap: 3px; padding: 8px 2px 0; font-size: 13px; color: var(--fg-2); }
  .choice:has(:checked) .caption { color: var(--fg); font-weight: 600; }
  .caption :global(svg) { color: var(--accent); }
</style>
