<script lang="ts" module>
  export type BuddyMood = 'idle' | 'happy' | 'plead' | 'poke' | 'dizzy' | 'bye' | 'thanks';
</script>

<script lang="ts">
  // Matcha 的吉祥物「小火苗」：会眨眼，眼珠跟着鼠标转，按心情换表情和动作。纯 SVG + CSS 动画。
  let { mood = 'idle', poke = 0, still = false }: { mood?: BuddyMood; poke?: number; still?: boolean } = $props();

  let svg = $state<SVGSVGElement>();
  let px = $state(0), py = $state(0);
  let blink = $state(false);

  // 眼珠跟着鼠标
  $effect(() => {
    if (still) return;
    let raf = 0, last: PointerEvent | null = null;
    const move = (e: PointerEvent) => {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!svg || !last) return;
        const r = svg.getBoundingClientRect();
        const dx = last.clientX - (r.left + r.width / 2), dy = last.clientY - (r.top + r.height * 0.6);
        const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 140);
        px = (dx / d) * 2.2 * k; py = (dy / d) * 1.8 * k;
      });
    };
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  });
  // 隔一会儿眨眼，偶尔连眨两下
  $effect(() => {
    if (still) return;
    let timer: ReturnType<typeof setTimeout>;
    const once = (then?: () => void) => { blink = true; timer = setTimeout(() => { blink = false; then?.(); }, 130); };
    const next = () => { timer = setTimeout(() => (Math.random() < 0.25 ? once(() => (timer = setTimeout(() => once(next), 120))) : once(next)), 2200 + Math.random() * 2400); };
    next();
    return () => { clearTimeout(timer); blink = false; };
  });

  const FLAME = 'M48 8 C60 24 76 38 76 60 C76 77 63 90 48 90 C33 90 20 77 20 60 C20 47 26 39 33 32 C34 40 38 45 42 46 C40 33 42 20 48 8 Z';
  const CORE = 'M48 64 C55 70 61 74 61 80 C61 86 55 89 48 89 C41 89 35 86 35 80 C35 74 41 70 48 64 Z';
  const open = $derived(mood === 'idle' || mood === 'plead' || mood === 'poke');
</script>

