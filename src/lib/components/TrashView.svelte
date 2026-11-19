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
  const block = $derived(app.game.running ? '游戏运行中，退出后再操作' : app.busy ? `正在${app.busy}` : '');
  const picked = $derived(list.filter((t) => selected.includes(t.trashId)));
  // 中断的条目：moving / restoring 只能还原，purging 只能继续永久删除
  const canRestore = (t: TrashEntry) => t.state !== 'purging';
  const canPurge = (t: TrashEntry) => t.state === 'trashed' || t.state === 'purging';

  function toggle(id: string) { selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]; }
  const where = (t: TrashEntry) => (app.categories.some((c) => c.id === t.categoryId && !c.builtin) ? app.categoryLabel(t.categoryId) : '最外层');
  const profiles = (t: TrashEntry) => t.profileIds.map((id) => app.profile(id)?.name).filter(Boolean).join('、');
  function when(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return '—';
    const p = (n: number) => String(n).padStart(2, '0');
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return `${sameYear ? '' : `${d.getFullYear()}-`}${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const stateTag = (t: TrashEntry) => (t.state === 'moving' || t.state === 'restoring' ? '待还原' : t.state === 'purging' ? '待完成删除' : '');
</script>

<div class="trash">
  {#if selected.length}
    <div class="bar">
      <span class="picked">已选 <b class="mono">{selected.length}</b> 项</span>
      <button class="btn" disabled={!!block || !picked.some(canRestore)} title={block || undefined}
              onclick={() => app.restoreTrash(picked.filter(canRestore).map((t) => t.trashId))}><Undo2 size={14} />还原</button>
      <button class="btn danger" disabled={!!block || !picked.some(canPurge)} title={block || undefined}
              onclick={() => app.purgeTrash(picked.filter(canPurge).map((t) => t.trashId))}><Trash size={14} />永久删除</button>
      <span class="grow"></span>
      {#if !allChecked}<button class="btn ghost" onclick={() => (selected = list.map((t) => t.trashId))}>全选 {list.length}</button>{/if}
      <button class="btn ghost" onclick={() => (selected = [])}><X size={14} />取消选择</button>
    </div>
  {:else if list.length}
    <div class="bar">
      <p class="note">还原会放回原分类并恢复方案里的勾选。使用该方案启动游戏时生效。</p>
    </div>
  {/if}

  <div class="content">
    {#if !list.length}
      <div class="empty">
        <Trash size={28} strokeWidth={1.25} />
        <p>回收站是空的</p>
        <span>删除的 Mod 会先放在这里，可以还原，也可以永久删除</span>
      </div>
    {:else}
      <div class="row head">
        <input type="checkbox" checked={allChecked} onchange={() => (selected = allChecked ? [] : list.map((t) => t.trashId))} aria-label="全选" />
        <span></span><span>名称</span><span>原分类</span><span>原方案</span><span class="r">大小</span><span>删除时间</span><span></span>
      </div>
      {#each list as t (t.trashId)}
        {@const tag = stateTag(t)}
        <div class="row" class:picked={selected.includes(t.trashId)}>
          <input type="checkbox" checked={selected.includes(t.trashId)} onchange={() => toggle(t.trashId)} aria-label={`选择 ${t.title}`} />
          <div class="mini" aria-hidden="true"><ModThumb mod={trashThumb(t)} /></div>
          <div class="nm">
            <span class="t">{t.title}{#if tag}<span class="tag">{tag}</span>{/if}</span>
            <span class="mono f" title={t.files.map((f) => f.file).join('\n')}>{t.file}{t.files.length > 1 ? `  +${t.files.length - 1}` : ''}</span>
          </div>
          <span class="c" title={where(t)}>{where(t)}</span>
          <span class="c" title={profiles(t)}>{profiles(t) || '—'}</span>
          <span class="mono r sz">{mib(t.sizeBytes)}</span>
          <span class="mono sz">{when(t.deletedAt)}</span>
          <span class="ops">
            {#if canRestore(t)}<button class="btn sm ghost" disabled={!!block} title={block || '放回原位置'} onclick={() => app.restoreTrash([t.trashId])}><Undo2 size={13} />还原</button>{/if}
            {#if canPurge(t)}<button class="icon-btn del" disabled={!!block} title={block || '永久删除'} aria-label={`永久删除 ${t.title}`} onclick={() => app.purgeTrash([t.trashId])}><Trash size={13} /></button>{/if}
          </span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .trash { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .btn:disabled, .icon-btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .bar { display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 20px 12px; }
  .bar .btn { height: 30px; flex: none; }
  .picked { font-size: 13px; color: var(--fg-2); margin-right: 4px; white-space: nowrap; }
  .picked b { color: var(--fg); font-weight: 500; }
  .grow { flex: 1; }
  .btn.danger { color: var(--danger); }
  .btn.danger:hover { border-color: #4a1d1d; }
  .note { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-3); }
  .content { flex: 1; min-height: 0; overflow-y: auto; border-top: 1px solid var(--line); }
  input[type='checkbox'] { width: 14px; height: 14px; padding: 0; margin: 0; accent-color: var(--fg); cursor: pointer; }
  .row { display: grid; grid-template-columns: 14px 36px minmax(140px, 1fr) minmax(70px, 130px) minmax(70px, 140px) 72px 92px 96px; gap: 12px; align-items: center; min-height: 54px; padding: 8px 20px; border-bottom: 1px solid var(--line-soft); }
  .mini { position: relative; overflow: hidden; width: 36px; height: 36px; border-radius: var(--r-sm); }
  .row:not(.head):hover { background: var(--bg-1); }
  .row.picked { background: var(--bg-2); }
  .row.head { min-height: 0; padding-top: 8px; padding-bottom: 8px; font-size: 12px; color: var(--fg-3); position: sticky; top: 0; background: var(--bg); z-index: 1; }
  .nm { display: flex; flex-direction: column; min-width: 0; }
  .t { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { flex: none; height: 18px; padding: 0 6px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); font-size: 11px; line-height: 16px; color: var(--fg-2); }
  .f { font-size: 12px; color: var(--fg-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .c { font-size: 12px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sz { font-size: 12px; color: var(--fg-3); white-space: nowrap; }
  .r { text-align: right; justify-self: end; }
  .ops { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
  .ops .btn { height: 26px; }
  .del:hover { color: var(--danger); }
  .empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 72px 20px; color: var(--fg-3); text-align: center; }
  .empty p { margin: 0; font-size: 14px; color: var(--fg-2); }
  .empty span { font-size: 13px; }
  @container modmain (max-width: 860px) {
    .bar { padding-left: 14px; padding-right: 14px; }
    .row { grid-template-columns: 14px 36px minmax(120px, 1fr) minmax(70px, 120px) 64px 96px; gap: 10px; padding-left: 14px; padding-right: 14px; }
    .row > :nth-child(5), .row > :nth-child(7) { display: none; }
  }
</style>
