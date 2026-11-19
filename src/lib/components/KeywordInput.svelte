<script lang="ts">
  // 关键词标签输入：回车 / 逗号添加，退格删最后一个，粘贴一段按逗号换行拆开。/…/ 包起来按正则。
  import X from '@lucide/svelte/icons/x';
  import { badRegex, splitKeywords } from '../bilibili-filter';

  let { words = $bindable(), label, placeholder = '添加关键词，回车确认' }: { words: string[]; label: string; placeholder?: string } = $props();
  let draft = $state('');
  let input = $state<HTMLInputElement>();

  function add(src: string) {
    const have = new Set(words.map((w) => w.toLowerCase()));
    const next = splitKeywords(src).filter((w) => { const k = w.toLowerCase(); if (have.has(k)) return false; have.add(k); return true; });
    if (next.length) words = [...words, ...next];
    draft = '';
  }
  const remove = (w: string) => { words = words.filter((x) => x !== w); input?.focus(); };
  function key(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); add(draft); }
    else if (e.key === 'Backspace' && !draft && words.length) words = words.slice(0, -1);
  }
  function paste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/[,，、\n]/.test(text)) return;
    e.preventDefault();
    add(draft + text);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="kw" onclick={() => input?.focus()}>
  {#each words as w (w)}
    {@const bad = badRegex(w)}
    <span class="chip" class:re={w.startsWith('/') && !bad} class:bad title={bad ? '正则写错了，这一条不生效' : w}>
      <span class="w">{w}</span>
      <button type="button" aria-label={`删除 ${w}`} onclick={(e) => { e.stopPropagation(); remove(w); }}><X size={11} /></button>
    </span>
  {/each}
  <input bind:this={input} bind:value={draft} aria-label={label} placeholder={words.length ? '' : placeholder} maxlength="60"
    onkeydown={key} onpaste={paste} onblur={() => { if (draft.trim()) add(draft); }} />
</div>

<style>
  .kw { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 36px; padding: 5px 6px; border: 1px solid var(--line-strong); border-radius: var(--r); background: var(--bg); cursor: text; transition: border-color var(--dur); }
  .kw:focus-within { border-color: var(--fg-3); }
  .chip { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; height: 24px; padding: 0 2px 0 8px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--bg-2); font-size: 12px; color: var(--fg); animation: pop 160ms var(--ease-out); }
  .chip.re .w { font-family: var(--font-mono); }
  .chip.bad { border-color: var(--danger); color: var(--danger); }
  .w { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip button { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 3px; color: var(--fg-3); transition: background var(--dur), color var(--dur); }
  .chip button:hover { background: var(--bg-3); color: var(--fg); }
  input { flex: 1; min-width: 120px; height: 24px; padding: 0 4px; border: 0; background: transparent; font-size: 12px; outline: none; }
  @keyframes pop { from { transform: scale(.85); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .chip { animation: none; } }
</style>
