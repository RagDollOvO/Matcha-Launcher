<script lang="ts">
  import Toggle from './Toggle.svelte';
  import type { ExternalPackRecord } from '../types';
  import { api } from '../api';
  import { app } from '../stores/app.svelte';
  let {p}:{p:ExternalPackRecord}=$props();
  const reason=$derived(app.game.running?'退出游戏后可切换':app.busy?'正在处理':p.conflicts.length?'入口归属重叠':p.control?.reason);
  async function flip(){
    const root=app.game.root,c=p.control;
    if(!root || !c || c.enabled===null || reason)return;
    const enabled=!c.enabled;
    await app.perform((enabled?'启用 ':'停用 ')+p.name,()=>api.setRecordedDllEnabled(p.id,enabled,root),p.name+(enabled?' 已启用':' 已停用')+'，下次启动生效');
  }
</script>
<span title={reason||'下次启动游戏生效'}><Toggle on={p.control?.enabled===true} mixed={p.control?.enabled===null} disabled={!!reason || p.control?.enabled==null} onchange={()=>void flip()} label={(p.control?.enabled?'停用 ':'启用 ')+p.name}/></span>
<style>span{display:inline-flex;padding:6px}</style>
