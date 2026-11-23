<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import Copy from '@lucide/svelte/icons/copy';
  import FolderInput from '@lucide/svelte/icons/folder-input';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ModThumb from './ModThumb.svelte';
  import { trashThumb } from '../stores/thumbs.svelte';
  import { app, mib } from '../stores/app.svelte';

  let dialog = $state<HTMLDialogElement>();
  $effect(() => { if (app.confirmation && dialog && !dialog.open) dialog.showModal(); });

  const c = $derived(app.confirmation);
  const x = $derived(c?.extra);
  const initial = (s: string) => (s.match(/[\p{L}\p{N}]/u)?.[0] ?? 'V').toUpperCase();
  async function copy(text: string, ok: string) {
    try { await navigator.clipboard.writeText(text); app.toast(ok); } catch { app.toast('复制失败'); }
  }
</script>

{#if c}
  <dialog bind:this={dialog} class:wide={!!x?.items || x?.layout === 'import'} class:focused={!!x?.layout} class:destructive={x?.layout === 'destructive'} oncancel={(e) => { e.preventDefault(); app.answerConfirmation(false); }} aria-labelledby="confirm-title">
    <header>
      {#if x?.layout}<span class="symbol" aria-hidden="true">{#if x.layout === 'import'}<FolderInput size={21}/>{:else}<TriangleAlert size={21}/>{/if}</span>{/if}
      <h2 id="confirm-title">{c.title}</h2>
      <button class="icon-btn" type="button" aria-label="取消" onclick={() => app.answerConfirmation(false)}><X size={16} /></button>
    </header>

    <div class="body">
      {#if c.message}<p class="msg">{c.message}</p>{/if}

      {#if x?.items?.length}
        <ul class="items" class:single={x.items.length === 1}>
          {#each x.items as it, i (i)}
            {@const mod = it.modId ? app.mod(it.modId) : undefined}
            {@const entry = it.trashId && app.trash.find(t => t.trashId === it.trashId)}
            <li>
              <span class="pv">{#if entry}<ModThumb mod={trashThumb(entry)} />{:else if mod}<ModThumb {mod} />{:else}<span class="ini">{initial(it.title)}</span>{/if}</span>
              <span class="info">
                <span class="t" title={it.title}>{it.title}</span>
                {#if x.items.length === 1}
                  {#each it.files as f (f.file)}
                    <span class="file"><span class="mono fp" title={f.file}>{f.file}</span><span class="mono fs">{mib(f.size)}</span></span>
                  {/each}
                {:else}
                  <span class="mono m" title={it.files.map((f) => f.file).join('\n')}>{it.files[0]?.file ?? ''}{it.files.length > 1 ? `  +${it.files.length - 1}` : ''}</span>
                {/if}
              </span>
              {#if x.items.length > 1}<span class="mono sz">{mib(it.sizeBytes)}</span>{/if}
            </li>
          {/each}
          {#if x.more}<li class="more">还有 {x.more} 个</li>{/if}
        </ul>
      {/if}

      {#if x?.facts?.length}
        <dl class="facts">
          {#each x.facts as f (f.label)}
            <dt>{f.label}</dt><dd class:danger={f.danger}>{f.value}</dd>
          {/each}
        </dl>
      {/if}

      {#each x?.lists ?? [] as l (l.title)}
        <div class="list">
          <div class="lt">{l.title}<span class="mono">{l.rows.length}</span></div>
          <div class="rows">
            {#each l.rows as r, i (i)}<div class="lr"><span class="lk" title={r.k}>{r.k}</span><span class="lv">{r.v}</span></div>{/each}
          </div>
        </div>
      {/each}

      {#if x?.warn}
        <div class="warn" role="note">
          <span class="wi"><TriangleAlert size={15} /></span>
          <div class="wb">
            <strong>{x.warn.title}</strong>
            <p>{x.warn.text}</p>
            {#if x.warn.links?.length}
              <div class="links">
                {#each x.warn.links.slice(0, 5) as url (url)}
                  <div class="link">
                    <span class="mono" title={url}>{url.replace(/^https?:\/\//, '')}</span>
                    <button class="icon-btn" type="button" title="复制链接" aria-label="复制链接" onclick={() => copy(url, '已复制创意工坊链接')}><Copy size={13} /></button>
                  </div>
                {/each}
              </div>
              {#if x.warn.links.length > 1}
                <button class="btn sm ghost" type="button" onclick={() => copy(x.warn!.links!.join('\n'), `已复制 ${x.warn!.links!.length} 个链接`)}><Copy size={13} />复制全部 {x.warn.links.length} 个链接</button>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <footer>
      <button class="btn" class:ghost={!!x?.layout} type="button" onclick={() => app.answerConfirmation(false)}>取消</button>
      <button class="btn primary" type="button" onclick={() => app.answerConfirmation(true)}>{c.ok ?? '确认执行'}</button>
    </footer>
  </dialog>
{/if}

<style>
  dialog { width: min(480px, 92vw); max-height: min(720px, 86vh); padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-1); color: var(--fg); display: flex; flex-direction: column; overflow: hidden; }
  dialog.wide { width: min(560px, 92vw); }
  dialog:not([open]) { display: none; }
  dialog::backdrop { background: #000c; }
  header { display: flex; align-items: center; gap: 12px; padding: 16px 14px 4px 20px; }
  h2 { flex: 1; min-width: 0; margin: 0; font-size: 16px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 20px 4px; display: flex; flex-direction: column; gap: 14px; }
  .msg { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.65; color: var(--fg-2); user-select: text; }

  /* 条目：单个时列出每个文件，多个时一行一个 */
  .items { list-style: none; margin: 0; padding: 4px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); max-height: 260px; overflow-y: auto; }
  .items li { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 8px; border-radius: var(--r-sm); }
  .items.single li { align-items: flex-start; padding: 8px; }
  .pv { position: relative; display: grid; place-items: center; width: 36px; height: 36px; flex: none; border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-1); }
  .single .pv { width: 52px; height: 52px; }
  .ini { font-family: var(--font-display); font-size: 17px; color: var(--fg-3); }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .t { font-size: 13px; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .single .t { font-size: 14px; margin-bottom: 4px; }
  .m { font-size: 12px; color: var(--fg-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file { display: flex; align-items: baseline; gap: 12px; font-size: 12px; line-height: 1.7; }
  .fp { flex: 1; min-width: 0; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fs, .sz { flex: none; font-size: 12px; color: var(--fg-3); }
  .more { justify-content: center; min-height: 32px !important; font-size: 12px; color: var(--fg-3); }

  .facts { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 8px 14px; margin: 0; font-size: 13px; }
  .facts dt { color: var(--fg-3); }
  .facts dd { margin: 0; color: var(--fg); overflow-wrap: anywhere; }
  .facts dd.danger { color: var(--danger); }

  /* 提醒：实色底 + 1px 描边，不用半透明，不加新颜色 */
  .warn { display: flex; gap: 10px; padding: 12px 14px; border: 1px solid var(--line-strong); border-left: 2px solid var(--fg-2); border-radius: var(--r); background: var(--bg-2); }
  .wi { flex: none; display: grid; place-items: center; height: 20px; color: var(--fg); }
  .wb { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  .wb strong { font-size: 13px; font-weight: 500; color: var(--fg); }
  .wb p { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-2); }
  .links { align-self: stretch; display: flex; flex-direction: column; margin-top: 4px; }
  .link { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .link .mono { flex: 1; min-width: 0; font-size: 12px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
  .link .icon-btn { width: 24px; height: 24px; flex: none; }
  .wb .btn { margin: 2px 0 0 -8px; }

  /* 两列清单：文件变化、模块调整 */
  .list { border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); overflow: hidden; }
  .lt { display: flex; justify-content: space-between; padding: 8px 12px; font-size: 12px; color: var(--fg-2); border-bottom: 1px solid var(--line); }
  .lt .mono { color: var(--fg-3); }
  .rows { max-height: 200px; overflow-y: auto; padding: 4px 0; }
  .lr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; padding: 5px 12px; font-size: 12px; line-height: 1.5; }
  .lk { min-width: 0; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lv { color: var(--fg-3); text-align: right; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px; margin-top: 12px; border-top: 1px solid var(--line); }
  footer .btn { height: 32px; padding: 0 14px; }

  .focused { border-radius: 20px; }
  .focused::backdrop { background: color-mix(in srgb, var(--md-scrim) 50%, transparent); }
  .focused header { padding: 18px 20px 16px; border-bottom: 1px solid var(--line); }
  .focused h2 { white-space: normal; overflow-wrap: anywhere; font-size: 21px; font-weight: 650; line-height: 1.24; }
  .symbol { width: 42px; height: 42px; display: grid; place-items: center; flex: none; border-radius: 13px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .destructive .symbol { background: var(--md-error-container); color: var(--md-on-error-container); }
  .focused .body { padding: 16px 20px; }
  .focused .facts { grid-template-columns: minmax(58px, max-content) minmax(0, 1fr); padding: 12px; border-radius: 10px; background: var(--md-surface-container-low); }
  .focused .msg { font-size: 14px; }
  .focused footer { padding-block: 12px; margin: 0; background: var(--md-surface-container-low); }
  .focused footer .btn { height: 35px; }
  .destructive footer .primary { color: var(--md-on-error); background: var(--md-error); border-color: var(--md-error); }
  .destructive footer .primary:hover { filter: brightness(1.07); }
</style>
