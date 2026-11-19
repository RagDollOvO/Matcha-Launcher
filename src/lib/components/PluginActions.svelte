<script lang="ts">
  import { app } from '../stores/app.svelte';
  import type { PlatformPlugin, PluginAction } from '../types';
  import PluginReport from './PluginReport.svelte';
  import { pluginReport, type PluginReport as Report } from '../plugins/report';
  let { plugin }: { plugin: PlatformPlugin } = $props();
  let values = $state<Record<string, string | boolean>>({});
  let outputs = $state<Record<string, string>>({});
  let reports = $state<Record<string, Report | null>>({});
  function fieldLabel(name: string) {
    const field = plugin.config.find(value => value && typeof value === 'object' && 'id' in value && value.id === name);
    return field && typeof field === 'object' && 'label' in field && typeof field.label === 'string' ? field.label : name;
  }
  function fieldValue(action: PluginAction, name: string) {
    const parameter = action.parameters[name];
    return values[`${action.id}:${name}`] ?? (action.id === 'configure' ? plugin.savedConfig?.[name] : undefined) ?? parameter.default ?? (parameter.type === 'boolean' ? false : undefined);
  }
  async function run(action: PluginAction) {
    reports[action.id] = null;
    const args: Record<string, unknown> = {};
    for (const [name, parameter] of Object.entries(action.parameters)) {
      const value = fieldValue(action, name);
      if (value === undefined || (value === '' && parameter.type !== 'string')) { if (parameter.required && parameter.default === undefined) { outputs[action.id] = `请填写 ${name}`; return; } continue; }
      if (parameter.type === 'integer' || parameter.type === 'number') {
        const number = Number(value);
        if (!Number.isFinite(number) || (parameter.type === 'integer' && !Number.isInteger(number))) { outputs[action.id] = `${name} 需要有效${parameter.type === 'integer' ? '整数' : '数字'}`; return; }
        args[name] = number;
      } else args[name] = value;
    }
    const result = await app.invokePlugin(plugin, action, args);
    if (result !== undefined) {
      const payload = result && typeof result === 'object' && 'result' in result ? result.result : result;
      reports[action.id] = pluginReport(payload);
      outputs[action.id] = JSON.stringify(result, null, 2);
    }
  }
</script>

{#if plugin.configError}<p class="muted">设置文件读取失败：{plugin.configError}</p>{/if}
{#each plugin.actions as action (action.id)}
  <details>
    <summary>{action.label} <span class="muted">{action.effect === 'read' ? '读取' : '写入'}</span></summary>
    <p>{action.description}</p>
    <form onsubmit={(e) => { e.preventDefault(); void run(action); }}>
      {#each Object.entries(action.parameters) as [name, param] (name)}
        {@const key = `${action.id}:${name}`}
        <label>
          <span>{fieldLabel(name)}{param.required ? ' *' : ''}</span>
          {#if param.type === 'boolean'}
            <input type="checkbox" checked={Boolean(fieldValue(action, name))} onchange={(e) => values[key] = e.currentTarget.checked} />
          {:else if param.type === 'enum'}
            <select value={String(fieldValue(action, name) ?? '')} required={param.required} onchange={(e) => values[key] = e.currentTarget.value}>
              <option value="">选择…</option>
              {#each param.options ?? [] as option (option)}<option value={option}>{option}</option>{/each}
            </select>
          {:else if param.type === 'integer' || param.type === 'number'}
            <input type="number" value={String(fieldValue(action, name) ?? '')} min={param.minimum} max={param.maximum} step={param.type === 'integer' ? 1 : 'any'} required={param.required} oninput={(e) => values[key] = e.currentTarget.value} />
          {:else}
            <input value={String(fieldValue(action, name) ?? '')} required={param.required} oninput={(e) => values[key] = e.currentTarget.value} />
          {/if}
        </label>
      {/each}
      <button class="btn" type="submit" disabled={!!app.busy || plugin.runtimeState !== 'initialized'}>执行 {action.label}</button>
      {#if plugin.runtimeState !== 'initialized'}<span class="muted">等待游戏加载此模组</span>{/if}
    </form>
    {#if reports[action.id]}<PluginReport report={reports[action.id]!}/>
    {:else if outputs[action.id]}<pre aria-live="polite">{outputs[action.id]}</pre>{/if}
  </details>
{/each}
<style>
  details { border-top: 1px solid var(--line); padding: 12px 0; }
  summary { cursor: pointer; font-size: 14px; }
  summary span { margin-left: 12px; font-size: 12px; }
  p { color: var(--fg-2); }
  form { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items: end; gap: 18px 24px; }
  label { display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
  input, select { max-width: 240px; }
  input[type=checkbox] { height: 30px; align-self: start; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; color: var(--fg-2); user-select: text; }
</style>
