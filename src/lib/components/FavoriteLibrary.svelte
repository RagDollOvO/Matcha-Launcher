<script lang="ts">
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import Play from '@lucide/svelte/icons/play';
  import PackageOpen from '@lucide/svelte/icons/package-open';
  import PackagePlus from '@lucide/svelte/icons/package-plus';
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import Copy from '@lucide/svelte/icons/copy';
  import {api} from '../api';
  import Star from '@lucide/svelte/icons/star';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import List from '@lucide/svelte/icons/list';
  import X from '@lucide/svelte/icons/x';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash from '@lucide/svelte/icons/trash';
  import {app} from '../stores/app.svelte';
  import {welcome} from '../stores/welcome.svelte';
  import {desktop, errorText, pickDirectory, pickVpk} from '../api/bridge';
  import type {FavoriteCollection, FavoriteEntry} from '../types';
  import {favoriteMenu, setFavoriteMembers} from './favorite-menus';
  import ModThumb from './ModThumb.svelte';
  import Menu from './Menu.svelte';
  import type {MenuItem,MenuState} from './menu';
  import FavoriteCollectionDialog from './FavoriteCollectionDialog.svelte';
  import {player} from '../stores/player.svelte';
  import FavoriteRepair from './FavoriteRepair.svelte';
  import SoundList from './SoundList.svelte';
  import FavoriteApplyDialog from './FavoriteApplyDialog.svelte';
  import FileDropCue from './FileDropCue.svelte';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import {flip} from 'svelte/animate';
  import {cubicOut} from 'svelte/easing';
  import {reduceMotion} from '../motion';

  let {folderId=$bindable(''), view=$bindable('grid'), selected=$bindable([]), pathOpen=$bindable(false), dropping, over, dragging=false, press, clickable, locate, openTest}:
    {folderId:string;view:'grid'|'list';selected:string[];pathOpen:boolean;dropping:number|null;over?:string|null;dragging?:boolean;
      press:(e:PointerEvent,id:string)=>void;clickable:()=>boolean;locate:(id:string)=>void;openTest:(ids:string[])=>void}=$props();
  let q=$state(''), sort=$state('name'), path=$state(''), detailId=$state(''), anchor='';
  let originalNotice=$state<{id:string;text:string}|null>(null);
  let sheet=$state<{mode:'create'|'rename'|'add';group?:FavoriteCollection;seed?:string[];fromCollectionId?:string}|null>(null);
  let menu=$state<MenuState>(null);
  let applyIds=$state<string[]|null>(null);
  const group=$derived(app.favoriteCollections.find(c=>c.id===folderId));
  const entries=$derived(app.favoriteEntries);
  const scope=$derived(group ? entries.filter(m=>group.modIds.includes(m.id)) : entries);
  const query=$derived(q.trim().toLowerCase());
  const rows=$derived(scope.filter(m=>!query || [m.title,m.file,m.author,'sourceTitle' in m ? m.sourceTitle : ''].some(v=>v?.toLowerCase().includes(query)))
    .sort((a,b)=>sort==='size'?b.sizeMB-a.sizeMB:sort==='updated'?b.updatedAt.localeCompare(a.updatedAt):a.title.localeCompare(b.title,'zh')));
  const shelves=$derived(app.favoriteCollections.filter(c=>!query||c.name.toLowerCase().includes(query)).map(c=>({c,members:entries.filter(m=>c.modIds.includes(m.id))})));

  // ---------- 合集拖动排序：按住卡片拖，其他合集实时让位，松手保存；Alt+方向键也能挪 ----------
  type Sort={id:string;order:string[];x:number;y:number;dx:number;dy:number;w:number;settle:boolean};
  let sorting=$state<Sort|null>(null);
  let sortPress:{id:string;x:number;y:number;el:HTMLElement}|null=null, sortedAt=0, sortClick=false, settleTimer:ReturnType<typeof setTimeout>|undefined;
  let scroller=$state<HTMLElement>();
  const still=reduceMotion();
  const sortable=$derived(!query&&shelves.length>1);
  const shown=$derived(sorting?sorting.order.map(id=>shelves.find(s=>s.c.id===id)).filter(s=>!!s):shelves);
  const lifted=$derived(sorting&&shelves.find(s=>s.c.id===sorting!.id));
  function sortDown(e:PointerEvent,id:string){
    if(e.button!==0||!sortable||app.busy||sorting)return;
    sortPress={id,x:e.clientX,y:e.clientY,el:e.currentTarget as HTMLElement};
    window.addEventListener('pointermove',sortMove);
    window.addEventListener('pointerup',sortUp,{once:true});
    window.addEventListener('pointercancel',sortCancel,{once:true});
  }
  function sortMove(e:PointerEvent){
    if(!sortPress)return;
    if(!sorting){
      if(Math.hypot(e.clientX-sortPress.x,e.clientY-sortPress.y)<6)return;
      const r=sortPress.el.getBoundingClientRect();
      sorting={id:sortPress.id,order:shelves.map(s=>s.c.id),x:e.clientX,y:e.clientY,dx:sortPress.x-r.left,dy:sortPress.y-r.top,w:r.width,settle:false};
      document.documentElement.classList.add('sorting-albums');
    }
    sorting.x=e.clientX;sorting.y=e.clientY;
    const box=scroller?.getBoundingClientRect();
    if(scroller&&box){if(e.clientY<box.top+36)scroller.scrollTop-=14;else if(e.clientY>box.bottom-36)scroller.scrollTop+=14;}
    // 刚让位的卡片还在滑，等它停稳再判断，免得来回跳
    if(performance.now()-sortedAt<(still?0:200))return;
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-album]')?.dataset.album;
    if(!target||target===sorting.id)return;
    const order=sorting.order.filter(id=>id!==sorting!.id);
    order.splice(sorting.order.indexOf(target),0,sorting.id);
    sorting.order=order;sortedAt=performance.now();
  }
  function sortStop(){
    window.removeEventListener('pointermove',sortMove);
    window.removeEventListener('pointerup',sortUp);
    window.removeEventListener('pointercancel',sortCancel);
    document.documentElement.classList.remove('sorting-albums');
    sortPress=null;
  }
  function sortCancel(){sortStop();sorting=null;}
  function sortUp(){
    const s=sorting;sortStop();
    if(!s)return;
    sortClick=true;setTimeout(()=>sortClick=false);
    const i=s.order.indexOf(s.id), after=i>0;
    if(s.order.some((id,k)=>id!==shelves[k]?.c.id))void app.moveFavoriteCollection(s.id,after?s.order[i-1]:s.order[1],after);
    // 浮起的卡片落回空位再消失
    const slot=document.querySelector<HTMLElement>('[data-album="'+CSS.escape(s.id)+'"]')?.getBoundingClientRect();
    if(still||!slot){sorting=null;return;}
    s.settle=true;s.x=slot.left+s.dx;s.y=slot.top+s.dy;
    clearTimeout(settleTimer);settleTimer=setTimeout(()=>{if(sorting===s)sorting=null;},190);
  }
  function sortKey(e:KeyboardEvent,id:string){
    if(!e.altKey||!sortable||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();
    const ids=shelves.map(s=>s.c.id), i=ids.indexOf(id), back=e.key==='ArrowLeft'||e.key==='ArrowUp', j=back?i-1:i+1;
    if(j>=0&&j<ids.length)void app.moveFavoriteCollection(id,ids[j],!back);
  }
  $effect(()=>()=>{sortStop();clearTimeout(settleTimer);});
  const detail=$derived(scope.find(m=>m.id===detailId));
  const live=$derived(detail && app.favoriteMod(detail.id));
  const sound=$derived(detail?.soundCount && !('missingSource' in detail && detail.missingSource) ? {id:'fav-asset:'+detail.id,updatedAt:detail.updatedAt}:undefined);
  const disk=(m:FavoriteEntry)=>'referenceKind' in m?m.ownedPath:m.absolutePath;
  const dropGroup=$derived(over==='fav' ? undefined : over?.startsWith('g:') ? app.favoriteCollections.find(c=>c.id===over.slice(2)) : group);
  const labels=(id:string)=>app.favoriteCollections.filter(c=>c.modIds.includes(id)).map(c=>c.name);
  const subtitle=(m:FavoriteEntry)=>'referenceKind' in m && m.referenceKind==='folder'?'素材文件夹':m.sizeMB.toFixed(1)+' MiB';
  function open(id='') {folderId=id;q='';selected=[];detailId='';anchor='';}
  $effect(()=>{if(folderId && !group) open();});
  $effect(()=>{if(selected.some(id=>!rows.some(m=>m.id===id))) selected=selected.filter(id=>rows.some(m=>m.id===id));});
  function toggle(id:string){selected=selected.includes(id)?selected.filter(s=>s!==id):[...selected,id];anchor=id;}
  function pick(e:MouseEvent,id:string){
    if(!clickable())return;
    if(e.ctrlKey||e.metaKey)return toggle(id);
    if(e.shiftKey && anchor){const a=rows.findIndex(m=>m.id===anchor),b=rows.findIndex(m=>m.id===id);if(a>=0&&b>=0){selected=[...new Set([...selected,...rows.slice(Math.min(a,b),Math.max(a,b)+1).map(m=>m.id)])];return;}}
    detailId=detailId===id?'':id;anchor=id;
  }
  function options(e:MouseEvent,items:MenuItem[],below=false){e.preventDefault();e.stopPropagation();const r=(e.currentTarget as HTMLElement).getBoundingClientRect();menu={x:below?r.left:e.clientX,y:below?r.bottom+3:e.clientY,items};}
  const create=(ids:string[]=[])=>sheet={mode:'create',seed:[...ids]};
  async function chooseFile(folder=false) {
    if (!desktop) {pathOpen=true; return;}
    const id=group?.id;
    try {
      const file=folder ? await pickDirectory('收藏素材文件夹') : await pickVpk('收藏 VPK 文件（分卷包请选择 _dir.vpk）');
      if(file) await app.bookmarkFiles([file],id);
    } catch(e) {app.toast(errorText(e));}
  }
  async function unstar(ids:string[]){
    if(!await app.setFavorite(ids,false))return false;
    selected=selected.filter(id=>!ids.includes(id));
    if(ids.includes(detailId))detailId='';
    if(player.modId && ids.some(id=>player.modId==='fav-asset:'+id))player.stop();
    if(applyIds){const left=applyIds.filter(id=>!ids.includes(id));applyIds=left.length?left:null;}
    return true;
  }
  function remove(ids:string[]){if(group)void setFavoriteMembers(group,ids,false);else unstar(ids);}
  async function testEntries(ids:string[]){
    const missing=ids.filter(id=>!app.favoriteMod(id));
    if(missing.length){
      if(!await app.confirm('先导入 Mod 库，再实测',missing.map(id=>app.favoriteRefs[id]?.title??id).join('\n')+'\n从收藏副本导入到库。现有方案保持原样。','导入并打开实测'))return;
      if(!await app.importFavoriteSources(missing))return;
    }
    const mods=ids.map(id=>app.favoriteMod(id));
    if(mods.some(m=>!m||m.error||m.kind==='platform-package')){app.toast('所选项目需要可读取的游戏 Mod。');return;}
    openTest([...new Set(mods.map(m=>m!.id))]);
  }
  async function exportEntries(ids:string[],pack:boolean){
    try{for(const id of ids){if(pack)await api.packFavoriteFolder(id);else await api.extractMod('fav-asset:'+id);}}
    catch(e){app.toast(errorText(e));}
  }
  async function deleteEntries(ids:string[]){
    if(app.busy){app.toast('请等待「'+app.busy+'」完成');return;}
    await unstar(ids);
  }
  async function recycleOriginal(id:string){
    originalNotice=null;
    try{
      const plan=await api.previewRecycleFavorites([id]);
      if(await app.confirm('将外部原件移到 Windows 回收站？','收藏卡片、收藏副本和方案都会保留。','回收原件',{
        lists:[{title:'原件位置',rows:plan.map(row=>({k:row.folder?'文件夹':'文件',v:row.file}))}]})){
        await api.recycleFavoriteFiles([id],plan);
        originalNotice={id,text:'外部原件已移到 Windows 回收站，收藏副本已保留。'};
      }
    }catch(e){
      if(e && typeof e==='object' && 'code' in e && e.code==='path_missing'){
        originalNotice={id,text:'原位置找不到外部原件。收藏副本仍可使用，点「移到回收站」可收起这张卡片。'};
      }else app.toast(errorText(e));
    }
  }
  function moveOptions(ids:string[]):MenuItem[]{
    const from=group?.id;
    return [...app.favoriteCollections.filter(c=>c.id!==from).map((c):MenuItem=>({
      label:c.name,disabled:!from && ids.every(id=>c.modIds.includes(id))?'已在合集中':false,
      run:async()=>{if(await app.editFavoriteCollection({action:'add',collectionId:c.id,modIds:ids,fromCollectionId:from}))app.toast('已移到「'+c.name+'」');}
    })),...(from?[{label:'移出当前合集',run:()=>remove(ids)}]:[]),
      {label:'新建合集…',icon:Plus,run:()=>sheet={mode:'create',seed:ids,fromCollectionId:from}}];
  }
  function itemMenu(m:FavoriteEntry):MenuItem[]{
    const ids=selected.includes(m.id)?[...selected]:[m.id], one=ids.length===1;
    const folders=ids.filter(id=>app.favoriteRefs[id]?.referenceKind==='folder');
    const vpks=ids.filter(id=>!folders.includes(id));
    const gone=ids.some(id=>app.favoriteRefs[id]?.missingSource);
    const busy=app.busy?'请等待当前操作完成':false;
    const testBlock=busy||(!app.game.installed?'请先选择游戏目录':gone?'请在详情里重新定位原文件':ids.some(id=>app.favoriteMod(id)?.error||app.favoriteMod(id)?.kind==='platform-package')?'请选择可用于实测的 Mod':false);
    return [...(one?[{label:'查看详情',icon:PanelRight,hint:'Enter',run:()=>detailId=m.id}]:[]),
      {label:'快速实测',icon:Play,disabled:testBlock,run:()=>testEntries(ids)},
      {label:'取消收藏',icon:Star,hint:'F',run:()=>unstar(ids)},
      {kind:'sep'},
      {label:'加入方案…',icon:ListChecks,run:()=>applyIds=ids},
      {label:'移到合集',icon:Folder,items:moveOptions(ids)},
      {kind:'sep'},
      ...(vpks.length?[{label:'解包到桌面',icon:PackageOpen,disabled:busy||(gone?'请先定位原文件':false),run:()=>exportEntries(vpks,false)} satisfies MenuItem]:[]),
      ...(folders.length?[{label:'打包 VPK 到桌面',icon:PackagePlus,disabled:busy,run:()=>exportEntries(folders,true)} satisfies MenuItem]:[]),
      ...(one&&disk(m)?[{label:'在资源管理器中显示',icon:FolderSearch,run:()=>app.reveal(disk(m)!)}]:[]),
      ...(desktop?[{label:'复制 VPK 文件',icon:Copy,hint:'Ctrl+C',disabled:gone?'请先定位原文件':false,run:()=>app.copyModFiles(ids,true)} satisfies MenuItem]:[]),
      {label:'复制完整路径',icon:Copy,run:async()=>{try{await navigator.clipboard.writeText(ids.map(id=>{const entry=entries.find(v=>v.id===id);return entry&&disk(entry);}).filter(Boolean).join('\n'));app.toast('已复制完整路径');}catch{app.toast('复制失败');}}},
      {kind:'sep'},{label:'移到回收站',icon:Trash,hint:'Del',shortcut:'Delete',disabled:busy,run:()=>deleteEntries(ids)}];
  }
  function groupMenu(c:FavoriteCollection):MenuItem[]{return [
    {label:'应用到方案…',icon:ListChecks,disabled:c.modIds.length?false:'合集为空',run:()=>applyIds=[...c.modIds]},
    {label:'添加成员…',icon:Plus,run:()=>sheet={mode:'add',group:c}},
    {label:'重命名…',icon:Pencil,run:()=>sheet={mode:'rename',group:c}},
    {kind:'sep'},{label:'删除合集…',icon:Trash,run:async()=>{
      if(await app.confirm('删除「'+c.name+'」？','其中的收藏仍保留在收藏夹。','删除合集') && await app.editFavoriteCollection({action:'delete',collectionId:c.id}) && folderId===c.id)open();
    }}];}
  function key(e:KeyboardEvent){
    if(sorting&&e.key==='Escape'){e.preventDefault();sortCancel();return;}
    const target=e.target instanceof Element?e.target:null;
    if(welcome.open||applyIds||sheet||menu||app.confirmation||e.defaultPrevented||target?.closest('input,select,textarea,[contenteditable],dialog,.ctx-menu')||!(target===document.body||target?.closest('.favorites')))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();selected=rows.map(m=>m.id);return;}
    if(e.key==='Escape'){if(detailId)detailId='';else selected=[];return;}
    if(e.key==='Backspace'&&group){e.preventDefault();open();return;}
    const focused=target?.closest<HTMLElement>('[data-favorite-id]')?.dataset.favoriteId;
    const ids=focused&&!selected.includes(focused)?[focused]:selected.length?[...selected]:detail?[detail.id]:[];
    if(desktop&&(e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&!e.repeat){
      if(e.key.toLowerCase()==='c'&&ids.length&&window.getSelection()?.isCollapsed!==false){e.preventDefault();void app.copyModFiles(ids,true);return;}
      if(e.key.toLowerCase()==='v'){
        const id=group?.id;
        void app.pasteModFiles(async paths=>{
          if(app.route==='mods'&&app.modFilter.category==='fav'&&!app.confirmation)await app.bookmarkFiles(paths,id);
        });
        return;
      }
    }
    if(ids.length && e.key==='Delete'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey){e.preventDefault();void deleteEntries(ids);}
    if(ids.length && e.key.toLowerCase()==='f'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();unstar(ids);}
  }
</script>
<svelte:window onkeydown={key}/>
{#snippet albumBody(c:FavoriteCollection,members:FavoriteEntry[])}
  <span class="folder-art" aria-hidden="true"><span class="folder-back"></span>
    {#each members.slice(0,2) as m,j (m.id)}<span class="sample" class:rear={j===1}><ModThumb mod={m}/></span>{/each}
    <span class="folder-front"><Star size={10}/></span></span>
  <span class="album-name"><b>{c.name}</b><small>{members.length} 个收藏</small></span><ChevronRight size={14}/>
{/snippet}
<section class="favorites" aria-label="独立收藏夹">
  <div class="pane">
    <header>
      <div class="heading">
        {#if group}<button class="back" onclick={()=>open()}><Star size={14}/>收藏夹<ChevronRight size={13}/></button>{/if}
        <div class="title-line">{#if !group}<Star size={22}/>{/if}<h2 title={group?.name}>{group?.name??'收藏夹'}</h2></div>
        <p>{group?scope.length+' 个成员':entries.length+' 个收藏 · '+app.favoriteCollections.length+' 个合集'}</p>
      </div>
      <div class="actions">
        <button class="btn ghost" disabled={!!app.busy} onclick={e=>options(e,[{label:'VPK 文件…',icon:Star,run:()=>chooseFile()},{label:'素材文件夹…',icon:Folder,run:()=>chooseFile(true)}],true)}><Star size={14}/>收藏文件</button>
        {#if group}
          <button class="btn" class:primary={!scope.length} onclick={()=>sheet={mode:'add',group}}><Plus size={15}/>添加成员</button>
          {#if scope.length}<button class="btn primary" onclick={()=>applyIds=scope.map(m=>m.id)}><ListChecks size={15}/>应用到方案</button>{/if}
          <button class="icon-btn" aria-label="管理合集" title="管理合集" onclick={e=>options(e,groupMenu(group!),true)}><Ellipsis size={19}/></button>
        {:else}<button class="btn primary" onclick={()=>create(selected)}><Plus size={15}/>新建合集</button>{/if}
      </div>
    </header>
    <div class="tools">
      {#if selected.length}
        <strong>已选 {selected.length} 项</strong>
        <button class="btn" onclick={()=>applyIds=[...selected]}><ListChecks size={14}/>应用到方案</button>
        <button class="btn" onclick={e=>options(e,moveOptions([...selected]),true)}><Folder size={14}/>移到合集</button>
        {#if group}<button class="btn ghost" onclick={()=>remove([...selected])}>移出当前合集</button>{/if}
        <button class="btn ghost" disabled={!!app.busy} title="移到 Matcha 回收站（Del）" onclick={()=>deleteEntries([...selected])}><Trash size={14}/>移到回收站</button><i></i>
        <button class="icon-btn" aria-label="取消选择" onclick={()=>selected=[]}><X size={15}/></button>
      {:else}
        <label class="find"><Search size={15}/><input aria-label="搜索收藏" placeholder={group?'在这个合集里搜索':'搜索收藏或合集'} bind:value={q}/>{#if q}<button aria-label="清空搜索" onclick={()=>q=''}><X size={13}/></button>{/if}</label><i></i>
        <select aria-label="排序" bind:value={sort}><option value="name">按名称</option><option value="size">按大小</option><option value="updated">按更新时间</option></select>
        <div class="switcher" role="group" aria-label="显示方式"><button aria-label="图标" aria-pressed={view==='grid'} onclick={()=>view='grid'}><LayoutGrid size={15}/></button><button aria-label="列表" aria-pressed={view==='list'} onclick={()=>view='list'}><List size={16}/></button></div>
      {/if}
    </div>
    {#if pathOpen&&!desktop}<form class="paths" onsubmit={async e=>{e.preventDefault();const f=path.trim().replace(/^"|"$/g,'');if(f&&await app.bookmarkFiles([f],group?.id)){path='';pathOpen=false;}}}>
      <input placeholder="VPK 或素材文件夹的完整路径" aria-label="收藏路径" bind:value={path}/><button class="btn" disabled={!path.trim()||!!app.busy}>收藏</button><button type="button" class="icon-btn" aria-label="收起" onclick={()=>pathOpen=false}><X size={14}/></button></form>{/if}
    <div class="scroll" bind:this={scroller}>
      {#if !group && shelves.length}<section class="albums"><h3>我的合集 <small>{shelves.length}</small>{#if sortable}<span class="sort-hint">{sorting?'松手放下 · Esc 取消':'按住拖动可排序'}</span>{/if}</h3><div class="folder-grid">
        {#each shown as {c,members} (c.id)}
          <button class="album" class:drop={over==='g:'+c.id} class:target={dragging&&over!=='g:'+c.id} class:placeholder={sorting?.id===c.id}
            data-album={c.id} data-drop={'g:'+c.id} data-favorite-folder={c.id} aria-label={'打开合集 '+c.name+(sortable?'，Alt+方向键调整顺序':'')}
            animate:flip={{duration:still?0:220,easing:cubicOut}}
            onpointerdown={e=>sortDown(e,c.id)} onkeydown={e=>sortKey(e,c.id)}
            onclick={()=>{if(clickable()&&!sortClick)open(c.id);}} oncontextmenu={e=>options(e,groupMenu(c))}>
            {@render albumBody(c,members)}
          </button>
        {/each}
      </div></section>{/if}
      {#if !group && (shelves.length || rows.length)}<h3>{query?'匹配的收藏':'全部收藏'} <small>{rows.length}</small></h3>{/if}
      {#if rows.length}<div class="entries" class:list={view==='list'}>
        {#each rows as m (m.id)}
          <div class="entry" data-favorite-id={m.id} class:picked={selected.includes(m.id)} class:inspected={detailId===m.id} role="button" tabindex="0" aria-label={m.title}
            onpointerdown={e=>press(e,m.id)} onclick={e=>pick(e,m.id)} onkeydown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter')detailId=m.id;if(e.key===' '){e.preventDefault();toggle(m.id);}}}
            oncontextmenu={e=>options(e,itemMenu(m))}>
            <div class="cover"><ModThumb mod={m}/></div>
            <button class="check" class:show={selected.includes(m.id)} aria-label={'选择 '+m.title} aria-pressed={selected.includes(m.id)} onclick={e=>{e.stopPropagation();toggle(m.id);}}>{selected.includes(m.id)?'✓':''}</button>
            <button class="star" title="取消收藏" aria-label={'取消收藏 '+m.title} onclick={e=>{e.stopPropagation();unstar([m.id]);}}><Star size={13} fill="currentColor"/></button>
            <span class="entry-name" title={m.title}>{m.title}</span><small class="size">{subtitle(m)}</small>
            <button class="more" title="收藏操作" aria-label={'整理 '+m.title} onclick={e=>options(e,itemMenu(m),true)}><Ellipsis size={16}/></button>
          </div>
        {/each}
      </div>{:else}<div class="empty"><span class="empty-icon"><FolderOpen size={27} strokeWidth={1.5}/></span><b>{query?'没有匹配的收藏':group?'合集里还没有收藏':'收藏夹还是空的'}</b>
        {#if query}<button class="btn ghost" onclick={()=>q=''}>清空搜索</button>{:else if group}<button class="btn ghost" onclick={()=>sheet={mode:'add',group}}>从收藏夹添加</button>
        {:else}<span>给 Mod 点星标，或直接拖入 VPK、素材文件夹。</span>{/if}</div>{/if}
    </div>
  </div>
  {#if detail}<aside class="info" aria-label="收藏详情">
    <div class="info-head"><span>收藏详情</span><button class="icon-btn" aria-label="关闭详情" onclick={()=>detailId=''}><X size={15}/></button></div>
    <div class="preview"><ModThumb mod={detail} fit="contain"/></div><h2>{detail.title}</h2>
    <p>{detail.author||('referenceKind' in detail?'本地收藏':'Mod 库')} · {subtitle(detail)}</p>
    <div class="detail-actions">
      <button class="btn primary" onclick={()=>applyIds=[detail!.id]}><ListChecks size={15}/>应用到方案…</button>
      {#if sound}<button class="btn" onclick={()=>player.preview(sound!)}><Play size={14}/>{player.modId===sound.id?'停止试听':'试听声音'}</button>{/if}
    </div>
    {#if sound}<SoundList mod={sound}/>{/if}
    <span class="field-name">所在合集</span><button class="assign" onclick={e=>options(e,favoriteMenu([detail!.id],create),true)}><Folder size={14}/>{labels(detail.id).join('、')||'加入合集'}<ChevronRight size={13}/></button>
    {#if 'missingSource' in detail && detail.missingSource}<p>原文件已缺失。可重新定位文件，或将这条收藏记录移到回收站。</p><FavoriteRepair id={detail.id}/>
    {:else if disk(detail)}<span class="field-name">收藏副本</span><button class="btn ghost" onclick={()=>app.reveal(disk(detail!)!)}><FolderSearch size={14}/>在资源管理器中显示</button>{/if}
    {#if detail.absolutePath}<span class="field-name">原位置</span><span class="path">{detail.absolutePath}</span>
      {#if detail.id.startsWith('favorite-file:') && 'ownedPath' in detail && detail.ownedPath && !detail.library}
        <button class="btn ghost" onclick={()=>recycleOriginal(detail!.id)}>回收外部原件…</button>
        {#if originalNotice?.id===detail.id}<p role="status">{originalNotice.text}</p>{/if}
      {/if}{/if}

    {#if live}<button class="btn ghost" onclick={()=>locate(live!.id)}>在 Mod 库查看<ChevronRight size={13}/></button>{/if}
    <button class="btn ghost" disabled={!!app.busy} onclick={()=>deleteEntries([detail!.id])}><Trash size={14}/>移到回收站</button>
  </aside>{/if}
  {#if sorting&&lifted}
    <div class="album lift" class:settle={sorting.settle} aria-hidden="true" style:width="{sorting.w}px"
      style:transform="translate({sorting.x-sorting.dx}px, {sorting.y-sorting.dy}px)">{@render albumBody(lifted.c,lifted.members)}</div>
  {/if}
  {#if dropping!==null}<FileDropCue favorite title={!desktop?'松开后粘贴本机路径':dropGroup?'收藏到「'+dropGroup.name+'」':'松开以收藏'} detail="VPK 和素材文件夹均保留独立副本"/>{/if}
  {#key menu}{#if menu}<Menu items={menu.items} x={menu.x} y={menu.y} onclose={()=>menu=null}/>{/if}{/key}
  {#if sheet}<FavoriteCollectionDialog {...sheet} onclose={()=>sheet=null} onsaved={id=>{sheet=null;open(id);}}/>{/if}
  {#if applyIds}<FavoriteApplyDialog ids={applyIds} onremove={id=>deleteEntries([id])} onclose={()=>applyIds=null}/>{/if}
</section>

<style>
  .favorites { position: relative; display: flex; flex: 1; min-width: 0; height: 100%; color: var(--fg); }
  .pane { display: flex; flex-direction: column; flex: 1; min-width: 0; container: favorites-pane / inline-size; }
  header, .actions, .tools, .title-line, .find, .switcher, .album, .info-head, .assign, .paths {
    display: flex; align-items: center;
  }
  header { justify-content: space-between; align-items: end; gap: 16px; padding: 24px 24px 18px; }
  .heading { min-width: 0; }
  .title-line { gap: 9px; min-width: 0; color: var(--md-primary); }
  .title-line :global(svg) { flex: none; }
  h2 { color: var(--fg); font-size: 27px; line-height: 1.2; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .heading p, .info p { margin: 5px 0 0; color: var(--fg-2); font-size: 13px; }
  .back { display: inline-flex; align-items: center; gap: 5px; margin-bottom: 6px; color: var(--md-primary); }
  .back:hover { text-decoration: underline; text-underline-offset: 3px; }
  .actions { flex: none; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  header .btn { height: 34px; }

  .tools, .paths { gap: 8px; padding: 0 24px 13px; flex-wrap: wrap; }
  .tools { min-height: 47px; }
  .tools > i { flex: 1; }
  .tools strong { color: var(--md-primary); font-size: 13px; }
  .find { gap: 8px; max-width: 310px; min-width: 110px; flex: 1; height: 34px; padding-inline: 10px; background: var(--bg-2); border-radius: 9px; color: var(--fg-2); }
  .find:focus-within { outline: 1px solid var(--md-outline); outline-offset: -1px; }
  .find input { border: 0; background: none; flex: 1; min-width: 0; height: 100%; padding: 0; }
  .find button { display: grid; place-items: center; }
  .switcher { padding: 3px; border-radius: 9px; background: var(--bg-2); }
  .switcher button { padding: 5px 7px; display: grid; place-items: center; border-radius: 6px; color: var(--fg-2); }
  .switcher button[aria-pressed=true] { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .tools select { height: 33px; padding-block: 0; }
  .paths input { flex: 1; min-width: 0; }

  .scroll { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px 26px; border-top: 1px solid var(--line-soft); }
  h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 10px; color: var(--fg); font-size: 15px; font-weight: 650; }
  h3 small { color: var(--fg-3); font: 12px var(--font-mono); }
  .albums { margin-bottom: 23px; }
  .folder-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(211px, 100%), 1fr)); gap: 10px; }
  .album { gap: 12px; min-width: 0; min-height: 76px; padding: 9px 11px; text-align: left; border-radius: 11px; background: var(--md-surface-container); color: var(--fg-3); }
  .album:hover, .album.drop { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .album { outline: 1px dashed transparent; outline-offset: -1px; }
  /* 拖 Mod 时：可放的合集描虚线，指到的那个亮起、文件夹张口接住 */
  .album.target { outline-color: var(--line-strong); }
  .album.drop { outline: 2px solid var(--md-primary); outline-offset: -2px; box-shadow: 0 12px 26px -16px color-mix(in srgb, var(--md-primary) 80%, transparent); }
  /* 排序：原位留一个虚线空槽，卡片本身浮在指针下 */
  .album.placeholder { background: color-mix(in srgb, var(--md-primary) 7%, transparent); outline: 2px dashed color-mix(in srgb, var(--md-primary) 50%, transparent); outline-offset: -2px; }
  .album.placeholder > span, .album.placeholder > :global(svg) { opacity: 0; }
  .album.lift { position: fixed; left: 0; top: 0; z-index: 60; pointer-events: none; margin: 0;
    background: var(--md-surface-container-high); color: var(--fg-2); outline: 1px solid color-mix(in srgb, var(--md-primary) 45%, transparent);
    box-shadow: 0 22px 40px -18px rgb(0 0 0 / .55), 0 4px 12px -6px rgb(0 0 0 / .3); scale: 1.04; rotate: -1.5deg; }
  .album.lift.settle { scale: 1; rotate: 0deg; box-shadow: none; transition: transform 180ms var(--ease-out), scale 180ms var(--ease-out), rotate 180ms var(--ease-out), box-shadow 180ms; }
  :global(html.sorting-albums), :global(html.sorting-albums *) { cursor: grabbing !important; }
  .sort-hint { margin-left: auto; color: var(--fg-3); font-size: 12px; font-weight: 400; }
  .album > :global(svg) { flex: none; }
  .album-name { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .album-name b { color: var(--fg); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .album-name small, .size, .path { font-size: 12px; color: var(--fg-2); }
  .folder-art { position: relative; width: 63px; height: 50px; flex: none; }
  .folder-back { position: absolute; inset: 14px 3px 3px 0; background: var(--md-primary-container); border-radius: 5px; }
  .folder-back::before { content: ''; position: absolute; left: 0; top: -5px; width: 24px; height: 11px; border-radius: 4px; background: inherit; }
  .sample { position: absolute; left: 22px; top: 1px; width: 31px; height: 32px; border-radius: 4px; overflow: hidden; transform: rotate(9deg); z-index: 1; }
  .sample.rear { left: 9px; top: 3px; transform: rotate(-10deg); z-index: 0; }
  .folder-front { position: absolute; z-index: 2; inset: 26px 1px 2px 2px; display: flex; align-items: center; padding-left: 9px; border-radius: 4px 5px 6px 6px; background: var(--md-secondary); color: var(--md-on-secondary); transform: skewX(-6deg); }
  @media (prefers-reduced-motion: no-preference) {
    .album .folder-front { transform-origin: 50% 100%; transition: transform var(--dur) var(--ease-out); }
    .album .sample { transition: translate 260ms var(--ease-out); }
    .album:hover .folder-front { transform: translateY(2px) skewX(-8deg); }
    .album.drop { scale: 1.02; }
    .album.drop .folder-front { transform: perspective(140px) rotateX(-34deg) skewX(-6deg); }
    .album.drop .sample { translate: 2px -6px; }
    .album.drop .sample.rear { translate: -3px -4px; }
    .album.lift { animation: album-lift 160ms var(--ease-out) both; }
  }
  @keyframes album-lift { from { scale: 1; rotate: 0deg; box-shadow: none; } }

  .entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(142px, 100%), 1fr)); gap: 12px; align-content: start; }
  .entry { position: relative; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 6px; padding: 6px 8px 7px; border-radius: 11px; background: var(--md-surface-container); cursor: pointer; }
  .entry:hover { background: var(--bg-2); }
  .entry:focus-visible, .entry.picked, .entry.inspected { outline: 1px solid var(--md-primary); outline-offset: 0; }
  .entry.picked { background: var(--md-secondary-container); }
  .cover { grid-column: 1/-1; position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 7px; }
  .entry-name { grid-column: 1/-1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-top: 3px; font-size: 14px; font-weight: 650; }
  .star, .check, .more { display: grid; place-items: center; border-radius: 6px; }
  .star, .check { position: absolute; top: 12px; width: 25px; height: 25px; background: var(--md-surface-container); color: var(--md-primary); }
  .star { right: 14px; }
  .star:hover { background: var(--md-secondary-container); }
  .check { left: 14px; opacity: 0; border: 1px solid var(--md-outline); }
  .entry:hover .check, .check:focus-visible, .check.show { opacity: 1; }
  .check.show { background: var(--md-primary); color: var(--md-on-primary); }
  .more { width: 26px; height: 25px; color: var(--fg-2); }
  .more:hover { color: var(--fg); background: var(--hover); }
  .entries.list { grid-template-columns: 1fr; gap: 3px; }
  .list .entry { grid-template-columns: 20px 40px minmax(0, 1fr) auto 24px 26px; gap: 10px; padding: 6px 10px; border-radius: 8px; }
  .list .cover { grid-column: 2; grid-row: 1; }
  .list .entry-name { grid-column: 3; grid-row: 1; padding: 0; }
  .list .size { grid-column: 4; grid-row: 1; }
  .list .star, .list .check { position: static; grid-row: 1; }
  .list .check { grid-column: 1; width: 17px; height: 17px; opacity: 1; }
  .list .star { grid-column: 5; }
  .list .more { grid-column: 6; grid-row: 1; }
  .album, .entry { transition: background var(--dur), color var(--dur); }
  .album { transition: background var(--dur), color var(--dur), outline-color var(--dur), box-shadow var(--dur), scale 200ms var(--ease-out); }

  .empty { display: flex; align-items: center; gap: 9px; flex-direction: column; padding: 38px 10px; text-align: center; color: var(--fg-2); }
  .empty b { color: var(--fg); font-size: 15px; }
  .empty-icon { display: grid; place-items: center; width: 49px; height: 49px; margin-bottom: 4px; border-radius: 14px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .info { width: clamp(175px, 32%, 286px); overflow: auto; padding: 16px; border-left: 1px solid var(--line); background: var(--md-surface-container-low); display: flex; flex-direction: column; align-items: stretch; gap: 9px; }
  .info-head { justify-content: space-between; color: var(--fg-2); font-size: 13px; }
  .info > :global(*) { flex-shrink: 0; }
  .preview { position: relative; aspect-ratio: 1; flex: none; border-radius: 10px; overflow: hidden; }
  .info h2 { font-size: 17px; white-space: normal; overflow-wrap: anywhere; }
  .info p { margin: 0; }
  .info .field-name { margin: 6px 0 0; padding-top: 10px; border-top: 1px solid var(--line-soft); color: var(--fg-2); font-size: 12px; }
  .detail-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 3px; }
  .detail-actions .btn { height: 31px; }
  .assign { gap: 6px; text-align: left; color: var(--md-primary); }
  .assign :global(svg) { flex: none; }
  .path { overflow-wrap: anywhere; user-select: text; }
  .info .btn { align-self: flex-start; }

  @container favorites-pane (max-width: 560px) {
    header, .tools, .scroll, .paths { padding-inline: 15px; }
    header { flex-direction: column; align-items: stretch; gap: 11px; padding-block: 17px 12px; }
    .actions { justify-content: flex-start; }
  }
  @container favorites-pane (max-width: 310px) {
    .list .entry { grid-template-columns: 18px 32px minmax(0, 1fr) 23px 24px; gap: 6px; }
    .list .size { display: none; }
    .list .star { grid-column: 4; }
    .list .more { grid-column: 5; }
  }
</style>
