<script lang="ts">
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
  import {desktop, errorText, pickDirectory, pickVpk} from '../api/bridge';
  import type {FavoriteCollection, FavoriteEntry} from '../types';
  import {favoriteMenu, setFavoriteMembers} from './favorite-menus';
  import ModThumb from './ModThumb.svelte';
  import Menu from './Menu.svelte';
  import type {MenuItem,MenuState} from './menu';
  import FavoriteCollectionDialog from './FavoriteCollectionDialog.svelte';
  import SoundList from './SoundList.svelte';
  import FavoriteApplyDialog from './FavoriteApplyDialog.svelte';
  import ListChecks from '@lucide/svelte/icons/list-checks';

  let {folderId=$bindable(''), view=$bindable('grid'), selected=$bindable([]), pathOpen=$bindable(false), dropping, over, press, clickable, locate}:
    {folderId:string;view:'grid'|'list';selected:string[];pathOpen:boolean;dropping:number|null;over?:string|null;
      press:(e:PointerEvent,id:string)=>void;clickable:()=>boolean;locate:(id:string)=>void}=$props();
  let q=$state(''), sort=$state('name'), path=$state(''), detailId=$state(''), anchor='';
  let sheet=$state<{mode:'create'|'rename'|'add';group?:FavoriteCollection;seed?:string[]}|null>(null);
  let menu=$state<MenuState>(null);
  let applyIds=$state<string[]|null>(null);
  const group=$derived(app.favoriteCollections.find(c=>c.id===folderId));
  const entries=$derived(app.favoriteEntries);
  const scope=$derived(group ? entries.filter(m=>group.modIds.includes(m.id)) : entries);
  const query=$derived(q.trim().toLowerCase());
  const rows=$derived(scope.filter(m=>!query || [m.title,m.file,m.author,'sourceTitle' in m ? m.sourceTitle : ''].some(v=>v?.toLowerCase().includes(query)))
    .sort((a,b)=>sort==='size'?b.sizeMB-a.sizeMB:sort==='updated'?b.updatedAt.localeCompare(a.updatedAt):a.title.localeCompare(b.title,'zh')));
  const shelves=$derived(app.favoriteCollections.filter(c=>!query||c.name.toLowerCase().includes(query)).map(c=>({c,members:entries.filter(m=>c.modIds.includes(m.id))})));
  const detail=$derived(scope.find(m=>m.id===detailId));
  const live=$derived(detail && app.mod(detail.id));
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
  function unstar(ids:string[]){app.setFavorite(ids,false);selected=selected.filter(id=>!ids.includes(id));if(ids.includes(detailId))detailId='';}
  function remove(ids:string[]){if(group)void setFavoriteMembers(group,ids,false);else unstar(ids);}
  function itemMenu(m:FavoriteEntry):MenuItem[]{
    const ids=selected.includes(m.id)?[...selected]:[m.id];
    return [{label:'查看详情',icon:FolderOpen,run:()=>detailId=m.id},
      {label:'应用到方案…',icon:ListChecks,run:()=>applyIds=ids},
      {label:'整理到合集',icon:Folder,items:favoriteMenu(ids,create)},
      ...(group?[{label:'移出当前合集',run:()=>void setFavoriteMembers(group!,ids,false)}]:[]),
      {label:'取消收藏',icon:Star,run:()=>unstar(ids)}];
  }
  function groupMenu(c:FavoriteCollection):MenuItem[]{return [
    {label:'应用到方案…',icon:ListChecks,disabled:c.modIds.length?false:'合集为空',run:()=>applyIds=[...c.modIds]},
    {label:'添加成员…',icon:Plus,run:()=>sheet={mode:'add',group:c}},
    {label:'重命名…',icon:Pencil,run:()=>sheet={mode:'rename',group:c}},
    {kind:'sep'},{label:'删除合集…',icon:Trash,run:async()=>{
      if(await app.confirm('删除「'+c.name+'」？','其中的收藏仍保留在收藏夹。','删除合集') && await app.editFavoriteCollection({action:'delete',collectionId:c.id}) && folderId===c.id)open();
    }}];}
  function key(e:KeyboardEvent){
    if(applyIds||sheet||menu||app.confirmation||e.defaultPrevented||(e.target as Element)?.closest?.('input,select,textarea,[contenteditable],dialog,.ctx-menu')||!(e.target===document.body||(e.target as Element)?.closest?.('.favorites')))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();selected=rows.map(m=>m.id);return;}
    if(e.key==='Escape'){if(detailId)detailId='';else selected=[];return;}
    if(e.key==='Backspace'&&group){e.preventDefault();open();return;}
    const ids=selected.length?[...selected]:detail?[detail.id]:[];
    if(ids.length && e.key==='Delete'){e.preventDefault();remove(ids);}
    if(ids.length && e.key.toLowerCase()==='f'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();unstar(ids);}
  }
