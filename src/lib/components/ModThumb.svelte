<script lang="ts">
  import { untrack } from 'svelte';
  import { thumbs, type ThumbMod } from '../stores/thumbs.svelte';
  import { modArt, artUid } from '../modArt';

  let { mod, fit = 'cover' }: { mod: ThumbMod; fit?: 'cover' | 'contain' } = $props();

  const src = $derived(thumbs.src(mod));
  // 没有封面时画生成纹样（见 modArt.ts）；懒求值，有图的条目不会生成
  const art = $derived(modArt({ id: mod.id, title: mod.title, dirs: thumbs.dirs(mod) }));
  const uid = artUid();
  const svg = $derived(art.svg.replaceAll('§', uid));

  let failed = $state(false);
  // 挂载时封面已在缓存里就直接显示；之后才读到的封面盖在纹样上淡入，淡完再拿掉纹样
  const cached = untrack(() => !!thumbs.src(mod));
  let ready = $state(cached);
  let settled = $state(cached);
  let last = untrack(() => thumbs.src(mod));
  $effect(() => {
    if (src === last) return;
    last = src;
    failed = false;
    ready = false;
    settled = false;
  });

  // 一直观察：封面缓存满了会丢掉早先的图，滚回来时再读一次（已缓存时 load 什么也不做）
  function visible(node: HTMLElement) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) thumbs.load(mod);
    }, { rootMargin: '200px' });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }
</script>

