<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Check from '@lucide/svelte/icons/check';
  import Minus from '@lucide/svelte/icons/minus';
  import Self from './Menu.svelte';
  import type { MenuItem } from './menu';

  let { items, x = 0, y = 0, onclose, anchor = null, depth = 0, onback, focusFirst = false }: {
    items: MenuItem[]; x?: number; y?: number; onclose: () => void;
    /** 子菜单：贴着父条目右侧展开 */
    anchor?: DOMRect | null; depth?: number; onback?: () => void; focusFirst?: boolean;
  } = $props();

  let el = $state<HTMLDivElement>();
  let pos = $state<{ left: number; top: number } | null>(null);
  let open = $state<{ i: number; rect: DOMRect; focus: boolean } | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const buttons = () => [...(el?.querySelectorAll<HTMLButtonElement>(':scope > .mi:not(:disabled)') ?? [])];

  onMount(() => {
    const r = el!.getBoundingClientRect();
    const W = innerWidth, H = innerHeight, m = 8;
    let left = x, top = y;
    if (anchor) {
      left = anchor.right - 2; top = anchor.top - 5;
      if (left + r.width > W - m) left = anchor.left - r.width + 2;
    }
    pos = { left: Math.max(m, Math.min(left, W - r.width - m)), top: Math.max(m, Math.min(top, H - r.height - m)) };
    if (focusFirst) void tick().then(() => buttons()[0]?.focus());
    else el!.focus({ preventScroll: true });
    if (depth > 0) return () => clearTimeout(timer);

    // 根菜单负责全局关闭：点外面、窗口失焦、缩放、外部滚动
    const outside = (e: Event) => { if (!(e.target as Element).closest?.('.ctx-menu')) onclose(); };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', onclose);
    window.addEventListener('blur', onclose);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', onclose);
      window.removeEventListener('blur', onclose);
    };
  });

  function hover(i: number, target: HTMLElement) {
    clearTimeout(timer);
    const it = items[i];
    const sub = it.kind !== 'sep' && it.kind !== 'label' && it.items?.length && !it.disabled;
    timer = setTimeout(() => (open = sub ? { i, rect: target.getBoundingClientRect(), focus: false } : null), sub ? 90 : 160);
  }
  function activate(i: number, target: HTMLElement, viaKey = false) {
    const it = items[i];
    if (it.kind === 'sep' || it.kind === 'label' || it.disabled) return;
    if (it.items?.length) { clearTimeout(timer); open = { i, rect: target.getBoundingClientRect(), focus: viaKey }; return; }
    onclose();
    it.run?.();
  }
  function onKey(e: KeyboardEvent) {
    const list = buttons();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (d: number) => list[(at + d + list.length) % list.length]?.focus();
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(at < 0 ? 0 : -1);
    else if (e.key === 'ArrowRight' && at >= 0) activate(Number(list[at].dataset.i), list[at], true);
    else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) activate(Number(list[at].dataset.i), list[at], true);
    else if (e.key === 'ArrowLeft' && depth > 0) onback?.();
    else if (e.key === 'Escape') { if (depth > 0) onback?.(); else onclose(); }
    else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  function closeSub() {
    const i = open?.i;
    open = null;
    if (i !== undefined) el?.querySelector<HTMLButtonElement>(`:scope > .mi[data-i="${i}"]`)?.focus();
  }
</script>

<div class="ctx-menu" class:ready={!!pos} bind:this={el} role="menu" tabindex="-1"
     style:left="{pos?.left ?? x}px" style:top="{pos?.top ?? y}px" style:z-index={60 + depth}
     onkeydown={onKey} oncontextmenu={(e) => e.preventDefault()}>
  {#each items as it, i (i)}
    {#if it.kind === 'sep'}
      <div class="sep" role="separator"></div>
    {:else if it.kind === 'label'}
      <div class="label">{it.label}</div>
    {:else}
      <button class="mi" class:danger={it.danger} class:open={open?.i === i} data-i={i} type="button"
              role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={it.checked === undefined ? undefined : it.checked === 'mixed' ? 'mixed' : it.checked}
              aria-haspopup={it.items?.length ? 'menu' : undefined}
              disabled={!!it.disabled} title={it.disabled || undefined}
              style:padding-left={it.indent ? `${8 + it.indent * 14}px` : undefined}
              onpointerenter={(e) => hover(i, e.currentTarget)} onclick={(e) => activate(i, e.currentTarget)}>
        <span class="ic">
          {#if it.checked !== undefined}
            <span class="box" class:on={it.checked !== false}>{#if it.checked === 'mixed'}<Minus size={11} strokeWidth={3} />{:else if it.checked}<Check size={11} strokeWidth={3} />{/if}</span>
          {:else if it.current}<Check size={14} />
          {:else if it.icon}<it.icon size={14} />{/if}
        </span>
        <span class="lb">{it.label}</span>
        {#if it.hint}<span class="hint">{it.hint}</span>{/if}
        {#if it.items?.length}<span class="more"><ChevronRight size={14} /></span>{/if}
      </button>
    {/if}
  {/each}
  {#if open}
    {@const parent = items[open.i]}
    {#if parent.kind !== 'sep' && parent.kind !== 'label' && parent.items}
      <Self items={parent.items} anchor={open.rect} depth={depth + 1} {onclose} onback={closeSub} focusFirst={open.focus} />
    {/if}
  {/if}
</div>

<style>
  .ctx-menu { position: fixed; min-width: 196px; max-width: 320px; max-height: min(460px, calc(100vh - 16px)); overflow-y: auto; padding: 4px; background: var(--bg-2); border: 1px solid var(--line-strong); border-radius: 8px; outline: none; visibility: hidden; user-select: none; }
  .ctx-menu.ready { visibility: visible; animation: menu-in 90ms ease-out; }
  /* 只动透明度：transform 会让 fixed 定位的子菜单改以父菜单为参照 */
  @keyframes menu-in { from { opacity: 0; } to { opacity: 1; } }
  .mi { display: flex; align-items: center; gap: 8px; width: 100%; height: 30px; padding: 0 8px; border-radius: 5px; color: var(--fg); font-size: 13px; text-align: left; white-space: nowrap; outline: none; }
  .mi:hover:not(:disabled), .mi:focus-visible, .mi.open { background: var(--bg-3); }
  .mi:disabled { color: var(--fg-4); cursor: default; }
  .mi.danger { color: var(--danger); }
  .mi.danger .ic { color: var(--danger); }
  .ic { display: grid; place-items: center; width: 16px; flex: none; color: var(--fg-2); }
  .lb { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .hint { flex: none; font-size: 12px; color: var(--fg-4); }
  .more { display: grid; place-items: center; flex: none; color: var(--fg-3); }
  .box { display: grid; place-items: center; width: 14px; height: 14px; border: 1px solid var(--fg-3); border-radius: 3px; color: var(--bg); }
  .box.on { background: var(--fg); border-color: var(--fg); }
  .sep { height: 1px; margin: 4px 6px; background: var(--line-strong); }
  .label { padding: 6px 8px 4px; font-size: 12px; color: var(--fg-3); white-space: nowrap; }
</style>
