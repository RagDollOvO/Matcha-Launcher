<script lang="ts">
  import FavoriteRepair from './FavoriteRepair.svelte';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import Layers from '@lucide/svelte/icons/layers';
  import Package from '@lucide/svelte/icons/package';
  import Trash from '@lucide/svelte/icons/trash';
  import {app} from '../stores/app.svelte';
  import ModThumb from './ModThumb.svelte';
  import WorkDialog from './WorkDialog.svelte';
  let {ids,onclose,onremove}:{ids:string[];onclose:()=>void;onremove:(id:string)=>void}=$props();
  let chosen=$state<string[]>([]), error=$state('');
  const items=$derived(ids.map(id=>app.favoriteEntries.find(m=>m.id===id)));
  const names=$derived(items.map(m=>m?.title??'已移除的收藏').join('、'));
  const missing=$derived(ids.filter(id=>app.favoriteRefs[id] && !app.favoriteMod(id)));
  const lost=$derived(ids.filter(id=>app.favoriteRefs[id]?.missingSource));
  const invalid=$derived(items.some((m,i)=>!m || (!missing.includes(ids[i]) && (!app.favoriteMod(ids[i]) || app.favoriteMod(ids[i])?.error || app.favoriteMod(ids[i])?.kind==='platform-package'))));
  const modIds=$derived([...new Set(ids.map(id=>app.favoriteMod(id)?.id).filter((id):id is string=>!!id))]);
  const alternatives=$derived(new Set(ids.flatMap(id=>app.favoriteRefs[id]?.library?.alternatives??[]).filter(id=>!modIds.includes(id))));
  const options=$derived(app.profiles.map(p=>({p,other:!!p.modsGameRoot && p.modsGameRoot.toLowerCase()!==app.game.root.toLowerCase(),replace:p.modIds.filter(id=>alternatives.has(id)).length,count:modIds.filter(id=>!p.modIds.includes(id)).length})));
  const targets=$derived(options.filter(o=>!o.other && (o.count||o.replace) && chosen.includes(o.p.id)));
  async function submit(){
    if (app.busy || invalid || lost.length) return;
    error='';
    if(missing.length){
      if (!await app.importFavoriteSources([...missing])) error=app.error||'导入未完成，请检查文件位置。';
    } else if(targets.length) {
      const r=await app.applyFavorites(ids,targets.map(o=>o.p.id));
      if(r){app.toast('方案已保存 · '+r.lines.join('；'));onclose();}else error=app.error||'保存未完成，请重试。';
    }
  }
