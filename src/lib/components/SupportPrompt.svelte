<script lang="ts">
  // 下载完成后右下角的「去点赞」卡片，主角是 Matcha 的吉祥物小火苗。
  // - 弹出：卡片弹起 → 小火苗蹦出来 → 气泡里一个字一个字说话（带「哔哔」声）
  // - 鼠标移到「前往点赞」：小火苗举手蹦跶冒心心；移到「下次一定」：委屈发抖掉眼泪，「前往点赞」在旁边蹦着求选
  // - 戳小火苗会「吱」一声，连戳会晕
  // - 「下次一定」：挥手告别两秒再收起，还能反悔；点赞后从浏览器回来，小火苗撒花道谢
  // 不挡操作、不自动消失（道谢除外）；内置浏览器页被原生网页盖住，先不弹，离开后再出来。
  import { untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import Heart from '@lucide/svelte/icons/heart';
  import FlareBuddy, { type BuddyMood } from './FlareBuddy.svelte';
  import { app } from '../stores/app.svelte';
  import { support, SOURCE_LABEL, type SupportItem } from '../stores/support.svelte';
  import { PLEAD, HAPPY, POKE, DIZZY, THANKS, PITCH, idleLine, pick, teaseLine, likedLine, laterLabel } from '../support-lines';
  import { sfx } from '../sound/sfx.svelte';
  import { reduceMotion } from '../motion';

  const SHOW = 4;
  const still = reduceMotion();
  const SHORT: Record<SupportItem['source'], string> = { steam: 'Steam', bilibili: 'B站', gamemaps: 'GameMaps', afdian: '爱发电' };

  const items = $derived(support.pending);
  const one = $derived(items.length === 1 ? items[0] : null);
  const thanking = $derived(support.cheer && app.route !== 'browser');
  const showCard = $derived(app.route !== 'browser' && (thanking || (support.open && items.length > 0)));
  const bye = $derived(!thanking && !!support.farewell);

  // ---------- 心情 ----------
  let hover = $state<'idle' | 'happy' | 'plead'>('idle');
  let hoverLine = $state('');
  let temp = $state<{ mood: 'poke' | 'dizzy'; line: string } | null>(null);
  let thanksLine = $state('');
  let tempTimer: ReturnType<typeof setTimeout> | undefined;

  const mood = $derived<BuddyMood>(thanking ? 'thanks' : bye ? 'bye' : temp ? temp.mood : hover);
  const bubble = $derived(thanking ? thanksLine : bye ? support.farewell : temp ? temp.line : hover === 'idle' ? support.line : hoverLine);
  const title = $derived(thanking ? '谢谢你！' : one ? '下载好啦！给作者点个赞吧～' : `${items.length} 个都下载好啦～`);
  const note = $derived(support.later >= 3 ? teaseLine(support.later) : support.likedCount ? likedLine(support.likedCount) : '');

  function feel(m: 'idle' | 'happy' | 'plead') {
    if (bye || thanking || m === hover) return;
    hover = m;
    if (m === 'idle') return;
    temp = null; clearTimeout(tempTimer);
    if (m === 'happy') { hoverLine = pick(HAPPY); sfx.cute('boing'); }
    else { hoverLine = pick(PLEAD); sfx.cute('aww'); }
  }
  /** 悬停 / 聚焦时换心情，移开就恢复 */
  const react = (m: 'happy' | 'plead') => ({ onpointerenter: () => feel(m), onpointerleave: () => feel('idle'), onfocus: () => feel(m), onblur: () => feel('idle') });

  // ---------- 戳一戳 ----------
  let pokes = $state(0);
  let pokeTimes: number[] = [];
  function pokeIt() {
    pokes++;
    if (bye || thanking) { sfx.cute('squeak'); return; }
    const now = Date.now();
    pokeTimes = [...pokeTimes.filter((t) => now - t < 2500), now];
    clearTimeout(tempTimer);
    if (pokeTimes.length >= 4) {
      pokeTimes = [];
      temp = { mood: 'dizzy', line: pick(DIZZY) }; sfx.cute('dizzy');
      tempTimer = setTimeout(() => (temp = null), 2600);
    } else {
      temp = { mood: 'poke', line: pick(POKE) }; sfx.cute('squeak');
      tempTimer = setTimeout(() => (temp = null), 1900);
    }
  }

  // ---------- 粒子 ----------
  type Part = { dx: number; dy: number; r: number; d: number; g: string; c: string; s: number };
  // 卡片是暖色亮底，白色粒子看不见，换成橙黄
  const COLORS = ['#ff5f6d', '#ff8fab', '#ffb84d', '#ff7a45', '#ffc93c'];
  const HEARTS = [{ x: -16, d: 0, s: 0.9 }, { x: 12, d: 200, s: 0.7 }, { x: -4, d: 420, s: 1 }, { x: 18, d: 640, s: 0.8 }, { x: -20, d: 860, s: 0.75 }, { x: 6, d: 1080, s: 0.95 }];
  let burst = $state<{ id: number; parts: Part[] } | null>(null);
  let burstId = 0;
  let burstTimer: ReturnType<typeof setTimeout> | undefined;
  function fire(n: number, near: number, far: number, glyphs: string[]) {
    if (still) return;
    const parts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.6, dist = near + Math.random() * (far - near);
      return { dx: Math.cos(a) * dist, dy: Math.sin(a) * dist - 12, r: (Math.random() - 0.5) * 240, d: Math.random() * 90, g: pick(glyphs), c: pick(COLORS), s: 0.7 + Math.random() * 0.7 };
    });
    burst = { id: ++burstId, parts };
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => (burst = null), 1400);
  }

  // ---------- 出场 ----------
  let shownAt = 0, wasShown = false;
  let settled = $state(false);
  $effect(() => {
    const on = showCard;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (on && !wasShown) {
      shownAt = performance.now(); settled = false;
      untrack(() => sfx.cute('pop'));
      if (!still) {
        timers.push(setTimeout(() => sfx.cute('boing'), 180));
        // 道谢时有更大的撒花，出场的小星星就不放了
        if (!untrack(() => thanking)) timers.push(setTimeout(() => fire(9, 40, 64, ['✦', '✧', '♥']), 260));
      }
      timers.push(setTimeout(() => (settled = true), 760));
    }
    if (!on) { hover = 'idle'; temp = null; }
    wasShown = on;
    return () => timers.forEach(clearTimeout);
  });
  // 告别 / 道谢时把悬停心情清掉
  $effect(() => { if (bye || thanking) { hover = 'idle'; temp = null; } });

  // 道谢：撒花，几秒后自己收起；还有没点的，换句台词接着问
  $effect(() => {
    if (!thanking) return;
    thanksLine = support.cheerLine || pick(THANKS);
    const a = setTimeout(() => { sfx.cute('yay'); fire(20, 54, 120, ['♥', '✦', '♥', '★', '✧']); }, 240);
    const b = setTimeout(() => endThanks(), 4200);
    return () => { clearTimeout(a); clearTimeout(b); };
  });
  function endThanks() {
    support.cheer = false; support.cheerLine = '';
    if (support.pending.length) support.line = idleLine(support.pending.map((p) => p.source));
  }

  // ---------- 打字机 ----------
  let typed = $state('');
  $effect(() => {
    const full = bubble, pitch = PITCH[mood] ?? 1;
    if (!showCard) return;
    if (still) { typed = full; return; }
    const chars = Array.from(full);
    let i = 0, timer: ReturnType<typeof setTimeout>;
    typed = '';
    const step = () => {
      i++;
      typed = chars.slice(0, i).join('');
      const ch = chars[i - 1];
      if (i % 2 === 1 && /[\p{L}\p{N}]/u.test(ch)) sfx.cute('blip', pitch);
      if (i < chars.length) timer = setTimeout(step, /[，。！？、…～]/.test(ch) ? 130 : 34);
    };
    timer = setTimeout(step, Math.max(0, 560 - (performance.now() - shownAt)));
    return () => clearTimeout(timer);
  });

  // ---------- 动作 ----------
  function like(item: SupportItem) { if (support.voting) return; sfx.cute('sparkle'); void support.go(item); }
  function later() { if (support.voting) return; sfx.cute('whimper'); support.dismiss(); }
  const sub = (i: SupportItem) => i.author ?? SOURCE_LABEL[i.source];
  const where = (i: SupportItem) => support.direct(i) ? `用内置浏览器里登录的 ${support.directName(i)} 账号直接点赞` : `在内置浏览器打开${SOURCE_LABEL[i.source]}页面`;
  const busy = $derived(!!support.voting);
