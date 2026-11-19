<script lang="ts">
  import { onMount } from 'svelte';
  import X from '@lucide/svelte/icons/x';
  import Play from '@lucide/svelte/icons/play';
  import Search from '@lucide/svelte/icons/search';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ModThumb from './ModThumb.svelte';
  import { app } from '../stores/app.svelte';
  import { errorText } from '../api/bridge';
  import { quickTestApi, type TestOptions, type TestPreset, type TestStatus } from '../api/quick-test';
  import { campaignOf } from '../maps';
  let { seed, onclose }: { seed?: string[]; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let options = $state<TestOptions | null>(null);
  let preset = $state<TestPreset>({modIds:[],mapModId:'',map:'',width:960,quiet:true,infiniteAmmo:true});
  let status = $state<TestStatus>({state:'idle'});
  let loading = $state(true), launching = $state(false), error = $state(''), q = $state('');
  let now = $state(Date.now()), revision=0, dead=false, polling=false;
  const sizes = [[960,'960×540'],[1280,'1280×720'],[1600,'1600×900']] as const;
  const pool = $derived(app.mods.filter(m=>m.id!==preset.mapModId));
  const mods = $derived(pool.filter(m=>`${m.title} ${m.sourceTitle ?? ''} ${m.file}`.toLowerCase().includes(q.toLowerCase())));
  const missing = $derived(preset.modIds.filter(id=>!app.mods.some(m=>m.id===id)));
  const running = $derived(!!status.processRunning||['loading','ready','busy'].includes(status.state));
  const mapValid = $derived(options?.maps.some(m=>m.modId===preset.mapModId&&m.id===preset.map));
  const mapPackages = $derived([...new Map((options?.maps??[]).map(m=>[m.modId,{id:m.modId,title:m.source}])).values()]);
  const packageMaps = $derived(options?.maps.filter(m=>m.modId===preset.mapModId)??[]);
  const elapsed = $derived(status.startedAt?Math.max(0,Math.round(((status.readyAt?Date.parse(status.readyAt):now)-Date.parse(status.startedAt))/1000)):0);
  const statusText = $derived(status.state==='failed'?'测试启动失败':status.state==='ready'?'已进入测试场景':status.state==='loading'?'游戏已启动 · 正在加载':status.state==='busy'?'游戏运行中 · 退出后可开始测试':status.state==='exited'?'上次测试已结束':'准备好就开始');
  async function refreshOptions(initial=false) {
    const own=++revision; loading=true;error='';
    try {
      const next=await quickTestApi.options(initial?seed:[...preset.modIds],initial?undefined:preset.mapModId);
      if(dead||own!==revision)return;
      options=next;
      if(initial) {preset={...next.preset,modIds:seed??next.preset.modIds};status=next.status;}
    } catch(e) {if(!dead&&own===revision)error=errorText(e);}
    finally {if(!dead&&own===revision)loading=false;}
  }
  function toggle(id:string) {preset.modIds=preset.modIds.includes(id)?preset.modIds.filter(x=>x!==id):[...preset.modIds,id];void refreshOptions();}
  function changePackage() {
    const maps=options?.maps.filter(m=>m.modId===preset.mapModId)??[];
    preset.map=maps.length===1?maps[0].id:'';
    preset.modIds=preset.modIds.filter(id=>id!==preset.mapModId);
    void refreshOptions();
  }
  async function poll() {
    if(polling||launching)return;polling=true;
    try {const next=await quickTestApi.status();if(!dead)status=next;} catch(e) {if(!dead)error=errorText(e);}
    finally {polling=false;}
  }
  async function start() {
    if(loading||launching||running||!mapValid||missing.length)return;
    launching=true;error='';
    try {status=await quickTestApi.start({...preset,modIds:[...preset.modIds]});void app.refresh();}
    catch(e) {error=errorText(e);}
    finally {launching=false;}
  }
  onMount(()=>{dialog.showModal();void refreshOptions(true);const timer=setInterval(()=>{now=Date.now();void poll();},2500);return ()=>{dead=true;clearInterval(timer);};});
</script>

<dialog bind:this={dialog} class="qt" oncancel={(e)=>{e.preventDefault();if(!launching)onclose();}} aria-labelledby="test-title">
  <header>
    <div class="ttl"><h2 id="test-title">快速实测</h2><p>挑一张地图和要测的 Mod，在小窗里直接进场。</p></div>
    <button class="icon-btn" aria-label="关闭测试设置" disabled={launching} onclick={onclose}><X size={16}/></button>
  </header>

  <div class="body">
    <section class="scene" aria-label="测试场景">
      <div class="row">
        <label class="field"><span class="lbl">地图包</span>
          <select aria-label="地图 MOD" bind:value={preset.mapModId} disabled={launching||loading} onchange={changePackage}>
            <option value="" disabled>选择库中的地图包</option>
            {#each mapPackages as pack (pack.id)}<option value={pack.id}>{pack.title}</option>{/each}
          </select>
        </label>
        <label class="field"><span class="lbl">地图</span>
          <select aria-label="测试地图" bind:value={preset.map} disabled={launching||loading||!preset.mapModId}>
            <option value="" disabled>选择地图 / 章节</option>
            {#each packageMaps as map (map.id)}
              {@const campaign=campaignOf(map.id)}
              <option value={map.id}>{campaign?`${campaign.name} ${campaign.chapter} · `:''}{map.id}</option>
            {/each}
          </select>
        </label>
      </div>
      {#if options&&!mapPackages.length}<p class="problem">库中还没有地图 Mod。先导入地图 VPK，或用工坊链接下载。</p>
      {:else if options&&preset.map&&!mapValid}<p class="problem">上次选择的地图已移除，请重新指定地图包。</p>{/if}
      <div class="row">
        <div class="field"><span class="lbl">窗口</span>
          <div class="seg" role="radiogroup" aria-label="测试窗口尺寸">
            {#each sizes as [w, label] (w)}
              <button role="radio" aria-checked={preset.width===w} class:on={preset.width===w} disabled={launching} onclick={()=>preset.width=w}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="field"><span class="lbl">场景</span>
          <div class="checks">
            <label><input type="checkbox" bind:checked={preset.quiet} disabled={launching}/>停止刷怪</label>
            <label><input type="checkbox" bind:checked={preset.infiniteAmmo} disabled={launching}/>无限弹药</label>
          </div>
        </div>
      </div>
    </section>

    <section class="pick" aria-label="测试 Mod">
      <div class="pick-head">
        <h3>测试 Mod</h3>
        <span class="count mono">{preset.modIds.length} / {pool.length}</span>
        <span class="grow"></span>
        {#if preset.modIds.length}<button class="btn sm ghost" disabled={launching} onclick={()=>{preset.modIds=[];void refreshOptions();}}>清空</button>{/if}
        <label class="find"><Search size={13}/><input aria-label="搜索测试 Mod" placeholder="搜索名称或文件名" bind:value={q}/></label>
      </div>
      <div class="list">
        {#each mods as mod (mod.id)}
          {@const on=preset.modIds.includes(mod.id)}
          <label class="item" class:on class:bad={!!mod.error}>
            <input type="checkbox" checked={on} disabled={launching||!!mod.error} onchange={()=>toggle(mod.id)}/>
            <span class="pv"><ModThumb {mod}/></span>
            <span class="info"><span class="t">{mod.title}</span><span class="m">{mod.error||mod.file}</span></span>
          </label>
        {/each}
        {#if !mods.length}<p class="empty">{q?'换个关键词试试':'可直接测试所选地图，或先导入其他 Mod。'}</p>{/if}
      </div>
      <p class="hint">地图包会自动随本次测试加载；依赖包请一起勾选，勾选顺序越靠前优先级越高。</p>
      {#if missing.length}<p class="problem">上次选择中有 {missing.length} 项已移除。<button onclick={()=>{preset.modIds=preset.modIds.filter(id=>!missing.includes(id));void refreshOptions();}}>移出本次测试</button></p>{/if}
    </section>

    {#if options?.conflicts.length}<p class="warn">所选 Mod 有 {options.conflicts.length} 组资源重叠，测试 Mod 优先于地图包。可减少选择后单独对比。</p>{/if}
    {#if error}<p class="problem" role="alert">{error}<button disabled={launching} onclick={()=>void refreshOptions(!options)}>重试读取</button></p>{/if}
  </div>

  <footer>
    <div class="status" role="status">
      <b><i class:live={running} class:fail={status.state==='failed'}></i>{launching?'正在准备独立环境…':loading?'正在读取测试设置…':statusText}</b>
      {#if status.state==='failed'}<small class="failure" role="alert">{status.failure}{status.processRunning?' 退出测试游戏后可重试。':''}</small>
      {:else}<small>{['loading','ready'].includes(status.state)?`${status.state==='ready'?'进场约用':'已等待'} ${elapsed} 秒 · F10 退出后可更换 Mod`:`独立配置 · Steam 保持登录${status.preparationMs!==undefined?` · ${status.cacheHit?'已复用缓存':'首次准备'} ${(status.preparationMs/1000).toFixed(1)} 秒`:''}`}</small>{/if}
      {#if status.state==='loading'&&elapsed>45}<small>{status.configured?'测试配置已载入，等待玩家进场。':'尚未收到测试配置回执，请打开日志检查加载路径。'}</small>{/if}
      <small class="keys"><kbd>F7</kbd>第三人称<kbd>F8</kbd>第一人称<kbd>F10</kbd>退出测试</small>
    </div>
    {#if status.directory}<button class="btn ghost" title="打开测试目录 / 日志" onclick={()=>app.reveal(status.directory!)}><FolderOpen size={14}/>日志</button>{/if}
    <button class="btn primary launch" disabled={loading||launching||running||!mapValid||!!missing.length||!!app.busy} onclick={()=>void start()}>
      {#if launching||loading}<LoaderCircle size={15} class="spin"/>{:else}<Play size={14} fill="currentColor"/>{/if}{launching?'准备中':['exited','failed'].includes(status.state)?'再次测试':'开始测试'}
    </button>
  </footer>
</dialog>

<style>
  .qt { width: min(720px, 92vw); max-height: min(780px, 90vh); padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-1); color: var(--fg); display: flex; flex-direction: column; overflow: hidden; }
  .qt:not([open]) { display: none; }
  .qt::backdrop { background: #000c; }
  .btn:disabled, .icon-btn:disabled, .seg button:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .grow { flex: 1; }

  header { display: flex; align-items: flex-start; gap: 12px; padding: 18px 14px 14px 20px; border-bottom: 1px solid var(--line); }
  .ttl { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 16px; font-weight: 500; }
  header p { margin: 4px 0 0; font-size: 12px; color: var(--fg-3); }
  h3 { margin: 0; font-size: 13px; font-weight: 500; }

  .body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
  section { padding: 16px 20px; }
  .scene { display: flex; flex-direction: column; gap: 14px; border-bottom: 1px solid var(--line); }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .lbl { font-size: 12px; color: var(--fg-3); }
  select { width: 100%; height: 32px; padding: 0 8px; font-size: 13px; background: var(--bg); }
  select:disabled { opacity: .5; }
  .seg { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--line-strong); border-radius: var(--r); background: var(--bg); }
  .seg button { flex: 1; height: 26px; border-radius: var(--r-sm); font-size: 12px; font-family: var(--font-mono); color: var(--fg-3); transition: background var(--dur), color var(--dur); }
  .seg button:hover { color: var(--fg); }
  .seg button.on { background: var(--bg-3); color: var(--fg); }
  .checks { display: flex; align-items: center; gap: 18px; height: 32px; }
  .checks label { display: inline-flex; align-items: center; gap: 7px; color: var(--fg-2); cursor: pointer; }
  input[type='checkbox'] { width: 14px; height: 14px; flex: none; margin: 0; padding: 0; accent-color: var(--fg); cursor: pointer; }
  input:disabled { cursor: default; opacity: .4; }

  .pick { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .pick-head { display: flex; align-items: center; gap: 8px; }
  .count { font-size: 12px; color: var(--fg-3); }
  .find { display: flex; align-items: center; gap: 6px; width: 200px; height: 28px; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: var(--r); background: var(--bg); color: var(--fg-4); transition: border-color var(--dur); }
  .find:focus-within { border-color: var(--fg-3); }
  .find input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: none; font-size: 12px; }
  .list { max-height: 280px; overflow-y: auto; padding: 4px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); }
  .item { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 8px; border-radius: var(--r-sm); cursor: pointer; transition: background var(--dur); }
  .item:hover { background: var(--bg-2); }
  .item:has(input:focus-visible) { box-shadow: inset 0 0 0 1px var(--fg-3); }
  .item.bad { cursor: default; }
  .pv { position: relative; width: 36px; height: 36px; flex: none; border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; }
  .item:not(.on) .pv { opacity: .55; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .t { font-size: 13px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item.on .t { color: var(--fg); }
  .m { font-size: 12px; color: var(--fg-4); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item.bad .m { color: var(--danger); font-family: inherit; }
  .empty { margin: 0; padding: 22px 8px; text-align: center; font-size: 12px; color: var(--fg-3); }
  .hint { margin: 0; font-size: 12px; color: var(--fg-3); }

  .problem, .warn { margin: 0; font-size: 12px; line-height: 1.6; color: var(--danger); overflow-wrap: anywhere; }
  .body > .problem, .body > .warn { padding: 0 20px 14px; }
  .warn { color: var(--fg-2); }
  .problem button { margin-left: 8px; color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }

  footer { display: flex; align-items: center; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--line); background: var(--bg); }
  .status { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .status b { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
  .status i { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--fg-4); }
  .status i.live { background: var(--fg); box-shadow: 0 0 0 3px #ededed22; }
  .status i.fail { background: var(--danger); }
  .status small { padding-left: 14px; font-size: 12px; color: var(--fg-3); overflow-wrap: anywhere; }
  .status .failure { color: var(--danger); line-height: 1.6; }
  .keys { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; color: var(--fg-4) !important; }
  kbd { display: inline-grid; place-items: center; height: 17px; padding: 0 4px; border: 1px solid var(--line-strong); border-radius: 3px; font: 10px var(--font-mono); color: var(--fg-2); }
  kbd:not(:first-child) { margin-left: 6px; }
  .launch { height: 34px; padding: 0 18px; font-weight: 500; }

  @media (max-width: 620px) {
    .row { grid-template-columns: 1fr; }
    .pick-head { flex-wrap: wrap; }
    .find { width: 100%; order: 9; }
  }
</style>
