<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import X from '@lucide/svelte/icons/x';

  let { title, lead, wide = false, locked = false, onclose, symbol, children, footer }: {
    title: string; lead?: string; wide?: boolean; locked?: boolean; onclose: () => void;
    symbol: Snippet; children: Snippet; footer: Snippet;
  } = $props();
  const id = $props.id();
  let dialog: HTMLDialogElement;
  onMount(() => dialog.showModal());
</script>

<dialog bind:this={dialog} class:wide aria-labelledby={id} oncancel={(e) => { e.preventDefault(); if (!locked) onclose(); }}>
  <header>
    <span class="symbol" aria-hidden="true">{@render symbol()}</span>
    <div class="heading"><h2 id={id}>{title}</h2>{#if lead}<p>{lead}</p>{/if}</div>
    <button class="icon-btn" aria-label="关闭" type="button" disabled={locked} onclick={onclose}><X size={17} /></button>
  </header>
  <div class="body">{@render children()}</div>
  <footer>{@render footer()}</footer>
</dialog>

<style>
  dialog { width: min(520px, 92vw); max-height: min(780px, 90vh); display: flex; flex-direction: column; margin: auto; padding: 0; border: 1px solid var(--line-strong); border-radius: 20px; background: var(--md-surface-container); color: var(--fg); overflow: hidden; }
  dialog:not([open]) { display: none; }
  dialog.wide { width: min(820px, 94vw); }
  dialog::backdrop { background: color-mix(in srgb, var(--md-scrim) 50%, transparent); }
  header, footer { display: flex; align-items: center; gap: 12px; flex: none; padding-inline: 22px; }
  header { padding-block: 18px 17px; border-bottom: 1px solid var(--line); }
  .symbol { width: 42px; height: 42px; display: grid; place-items: center; flex: none; border-radius: 13px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .heading { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 22px; font-weight: 650; line-height: 1.22; overflow-wrap: anywhere; }
  p { margin: 5px 0 0; color: var(--fg-2); font-size: 13px; line-height: 1.45; }
  header button { align-self: start; flex: none; }
  .body { min-height: 0; overflow: auto; padding: 18px 22px; }
  footer { justify-content: flex-end; flex-wrap: wrap; padding-block: 12px; border-top: 1px solid var(--line); background: var(--md-surface-container-low); }
  footer :global(.btn) { height: 35px; }
  header button:disabled, footer :global(.btn:disabled) { opacity: .47; cursor: default; pointer-events: none; }
  @media (max-width: 520px) {
    header, footer, .body { padding-inline: 15px; }
  }
</style>
