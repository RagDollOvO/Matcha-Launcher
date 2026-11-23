<script lang="ts">
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import {desktop} from '../api/bridge';
  import {app} from '../stores/app.svelte';
  let {id,primary=false}:{id:string;primary?:boolean}=$props();
  let path=$state('');
</script>
{#if !desktop}<input class="source" aria-label="原文件完整路径" placeholder="粘贴原文件的完整路径" bind:value={path}/>{/if}
<button class="btn" class:primary type="button" disabled={!!app.busy || (!desktop && !path.trim())} onclick={()=>app.repairFavorite(id,path.trim().replace(/^"|"$/g,''))}><FolderSearch size={14}/>重新定位原文件</button>
<style>.source{width:100%;min-width:0;padding:8px;border-radius:6px;background:var(--bg-2);color:var(--fg)}</style>