</script>
<svelte:window onkeydown={key}/>
<section class="favorites" aria-label="独立收藏夹">
  <div class="pane">
    <header>
      <div class="heading"><div class="title-line">{#if group}<button class="back" onclick={()=>open()}><Star size={15}/>收藏夹</button><ChevronRight size={14}/>{:else}<Star size={21}/>{/if}
        <h2>{group?.name??'收藏夹'}</h2></div>
        <p>{group?scope.length+' 个成员':entries.length+' 个收藏 · '+app.favoriteCollections.length+' 个合集'}<span>启停由 Mod 方案管理</span></p>
      </div>
      <button class="btn ghost collect" disabled={!!app.busy} onclick={e=>options(e,[{label:'VPK 文件…',icon:Star,run:()=>chooseFile()},{label:'素材文件夹…',icon:Folder,run:()=>chooseFile(true)}],true)}><Star size={14}/>收藏文件</button>
      {#if group}<button class="icon-btn" aria-label="管理合集" title="管理合集" onclick={e=>options(e,groupMenu(group!),true)}><Ellipsis size={17}/></button>
        <button class="btn ghost" disabled={!scope.length} onclick={()=>applyIds=scope.map(m=>m.id)}><ListChecks size={15}/>应用到方案</button>
        <button class="btn primary" onclick={()=>sheet={mode:'add',group}}><Plus size={15}/>添加成员</button>
      {:else}<button class="btn primary" onclick={()=>create(selected)}><Plus size={15}/>新建合集</button>{/if}
    </header>
    <div class="tools">
      {#if selected.length}
        <strong>已选 {selected.length} 项</strong>
        <button class="btn" onclick={()=>applyIds=[...selected]}><ListChecks size={14}/>应用到方案</button>
        <button class="btn" onclick={e=>options(e,favoriteMenu([...selected],create),true)}><Folder size={14}/>整理到合集</button>
        {#if group}<button class="btn ghost" onclick={()=>remove([...selected])}>移出当前合集</button>{/if}
        <button class="btn ghost" onclick={()=>unstar([...selected])}>取消收藏</button><i></i>
        <button class="icon-btn" aria-label="取消选择" onclick={()=>selected=[]}><X size={15}/></button>
      {:else}
        <label class="find"><Search size={15}/><input placeholder={group?'在这个合集里搜索':'搜索收藏或合集'} bind:value={q}/>{#if q}<button aria-label="清空搜索" onclick={()=>q=''}><X size={13}/></button>{/if}</label><i></i>
        <select aria-label="排序" bind:value={sort}><option value="name">按名称</option><option value="size">按大小</option><option value="updated">按更新时间</option></select>
        <div class="switcher" role="group" aria-label="显示方式"><button aria-label="图标" aria-pressed={view==='grid'} onclick={()=>view='grid'}><LayoutGrid size={15}/></button><button aria-label="列表" aria-pressed={view==='list'} onclick={()=>view='list'}><List size={16}/></button></div>
      {/if}
    </div>
    {#if pathOpen&&!desktop}<form class="paths" onsubmit={async e=>{e.preventDefault();const f=path.trim().replace(/^"|"$/g,'');if(f&&await app.bookmarkFiles([f],group?.id)){path='';pathOpen=false;}}}>
      <input placeholder="VPK 或素材文件夹的完整路径" aria-label="收藏路径" bind:value={path}/><button class="btn" disabled={!path.trim()||!!app.busy}>收藏</button><button type="button" class="icon-btn" aria-label="收起" onclick={()=>pathOpen=false}><X size={14}/></button></form>{/if}
    <div class="scroll">
      {#if !group && shelves.length}<section class="albums"><h3>我的合集</h3><div class="folder-grid">
        {#each shelves as {c,members} (c.id)}
          <button class="album" class:drop={over==='g:'+c.id} data-drop={'g:'+c.id} data-favorite-folder={c.id} aria-label={'打开合集 '+c.name} onclick={()=>{if(clickable())open(c.id);}} oncontextmenu={e=>options(e,groupMenu(c))}>
            <span class="folder-art" aria-hidden="true"><span class="folder-back"></span>
              {#each members.slice(0,2) as m,j (m.id)}<span class="sample" class:rear={j===1}><ModThumb mod={m}/></span>{/each}
              <span class="folder-front"><Star size={10}/></span></span>
            <span class="album-name"><b>{c.name}</b><small>{members.length} 个收藏</small></span><ChevronRight size={14}/>
          </button>
        {/each}
      </div></section>{/if}
      {#if !group && (shelves.length || rows.length)}<h3>{query?'匹配的收藏':'全部收藏'}</h3>{/if}
      {#if rows.length}<div class="entries" class:list={view==='list'}>
        {#each rows as m (m.id)}
          <div class="entry" class:picked={selected.includes(m.id)} class:inspected={detailId===m.id} role="button" tabindex="0" aria-label={m.title}
            onpointerdown={e=>press(e,m.id)} onclick={e=>pick(e,m.id)} onkeydown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter')detailId=m.id;if(e.key===' '){e.preventDefault();toggle(m.id);}}}
            oncontextmenu={e=>options(e,itemMenu(m))}>
            <div class="cover"><ModThumb mod={m}/></div>
            <button class="check" class:show={selected.includes(m.id)} aria-label={'选择 '+m.title} aria-pressed={selected.includes(m.id)} onclick={e=>{e.stopPropagation();toggle(m.id);}}>{selected.includes(m.id)?'✓':''}</button>
            <button class="star" title="取消收藏" aria-label={'取消收藏 '+m.title} onclick={e=>{e.stopPropagation();unstar([m.id]);}}><Star size={13} fill="currentColor"/></button>
            <span class="entry-name" title={m.title}>{m.title}</span><small class="size">{subtitle(m)}</small>
            <button class="more" title="收藏操作" aria-label={'整理 '+m.title} onclick={e=>options(e,itemMenu(m),true)}><Ellipsis size={16}/></button>
          </div>
        {/each}
      </div>{:else}<div class="empty"><FolderOpen size={30} strokeWidth={1.35}/><b>{query?'没有匹配的收藏':group?'合集里还没有收藏':'收藏夹还是空的'}</b>
        {#if query}<button class="btn ghost" onclick={()=>q=''}>清空搜索</button>{:else if group}<button class="btn ghost" onclick={()=>sheet={mode:'add',group}}>从收藏夹添加</button>
        {:else}<span>给 Mod 点星标，或直接拖入 VPK、素材文件夹。</span>{/if}</div>{/if}
    </div>
  </div>
  {#if detail}<aside class="info">
    <div class="info-head"><span>收藏详情</span><button class="icon-btn" aria-label="关闭详情" onclick={()=>detailId=''}><X size={15}/></button></div>
    <div class="preview"><ModThumb mod={detail} fit="contain"/></div><h2>{detail.title}</h2>
    <p>{detail.author||('referenceKind' in detail?'本地收藏':'Mod 库')} · {subtitle(detail)}</p>
    <button class="btn" onclick={()=>applyIds=[detail!.id]}><ListChecks size={15}/>应用到方案…</button>
    <span class="field-name">所在合集</span><button class="assign" onclick={e=>options(e,favoriteMenu([detail!.id],create),true)}><Folder size={14}/>{labels(detail.id).join('、')||'加入合集'}<ChevronRight size={13}/></button>
    {#if detail.absolutePath}<span class="field-name">原位置</span><span class="path">{detail.absolutePath}</span><button class="btn ghost" onclick={()=>app.reveal(detail!.absolutePath!)}>在资源管理器中显示</button>{/if}
    {#if live?.soundCount}<SoundList mod={live}/>{/if}
    {#if live}<button class="btn ghost" onclick={()=>locate(live!.id)}>在 Mod 库查看<ChevronRight size={13}/></button>{/if}
  </aside>{/if}
  {#if dropping!==null}<div class="dropzone" role="status"><div><Star size={18}/><b>{dropGroup?'松开以加入「'+dropGroup.name+'」':'松开以收藏'}</b><span>只记录原位置</span></div></div>{/if}
  {#key menu}{#if menu}<Menu items={menu.items} x={menu.x} y={menu.y} onclose={()=>menu=null}/>{/if}{/key}
  {#if sheet}<FavoriteCollectionDialog {...sheet} onclose={()=>sheet=null} onsaved={id=>{sheet=null;open(id);}}/>{/if}
  {#if applyIds}<FavoriteApplyDialog ids={applyIds} onclose={()=>applyIds=null}/>{/if}
</section>

<style>
  .favorites{position:relative;display:flex;flex:1;min-width:0;height:100%;color:var(--fg)}.pane{display:flex;flex-direction:column;flex:1;min-width:0}
  header,.tools,.title-line,.find,.switcher,.album,.info-head,.assign,.paths{display:flex;align-items:center}header{padding:20px 22px 14px;gap:7px}.heading{flex:1;min-width:0}.title-line{gap:9px;min-width:0;color:var(--md-primary)}h2{color:var(--fg);font-size:20px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.heading p,.info p{font-size:12px;color:var(--fg-3);margin:6px 0 0}.heading p span{margin-left:12px}.back{display:inline-flex;align-items:center;gap:6px;color:var(--fg-2);white-space:nowrap}.back:hover{color:var(--md-primary)}
  .tools,.paths{gap:8px;padding:0 22px 12px}.tools{min-height:43px}.tools i{flex:1}.tools strong{font-size:13px}.find{gap:7px;max-width:290px;min-width:90px;flex:1;height:32px;padding:0 10px;background:var(--bg-2);border-radius:10px;color:var(--fg-3)}.find input{border:0;background:none;flex:1;min-width:0;height:100%;padding:0}.switcher{padding:3px;border-radius:9px;background:var(--bg-2)}.switcher button{padding:4px 7px;display:grid;place-items:center;border-radius:6px;color:var(--fg-3)}.switcher button[aria-pressed=true]{background:var(--md-secondary-container);color:var(--md-on-secondary-container)}.tools select{height:31px}.paths input{flex:1;min-width:0}.btn{white-space:nowrap;border-radius:10px}
  .scroll{flex:1;overflow:auto;padding:15px 22px 28px;border-top:1px solid var(--line-soft);min-height:0}h3,.info .field-name{margin:0 0 10px;color:var(--fg-2);font-size:12px;font-weight:600}.albums{margin-bottom:21px}.folder-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(205px,100%),1fr));gap:8px}.album{gap:12px;min-width:0;padding:8px 11px;text-align:left;border-radius:9px;background:color-mix(in srgb,var(--md-secondary-container) 27%,transparent);color:var(--fg-3)}.album:hover,.album.drop{background:var(--md-secondary-container);color:var(--md-on-secondary-container)}.album-name{flex:1;min-width:0;display:grid;gap:3px}.album-name b{color:var(--fg);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.album-name small,.size,.path{font-size:12px;color:var(--fg-3)}
  .folder-art{position:relative;width:49px;height:39px;flex:none}.folder-back{position:absolute;inset:7px 2px 2px 0;background:var(--md-primary-container);border-radius:3px}.folder-back:before{content:'';position:absolute;left:0;top:-4px;width:19px;height:9px;border-radius:4px;background:inherit}.sample{position:absolute;left:13px;top:0;width:26px;height:27px;border-radius:3px;overflow:hidden;transform:rotate(7deg);z-index:1}.sample.rear{left:5px;top:2px;transform:rotate(-9deg);z-index:0}.folder-front{position:absolute;z-index:2;inset:17px 0 1px 1px;display:flex;align-items:center;padding-left:7px;border-radius:3px 4px 5px 5px;background:var(--md-secondary);color:var(--md-on-secondary);transform:skewX(-5deg)}
  .entries{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(155px,100%),1fr));gap:12px;align-content:start}.entry{position:relative;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;padding:8px;border-radius:12px;background:color-mix(in srgb,var(--md-surface-container-high) 68%,transparent);cursor:pointer}.entry:focus-visible,.entry.picked,.entry.inspected{outline:2px solid var(--md-primary);outline-offset:-1px}.cover{grid-column:1/-1;position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:8px}.entry-name{grid-column:1/-1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}.star,.check,.more{display:grid;place-items:center;border-radius:5px}.star,.check{position:absolute;top:14px;width:23px;height:23px;background:var(--md-surface-container);color:var(--md-primary)}.star{right:14px}.check{left:14px;opacity:0;border:1px solid var(--md-outline)}.entry:hover .check,.check:focus-visible,.check.show{opacity:1}.more{padding:3px;color:var(--fg-3)}.more:hover{color:var(--fg);background:var(--bg-2)}
  .entries.list{grid-template-columns:1fr;gap:2px}.list .entry{display:grid;grid-template-columns:20px 40px minmax(0,1fr) auto 24px 24px;gap:10px;padding:6px 8px;border-radius:7px}.list .cover{grid-column:2;grid-row:1;aspect-ratio:1}.list .entry-name{grid-column:3;grid-row:1}.list .size{grid-column:4}.list .star,.list .check{position:static;grid-row:1}.list .check{grid-column:1;width:16px;height:16px;opacity:1}.list .star{grid-column:5}.list .more{grid-column:6;grid-row:1}
  .empty{display:flex;align-items:center;justify-content:center;gap:9px;flex-direction:column;color:var(--fg-3)}.empty{padding:40px 10px}.empty b{color:var(--fg)}.empty span{font-size:13px}.dropzone{position:absolute;inset:6px;z-index:4;display:grid;align-items:end;justify-items:center;padding:12px;border:2px dashed var(--md-primary);border-radius:12px;pointer-events:none}
  .dropzone>div{display:flex;align-items:center;gap:8px;max-width:100%;border-radius:10px;padding:8px 14px;background:var(--md-secondary-container);color:var(--md-on-secondary-container)}.dropzone span{font-size:12px}.album.drop{outline:2px solid var(--md-primary);outline-offset:-2px}
  .album,.star,.more,.entry{transition:background var(--dur),color var(--dur)}.album .folder-front{transition:transform var(--dur) var(--ease-out)}.album:hover .folder-front,.album.drop .folder-front{transform:translateY(2px) skewX(-8deg)}
  .info{width:min(270px,34%);min-width:155px;overflow:auto;padding:14px;border-left:1px solid var(--line);display:flex;flex-direction:column;align-items:stretch;gap:10px}.info-head{justify-content:space-between;color:var(--fg-3);font-size:12px}.preview{position:relative;aspect-ratio:1;flex:none;border-radius:10px;overflow:hidden}.info h2{font-size:16px;white-space:normal}.info p{margin:0}.info .field-name{margin:8px 0 0}.assign{gap:6px;text-align:left;color:var(--md-primary)}.path{overflow-wrap:anywhere}.info .btn{align-self:flex-start}
</style>
