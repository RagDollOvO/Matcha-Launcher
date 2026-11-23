<script lang="ts">
  import { untrack } from 'svelte';
  import Layers from '@lucide/svelte/icons/layers';
  import Search from '@lucide/svelte/icons/search';
  import ModThumb from './ModThumb.svelte';
  import WorkDialog from './WorkDialog.svelte';
  import { app } from '../stores/app.svelte';
  import type { FavoriteCollection } from '../types';

  let { mode, group, seed = [], fromCollectionId, fromLibrary=false, onclose, onsaved }: { mode: 'create' | 'add' | 'rename'; group?: FavoriteCollection; seed?: string[]; fromCollectionId?:string; fromLibrary?:boolean; onclose: () => void; onsaved: (id: string) => void } = $props();
  const formId = $props.id();
  let name = $state(untrack(() => mode === 'rename' ? group?.name ?? '' : ''));
  let chosen = $state<string[]>(untrack(() => [...seed]));
  let query = $state('');
  let error = $state('');
  const naming = $derived(mode !== 'add');
  const list = $derived([...app.favoriteEntries, ...app.mods.filter(m => seed.includes(m.id) && !app.isFavorite(m.id))].filter(m => (!fromCollectionId || app.favoriteCollections.find(c=>c.id===fromCollectionId)?.modIds.includes(m.id)) && (mode !== 'add' || !group?.modIds.includes(m.id))));
  const visible = $derived(list.filter(m => (m.title + ' ' + m.file).toLowerCase().includes(query.trim().toLowerCase())));
  const selected = $derived(chosen.filter(id => list.some(m => m.id === id)));
  const all = $derived(visible.length > 0 && visible.every(m => chosen.includes(m.id)));
  const duplicate = $derived(naming && app.favoriteCollections.some(c => c.id !== (mode === 'rename' ? group?.id : undefined) && c.name.toLowerCase() === name.trim().toLowerCase()));
  const title = $derived(mode === 'create' ? '新建收藏合集' : mode === 'rename' ? '重命名合集' : '添加成员');
  function toggle(id: string) { chosen = chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]; }
  async function save() {
    if (app.busy || duplicate || (naming ? !name.trim() : !selected.length)) return;
    error = '';
    const result = await app.editFavoriteCollection(mode === 'create' ? {action: 'create', name: name.trim(), modIds: selected, fromCollectionId, fromLibraryIds:fromLibrary?seed.filter(id=>selected.includes(id)):undefined}
      : mode === 'rename' ? {action: 'rename', collectionId: group!.id, name: name.trim()}
      : {action: 'add', collectionId: group!.id, modIds: selected});
    if (result) onsaved(result.id); else error = app.error || '保存未完成，请重试。';
  }
</script>

<WorkDialog {title} lead={mode === 'add' ? '加入「' + group?.name + '」' : undefined} locked={!!app.busy} {onclose}>
  {#snippet symbol()}<Layers size={22} />{/snippet}
  <form id={formId} onsubmit={(e) => { e.preventDefault(); void save(); }}>
    {#if naming}
      <!-- svelte-ignore a11y_autofocus (名称是打开此对话框后的第一个输入) -->
      <label class="name">合集名称<input maxlength="60" placeholder="例如：MAC10 音效" bind:value={name} autofocus /></label>
      {#if duplicate}<p class="err">已有同名合集，换个名字试试。</p>{/if}
    {/if}
    {#if mode !== 'rename' && list.length}
      <div class="bar"><strong>{mode === 'create' ? '选择成员' : '可添加的收藏'}</strong>
        <button type="button" onclick={() => chosen = all ? chosen.filter(id => !visible.some(m => m.id === id)) : [...new Set([...chosen, ...visible.map(m => m.id)])]} disabled={!visible.length}>{all ? '取消全选' : '全选'}</button></div>
      {#if list.length > 6}<label class="find"><Search size={15}/><input aria-label="搜索收藏" placeholder="搜索收藏" bind:value={query} /></label>{/if}
      <div class="choices">
        {#each visible as m (m.id)}
          <label class="choice" class:chosen={chosen.includes(m.id)}><span class="art"><ModThumb mod={m}/></span><span class="title"><strong>{m.title}</strong><small>{m.file}</small></span><input type="checkbox" checked={chosen.includes(m.id)} onchange={() => toggle(m.id)}/></label>
        {:else}<p class="hint">没有匹配的收藏</p>{/each}
      </div>
    {:else if mode === 'add'}<p class="hint">{app.favoriteIds().length ? '现有收藏都在这个合集中。' : '先给 Mod 点星标，就能在这里添加。'}</p>{/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </form>
  {#snippet footer()}
    {#if mode !== 'rename'}<span class="selection" aria-live="polite">{selected.length ? '已选 ' + selected.length + ' 个 Mod' : mode === 'create' ? '可稍后添加成员' : ''}</span>{/if}
    <button type="button" class="btn ghost" disabled={!!app.busy} onclick={onclose}>取消</button>
    <button type="submit" form={formId} class="btn primary" disabled={!!app.busy || duplicate || (naming ? !name.trim() : !selected.length)}>{app.busy ? '保存中…' : mode === 'create' ? '创建合集' : mode === 'rename' ? '保存名称' : '加入合集'}</button>
  {/snippet}
</WorkDialog>

<style>
  form { display: grid; gap: 12px; }
  .bar, .choice, .find { display: flex; align-items: center; gap: 10px; }
  .name { display: grid; gap: 7px; font-weight: 600; }
  .name input { height: 40px; padding-inline: 12px; background: var(--md-surface-container-low); font-weight: 400; }
  .name + .bar { margin-top: 4px; }
  .bar strong { flex: 1; font-size: 14px; }
  .bar button { color: var(--md-primary); padding: 3px 6px; }
  .bar button:disabled { opacity: .45; }
  .find { padding: 0 10px; background: var(--md-surface-container-low); color: var(--fg-2); border-radius: 9px; }
  .find input { flex: 1; min-width: 0; height: 35px; padding: 0; background: none; border: 0; }
  .choices { display: grid; gap: 2px; padding: 4px; max-height: 34vh; overflow: auto; background: var(--md-surface-container-low); border-radius: 12px; }
  .choice { min-height: 53px; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  .choice:hover, .choice:focus-within { background: var(--bg-2); }
  .choice.chosen { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .art { position: relative; flex: none; width: 37px; height: 37px; overflow: hidden; border-radius: 7px; }
  .title { flex: 1; min-width: 0; display: grid; }
  .title > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title small { color: var(--fg-3); font-size: 12px; }
  .chosen small { color: inherit; }
  .choice input { flex: none; width: 15px; height: 15px; margin: 0; accent-color: var(--md-primary); }
  .hint, .err { margin: 0; color: var(--fg-2); }
  .choices .hint { padding: 14px; text-align: center; }
  .err { color: var(--danger); }
  .selection { margin-right: auto; color: var(--fg-2); }
</style>
