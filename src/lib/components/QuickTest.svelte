<script lang="ts">
  import { onMount } from 'svelte';
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Play from '@lucide/svelte/icons/play';
  import Search from '@lucide/svelte/icons/search';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ModThumb from './ModThumb.svelte';
  import WorkDialog from './WorkDialog.svelte';
  import { app } from '../stores/app.svelte';
  import { errorText } from '../api/bridge';
  import { quickTestApi, type TestOptions, type TestPreset, type TestStatus } from '../api/quick-test';
  import { campaignOf } from '../maps';
  let { seed, onclose }: { seed?: string[]; onclose: () => void } = $props();
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
  const statusText = $derived(status.state==='failed'?'测试启动失败':status.state==='ready'?'已进入测试场景':status.state==='loading'?'游戏已启动 · 正在加载':status.state==='busy'?'游戏运行中 · 退出后可开始测试':status.state==='exited'?'上次测试已结束':mapValid?'就绪':'选择测试地图后即可开始');
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
  onMount(()=>{void refreshOptions(true);const timer=setInterval(()=>{now=Date.now();void poll();},2500);return ()=>{dead=true;clearInterval(timer);};});
</script>

<WorkDialog title="快速实测" lead="在独立测试环境中启动，保留当前 Mod 方案。" wide locked={launching} {onclose}>
  {#snippet symbol()}<FlaskConical size={22}/>{/snippet}
  <div class="setup">
    <section class="scene" aria-label="测试场景">
      <h3><MapPin size={16}/>地图与环境</h3>
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
      {#if options&&!mapPackages.length}<p class="problem">库中还没有地图 Mod。先导入地图 VPK，或用工坊链接下载。</p>
      {:else if options&&preset.map&&!mapValid}<p class="problem">上次选择的地图已移除，请重新指定地图包。</p>{/if}
      <div class="field"><span class="lbl">窗口尺寸</span>
        <div class="seg" role="radiogroup" aria-label="测试窗口尺寸">
          {#each sizes as [w, label] (w)}
            <button role="radio" aria-checked={preset.width===w} class:on={preset.width===w} disabled={launching} onclick={()=>preset.width=w}>{label}</button>
          {/each}
        </div>
      </div>
      <div class="field"><span class="lbl">游戏内设置</span>
        <div class="checks">
          <label><input type="checkbox" bind:checked={preset.quiet} disabled={launching}/>停止刷怪</label>
          <label><input type="checkbox" bind:checked={preset.infiniteAmmo} disabled={launching}/>无限弹药</label>
        </div>
      </div>
    </section>

    <section class="pick" aria-label="测试 Mod">
      <div class="pick-head">
        <h3>测试 Mod</h3>
        <span class="count" aria-live="polite">已选 {preset.modIds.length} 项</span>
        <span class="grow"></span>
        {#if preset.modIds.length}<button class="btn sm ghost" disabled={launching} onclick={()=>{preset.modIds=[];void refreshOptions();}}>清空</button>{/if}
      </div>
      <label class="find"><Search size={15}/><input aria-label="搜索测试 Mod" placeholder="搜索名称或文件名" bind:value={q}/></label>
      <div class="list">
        {#each mods as mod (mod.id)}
          {@const on=preset.modIds.includes(mod.id)}
          <label class="item" class:on class:bad={!!mod.error}>
            <input type="checkbox" checked={on} disabled={launching||!!mod.error} onchange={()=>toggle(mod.id)}/>
            <span class="pv"><ModThumb {mod}/></span>
            <span class="info"><span class="t">{mod.title}</span><span class="m">{mod.error||mod.file}</span></span>
          </label>
        {/each}
        {#if !mods.length}<p class="empty">{q?'换个关键词试试':'可直接测试所选地图，也可以先导入其他 Mod。'}</p>{/if}
      </div>
      <p class="hint">地图包会自动加载。请一并勾选依赖包，先勾选的 Mod 优先加载资源。</p>
      {#if missing.length}<p class="problem">上次选择中有 {missing.length} 项已移除。<button onclick={()=>{preset.modIds=preset.modIds.filter(id=>!missing.includes(id));void refreshOptions();}}>移出本次测试</button></p>{/if}
    </section>
    {#if options?.conflicts.length}<div class="warn"><TriangleAlert size={16}/><p>有 {options.conflicts.length} 对包包含同路径文件。测试 Mod 优先于地图包；可少选几个 Mod 单独对比。</p></div>{/if}
    {#if error}<p class="problem load-error" role="alert">{error}<button disabled={launching} onclick={()=>void refreshOptions(!options)}>重试读取</button></p>{/if}
  </div>

  {#snippet footer()}
    <div class="status" role="status">
      <b><i class:live={running || (!!mapValid && !loading)} class:fail={status.state==='failed'}></i>{launching?'正在准备独立环境…':loading?'正在读取测试设置…':statusText}</b>
      {#if status.state==='failed'}<small class="failure" role="alert">{status.failure}{status.processRunning?' 退出测试游戏后可重试。':''}</small>
      {:else}<small>{['loading','ready'].includes(status.state)?`${status.state==='ready'?'进场约用':'已等待'} ${elapsed} 秒 · F10 退出后可更换 Mod`:`独立配置 · Steam 保持登录${status.preparationMs!==undefined?` · ${status.cacheHit?'已复用缓存':'首次准备'} ${(status.preparationMs/1000).toFixed(1)} 秒`:''}`}</small>{/if}
      {#if status.state==='loading'&&elapsed>45}<small>{status.configured?'测试配置已载入，等待玩家进场。':'尚未收到测试配置回执，请打开日志检查加载路径。'}</small>{/if}
      <small class="keys"><kbd>F7</kbd>第三人称<kbd>F8</kbd>第一人称<kbd>F10</kbd>退出测试</small>
    </div>
    {#if status.directory}<button class="btn ghost" title="打开测试目录 / 日志" onclick={()=>app.reveal(status.directory!)}><FolderOpen size={14}/>日志</button>{/if}
    <button class="btn primary launch" disabled={loading||launching||running||!mapValid||!!missing.length||!!app.busy} onclick={()=>void start()}>
      {#if launching||loading}<LoaderCircle size={15} class="spin"/>{:else}<Play size={14} fill="currentColor"/>{/if}{launching?'准备中':['exited','failed'].includes(status.state)?'再次测试':'开始测试'}
    </button>
  {/snippet}
</WorkDialog>

<style>
  .setup { display: grid; grid-template-columns: minmax(255px, .8fr) minmax(0, 1.2fr); gap: 18px; align-items: start; }
  h3 { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 15px; }
  .scene { display: grid; gap: 12px; min-width: 0; padding: 15px; border-radius: 14px; background: var(--md-surface-container-low); }
  .scene h3 { margin-bottom: 2px; }
  .scene h3 :global(svg) { color: var(--md-primary); }
  .field { display: grid; gap: 5px; min-width: 0; }
  .lbl { color: var(--fg-2); font-size: 13px; }
  select { width: 100%; height: 36px; padding: 0 8px; background: var(--md-surface-container); }
  select:disabled { opacity: .58; }
  .seg { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--md-surface-container); }
  .seg button { flex: 1; height: 31px; padding-inline: 3px; border-radius: 6px; font: 12px var(--font-mono); color: var(--fg-2); }
  .seg button:hover { background: var(--hover); }
  .seg button.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .checks { display: flex; align-items: center; gap: 11px 15px; min-height: 32px; flex-wrap: wrap; }
  .checks label { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
  input[type='checkbox'] { width: 15px; height: 15px; flex: none; margin: 0; padding: 0; accent-color: var(--md-primary); cursor: pointer; }
  input:disabled { cursor: default; opacity: .55; }

  .pick { min-width: 0; display: grid; gap: 8px; }
  .pick-head { display: flex; align-items: center; gap: 9px; min-height: 29px; }
  .count { font-size: 12px; color: var(--md-primary); white-space: nowrap; }
  .grow { flex: 1; }
  .find { display: flex; align-items: center; gap: 8px; height: 36px; padding-inline: 10px; border-radius: 9px; background: var(--md-surface-container-low); color: var(--fg-2); }
  .find:focus-within { outline: 1px solid var(--md-outline); outline-offset: -1px; }
  .find input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: none; }
  .list { max-height: 222px; min-height: 66px; overflow: auto; padding: 4px; border-radius: 12px; background: var(--md-surface-container-low); }
  .item { display: flex; align-items: center; gap: 10px; min-height: 50px; padding: 6px 9px; border-radius: 8px; cursor: pointer; }
  .item:hover, .item:focus-within { background: var(--bg-2); }
  .item.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .item.bad { cursor: default; }
  .pv { position: relative; width: 34px; height: 34px; flex: none; border-radius: 7px; overflow: hidden; }
  .info { flex: 1; min-width: 0; display: grid; }
  .t, .m { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .m { font: 12px/1.5 var(--font-mono); color: var(--fg-3); }
  .item.on .m { color: inherit; }
  .item.bad .m { color: var(--danger); font-family: inherit; }
  .empty { padding: 15px 8px; text-align: center; color: var(--fg-2); }
  .empty, .hint, .problem, .warn p { margin: 0; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
  .hint, .warn p { color: var(--fg-2); }
  .problem { color: var(--danger); }
  .warn, .load-error { grid-column: 1 / -1; border-radius: 9px; background: var(--md-surface-container-low); padding: 10px 12px; }
  .warn { display: flex; align-items: flex-start; gap: 9px; color: var(--md-tertiary); }
  .warn :global(svg) { flex: none; margin-top: 2px; }
  .problem button { margin-left: 8px; color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }

  .status { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .status b { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
  .status i { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--fg-4); }
  .status i.live { background: var(--md-primary); }
  .status i.fail { background: var(--danger); }
  .status small { padding-left: 15px; font-size: 12px; color: var(--fg-2); overflow-wrap: anywhere; }
  .status .failure { color: var(--danger); }
  .keys { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  kbd { display: inline-grid; place-items: center; height: 18px; padding: 0 4px; border: 1px solid var(--line-strong); border-radius: 4px; font: 11px var(--font-mono); }
  kbd:not(:first-child) { margin-left: 5px; }
  .launch { padding-inline: 17px; font-weight: 600; }
  @media (max-width: 660px) {
    .setup { grid-template-columns: minmax(0, 1fr); gap: 15px; }
    .status { flex-basis: 100%; }
  }
</style>
