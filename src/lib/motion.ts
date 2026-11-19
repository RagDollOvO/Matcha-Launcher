// 小型动效工具：只动 transform / opacity，尊重「减少动态效果」设置。

/** 系统开了「减少动画」，或设置页打开了「减弱动效」 */
export const reduceMotion = () =>
  (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-reduce-motion')) ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * 「飞入下载」：从来源元素复制一张缩略图，沿弧线飞到侧栏的下载图标。
 * 只用于点击下载这种偶发操作；减少动态效果时直接跳过。
 */
export function flyToDownloads(from: Element | null | undefined) {
  if (!from || reduceMotion()) return;
  const target = document.querySelector('[data-rail="downloads"]');
  if (!target) return;
  const a = from.getBoundingClientRect(), b = target.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const img = from.querySelector('img');
  const ghost = document.createElement('div');
  const s = Math.min(a.width, a.height, 120);
  Object.assign(ghost.style, {
    position: 'fixed', left: `${a.left + (a.width - s) / 2}px`, top: `${a.top + (a.height - s) / 2}px`, width: `${s}px`, height: `${s}px`,
    borderRadius: '12px', overflow: 'hidden', zIndex: '60', pointerEvents: 'none', background: 'var(--md-surface-container-high)',
    border: '1px solid var(--island-line)', boxShadow: '0 14px 30px -14px rgb(0 0 0 / .5)', willChange: 'transform, opacity',
  } satisfies Partial<CSSStyleDeclaration>);
  if (img?.src) {
    const copy = document.createElement('img');
    copy.src = img.src;
    Object.assign(copy.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
    ghost.appendChild(copy);
  }
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const end = 14 / s;
  // 先轻轻抬起，再沿弧线收进图标
  const anim = ghost.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 40}px) scale(${0.5 + end / 2})`, opacity: 1, offset: 0.4 },
    { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0.2 },
  ], { duration: 560, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', fill: 'forwards' });
  anim.onfinish = () => {
    ghost.remove();
    target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  };
}
