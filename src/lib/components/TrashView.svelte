<script lang="ts">
  import Trash from '@lucide/svelte/icons/trash';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import X from '@lucide/svelte/icons/x';
  import { app, mib } from '../stores/app.svelte';
  import type { TrashEntry } from '../types';
  import ModThumb from './ModThumb.svelte';
  import { trashThumb } from '../stores/thumbs.svelte';

  let selected = $state<string[]>([]);
  const list = $derived(app.trash);
  // 还原、永久删除后，选择里去掉已经不在回收站的项
  $effect(() => {
    const alive = new Set(list.map((t) => t.trashId));
    if (selected.some((id) => !alive.has(id))) selected = selected.filter((id) => alive.has(id));
  });
  const allChecked = $derived(list.length > 0 && list.every((t) => selected.includes(t.trashId)));
  const picked = $derived(list.filter((t) => selected.includes(t.trashId)));
  const blocked=(rows:TrashEntry[])=>app.busy?`正在${app.busy}`:app.game.running && rows.some(t=>!t.favorite)?'游戏运行中，退出后再操作库里的 Mod':'';
  const block=$derived(blocked(picked));
  // 中断的条目：moving / restoring 只能还原，purging 只能继续永久删除
  const canRestore = (t: TrashEntry) => t.state !== 'purging';
  const canPurge = (t: TrashEntry) => t.state === 'trashed' || t.state === 'purging';

  function toggle(id: string) { selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]; }
  const where = (t: TrashEntry) => t.favorite?'收藏夹':(app.categories.some((c) => c.id === t.categoryId && !c.builtin) ? app.categoryLabel(t.categoryId) : '最外层');
  const profiles = (t: TrashEntry) => t.favorite?t.favorite.collections.join('、'):t.profileIds.map((id) => app.profile(id)?.name).filter(Boolean).join('、');
  function when(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return '—';
    const p = (n: number) => String(n).padStart(2, '0');
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return `${sameYear ? '' : `${d.getFullYear()}-`}${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const stateTag = (t: TrashEntry) => (t.state === 'moving' || t.state === 'restoring' ? '待还原' : t.state === 'purging' ? '待完成删除' : '');
  function onKey(e:KeyboardEvent){
    if(e.key!=='Delete'||e.repeat||e.defaultPrevented||e.ctrlKey||e.altKey||e.shiftKey||e.metaKey||app.confirmation||app.busy)return;
    const el=e.target instanceof HTMLElement?e.target:null;
    if(!el||(!el.closest('.trash')&&el!==document.body))return;
    const focused=el.closest<HTMLElement>('[data-trash-id]')?.dataset.trashId;
    const rows=focused&&!selected.includes(focused)?list.filter(t=>t.trashId===focused):picked;
    const eligible=rows.filter(canPurge);
    if(eligible.length&&!blocked(eligible)){e.preventDefault();void app.purgeTrash(eligible.map(t=>t.trashId));}
  }
</script>

<svelte:window onkeydown={onKey}/>
<div class="trash">
  {#if selected.length}
    <div class="bar">
      <span class="picked">已选 <b class="mono">{selected.length}</b> 项</span>
      <button class="btn primary" disabled={!!block || !picked.some(canRestore)} title={block || undefined}
              onclick={() => app.restoreTrash(picked.filter(canRestore).map((t) => t.trashId))}><Undo2 size={14} />还原</button>
      <button class="btn danger" disabled={!!block || !picked.some(canPurge)} title={block || undefined}
              onclick={() => app.purgeTrash(picked.filter(canPurge).map((t) => t.trashId))}><Trash size={14} />永久删除</button>
      <span class="grow"></span>
      {#if !allChecked}<button class="btn ghost" onclick={() => (selected = list.map((t) => t.trashId))}>全选 {list.length}</button>{/if}
      <button class="btn ghost" onclick={() => (selected = [])}><X size={14} />取消选择</button>
    </div>
  {:else if list.length}
    <div class="bar">
      <p class="note"><Undo2 size={15}/>{list.some(t=>t.favorite)&&list.some(t=>!t.favorite)
        ? '收藏回到收藏夹和仍在的原合集，库里的 Mod 回到原分类和方案。'
        : list.some(t=>t.favorite)?'还原到收藏夹，也会回到仍在的原合集。':'还原到原分类，并恢复方案里的勾选。'}</p>
    </div>
  {/if}

  <div class="content">
    {#if !list.length}
      <div class="empty">
        <span class="empty-icon"><Trash size={28} strokeWidth={1.5} /></span>
        <p>回收站是空的</p>
        <span>移除的 Mod 和收藏会先放在这里，可以还原，也可以永久删除</span>
      </div>
    {:else}
      <div class="row head">
        <input type="checkbox" checked={allChecked} onchange={() => (selected = allChecked ? [] : list.map((t) => t.trashId))} aria-label="全选" />
        <span></span><span>名称</span><span>还原位置</span><span>移入时间</span><span></span>
      </div>
      {#each list as t (t.trashId)}
        {@const tag = stateTag(t)}
        {@const rowBlock = blocked([t])}
        <div class="row" data-trash-id={t.trashId} class:picked={selected.includes(t.trashId)}>
          <input type="checkbox" checked={selected.includes(t.trashId)} onchange={() => toggle(t.trashId)} aria-label={`选择 ${t.title}`} />
          <div class="mini" aria-hidden="true"><ModThumb mod={trashThumb(t)} /></div>
          <div class="nm cell">
            <span class="t"><strong title={t.title}>{t.title}</strong>{#if t.favorite?.recordOnly}<span class="tag" title="原文件已缺失，还原后可重新定位">仅记录</span>{/if}{#if tag}<span class="tag">{tag}</span>{/if}</span>
            <span class="mono f" title={t.files.map((f) => f.file).join('\n')}>{t.file}{t.files.length > 1 ? `  +${t.files.length - 1}` : ''}</span>
          </div>
          <div class="cell origin"><span title={where(t)}>{where(t)}</span>{#if profiles(t)}<small title={profiles(t)}>{profiles(t)}</small>{/if}</div>
          <div class="cell mono timestamp"><span>{when(t.deletedAt)}</span>{#if !t.favorite?.recordOnly}<small>{mib(t.sizeBytes)}</small>{/if}</div>
          <span class="ops">
            {#if canRestore(t)}<button class="btn sm ghost" disabled={!!rowBlock} title={rowBlock || (t.favorite?'还原到收藏夹':'放回原位置')} onclick={() => app.restoreTrash([t.trashId])}><Undo2 size={13} />还原</button>{/if}
            {#if canPurge(t)}<button class="icon-btn del" disabled={!!rowBlock} title={rowBlock || '永久删除'} aria-label={`永久删除 ${t.title}`} onclick={() => app.purgeTrash([t.trashId])}><Trash size={13} /></button>{/if}
          </span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .trash { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 44px; margin-inline: 22px; padding-bottom: 10px; }
  .bar .btn { height: 31px; flex: none; }
  .picked { color: var(--fg-2); margin-right: 3px; white-space: nowrap; }
  .picked b { color: var(--md-primary); }
  .grow { flex: 1; }
  .btn.danger { color: var(--danger); }
  .btn.danger:hover { border-color: var(--danger); }
  .note { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--fg-2); }
  .note :global(svg) { flex: none; color: var(--md-primary); }
  .content { flex: 1; min-height: 0; overflow: auto; padding: 0 22px 16px; }
  input[type='checkbox'] { width: 15px; height: 15px; padding: 0; margin: 0; accent-color: var(--md-primary); cursor: pointer; }
  .row { display: grid; grid-template-columns: 15px 40px minmax(0, 1.9fr) minmax(0, 1fr) minmax(82px, 105px) 94px; gap: 11px; align-items: center; min-height: 64px; padding: 8px 10px; border-bottom: 1px solid var(--line-soft); }
  .mini { position: relative; overflow: hidden; width: 40px; height: 40px; border-radius: 8px; }
  .row:not(.head):hover, .row:not(.head):focus-within { background: var(--bg-1); }
  .row.picked { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .row.picked:hover, .row.picked:focus-within { background: var(--md-secondary-container); }
  .row.head { min-height: 32px; position: sticky; top: 0; z-index: 1; border-radius: 8px 8px 0 0; background: var(--md-surface-container); color: var(--fg-2); font-weight: 600; }
  .cell { display: grid; min-width: 0; gap: 2px; }
  .t { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .t strong, .f, .origin > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t strong { font-size: 14px; }
  .tag { flex: none; padding: 1px 5px; border-radius: 4px; font-size: 11px; color: var(--md-on-tertiary-container); background: var(--md-tertiary-container); }
  .f, small { font-size: 12px; color: var(--fg-2); }
  .timestamp { font-size: 12px; }
  .ops { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
  .ops .btn { height: 29px; border-color: transparent; background: var(--md-surface-container-high); }
  .ops .btn:hover:not(:disabled) { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .del:hover { color: var(--danger); }
  .empty { display: grid; justify-items: center; gap: 9px; padding: 64px 10px; color: var(--fg-2); text-align: center; }
  .empty-icon { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 15px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .empty p { margin: 2px 0 0; font-size: 16px; font-weight: 600; color: var(--fg); }
  @container modmain (max-width: 640px) {
    .bar { margin-inline: 13px; }
    .content { padding-inline: 13px; }
    .row { grid-template-columns: 15px 34px minmax(0, 1.5fr) minmax(0, 1fr) 84px; gap: 7px; padding-inline: 6px; }
    .row .timestamp, .row.head > :nth-child(5) { display: none; }
    .mini { width: 34px; height: 34px; }
    .ops .btn { padding-inline: 6px; }
  }
</style>
