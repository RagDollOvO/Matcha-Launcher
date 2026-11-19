<script lang="ts">
  import { reportValue, type PluginReport } from '../plugins/report';
  let { report }: { report: PluginReport } = $props();
</script>

<article class="report" aria-label={report.title} aria-live="polite">
  <header><h3>{report.title}</h3>{#if report.refreshedAt}<time datetime={report.refreshedAt}>更新于 {new Date(report.refreshedAt).toLocaleTimeString('zh-CN')}</time>{/if}</header>
  <p class="summary">{report.summary}</p>
  {#each report.sections as section, index (index)}
    <details open={!section.collapsed}>
      <summary>{section.title}</summary>
      {#if section.note}<p class="note">{section.note}</p>{/if}
      <dl class:metrics={section.layout === 'metrics'}>
        {#each section.items as item, itemIndex (itemIndex)}
          <div title={item.key}><dt>{item.label}</dt><dd class:missing={item.value === null}>{reportValue(item)}{#if item.value !== null && item.unit}<small>{item.unit}</small>{/if}</dd></div>
        {:else}<p class="note">暂无可显示的记录</p>{/each}
      </dl>
    </details>
  {/each}
</article>

<style>
  .report { margin-top: 20px; user-select: text; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  h3 { font-size: 20px; margin: 0; }
  time, .note { color: var(--fg-2); font-size: 13px; line-height: 1.7; }
  .summary { color: var(--fg-2); font-size: 14px; line-height: 1.8; margin: 8px 0 24px; }
  details { padding: 16px 0; border-top: 1px solid var(--line); }
  summary { font-size: 14px; font-weight: 600; cursor: pointer; }
  .note { margin: 8px 0 12px; }
  dl { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 0 36px; margin: 14px 0 0; }
  dl > div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 9px 0; }
  dt { color: var(--fg-2); font-size: 14px; }
  dd { margin: 0; font-size: 16px; font-variant-numeric: tabular-nums; }
  dd.missing { color: var(--fg-2); }
  dd small { font-size: 12px; color: var(--fg-2); margin-left: 5px; }
  dl.metrics { grid-template-columns: repeat(3,minmax(0,1fr)); gap: 20px; }
  .metrics > div { display: block; }
  .metrics dd { font-size: 22px; margin-top: 7px; }
  @media(max-width: 1050px) { dl.metrics { grid-template-columns: repeat(2,minmax(0,1fr)); } }
  @media(max-width: 620px) { dl, dl.metrics { grid-template-columns: 1fr; } }
</style>