</script>
<WorkDialog title="应用到方案" locked={!!app.busy} {onclose}>
  {#snippet symbol()}<ListChecks size={22}/>{/snippet}
  <div class="content">
    {#if !lost.length}
      <div class="source">
        <span class="covers" aria-hidden="true">
          {#each items.slice(0, 3) as m, i (ids[i])}<span class="cover">{#if m}<ModThumb mod={m}/>{:else}<Package size={17}/>{/if}</span>{/each}
        </span>
        <div><strong>{items.length} 个收藏</strong><p title={names}>{names}</p></div>
      </div>
    {/if}
    {#if lost.length}
      <h3>原文件已缺失</h3><p>重新定位文件后可继续加入方案。</p>
      {#each lost as id (id)}
        <div class="repair-item">
          <b>{app.favoriteRefs[id].title}</b><span class="file-name">{app.favoriteRefs[id].file}</span>
          <div class="repair-actions"><FavoriteRepair {id} primary/><button type="button" class="btn ghost" disabled={!!app.busy} onclick={()=>onremove(id)} aria-label={'移到回收站：'+app.favoriteRefs[id].title}><Trash size={14}/>移到回收站</button></div>
        </div>
      {/each}
    {:else if missing.length}
      <h3>先导入 Mod 库 · {missing.length} 项</h3>
      <p>使用收藏副本导入。同名的不同版本会单独保存，导入后即可选择方案。</p>
      <ul>{#each missing as id (id)}<li>{app.favoriteRefs[id].title}</li>{/each}</ul>
    {:else}
      <h3>选择目标方案 <small>可多选</small></h3>
      <div class="choices" role="group" aria-label="目标方案">{#each options as o (o.p.id)}
        <label class:off={o.other || (!o.count && !o.replace)} class:chosen={targets.includes(o)}>
          <span class="profile-icon"><Layers size={17}/></span>
          <span class="profile"><b>{o.p.name}</b><small>{o.other?'其他游戏目录':o.replace?'替换 '+o.replace+' 个同名成员':o.count?'新增 '+o.count+' 项':'已全部包含'}</small></span>
          <input type="checkbox" value={o.p.id} bind:group={chosen} disabled={o.other || (!o.count && !o.replace) || !!app.busy}/>
        </label>
      {/each}</div>
      {#if options.some(o=>o.replace && !o.other)}<p>替换仅影响所选方案里的同名成员。</p>{/if}
    {/if}
    {#if !lost.length && (invalid || error || (missing.length && app.game.running))}<p class="err" role="alert">{error || (invalid?'有收藏已移除或当前无法加入方案，请重新选择。':'游戏运行中，退出游戏后再导入。')}</p>{/if}
  </div>
  {#snippet footer()}
    <button class="btn ghost" type="button" disabled={!!app.busy} onclick={onclose}>{lost.length?'稍后处理':'取消'}</button>
    {#if !lost.length}<button class="btn primary" disabled={!!app.busy || invalid || !app.game.installed || (missing.length ? app.game.running : !targets.length)} onclick={()=>void submit()}>{app.busy ? app.busy+'…' : missing.length?'先导入 Mod 库':targets.length?'加入 '+targets.length+' 个方案':'加入方案'}</button>{/if}
  {/snippet}
</WorkDialog>
<style>
  .content { display: grid; gap: 11px; }
  .source, .covers, h3, .choices label, .repair-actions { display: flex; align-items: center; gap: 10px; }
  .source { padding: 11px 12px; gap: 13px; border-radius: 12px; background: var(--md-surface-container-low); }
  .covers { flex: none; gap: 3px; }
  .cover { display: grid; place-items: center; position: relative; width: 32px; height: 40px; overflow: hidden; border-radius: 5px; background: var(--bg-2); color: var(--fg-3); }
  .source > div { min-width: 0; }
  .source p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h3 { font-size: 15px; margin: 5px 0 0; }
  small, p { font-size: 13px; color: var(--fg-2); font-weight: 400; }
  h3 small, .profile small { font-size: 12px; }
  p { margin: 0; line-height: 1.55; }
  ul { margin: 0; padding-left: 22px; max-height: 112px; overflow: auto; overflow-wrap: anywhere; }
  .choices { display: grid; gap: 2px; padding: 4px; max-height: 34vh; overflow: auto; background: var(--md-surface-container-low); border-radius: 12px; }
  .choices label { min-height: 54px; padding: 7px 11px; border-radius: 8px; cursor: pointer; }
  .choices label:not(.off):hover, .choices label:focus-within { background: var(--bg-2); }
  .choices label.chosen { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .profile-icon { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 8px; background: var(--bg-2); color: var(--md-primary); }
  .profile { flex: 1; min-width: 0; display: grid; }
  .profile > * { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .chosen small { color: inherit; }
  .choices input { flex: none; width: 15px; height: 15px; margin: 0; accent-color: var(--md-primary); }
  .choices label.off { color: var(--fg-3); cursor: default; }
  .repair-actions { flex-wrap: wrap; gap: 6px; }
  .repair-item { display: grid; gap: 6px; padding: 10px 12px; background: var(--md-surface-container-low); border-radius: 10px; }
  .file-name { font: 12px/1.5 var(--font-mono); color: var(--fg-2); overflow-wrap: anywhere; }
  .err { color: var(--danger); }
</style>
