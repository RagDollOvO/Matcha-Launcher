<script lang="ts">
  // 全局提示（M3 snackbar）：反色底，从底部弹性滑入、下沉淡出；成功 / 错误带图标，下载完成带 Mod 封面。
  // 鼠标停在上面时暂停倒计时（底部细条一起停）。
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { backOut, cubicOut } from 'svelte/easing';
  import Check from '@lucide/svelte/icons/check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import ModThumb from './ModThumb.svelte';
  import { app } from '../stores/app.svelte';
  import { reduceMotion } from '../motion';

  const still = reduceMotion();
</script>

<div class="wrap" aria-live="polite">
  {#each app.toasts as t (t.id)}
    {@const mod = t.modId ? app.mod(t.modId) : undefined}
    <div class="toast {t.kind}" class:rich={!!t.title} role={t.kind === 'error' ? 'alert' : 'status'}
         animate:flip={{ duration: still ? 0 : 260, easing: cubicOut }}
         in:fly={{ y: still ? 0 : 28, duration: still ? 0 : 460, easing: backOut }}
         out:fly={{ y: still ? 0 : 12, duration: still ? 0 : 180, easing: cubicOut }}
         onmouseenter={() => app.holdToast(t.id)} onmouseleave={() => app.releaseToast(t.id)}>
      {#if mod}
        <span class="thumb"><ModThumb {mod} />{#if t.kind === 'ok'}<i class="badge"><Check size={9} strokeWidth={3.5} /></i>{/if}</span>
      {:else if t.kind === 'ok'}
        <span class="ic ok"><Check size={13} strokeWidth={3} /></span>
      {:else if t.kind === 'error'}
        <span class="ic err"><TriangleAlert size={13} strokeWidth={2.4} /></span>
      {/if}
      <span class="tx">
        {#if t.title}<b>{t.title}</b>{/if}
        <span class="msg">{t.text}</span>
      </span>
      {#each t.actions as a (a.label)}
        <button type="button" class="act" onclick={() => { app.dismissToast(t.id); a.run(); }}>{a.label}</button>
      {/each}
      {#if t.actions.length || t.title}
        <button type="button" class="x" aria-label="关闭提示" data-sfx="close" onclick={() => app.dismissToast(t.id)}><X size={13} /></button>
        <i class="timer" style:animation-duration="{t.ms}ms" aria-hidden="true"></i>
      {/if}
    </div>
  {/each}
</div>

<style>
  .wrap { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 50; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }

  .toast {
    position: relative; display: flex; align-items: center; gap: 10px; min-height: 40px; max-width: min(540px, calc(100vw - 32px));
    padding: 6px 8px 6px 14px; overflow: hidden; border-radius: 14px; pointer-events: auto;
    background: var(--md-inverse-surface); color: var(--md-inverse-on-surface); font-size: 13px;
    box-shadow: 0 16px 36px -16px rgb(0 0 0 / .55), 0 2px 8px -2px rgb(0 0 0 / .25);
  }
  .toast:has(.ic, .thumb) { padding-left: 8px; }
  .toast:not(:has(.act, .x)) { padding-right: 14px; }
  .toast.rich { min-height: 52px; padding-top: 8px; padding-bottom: 8px; }

  /* 图标：成功用反色主色圆点，错误用错误容器色，亮暗主题下都清楚 */
  .ic { display: grid; place-items: center; width: 24px; height: 24px; flex: none; border-radius: 50%; }
  .ic.ok { background: var(--md-inverse-primary); color: var(--md-inverse-surface); }
  .ic.err { background: var(--md-error-container); color: var(--md-on-error-container); }

  /* 下载完成的封面：小勾晚一拍弹出来 */
  .thumb { position: relative; width: 40px; height: 40px; flex: none; border-radius: 10px; overflow: hidden; background: color-mix(in srgb, var(--md-inverse-on-surface) 12%, transparent); }
  .thumb :global(.thumb) { border-radius: 10px; }
  .badge { position: absolute; right: 2px; bottom: 2px; display: grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: var(--md-inverse-primary); color: var(--md-inverse-surface); box-shadow: 0 0 0 2px var(--md-inverse-surface); animation: pop 460ms 220ms var(--ease-out) both; }
  @keyframes pop { 0% { transform: scale(0); } 60% { transform: scale(1.25); } 100% { transform: scale(1); } }

  .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .tx b { font-size: 12px; font-weight: 600; color: var(--md-inverse-primary); }
  .msg { overflow-wrap: anywhere; line-height: 1.45; }

  .act { flex: none; height: 30px; padding: 0 10px; border-radius: 9px; color: var(--md-inverse-primary); font-size: 13px; font-weight: 600; white-space: nowrap; transition: background var(--dur); }
  .act:hover { background: color-mix(in srgb, var(--md-inverse-primary) 16%, transparent); }
  .x { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border-radius: 8px; color: var(--md-inverse-on-surface); opacity: .55; transition: opacity var(--dur), background var(--dur); }
  .x:hover { opacity: 1; background: color-mix(in srgb, var(--md-inverse-on-surface) 12%, transparent); }

  /* 倒计时细条：和自动关闭同步，悬停时一起停 */
  .timer { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--md-inverse-primary); opacity: .55; transform-origin: left; animation: drain linear forwards; }
  .toast:hover .timer { animation-play-state: paused; }
  @keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }

  @media (prefers-reduced-motion: reduce) { .badge { animation: none; } .timer { display: none; } }
</style>
