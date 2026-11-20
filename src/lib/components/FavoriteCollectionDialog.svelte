<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Layers from '@lucide/svelte/icons/layers';
  import X from '@lucide/svelte/icons/x';
  import Search from '@lucide/svelte/icons/search';
  import ModThumb from './ModThumb.svelte';
  import { app } from '../stores/app.svelte';
  import type { FavoriteCollection } from '../types';

  let { mode, group, seed = [], onclose, onsaved }: { mode: 'create' | 'add' | 'rename'; group?: FavoriteCollection; seed?: string[]; onclose: () => void; onsaved: (id: string) => void } = $props();
  let dialog: HTMLDialogElement;
  let name = $state(untrack(() => mode === 'rename' ? group?.name ?? '' : ''));
  let chosen = $state<string[]>(untrack(() => [...seed]));
  let query = $state('');
  let error = $state('');
  const naming = $derived(mode !== 'add');
  const list = $derived([...app.favoriteEntries, ...app.mods.filter(m => seed.includes(m.id) && !app.isFavorite(m.id))].filter(m => mode !== 'add' || !group?.modIds.includes(m.id)));
  const visible = $derived(list.filter(m => (m.title + ' ' + m.file).toLowerCase().includes(query.trim().toLowerCase())));
  const selected = $derived(chosen.filter(id => list.some(m => m.id === id)));
  const all = $derived(visible.length > 0 && visible.every(m => chosen.includes(m.id)));
  const duplicate = $derived(naming && app.favoriteCollections.some(c => c.id !== (mode === 'rename' ? group?.id : undefined) && c.name.toLowerCase() === name.trim().toLowerCase()));
  const title = $derived(mode === 'create' ? '新建收藏合集' : mode === 'rename' ? '重命名合集' : '添加成员');
  onMount(() => { dialog.showModal(); });
  function toggle(id: string) { chosen = chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]; }
  async function save() {
    if (app.busy || duplicate || (naming ? !name.trim() : !selected.length)) return;
    error = '';
    const result = await app.editFavoriteCollection(mode === 'create' ? {action: 'create', name: name.trim(), modIds: selected}
      : mode === 'rename' ? {action: 'rename', collectionId: group!.id, name: name.trim()}
      : {action: 'add', collectionId: group!.id, modIds: selected});
    if (result) onsaved(result.id); else error = app.error || '保存未完成，请重试。';
  }
</script>

<dialog bind:this={dialog} aria-labelledby="fc-title" oncancel={(e) => { e.preventDefault(); if (!app.busy) onclose(); }}>
  <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <header><span class="symbol"><Layers size={20} /></span><h2 id="fc-title">{title}</h2><button class="icon-btn" type="button" aria-label="关闭合集窗口" disabled={!!app.busy} onclick={onclose}><X size={16}/></button></header>
    {#if naming}
      <label class="name">合集名称<input maxlength="60" placeholder="例如：MAC10 音效" bind:value={name} /></label>
      {#if duplicate}<p class="err">已有同名合集，换个名字试试。</p>{/if}
    {:else}<p class="dest">加入「{group?.name}」</p>{/if}
    {#if mode !== 'rename' && list.length}
      <div class="bar"><strong>{mode === 'create' ? '选择成员' : '可添加的收藏'}</strong>
        <button type="button" onclick={() => chosen = all ? chosen.filter(id => !visible.some(m => m.id === id)) : [...new Set([...chosen, ...visible.map(m => m.id)])]} disabled={!visible.length}>{all ? '取消全选' : '全选'}</button></div>
      {#if list.length > 6}<label class="find"><Search size={14}/><input placeholder="搜索收藏" bind:value={query} /></label>{/if}
      <div class="choices">
        {#each visible as m (m.id)}
          <label class="choice"><span class="art"><ModThumb mod={m}/></span><span class="title">{m.title}</span><input type="checkbox" checked={chosen.includes(m.id)} onchange={() => toggle(m.id)}/></label>
        {:else}<p class="hint">没有匹配的收藏</p>{/each}
      </div>
    {:else if mode === 'add'}<p class="hint">{app.favoriteIds().length ? '现有收藏都在这个合集中。' : '先给 Mod 点星标，就能在这里添加。'}</p>{/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <footer>{#if mode !== 'rename'}<span>{selected.length ? '已选 ' + selected.length + ' 个 Mod' : mode === 'create' ? '可稍后添加成员' : ''}</span>{/if}
      <button type="button" class="btn ghost" disabled={!!app.busy} onclick={onclose}>取消</button>
      <button class="btn primary" disabled={!!app.busy || duplicate || (naming ? !name.trim() : !selected.length)}>{app.busy ? '保存中…' : mode === 'create' ? '创建合集' : mode === 'rename' ? '保存名称' : '加入合集'}</button>
    </footer>
  </form>
</dialog>

<style>
  dialog { width:min(440px,90vw); max-height:86vh; margin:auto; padding:0; border:0; border-radius:17px; background:var(--bg-1); color:var(--fg); }
  dialog::backdrop { background:rgb(12 9 16 / .42); }
  form { display:flex; flex-direction:column; padding:23px; max-height:84vh; gap:14px; }
  header,.bar,footer,.choice,.find { display:flex; align-items:center; gap:10px; }
  header { margin-bottom:3px; } h2 { flex:1; margin:0; font-size:19px; } .symbol { display:grid; place-items:center; width:35px; height:35px; border-radius:11px; color:var(--md-on-secondary-container); background:var(--md-secondary-container); }
  .name { display:grid; gap:7px; font-size:13px; font-weight:600; } .name input { padding:9px 11px; height:38px; }
  .bar strong { flex:1; font-size:13px; } .bar button { color:var(--md-primary); font-size:12px; }
  .choices { min-height:0; max-height:32vh; overflow:auto; } .choice { cursor:pointer; padding:6px 8px; border-radius:7px; } .choice:hover { background:var(--bg-2); }
  .art { width:32px; height:32px; position:relative; overflow:hidden; border-radius:6px; flex:none; }
  .title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  .choice input { accent-color:var(--md-primary); } .find input { flex:1; min-width:0; } .hint,.dest,.err { margin:0; font-size:13px; color:var(--fg-2); } .err { color:var(--danger); }
  footer { justify-content:flex-end; padding-top:12px; border-top:1px solid var(--line); } footer span { margin-right:auto; color:var(--fg-3); font-size:12px; } footer .btn { border-radius:9px; }
</style>