<div class="thumb" use:visible>
  {#if !src || failed || !settled}
    <div class="art" data-kind={art.kind} style:--h={art.hue} style:--sat={art.sat} aria-hidden="true">{@html svg}</div>
  {/if}
  {#if src && !failed}
    <img {src} alt="" draggable="false" decoding="async" style:object-fit={fit}
         class:wait={!ready} class:fade={ready && !settled}
         onload={() => (ready = true)} onanimationend={() => (settled = true)} onerror={() => (failed = true)} />
  {/if}
</div>

<style>
  .thumb { position: absolute; inset: 0; display: grid; place-items: center; background: var(--bg-1); overflow: hidden; container-type: inline-size; transition: opacity var(--dur), filter var(--dur); }
  img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  img.wait { opacity: 0; }
  img.fade { animation: thumb-in 280ms var(--ease-out); }
  @keyframes thumb-in { from { opacity: 0; } }

  /* ---------- 生成纹样 ----------
     --h 色相（oklch），--sat 饱和度倍数（白/黑色系压到很低）。
     五档颜色：0 底、1 暗底、2 结构线、3 主色、4 高光；元素可用 --d 在主色相上偏移。 */
  .art {
    position: absolute; inset: 0;
    --l0: .31; --k0: .05; --l1: .19; --k1: .045; --l2: .47; --k2: .08; --l3: .79; --k3: .16; --l4: .97; --k4: .035;
    transition: transform 360ms var(--ease-out);
  }
  :global(:root[data-theme='light']) .art {
    --l0: .9; --k0: .05; --l1: .8; --k1: .075; --l2: .68; --k2: .09; --l3: .62; --k3: .17; --l4: .995; --k4: .012;
  }
  .art :global {
    svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: hidden; }
    line, path, circle, ellipse, rect { stroke-linecap: round; }
    .s2 { fill: none; stroke: oklch(var(--l2) calc(var(--k2) * var(--sat)) calc(var(--h) + var(--d, 0))); }
    .s3 { fill: none; stroke: oklch(var(--l3) calc(var(--k3) * var(--sat)) calc(var(--h) + var(--d, 0))); }
    .s4 { fill: none; stroke: oklch(var(--l4) calc(var(--k4) * var(--sat)) calc(var(--h) + var(--d, 0))); }
    .f0 { fill: oklch(var(--l0) calc(var(--k0) * var(--sat)) calc(var(--h) + var(--d, 0))); }
    .f1 { fill: oklch(var(--l1) calc(var(--k1) * var(--sat)) calc(var(--h) + 28 + var(--d, 0))); }
    .f2 { fill: oklch(var(--l2) calc(var(--k2) * var(--sat)) calc(var(--h) + var(--d, 0))); }
    .f3 { fill: oklch(var(--l3) calc(var(--k3) * var(--sat)) calc(var(--h) + var(--d, 0))); }
    .f4 { fill: oklch(var(--l4) calc(var(--k4) * var(--sat)) calc(var(--h) + var(--d, 0))); }
    .g0 { stop-color: oklch(var(--l0) calc(var(--k0) * var(--sat)) var(--h)); }
    .g1 { stop-color: oklch(var(--l1) calc(var(--k1) * var(--sat)) calc(var(--h) + 28)); }
    .g3 { stop-color: oklch(var(--l3) calc(var(--k3) * var(--sat)) var(--h)); }
    .g4 { stop-color: oklch(var(--l4) calc(var(--k4) * var(--sat)) var(--h)); }
    /* 不跟主题走的几样：唱片、弹孔/阴影、红点、窗口三色灯 */
    .vin { fill: oklch(.21 calc(.025 * var(--sat)) var(--h)); }
    .hole { fill: oklch(.14 calc(.02 * var(--sat)) var(--h)); }
    .dot { fill: oklch(.68 .22 25); }
    .brass { fill: oklch(.8 .11 82); }
    .tl1 { fill: oklch(.7 .18 25); }
    .tl2 { fill: oklch(.84 .15 85); }
    .tl3 { fill: oklch(.77 .16 150); }
    /* 动效用到的变换原点 */
    .tw, .bar, .drip, .wob, .rip, .cf > g, .cone { transform-box: fill-box; transform-origin: center; }
    .drip { transform-origin: top; }
    .fill, .type { transform-box: fill-box; transform-origin: left center; }
    .shadow { transform-box: fill-box; transform-origin: center; }
    .burst, .ripple, .spin, .ray, .xh, .cross, .pkg, .halo { transform-box: view-box; }
    .ray { transform-origin: 50px 50px; }
  }
  /* 缩得很小（通知、下载列表）时去掉细线细节，免得糊成一团 */
  @container (max-width: 72px) {
    .art :global(.dt) { display: none; }
  }

  /* 悬停：卡片放大一点，纹样动起来。只在悬停时挂动画，几百张卡片平时不占动画开销 */
  :global(.tile:hover) .art, :global(:hover) > .thumb > .art { transform: scale(1.04); }
  @media (prefers-reduced-motion: no-preference) {
    :global(.tile:hover) .art :global, :global(:hover) > .thumb > .art :global {
      .tw { animation: art-tw 1.6s ease-in-out infinite; animation-delay: calc(var(--i, 0) * -.43s); }
      .burst { animation: art-burst 2.6s ease-in-out infinite; }
      .drift { animation: art-drift 1.8s ease-in-out infinite; }
      .ripple { animation: art-ripple 1.8s ease-in-out infinite; }
      .bar { animation: art-eq .8s ease-in-out infinite; animation-delay: calc(var(--i, 0) * -.09s); }
      .ray { animation: art-ray .9s ease-in-out infinite; animation-delay: calc(var(--i, 0) * -.07s); }
      .cone { animation: art-thump .45s ease-in-out infinite; }
      .spin { animation: art-spin 2.4s linear infinite; }
      .note { animation: art-note 1.8s ease-out infinite; animation-delay: calc(var(--i, 0) * -.9s); }
      .aim { animation: art-aim 2.6s ease-in-out infinite; }
      .dot { animation: art-blink .7s steps(1) infinite; }
      .ecg { stroke-dasharray: 100; animation: art-ecg 1.5s cubic-bezier(.3, .7, .4, 1) infinite; }
      .beep { animation: art-blink 1.5s steps(1) infinite; }
      .cross { animation: art-beat 1.5s ease-out infinite; }
      .drip { animation: art-drip 1.6s ease-in-out infinite; animation-delay: calc(var(--i, 0) * -.31s); }
      .drop { animation: art-fall 1.4s ease-in infinite; animation-delay: calc(var(--i, 0) * -.37s); }
      .wob { animation: art-wob 1.2s ease-in-out infinite; }
      .slash { animation: art-slash .5s var(--ease-out) both; animation-delay: calc(var(--i, 0) * 70ms); }
      .pin { animation: art-bob 1.1s ease-in-out infinite; }
      .rip { animation: art-rip 1.3s ease-out infinite; }
      .route { animation: art-march .8s linear infinite; }
      .fill { animation: art-fill 1s var(--ease-out) both; }
      .xh { animation: art-xh 1s ease-in-out infinite; }
      .cur { animation: art-blink .9s steps(1) infinite; }
      .type { animation: art-fill 1.4s steps(6) infinite; }
      .sheen { animation: art-sweep 1.8s ease-in-out infinite; }
      .float { animation: art-bob 1.6s ease-in-out infinite; }
      .shadow { animation: art-shadow 1.6s ease-in-out infinite; }
      .cf > g { animation: art-confetti 1.4s ease-in-out infinite; animation-delay: calc(var(--i, 0) * -.23s); }
      .pkg { animation: art-thump 1.4s ease-in-out infinite; }
      .hop { animation: art-hop 1s ease-in-out infinite; animation-delay: calc(var(--i, 0) * -.18s); }
      .halo { animation: art-spin 9s linear infinite; }
      .visor { animation: art-blink 1.8s ease-in-out infinite; }
    }
  }
  @keyframes -global-art-tw { 0%, 100% { transform: scale(1) rotate(0); opacity: 1; } 50% { transform: scale(.3) rotate(45deg); opacity: .4; } }
  @keyframes -global-art-burst { 0%, 100% { transform: scale(1) rotate(0); } 50% { transform: scale(1.1) rotate(10deg); } }
  @keyframes -global-art-drift { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-2.5px, 2.5px); } }
  @keyframes -global-art-ripple { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
  @keyframes -global-art-eq { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(.4); } }
  @keyframes -global-art-ray { 0%, 100% { transform: scale(1); } 50% { transform: scale(.88); } }
  @keyframes -global-art-thump { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
  @keyframes -global-art-spin { to { transform: rotate(360deg); } }
  @keyframes -global-art-note { 0% { transform: translate(0, 3px); opacity: 0; } 25% { opacity: 1; } 100% { transform: translate(2px, -11px); opacity: 0; } }
  @keyframes -global-art-aim { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(2.5px, -1.5px); } 50% { transform: translate(-1px, 2px); } 75% { transform: translate(-2.5px, -1px); } }
  @keyframes -global-art-blink { 50% { opacity: .25; } }
  @keyframes -global-art-ecg { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
  @keyframes -global-art-beat { 0%, 100% { transform: scale(1); } 12% { transform: scale(1.07); } 24% { transform: scale(1); } 36% { transform: scale(1.04); } }
  @keyframes -global-art-drip { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(1.22); } }
  @keyframes -global-art-fall { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(16px); opacity: 0; } }
  @keyframes -global-art-wob { 0%, 100% { transform: scale(1, 1); } 33% { transform: scale(1.06, .96); } 66% { transform: scale(.97, 1.04); } }
  @keyframes -global-art-slash { from { opacity: 0; transform: translate(-5px, -7px); } }
  @keyframes -global-art-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes -global-art-rip { from { transform: scale(.6); opacity: .9; } to { transform: scale(3.2); opacity: 0; } }
  @keyframes -global-art-march { to { stroke-dashoffset: -8.4; } }
  @keyframes -global-art-fill { from { transform: scaleX(.12); } }
  @keyframes -global-art-xh { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.45); } }
  @keyframes -global-art-sweep { from { transform: translateX(-50px); } to { transform: translateX(110px); } }
  @keyframes -global-art-shadow { 0%, 100% { transform: scale(1); opacity: .4; } 50% { transform: scale(.8); opacity: .22; } }
  @keyframes -global-art-hop { 0%, 100% { transform: translateY(0); } 30% { transform: translateY(-4px); } 55% { transform: translateY(0); } }
  @keyframes -global-art-confetti { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-3px) rotate(18deg); } }
</style>
