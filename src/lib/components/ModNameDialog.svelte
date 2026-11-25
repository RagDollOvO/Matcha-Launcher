<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { api } from '../api';
  import { app } from '../stores/app.svelte';
  import type { Mod } from '../types';
  import ModThumb from './ModThumb.svelte';
  import WorkDialog from './WorkDialog.svelte';

  let { mod, gameRoot, onclose }: { mod: Mod; gameRoot: string; onclose: () => void } = $props();
  const formId = $props.id();
  const original = $derived(mod.sourceTitle ?? mod.title);
  let input: HTMLInputElement;
  let draft = $state(untrack(() => mod.title));
  let error = $state('');
  const name = $derived(draft.trim());
  const restoring = $derived(draft === original || name === original);
  const changed = $derived(restoring ? mod.title !== original : !!name && name !== mod.title);
  const locked = $derived(!!app.busy);

  onMount(() => input.select());
  function reset() {
    draft = original;
    error = '';
    input.focus();
    input.select();
  }
  async function save() {
    if (locked || !changed) return;
    error = '';
    const saved = await app.perform('保存显示名', () => api.renameMod(gameRoot, mod, restoring ? null : name),
      restoring ? '已恢复原名' : '显示名已保存');
    if (saved) onclose();
    else {
      error = app.error || '名称未保存，请重试。';
      void app.refresh();
    }
  }
</script>

<WorkDialog title="修改显示名" lead="仅在 Matcha 中显示" {locked} {onclose}>
  {#snippet symbol()}<span class="cover"><ModThumb {mod} /></span>{/snippet}
  <form id={formId} onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <!-- svelte-ignore a11y_autofocus (打开后可直接输入新名称) -->
    <label class="field">显示名
      <input bind:this={input} bind:value={draft} maxlength="512" autocomplete="off" spellcheck="false"
             placeholder="输入显示名" autofocus readonly={locked} />
    </label>
    <div class="source">
      <div class="original"><span>原名</span><bdi>{original}</bdi></div>
      <button class="reset" type="button" disabled={locked || restoring} onclick={reset}><RotateCcw size={14} />恢复原名</button>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
  {#snippet footer()}
    <button class="btn ghost" type="button" disabled={locked} onclick={onclose}>取消</button>
    <button class="btn primary" type="submit" form={formId} disabled={locked || !changed}>{locked ? '保存中…' : '保存'}</button>
  {/snippet}
</WorkDialog>

<style>
  .cover { position: relative; display: block; width: 100%; height: 100%; border-radius: inherit; overflow: hidden; }
  form { display: grid; gap: 12px; }
  .field { display: grid; gap: 7px; font-weight: 600; }
  input { width: 100%; height: 44px; padding-inline: 13px; font-size: 16px; font-weight: 500; background: var(--md-surface-container-lowest); }
  input:focus { border-color: var(--md-primary); outline: 1px solid var(--md-primary); outline-offset: -2px; }
  .source, .original, .reset { display: flex; align-items: baseline; }
  .source { align-items: center; gap: 14px; justify-content: space-between; }
  .original { min-width: 0; gap: 8px; color: var(--fg-2); }
  .original span { flex: none; color: var(--fg-3); font-size: 12px; }
  bdi { overflow-wrap: anywhere; user-select: text; }
  .reset { flex: none; align-items: center; gap: 5px; min-height: 30px; padding: 0 6px; border-radius: var(--r-sm); color: var(--md-primary); }
  .reset:hover:not(:disabled) { background: var(--hover); }
  .reset:disabled { color: var(--fg-4); opacity: .65; cursor: default; }
  .btn.primary { min-width: 72px; justify-content: center; }
  .error { margin: 0; color: var(--danger); overflow-wrap: anywhere; }
</style>