</script>

{#if showCard}
  <div class="like" class:still data-mood={mood} role="dialog" aria-modal="false" aria-labelledby="like-title" aria-describedby="like-say" out:fade={{ duration: still ? 0 : 200 }}>
    <div class="top">
      <button class="stage" type="button" data-sfx="none" aria-label="戳一下小火苗" onclick={pokeIt}>
        <FlareBuddy {mood} poke={pokes} {still} />
        {#if mood === 'happy' && !still}
          {#each HEARTS as h, i (i)}<i class="rise" style:--x="{h.x}px" style:--d="{h.d}ms" style:--s={h.s}>♥</i>{/each}
        {/if}
        {#if burst}
          {#key burst.id}
            {#each burst.parts as p, i (i)}<i class="spark" style:--dx="{p.dx}px" style:--dy="{p.dy}px" style:--r="{p.r}deg" style:--d="{p.d}ms" style:--s={p.s} style:color={p.c}>{p.g}</i>{/each}
          {/key}
        {/if}
      </button>
      <div class="talk">
        <h2 id="like-title"><span class="hb"><Heart size={13} fill="currentColor" /></span>{title}</h2>
        {#key bubble}
          <p class="say" class:again={settled} id="like-say">
            <span class="sr">{bubble}</span>
            <span class="ghost" aria-hidden="true">{bubble}</span>
            <span class="typed" aria-hidden="true">{typed}{#if typed.length < bubble.length}<i class="caret"></i>{/if}</span>
          </p>
        {/key}
      </div>
    </div>

    {#if !thanking && !bye}
      <div class="rest" out:fade={{ duration: still ? 0 : 140 }}>
        <ul>
          {#each items.slice(0, SHOW) as it (it.key)}
            <li out:fade={{ duration: still ? 0 : 120 }}>
              <span class="src {it.source}">{SHORT[it.source]}</span>
              <span class="info">
                <span class="t" title={it.title}>{it.title}</span>
                <span class="s">{sub(it)}</span>
              </span>
              {#if !one}<button class="mini" type="button" data-sfx="none" title={where(it)} aria-busy={support.voting === it.key} aria-disabled={busy} {...react('happy')} onclick={() => like(it)}><Heart size={12} fill="currentColor" />{support.voting === it.key ? '点赞中' : '点赞'}</button>{/if}
            </li>
          {/each}
          {#if items.length > SHOW}<li class="more">还有 {items.length - SHOW} 个在排队等你的赞～</li>{/if}
        </ul>
        {#if note}<p class="note" class:sad={support.later >= 3}>{note}</p>{/if}
      </div>
    {/if}

    <footer>
      {#if thanking}
        <button class="pill go" type="button" data-sfx="none" onclick={() => { sfx.cute('pop'); endThanks(); }}>嘿嘿，不客气 ♡</button>
      {:else if bye}
        <button class="pill back" type="button" data-sfx="none" title={where(items[0])} onclick={() => like(items[0])}><Heart size={13} fill="currentColor" />等等，我还是去点吧！</button>
        <button class="text" type="button" data-sfx="none" onclick={() => support.dismiss()}>收起</button>
      {:else}
        <button class="pill later" type="button" data-sfx="none" aria-disabled={busy} {...react('plead')} onclick={later}><span>{laterLabel(support.later)}</span></button>
        <button class="pill go" type="button" data-sfx="none" title={where(items[0])} aria-busy={busy && (one ? support.voting === one.key : support.voting === items[0].key)} aria-disabled={busy} {...react('happy')} onclick={() => like(items[0])}><Heart size={14} fill="currentColor" />{one && support.voting === one.key ? '点赞中…' : one ? (support.direct(one) ? '直接点赞' : '前往点赞') : '从第一个开始'}</button>
      {/if}
    </footer>
  </div>
{/if}

<style>
  /* 暖色亮底：奶油桃色 → 浅粉，带一层粉色小圆点。整个启动器只有这里是亮的，弹出来像一张便利贴 */
  .like {
    --ink: #4a2a2e; --ink-2: #8a6168; --ink-3: #b08990;
    --rose: #ff5f6d; --pink: #ff8fab; --edge: #ffc6d1; --soft: #ffe4ea;
    --buddy-shadow: #e7a3ae;
    position: absolute; right: 20px; bottom: 20px; z-index: 30; width: min(392px, calc(100% - 40px));
    display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 16px 12px;
    border: 1px solid var(--edge); border-radius: 20px; color: var(--ink);
    background:
      radial-gradient(150px 120px at 52px 58px, #fffbe9 0%, transparent 72%),
      radial-gradient(#ffd3dd 1.1px, transparent 1.6px) 0 0 / 14px 14px,
      linear-gradient(155deg, #fff4ec 0%, #ffecef 55%, #ffe1ea 100%);
    box-shadow: 0 18px 44px #000a, 0 0 0 4px #ff8fab14;
    transform-origin: 85% 100%;
    animation: card-in 560ms cubic-bezier(.34, 1.56, .64, 1) both;
  }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  .top { display: flex; gap: 10px; align-items: flex-start; }
  .stage { position: relative; flex: none; width: 86px; height: 90px; border-radius: 16px; cursor: pointer; animation: spawn 760ms cubic-bezier(.34, 1.56, .64, 1) 120ms both; }
  .stage:focus-visible { outline: 2px solid var(--pink); outline-offset: 2px; }
  .talk { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; padding-top: 6px; }
  h2 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; font-weight: 600; color: var(--ink); animation: rise-in 360ms ease-out 200ms both; }
  .hb { display: grid; place-items: center; color: var(--rose); animation: beat 1.4s ease-in-out 600ms infinite; }

  /* 气泡：底下垫一份完整文字撑住高度，上面一个字一个字打出来 */
  .say { position: relative; display: grid; margin: 0; padding: 9px 12px; border: 1.5px solid var(--edge); border-radius: 14px; background: #fff; font-size: 12.5px; line-height: 1.65; color: var(--ink); box-shadow: 0 2px 0 #ffd6de; transform-origin: 0 40%; animation: bubble 460ms cubic-bezier(.34, 1.56, .64, 1) 340ms both; }
  .say.again { animation: bump 280ms cubic-bezier(.34, 1.56, .64, 1) both; }
  .say::before { content: ''; position: absolute; left: -6.5px; top: 15px; width: 10px; height: 10px; background: #fff; border-left: 1.5px solid var(--edge); border-bottom: 1.5px solid var(--edge); border-bottom-left-radius: 3px; transform: rotate(45deg); }
  .ghost, .typed { grid-area: 1 / 1; overflow-wrap: anywhere; }
  .ghost { visibility: hidden; }
  .caret { display: inline-block; width: 6px; height: 6px; margin-left: 3px; border-radius: 50%; background: var(--pink); vertical-align: middle; animation: caret 420ms ease-in-out infinite alternate; }
  [data-mood='plead'] .say, [data-mood='bye'] .say { border-style: dashed; border-color: #f3a3b3; background: #fffafb; }
  [data-mood='happy'] .say, [data-mood='thanks'] .say { border-color: var(--pink); }

  .rest { display: flex; flex-direction: column; gap: 8px; animation: rise-in 380ms ease-out 300ms both; }
  ul { list-style: none; margin: 0; padding: 4px; border: 1.5px solid #ffd9e0; border-radius: 14px; background: #fffafb; max-height: 200px; overflow-y: auto; }
  li { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 5px 6px 5px 8px; border-radius: 10px; transition: background 150ms; }
  li:hover { background: #fff0f3; }
  .src { flex: none; height: 19px; padding: 0 8px; border-radius: 10px; font-size: 11px; font-weight: 600; line-height: 19px; }
  .src.steam { background: #e2f0fb; color: #1f6fa6; }
  .src.bilibili { background: #ffe3ed; color: #e0457b; }
  .src.gamemaps { background: #e2f5e7; color: #2f8a4c; }
  .src.afdian { background: #efe6fd; color: #7647c9; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .t { font-size: 13px; font-weight: 500; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s { font-size: 12px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more { justify-content: center; min-height: 28px; font-size: 12px; color: var(--ink-3); }
  .note { margin: 0; padding-left: 4px; font-size: 12px; color: var(--ink-3); }
  .note.sad { color: #e0455e; }

  footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; animation: rise-in 380ms ease-out 380ms both; }
  .pill { position: relative; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 16px; border-radius: 17px; font-size: 13px; transition: transform 180ms cubic-bezier(.34, 1.56, .64, 1), background 150ms, color 150ms, border-color 150ms; }
  .pill:active { transform: scale(.93); }
  .later { border: 1.5px solid #f3c3cc; background: #fff; color: var(--ink-2); }
  .later:hover { color: var(--ink); border-color: #eaa9b6; }
  .later:hover span { display: inline-block; animation: shy 180ms linear infinite; }
  .go { overflow: hidden; background: linear-gradient(180deg, #ff7676, #f0435a); color: #fff; font-weight: 600; box-shadow: 0 4px 14px #f0435a59, inset 0 1px 0 #ffffff59; }
  .go:hover { transform: translateY(-1px) scale(1.05); }
  .go::after { content: ''; position: absolute; top: 0; left: -60%; width: 40%; height: 100%; background: linear-gradient(100deg, transparent, #ffffff66, transparent); transform: skewX(-20deg); animation: shine 3.4s ease-in-out 1.4s infinite; }
  .go:hover :global(svg) { animation: beat 700ms ease-in-out infinite; }
  [data-mood='plead'] .go { animation: pickme 560ms ease-in-out infinite; }
  .back { margin-right: auto; border: 1.5px dashed #f3a3b3; background: #fff; color: #e0455e; }
  .back:hover { background: #fff0f3; border-style: solid; }
  .back :global(svg) { animation: beat 1.1s ease-in-out infinite; }
  .text { height: 30px; padding: 0 8px; font-size: 12px; color: var(--ink-3); }
  .text:hover { color: var(--ink); }
  .mini { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: 13px; background: var(--soft); color: #e0455e; font-size: 12px; font-weight: 500; transition: transform 160ms cubic-bezier(.34, 1.56, .64, 1), background 150ms, color 150ms; }
  .mini:hover { background: var(--rose); color: #fff; transform: scale(1.06); }
  .mini:active { transform: scale(.93); }
  /* 直接点赞等 Steam 回话：按着的那颗心一直跳，其他按钮先不响应 */
  .pill[aria-busy='true'] :global(svg), .mini[aria-busy='true'] :global(svg) { animation: beat 700ms ease-in-out infinite; }
  .mini[aria-busy='true'] { background: var(--rose); color: #fff; }
  .pill[aria-disabled='true'], .mini[aria-disabled='true'] { cursor: progress; }
  .pill[aria-disabled='true']:not([aria-busy='true']), .mini[aria-disabled='true']:not([aria-busy='true']) { opacity: .55; }
  .pill[aria-disabled='true']:hover, .pill[aria-disabled='true']:active, .mini[aria-disabled='true']:active { transform: none; }
  ul::-webkit-scrollbar-thumb { background: #f3c3cc; border-radius: 4px; }

  /* 粒子 */
  .rise, .spark { position: absolute; left: 50%; font-style: normal; line-height: 1; pointer-events: none; }
  .rise { top: 22%; color: #ff5f7e; font-size: calc(12px * var(--s)); opacity: 0; animation: float 1.3s ease-out var(--d) infinite; }
  .spark { top: 48%; font-size: calc(12px * var(--s)); opacity: 0; animation: fly 1.1s cubic-bezier(.15, .8, .3, 1) var(--d) both; }

  @keyframes card-in { from { opacity: 0; transform: translateY(28px) scale(.86) rotate(2deg); } 55% { opacity: 1; } to { opacity: 1; transform: none; } }
  @keyframes spawn { 0% { opacity: 0; transform: translateY(34px) scale(.3); } 55% { opacity: 1; transform: translateY(-8px) scale(1.12, .9); } 78% { transform: translateY(0) scale(.95, 1.06); } 100% { opacity: 1; transform: none; } }
  @keyframes rise-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes bubble { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: none; } }
  @keyframes bump { from { transform: scale(.94); } to { transform: none; } }
  @keyframes caret { from { transform: scale(.6); opacity: .5; } to { transform: scale(1); opacity: 1; } }
  @keyframes beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.28); } 30% { transform: scale(.94); } 45% { transform: scale(1.14); } 60% { transform: scale(1); } }
  @keyframes shy { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-1px); } 75% { transform: translateX(1px); } }
  @keyframes shine { 0%, 70% { left: -60%; } 100% { left: 130%; } }
  @keyframes pickme { 0%, 100% { transform: scale(1) rotate(0); } 30% { transform: scale(1.09) rotate(-3deg); } 65% { transform: scale(1.06) rotate(3deg); } }
  @keyframes float { 0% { opacity: 0; transform: translate(-50%, 0) scale(.4); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(calc(-50% + var(--x)), -48px) scale(1); } }
  @keyframes fly { 0% { opacity: 1; transform: translate(-50%, -50%) scale(.3) rotate(0); } 70% { opacity: 1; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1) rotate(var(--r)); } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy) + 16px)) scale(.9) rotate(var(--r)); } }

  .still, .still * { animation: none !important; }
  .still .rise, .still .spark { display: none; }
</style>
