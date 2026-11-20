<script lang="ts">
  import {onMount} from 'svelte';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import X from '@lucide/svelte/icons/x';
  import {app} from '../stores/app.svelte';
  let {ids,onclose}:{ids:string[];onclose:()=>void}=$props();
  let dialog:HTMLDialogElement, chosen=$state<string[]>([]), error=$state('');
  const items=$derived(ids.map(id=>app.favoriteEntries.find(m=>m.id===id)));
  const missing=$derived(ids.filter(id=>app.favoriteRefs[id] && !app.favoriteMod(id)));
  const invalid=$derived(items.some((m,i)=>!m || (!missing.includes(ids[i]) && (!app.favoriteMod(ids[i]) || app.favoriteMod(ids[i])?.error || app.favoriteMod(ids[i])?.kind==='platform-package'))));
  const modIds=$derived([...new Set(ids.map(id=>app.favoriteMod(id)?.id).filter((id):id is string=>!!id))]);
  const options=$derived(app.profiles.map(p=>({p,other:!!p.modsGameRoot && p.modsGameRoot.toLowerCase()!==app.game.root.toLowerCase(),count:modIds.filter(id=>!p.modIds.includes(id)).length})));
  const targets=$derived(options.filter(o=>!o.other && o.count && chosen.includes(o.p.id)));
  onMount(()=>dialog.showModal());
  async function submit(){
    if (app.busy || invalid) return;
    error='';
    if(missing.length){
      if (!await app.importFavoriteSources([...missing])) error=app.error||'导入未完成，请检查文件位置。';
    } else if(targets.length) {
      const r=await app.applyFavorites(ids,targets.map(o=>o.p.id));
      if(r){app.toast('方案已保存 · '+r.lines.join('；'));onclose();}else error=app.error||'保存未完成，请重试。';
    }
  }
</script>
<dialog bind:this={dialog} aria-labelledby="apply-heading" oncancel={e=>{e.preventDefault();if(!app.busy)onclose();}}>
  <form onsubmit={e=>{e.preventDefault();void submit();}}>
    <header><ListChecks size={20}/><h2 id="apply-heading">应用到方案</h2><button type="button" class="icon-btn" disabled={!!app.busy} aria-label="关闭" onclick={onclose}><X size={16}/></button></header>
    <p class="summary">{items.map(m=>m?.title??'已移除的收藏').join('、')}</p>
    {#if missing.length}
      <h3>先导入 Mod 库 · {missing.length} 项</h3>
      <p>VPK 会复制到游戏目录，素材文件夹会打包。原文件保留，导入后再选择目标方案。</p>
      <ul>{#each missing as id (id)}<li>{app.favoriteRefs[id].absolutePath}</li>{/each}</ul>
    {:else}
      <h3>选择目标方案 <small>可多选</small></h3>
      <div class="choices">{#each options as o (o.p.id)}
        <label class:off={o.other || !o.count}><input type="checkbox" value={o.p.id} bind:group={chosen} disabled={o.other || !o.count || !!app.busy}/><b>{o.p.name}</b><span>{o.other?'其他游戏目录':o.count?'新增 '+o.count+' 项':'已全部包含'}</span></label>
      {/each}</div>
      <p>只追加这次选中的成员。之后修改收藏或方案，各自独立。</p>
    {/if}
    {#if invalid || error || (missing.length && app.game.running)}<p class="err" role="alert">{error || (invalid?'有收藏已移除或当前无法加入方案，请重新选择。':'游戏运行中，退出游戏后再导入。')}</p>{/if}
    <footer><button class="btn ghost" type="button" disabled={!!app.busy} onclick={onclose}>取消</button>
      <button class="btn primary" disabled={!!app.busy || invalid || !app.game.installed || (missing.length ? app.game.running : !targets.length)}>{app.busy ? app.busy+'…' : missing.length?'先导入 Mod 库':targets.length?'加入 '+targets.length+' 个方案':'加入方案'}</button></footer>
  </form>
</dialog>
<style>
 dialog{width:min(440px,90vw);padding:0;border:0;border-radius:16px;background:var(--bg-1);color:var(--fg);margin:auto}dialog::backdrop{background:rgb(12 9 16/.42)}
 form{padding:22px;display:flex;flex-direction:column;gap:12px;max-height:85vh;overflow:auto}header,footer,label,h3{display:flex;align-items:center;gap:9px}header{color:var(--md-primary)}h2{flex:1;color:var(--fg);margin:0;font-size:19px}h3{font-size:14px;margin:4px 0 0}small,p,label span{font-size:12px;color:var(--fg-3);font-weight:400}p{margin:0;line-height:1.6}.summary,ul{max-height:90px;overflow:auto;color:var(--fg-2);overflow-wrap:anywhere}ul{margin:0;padding-left:20px;font-size:12px}
 .choices{max-height:36vh;overflow:auto}label{padding:10px 8px;cursor:pointer;border-radius:8px}label:hover{background:var(--bg-2)}label input{accent-color:var(--md-primary)}label b{flex:1}label.off{opacity:.65}.err{color:var(--danger)}footer{justify-content:flex-end;padding-top:10px;border-top:1px solid var(--line)}
</style>
