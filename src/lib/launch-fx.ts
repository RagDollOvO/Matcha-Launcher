// 启动游戏那一下的小特效：按钮回弹 + 两圈光环 + 播放键「嗖」地飞走 + 茶叶 / 泡泡 / 星星往上撒 + 头像蹦一下。
// 全部是临时挂在 body 上的小元素，只动 transform / opacity（光环动 outline-offset），放完自己删掉。
// 减少动态效果时整段跳过（音效照常）。

import { reduceMotion } from './motion';

const COLORS = [
  'var(--md-primary)',
  'var(--md-tertiary)',
  'var(--md-secondary)',
  'color-mix(in srgb, var(--md-primary) 55%, white)',
  'color-mix(in srgb, var(--md-tertiary) 50%, white)',
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

function layer() {
  const el = document.createElement('div');
  Object.assign(el.style, { position: 'fixed', inset: '0', zIndex: '60', pointerEvents: 'none', overflow: 'hidden' } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

function dot(host: HTMLElement, x: number, y: number, css: Partial<CSSStyleDeclaration>, text = '') {
  const el = document.createElement('span');
  Object.assign(el.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, willChange: 'transform, opacity', ...css } satisfies Partial<CSSStyleDeclaration>);
  el.textContent = text;
  host.appendChild(el);
  return el;
}

/** 一片茶叶：往上飘，到顶后打着转慢慢落下 */
function leaf(host: HTMLElement, x: number, y: number) {
  const s = rand(9, 15);
  const el = dot(host, x - s / 2, y - s / 2, { width: `${s}px`, height: `${s * 1.25}px`, borderRadius: `${s}px 1px`, background: pick(COLORS) });
  const dx = rand(-110, 110), up = rand(90, 190), spin = rand(-320, 320), sway = rand(14, 26) * Math.sign(dx || 1);
  return el.animate([
    { transform: 'translate(0, 0) rotate(0deg) scale(.3)', opacity: 0 },
    { transform: `translate(${dx * 0.3}px, ${-up * 0.5}px) rotate(${spin * 0.3}deg) scale(1)`, opacity: 1, offset: 0.18 },
    { transform: `translate(${dx * 0.8}px, ${-up}px) rotate(${spin * 0.6}deg) scale(1)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx + sway}px, ${-up + 22}px) rotate(${spin * 0.85}deg) scale(.9)`, opacity: 0.8, offset: 0.75 },
    { transform: `translate(${dx - sway * 0.4}px, ${-up + 46}px) rotate(${spin}deg) scale(.8)`, opacity: 0 },
  ], { duration: rand(1100, 1500), delay: rand(0, 140), easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'both' });
}

/** 一个泡泡：慢慢冒上去，晃两下，最后「啵」地放大消失 */
function bubble(host: HTMLElement, x: number, y: number) {
  const s = rand(8, 16);
  const el = dot(host, x - s / 2, y - s / 2, {
    width: `${s}px`, height: `${s}px`, borderRadius: '50%', border: `1.5px solid ${pick(COLORS)}`,
    background: 'color-mix(in srgb, var(--md-surface) 30%, transparent)',
  });
  const dx = rand(-60, 60), up = rand(130, 240), w = rand(6, 12);
  return el.animate([
    { transform: 'translate(0, 0) scale(.2)', opacity: 0 },
    { transform: `translate(${dx * 0.3 + w}px, ${-up * 0.35}px) scale(1)`, opacity: 1, offset: 0.25 },
    { transform: `translate(${dx * 0.6 - w}px, ${-up * 0.7}px) scale(1)`, opacity: 1, offset: 0.7 },
    { transform: `translate(${dx}px, ${-up}px) scale(1)`, opacity: 0.9, offset: 0.9 },
    { transform: `translate(${dx}px, ${-up}px) scale(1.7)`, opacity: 0 },
  ], { duration: rand(1200, 1700), delay: rand(40, 220), easing: 'ease-out', fill: 'both' });
}

/** 一颗小星：一闪一闪地蹦出去 */
function sparkle(host: HTMLElement, x: number, y: number, dx = rand(-90, 90), up = rand(60, 140), delay = rand(0, 200)) {
  const s = rand(11, 18);
  const el = dot(host, x - s / 2, y - s / 2, { fontSize: `${s}px`, lineHeight: '1', color: pick(COLORS) }, pick(['✦', '✧', '✦']));
  return el.animate([
    { transform: 'translate(0, 0) scale(0) rotate(0deg)', opacity: 0 },
    { transform: `translate(${dx * 0.6}px, ${-up * 0.6}px) scale(1.25) rotate(45deg)`, opacity: 1, offset: 0.35 },
    { transform: `translate(${dx * 0.85}px, ${-up * 0.85}px) scale(.7) rotate(70deg)`, opacity: 0.9, offset: 0.6 },
    { transform: `translate(${dx}px, ${-up}px) scale(0) rotate(110deg)`, opacity: 0 },
  ], { duration: rand(700, 1000), delay, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' });
}

/** 按钮外圈扩散的柔光环 */
function ring(host: HTMLElement, r: DOMRect, color: string, delay: number) {
  const el = dot(host, r.left, r.top, { width: `${r.width}px`, height: `${r.height}px`, borderRadius: '18px', outline: `2px solid ${color}`, outlineOffset: '0px' });
  return el.animate([
    { outlineOffset: '0px', opacity: 0.75 },
    { outlineOffset: '18px', opacity: 0 },
  ], { duration: 700, delay, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'both' });
}

/** 播放键变成一个小三角，蓄力往前一顶，然后朝右上方「嗖」地飞走，身后掉星星 */
function playDash(host: HTMLElement, r: DOMRect) {
  const x = r.left + r.width / 2 - 46, y = r.top + r.height / 2 - 16;
  const el = dot(host, x, y, { width: '18px', height: '18px' });
  el.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 4.5v15a1.2 1.2 0 0 0 1.8 1l12.4-7.5a1.2 1.2 0 0 0 0-2L7.8 3.5A1.2 1.2 0 0 0 6 4.5z" fill="var(--md-primary)" stroke="var(--md-on-primary)" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const tx = 210, ty = -190;
  const anim = el.animate([
    { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
    { transform: 'translate(-6px, 2px) rotate(0deg) scale(.9, 1.1)', opacity: 1, offset: 0.16 },
    { transform: 'translate(22px, -6px) rotate(-12deg) scale(1.25)', opacity: 1, offset: 0.36 },
    { transform: `translate(${tx}px, ${ty}px) rotate(-40deg) scale(.35)`, opacity: 0 },
  ], { duration: 820, easing: 'cubic-bezier(0.55, 0, 0.6, 0.9)', fill: 'both' });
  // 沿着飞行方向撒一串小尾巴
  for (let i = 0; i < 5; i++) {
    const k = 0.25 + i * 0.15;
    sparkle(host, x + 9 + 22 + (tx - 22) * k, y + 9 - 6 + (ty + 6) * k, rand(-14, 14), rand(-10, 18), 300 + i * 70);
  }
  return anim;
}

/** 头像跟着开心地蹦一下（先蹲、再跳、落地压扁、回弹） */
function hop(avatar: HTMLElement) {
  return avatar.animate([
    { transform: 'translateY(0) scale(1, 1)' },
    { transform: 'translateY(2px) scale(1.08, .9)', offset: 0.14 },
    { transform: 'translateY(-18px) scale(.95, 1.06)', offset: 0.42 },
    { transform: 'translateY(0) scale(1.07, .93)', offset: 0.7 },
    { transform: 'translateY(-3px) scale(.99, 1.01)', offset: 0.85 },
    { transform: 'translateY(0) scale(1, 1)' },
  ], { duration: 700, delay: 80, easing: 'ease-in-out' });
}

export function launchFx(button: HTMLElement | null | undefined, avatar?: HTMLElement | null) {
  if (!button || reduceMotion()) return;
  const r = button.getBoundingClientRect();
  if (!r.width) return;
  const host = layer();
  const anims: Animation[] = [];

  anims.push(button.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(.95)', offset: 0.18 },
    { transform: 'scale(1.035)', offset: 0.55 },
    { transform: 'scale(1)' },
  ], { duration: 560, easing: 'ease-out' }));
  anims.push(ring(host, r, 'var(--md-primary)', 0), ring(host, r, 'var(--md-tertiary)', 140));
  anims.push(playDash(host, r));

  // 从按钮上沿撒出去
  for (let i = 0; i < 12; i++) anims.push(leaf(host, r.left + rand(0.12, 0.88) * r.width, r.top + rand(4, 14)));
  for (let i = 0; i < 7; i++) anims.push(bubble(host, r.left + rand(0.15, 0.85) * r.width, r.top + rand(2, 10)));
  for (let i = 0; i < 9; i++) anims.push(sparkle(host, r.left + rand(0.1, 0.9) * r.width, r.top + rand(0, 12)));

  if (avatar) {
    anims.push(hop(avatar));
    // 落地那一下，头顶冒出一圈小星星
    const a = avatar.getBoundingClientRect();
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + (i - 2) * 0.5;
      anims.push(sparkle(host, a.left + a.width / 2, a.top + 10, Math.cos(ang) * rand(46, 64), -Math.sin(ang) * rand(46, 64), 560 + i * 25));
    }
  }

  // 全部放完再删；面板隐藏时动画可能不出帧，留个兜底定时器
  let done = false;
  const cleanup = () => { if (!done) { done = true; host.remove(); } };
  Promise.allSettled(anims.map((a) => a.finished)).then(cleanup);
  setTimeout(cleanup, 3000);
}
