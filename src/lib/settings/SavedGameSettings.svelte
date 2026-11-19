<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { call, errorText } from '../api/bridge';
  let { compact = false }: { compact?: boolean } = $props();
  type Report = {root: string; autoexec: string; radar: {source: string; status: string; error?: string; rows: {key:string;label:string;value:string}[]}};
  let report = $state<Report | null>(null), error = $state(''), revision = $state(0);
  $effect(() => {
    const root = app.game?.root; void revision;
    let active = true; report = null; error = '';
    if (root) void call<Report>('saved-game-settings', {root}).then(r => { if (active) report = r; }, e => { if (active) error = errorText(e); });
    return () => { active = false; };
  });
  function shown(key:string,v:string) {
    if (/^(RangeMeters|ClientGlowRangeMeters)$/.test(key)) return v + ' 米';
    if (/^(IconOpacity|WeaponIconOpacity|Scale)$/.test(key)) return v + '%';
    if (['Enabled','ClientItemGlow'].includes(key) && (v==='0'||v==='1')) return v==='1'?'开':'关';
    return v;
  }
</script>
{#if app.game?.root}
<div class="disk">
  {#if compact}<div>Matcha 启动项 · <code>{app.launchConfig.launchOptions.join(' ')}</code></div>{:else}
    <div class="heading"><strong>游戏里保存的设置</strong><button onclick={() => revision++}>重新读取</button></div>
  {/if}
  {#if error}<span role="alert">{error}</span>{:else if !report}正在读取游戏配置…{:else}
    <div>autoexec.cfg · {report.autoexec}</div>
    {#if !compact}
      <details open><summary>物资雷达 · {report.radar.status === 'read' ? report.radar.rows.length + ' 项已保存' : report.radar.status === 'missing' ? '尚无设置文件' : '读取失败'}</summary>
        {#if report.radar.error}<div>{report.radar.error}</div>{/if}
        {#if report.radar.rows.length}<dl>{#each report.radar.rows as row (row.key)}<div><dt>{row.label}</dt><dd>{shown(row.key,row.value)}</dd></div>{/each}</dl>{/if}
        <small>游戏中按 Ctrl + F7 调整，再点「重新读取」。<br/>{report.radar.source}</small>
      </details>
    {/if}
  {/if}
</div>
{/if}
<style>
.disk {display:grid;gap:6px;margin:9px 0;color:var(--fg-2);font-size:13px;overflow-wrap:anywhere}
.heading,dl div {display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.heading strong {font-size:15px;color:var(--fg)} button {color:var(--md-primary)}
details {margin:5px 0} summary {cursor:pointer} dl {max-height:230px;overflow:auto;margin:6px 0}
dl div {padding:4px 8px;border-bottom:1px solid var(--line-soft)} dd {margin:0} small {color:var(--fg-3)}
</style>
