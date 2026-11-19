<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { askAgent } from '../plugins/intake';
  import RecordedDllSwitch from './RecordedDllSwitch.svelte';
  import { filesLabel, fileLabel, runtimeLabel } from '../plugins/recorded-dll';
  import type { ExternalPackRecord } from '../types';
  let {p}:{p:ExternalPackRecord}=$props();
  function act(intent:string) { askAgent('请'+intent+'这个 DLL 模组：'+JSON.stringify({id:p.id,name:p.name,source:p.source})+'。先用 dll_pack_check 核对现场，按作者的方式处理，完成后复核。'); }
</script>
<section aria-label="模组详情">
  <h2>加载状态</h2>
  <dl><dt>本机文件</dt><dd>{filesLabel[p.state]}</dd><dt>当前游戏</dt><dd>{runtimeLabel[p.runtime]}</dd>
    <dt>启动方式</dt><dd>{p.launch}</dd>
    {#if p.control && p.state!=='absent'}<dt>下次启动</dt><dd><RecordedDllSwitch {p}/>{p.control.reason || (p.control.enabled?'启用':'停用')}</dd>{/if}
    {#each p.files as f (f.path)}<dt>{f.role==='entry'?'入口':f.role==='module'?'模块':'资源'}</dt>
      <dd><code>{f.path}</code> · {f.mapped?'已装载':f.parked?'入口已暂存':fileLabel[f.state]}</dd>{/each}
  </dl>
  {#each p.conflicts as c}<p>{c.path} 同时由 {c.other} 声明，请先核对入口。</p>{/each}
  <h2>来源与维护</h2><dl><dt>作者来源</dt><dd>{p.source}</dd><dt>维护方式</dt><dd>{p.maintenance}</dd>
    {#if p.enable && p.disable}<dt>启用 / 停用</dt><dd>{p.enable} / {p.disable}</dd>{/if}
    {#if p.lastCheck}<dt>最近登记</dt><dd>{new Date(p.lastCheck.at).toLocaleString()} · {filesLabel[p.lastCheck.state]}</dd>{/if}</dl>
  <div class="actions"><button class="btn" disabled={!app.game.root} onclick={()=>act(p.state==='absent'?'安装':'核查与维护')}>{p.state==='absent'?'让茶茶安装':'让茶茶维护'}</button>
    {#if p.state!=='absent'}
      {#if !p.control}<button class="btn ghost" onclick={()=>act('按作者说明核对并登记可逆启停方式：优先使用作者总开关，有独立入口时可登记入口暂存。请先预览')}>让茶茶接入开关</button>{/if}
      {#if !p.control && p.enable && p.disable}<button class="btn ghost" onclick={()=>act('启用')}>启用</button><button class="btn ghost" onclick={()=>act('停用')}>停用</button>{/if}
      <button class="btn ghost" onclick={()=>askAgent('请用 dll_pack_uninstall 完整卸载当前游戏的平台 '+JSON.stringify(p.id)+'，先给我看文件和配置清单，完成后移除登记。')}>让茶茶卸载…</button>
    {/if}</div>
</section>
<style>
  section{max-width:780px;font-size:14px}h2{font-size:16px;margin:26px 0 10px}dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 24px;margin:0}dt{color:var(--fg-3)}dd{margin:0;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}
</style>