<svg bind:this={svg} class="buddy" class:still data-mood={mood} viewBox="0 0 96 100" aria-hidden="true">
  <defs>
    <linearGradient id="fb-body" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ff9b6a" /><stop offset=".55" stop-color="#f2545b" /><stop offset="1" stop-color="#d9304a" />
    </linearGradient>
    <radialGradient id="fb-core" cx=".5" cy=".65" r=".55">
      <stop offset="0" stop-color="#ffe6c8" stop-opacity=".95" /><stop offset="1" stop-color="#ffb38a" stop-opacity="0" />
    </radialGradient>
  </defs>
  <ellipse class="shadow" cx="48" cy="94" rx="20" ry="3.4" />
  <g class="move">
    {#key poke}
      <g class="squish" class:hit={poke > 0}>
        <path class="halo" d={FLAME} />
        <g class="arm l"><path d="M22 64 Q12 66 11 75" /></g>
        <g class="arm r"><path d="M74 64 Q84 66 85 75" /></g>
        <path class="body" d={FLAME} fill="url(#fb-body)" />
        <path class="core" d={CORE} fill="url(#fb-core)" />

        <g class="face">
          {#if mood === 'plead'}
            <path class="brow" d="M32 53.5 L41 50.5" /><path class="brow" d="M55 50.5 L64 53.5" />
          {/if}

          {#if open}
            <g class="eyes" class:blink={blink && mood !== 'plead'} style:transform="translate({px}px, {py}px)">
              <ellipse class="eye" cx="39" cy="62" rx={mood === 'plead' ? 5 : 4.2} ry={mood === 'plead' ? 6.4 : 5.6} />
              <ellipse class="eye" cx="57" cy="62" rx={mood === 'plead' ? 5 : 4.2} ry={mood === 'plead' ? 6.4 : 5.6} />
              <circle class="shine" cx="40.6" cy="59.6" r={mood === 'plead' ? 2.3 : 1.6} /><circle class="shine" cx="58.6" cy="59.6" r={mood === 'plead' ? 2.3 : 1.6} />
              {#if mood === 'plead'}<circle class="shine sm" cx="37.4" cy="65" r="1" /><circle class="shine sm" cx="55.4" cy="65" r="1" />{/if}
            </g>
          {:else if mood === 'happy' || mood === 'thanks'}
            <path class="line" d="M34.5 63 Q39 56.5 43.5 63" /><path class="line" d="M52.5 63 Q57 56.5 61.5 63" />
          {:else if mood === 'bye'}
            <path class="line" d="M35 58.5 L42 62 L35 65.5" /><path class="line" d="M61 58.5 L54 62 L61 65.5" />
          {:else if mood === 'dizzy'}
            <g class="spin-eye"><path class="line" d="M35.5 58.5 L42.5 65.5 M42.5 58.5 L35.5 65.5" /></g>
            <g class="spin-eye r"><path class="line" d="M53.5 58.5 L60.5 65.5 M60.5 58.5 L53.5 65.5" /></g>
          {/if}

          <ellipse class="cheek" cx="30.5" cy="70" rx="4.6" ry="2.6" /><ellipse class="cheek" cx="65.5" cy="70" rx="4.6" ry="2.6" />

          {#if mood === 'idle'}<path class="line" d="M44.5 70.5 Q48 74 51.5 70.5" />
          {:else if mood === 'happy' || mood === 'thanks'}<path class="mouth" d="M42.5 69.5 Q48 79 53.5 69.5 Z" /><path class="tongue" d="M45.4 74 Q48 77.4 50.6 74 Z" />
          {:else if mood === 'plead'}<path class="line wobble" d="M43 73.5 Q45.5 71 48 73.5 Q50.5 76 53 73.5" />
          {:else if mood === 'poke'}<ellipse class="mouth" cx="48" cy="72.5" rx="2.6" ry="3.2" />
          {:else if mood === 'bye'}<path class="line" d="M43.5 74.5 Q48 70 52.5 74.5" />
          {:else}<path class="line" d="M43 72.5 Q45.5 70.5 48 72.5 Q50.5 74.5 53 72.5" />{/if}

          {#if mood === 'plead'}<path class="tear drop" d="M36 68 q-1.6 3 0 4.4 q1.6 -1.4 0 -4.4 Z" /><path class="tear drop d2" d="M60 68 q-1.6 3 0 4.4 q1.6 -1.4 0 -4.4 Z" />{/if}
          {#if mood === 'bye'}<path class="stream" d="M37 66 Q35 74 36 84" /><path class="stream" d="M59 66 Q61 74 60 84" />{/if}
        </g>
      </g>
    {/key}
  </g>

  {#if mood === 'thanks'}
    {#each [[16, 30, 0], [80, 22, 260], [10, 66, 520], [86, 58, 140]] as [x, y, d], i (i)}
      <path class="twinkle" style:--d="{d}ms" style:transform-origin="{x}px {y}px" d="M{x} {y - 6} Q{x} {y} {x + 6} {y} Q{x} {y} {x} {y + 6} Q{x} {y} {x - 6} {y} Q{x} {y} {x} {y - 6} Z" />
    {/each}
  {/if}
  {#if mood === 'dizzy'}
    <g class="orbit">{#each [0, 120, 240] as a (a)}<text x={48 + 18 * Math.cos((a * Math.PI) / 180)} y={14 + 5 * Math.sin((a * Math.PI) / 180)}>✦</text>{/each}</g>
  {/if}
</svg>

<style>
  .buddy { display: block; width: 100%; height: 100%; overflow: visible; }
  .shadow { fill: var(--buddy-shadow, #000); opacity: .55; transform-origin: 48px 94px; animation: shadow 2.6s ease-in-out infinite; }
  .move { transform-origin: 48px 90px; animation: bob 2.6s ease-in-out infinite; }
  .squish { transform-origin: 48px 90px; }
  .squish.hit { animation: squish 420ms cubic-bezier(.34, 1.56, .64, 1); }

  .halo { fill: #f2545b; opacity: .18; transform-origin: 48px 90px; animation: halo 1.2s ease-in-out infinite alternate; }
  .body { transform-origin: 48px 90px; animation: flicker 1.5s ease-in-out infinite alternate; }
  .arm path { fill: none; stroke: #f05a5c; stroke-width: 6; stroke-linecap: round; }
  .arm { transition: transform 260ms cubic-bezier(.34, 1.56, .64, 1); }
  .arm.l { transform-origin: 22px 64px; }
  .arm.r { transform-origin: 74px 64px; }

  .eye { fill: #2a0a10; }
  .eyes { transition: transform 120ms ease-out; }
  .eyes ellipse, .eyes circle { transform-box: fill-box; transform-origin: center; transition: transform 90ms; }
  .eyes.blink ellipse { transform: scaleY(.1); }
  .eyes.blink circle { transform: scale(0); }
  .shine { fill: #fff; }
  .shine.sm { opacity: .85; }
  .line { fill: none; stroke: #2a0a10; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .brow { fill: none; stroke: #2a0a10; stroke-width: 2; stroke-linecap: round; }
  .mouth { fill: #4a0d16; }
  .tongue { fill: #ff8f9c; }
  .cheek { fill: #ffa3b4; opacity: .6; transition: opacity 200ms; }
  [data-mood='happy'] .cheek, [data-mood='thanks'] .cheek, [data-mood='poke'] .cheek { opacity: .95; }
  .tear { fill: #a8dcff; opacity: 0; animation: drop 1.2s ease-in infinite; }
  .tear.d2 { animation-delay: 600ms; }
  .stream { fill: none; stroke: #a8dcff; stroke-width: 2.6; stroke-linecap: round; stroke-dasharray: 3 4; animation: stream 500ms linear infinite; }
  .wobble { animation: wobble 260ms ease-in-out infinite alternate; }
  .twinkle { fill: #ffd27a; transform: scale(0); animation: twinkle 1s ease-in-out var(--d) infinite; }
  .orbit { transform-origin: 48px 14px; animation: orbit 1.1s linear infinite; }
  .orbit text { font-size: 8px; fill: #ffd27a; text-anchor: middle; dominant-baseline: middle; }
  .spin-eye { transform-origin: 39px 62px; animation: orbit 700ms linear infinite; }
  .spin-eye.r { transform-origin: 57px 62px; }

  /* 心情 → 动作 */
  [data-mood='happy'] .move { animation: jump 640ms cubic-bezier(.34, 1.4, .64, 1) infinite; }
  [data-mood='happy'] .arm.l, [data-mood='thanks'] .arm.l { transform: rotate(96deg); }
  [data-mood='happy'] .arm.r, [data-mood='thanks'] .arm.r { transform: rotate(-96deg); }
  [data-mood='happy'] .body { animation-duration: .5s; }
  [data-mood='plead'] .move { animation: shiver 160ms linear infinite; }
  [data-mood='plead'] .squish { transform: scale(1.03, .95); transition: transform 200ms; }
  [data-mood='plead'] .arm.l { transform: rotate(-28deg); }
  [data-mood='plead'] .arm.r { transform: rotate(28deg); }
  [data-mood='plead'] .halo { opacity: .08; }
  [data-mood='bye'] .move { animation: sway 1.3s ease-in-out infinite; }
  [data-mood='bye'] .arm.r { animation: wave 420ms ease-in-out infinite alternate; }
  [data-mood='bye'] .halo { opacity: .06; }
  [data-mood='thanks'] .move { animation: dance 520ms ease-in-out infinite alternate; }
  [data-mood='dizzy'] .move { animation: dizzy 640ms ease-in-out infinite alternate; }
  [data-mood='poke'] .arm.l { transform: rotate(40deg); }
  [data-mood='poke'] .arm.r { transform: rotate(-40deg); }

  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes shadow { 0%, 100% { transform: scaleX(1); opacity: .55; } 50% { transform: scaleX(.88); opacity: .4; } }
  @keyframes flicker { 0% { transform: scale(1, 1) skewX(0); } 50% { transform: scale(.985, 1.025) skewX(-1.5deg); } 100% { transform: scale(1.01, .99) skewX(1.5deg); } }
  @keyframes halo { from { transform: scale(1.1); opacity: .12; } to { transform: scale(1.18); opacity: .24; } }
  @keyframes squish { 0% { transform: scale(1, 1); } 25% { transform: scale(1.18, .78); } 55% { transform: scale(.9, 1.12); } 100% { transform: scale(1, 1); } }
  @keyframes jump { 0%, 100% { transform: translateY(0) scale(1, 1); } 15% { transform: translateY(0) scale(1.12, .88); } 45% { transform: translateY(-12px) scale(.92, 1.1); } 75% { transform: translateY(0) scale(1.06, .94); } }
  @keyframes shiver { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-.8px); } 75% { transform: translateX(.8px); } }
  @keyframes sway { 0%, 100% { transform: rotate(-5deg) scale(.95); } 50% { transform: rotate(5deg) scale(.95); } }
  @keyframes wave { from { transform: rotate(-70deg); } to { transform: rotate(-120deg); } }
  @keyframes dance { from { transform: rotate(-9deg) translateY(0); } to { transform: rotate(9deg) translateY(-6px); } }
  @keyframes dizzy { from { transform: rotate(-10deg); } to { transform: rotate(10deg); } }
  @keyframes wobble { from { transform: translateX(-.6px); } to { transform: translateX(.6px); } }
  @keyframes drop { 0% { opacity: 0; transform: translateY(0); } 15% { opacity: 1; } 100% { opacity: 0; transform: translateY(10px); } }
  @keyframes stream { to { stroke-dashoffset: -7; } }
  @keyframes twinkle { 0%, 100% { transform: scale(0) rotate(0); } 50% { transform: scale(1) rotate(45deg); } }
  @keyframes orbit { to { transform: rotate(360deg); } }

  .still *, .still { animation: none !important; transition: none !important; }
</style>
