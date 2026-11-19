<script lang="ts">
  // 主页始终显示导入的原图；随壁纸配色下，其余页面使用预先模糊的小图。
  // 壁纸轮播时主页的图一层叠一层淡入：新图先在后台解码好再淡入，淡完把下面的旧层拿掉。
  import { untrack } from 'svelte';
  import { app } from '../stores/app.svelte';
  import { theme } from '../theme/theme.svelte';
  import { carousel, homeImage, homeHasPhoto, setCarouselStage, decoded } from '../theme/carousel.svelte';
  import { prefs } from '../stores/prefs.svelte';

  /** soft：始终用模糊的氛围底（助手独立窗口用） */
  let { soft = false }: { soft?: boolean } = $props();
  const home = $derived(!soft && app.route === 'home');
  const photo = $derived(home && homeHasPhoto());
  // 动态壁纸只在主页播；游戏运行中或开了减弱动效时停在封面帧，不占显卡
  const moving = $derived(photo && !!theme.video && !app.game?.running && !prefs.reduceMotion);
  const image = $derived(soft ? '' : homeImage());
  const ambient = $derived(carousel.ambient || theme.ambient);

  // 轮播只在主页照片露着的时候计时
  $effect(() => { if (!soft) setCarouselStage(photo && !moving && !app.game?.running); });

  type Layer = { id: number; src: string; in: boolean };
  let layers = $state<Layer[]>([]);
  let seq = 0;
  $effect(() => {
    const src = image, live = photo && !moving;
    untrack(() => {
      const top = layers.at(-1);
      if (top?.src === src) return;
      if (!src) { layers = []; return; }
      // 不在主页、第一张、减弱动效：直接换，不淡入
      if (!live || !top || prefs.reduceMotion) { layers = [{ id: ++seq, src, in: true }]; return; }
      // 上一张还没淡完又来一张：只留已经显示好的那层
      layers = [...layers.filter((l) => l.in).slice(-1), { id: ++seq, src, in: false }];
    });
  });
  const FADE = 1600;
  function ready(e: Event, id: number) {
    const el = e.currentTarget as HTMLImageElement;
    void decoded(el).then(() => {
      const l = layers.find((x) => x.id === id);
      if (!l || l.in) return;
      // 先让浏览器记下「透明」这一刻的样式，过渡才会真的跑；窗口在后台时 transitionend 可能不来，到点也清掉旧层
      void getComputedStyle(el).opacity;
      l.in = true;
      setTimeout(() => settle(id), FADE + 300);
    });
  }
  function settle(id: number) {
    const i = layers.findIndex((x) => x.id === id);
    if (i > 0) layers = layers.slice(i);
  }
  function settled(e: TransitionEvent, id: number) {
    if (e.propertyName === 'opacity') settle(id);
  }
  function broken(id: number) {
    if (layers.length > 1) layers = layers.filter((x) => x.id !== id);
  }

  // 主页壁纸跟着鼠标轻微反向移动，做出一点纵深；只改 transform，交给 GPU 合成
  let bx = $state(0), by = $state(0);
  function onPointer(e: PointerEvent) {
    if (!photo) return;
    bx = (e.clientX / innerWidth) * 2 - 1;
    by = (e.clientY / innerHeight) * 2 - 1;
  }
</script>

<svelte:window onpointermove={onPointer} />

<div class="backdrop" class:home class:photo aria-hidden="true" style="--bx:{bx};--by:{by}">
  {#if moving}
    <video class="wp clear vid" src={theme.video} poster={theme.wallpaper} autoplay muted loop playsinline disablepictureinpicture disableremoteplayback></video>
  {:else if photo}
    <div class="wp clear">
      {#each layers as l (l.id)}
        <img class="ly" class:in={l.in} src={l.src} alt="" draggable="false" decoding="async"
          onload={(e) => ready(e, l.id)} onerror={() => broken(l.id)} ontransitionend={(e) => settled(e, l.id)} />
      {/each}
    </div>
  {:else if !home && theme.look === 'wallpaper' && ambient}
    <div class="wp soft" style="background-image:url({ambient})"></div>
  {:else}
    <div class="wp sky"></div>
  {/if}
  {#if !photo}
    <div class="veil"></div>
    {#if home}<div class="scrim"></div>{/if}
  {/if}
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 0; overflow: hidden; background: var(--md-surface); pointer-events: none; }
  .backdrop.photo { background: #151a18; }
  .wp { position: absolute; inset: 0; background-size: cover; background-position: center 12%; }
  .soft { inset: -4%; }
  .clear { transform: translate3d(calc(var(--bx) * -10px), calc(var(--by) * -6px), 0) scale(1.04); transition: transform 1.2s cubic-bezier(0.2, 0.8, 0.2, 1); }
  @media (prefers-reduced-motion: reduce) { .clear { transform: scale(1.04); } }
  .vid { width: 100%; height: 100%; object-fit: cover; object-position: center 12%; }
  /* 轮播的一层：先透明，解码好再淡入。只动 opacity，交给合成器 */
  .ly { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 12%; user-select: none;
    opacity: 0; transition: opacity 1600ms cubic-bezier(0.4, 0, 0.2, 1); }
  .ly.in { opacity: 1; }

  .sky {
    background:
      radial-gradient(60% 70% at 78% 18%, color-mix(in srgb, var(--md-tertiary-container) 85%, transparent), transparent 70%),
      radial-gradient(70% 80% at 12% 100%, color-mix(in srgb, var(--md-primary-container) 90%, transparent), transparent 70%),
      linear-gradient(160deg, var(--md-surface-container-high), var(--md-surface));
  }

  /* 底色只作用于氛围底和默认渐变。 */
  .veil { position: absolute; inset: 0; background: color-mix(in srgb, var(--md-surface) calc(var(--veil) * 100%), transparent); transition: background 480ms var(--ease-out); }
  .home .veil { background: transparent; }
  :global([data-theme='dark']) .home .veil { background: rgb(0 0 0 / 0.18); }

  /* 默认主页渐变在玩家卡和时钟一侧更沉静。 */
  .scrim {
    position: absolute; inset: 0;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--md-surface) 55%, transparent) 0%, color-mix(in srgb, var(--md-surface) 22%, transparent) 26%, transparent 42%),
      linear-gradient(0deg, color-mix(in srgb, var(--md-surface) 40%, transparent) 0%, transparent 28%);
  }
</style>
