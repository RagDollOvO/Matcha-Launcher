<script lang="ts">
  // 自定义端点（中转 / 本地模型）：读写 Pi 的 models.json。保存语义是整份替换，所以先 GET 再改目标 provider。
  import { onMount } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { piHost, type PiModelsConfig } from '../agent/host';
  import { agent } from '../agent';
  import { app } from '../stores/app.svelte';

  const REDACTED = '__FLARE_REDACTED__';
  const APIS = [['openai-completions', 'OpenAI 兼容（Chat Completions）'], ['openai-responses', 'OpenAI Responses'], ['anthropic-messages', 'Anthropic Messages'], ['google-generative-ai', 'Google Gemini']] as const;

  let config = $state<PiModelsConfig | null>(null);
  let phase = $state<'loading' | 'ready' | 'missing' | 'error'>('loading');
  let error = $state('');
  let form = $state<{ original: string; id: string; baseUrl: string; api: string; apiKey: string; hasKey: boolean; models: string; context: string } | null>(null);
  let saving = $state(false);

  const entries = $derived(Object.entries(config?.providers ?? {}));
  onMount(() => { void load(); });
  async function load() {
    const r = await piHost.models();
    if (r.ok) { config = r.value; phase = 'ready'; }
    else { phase = r.missing ? 'missing' : 'error'; error = r.error; }
  }
  function edit(id = '') {
    const p = id ? config?.providers[id] : undefined;
    form = {
      original: id, id, baseUrl: p?.baseUrl ?? '', api: p?.api ?? 'openai-completions', apiKey: '', hasKey: !!p?.apiKey,
      models: (p?.models ?? []).map((m) => m.id).join('\n'),
      context: String((p?.models?.[0]?.contextWindow as number | undefined) ?? ''),
    };
  }
  async function save() {
    if (!form || !config) return;
    const f = form;
    const id = f.id.trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) { app.toast('名称只能用字母、数字、点、横线和下划线'); return; }
    if (!/^https?:\/\//i.test(f.baseUrl.trim())) { app.toast('Base URL 需要以 http:// 或 https:// 开头'); return; }
    const ids = f.models.split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean);
    if (!ids.length) { app.toast('至少填一个模型 ID'); return; }
    const old = config.providers[f.original] ?? {};
    const ctx = Number(f.context);
    const next: PiModelsConfig = $state.snapshot(config) as PiModelsConfig;
    if (f.original && f.original !== id) delete next.providers[f.original];
    next.providers[id] = {
      ...old, baseUrl: f.baseUrl.trim(), api: f.api,
      // 留空表示沿用：旧值以 REDACTED 标记带回，后端保留原值
      apiKey: f.apiKey.trim() || (f.hasKey ? (old.apiKey ?? REDACTED) : undefined),
      models: ids.map((mid) => ({ ...(old.models?.find((m) => m.id === mid) ?? {}), id: mid, ...(ctx > 0 ? { contextWindow: Math.round(ctx) } : {}) })),
    };
    if (!next.providers[id].apiKey) delete next.providers[id].apiKey;
    saving = true;
    const r = await piHost.saveModels(next);
    saving = false;
    if (!r.ok) { app.toast(r.error); return; }
    config = r.value; form = null;
    app.toast(`端点「${id}」已保存`);
    if (agent.connected) agent.reconnect();
  }
  async function remove(id: string) {
    if (!config || !await app.confirm('删除端点', `删除自定义端点「${id}」？\n它下面的模型会从列表里消失。`, '删除')) return;
    const next = $state.snapshot(config) as PiModelsConfig;
    delete next.providers[id];
    const r = await piHost.saveModels(next);
    if (!r.ok) { app.toast(r.error); return; }
    config = r.value;
    if (agent.connected) agent.reconnect();
  }
</script>

<h3>自定义端点{#if phase === 'missing'}<span class="soon">即将支持</span>{/if}</h3>
<p class="lead">支持 OpenAI 兼容接口，如 LM Studio、Ollama。</p>
{#if phase === 'loading'}<p class="hint"><LoaderCircle size={12} class="spin" /> 读取中…</p>
{:else if phase === 'error'}<p class="hint">{error} <button class="link" onclick={() => void load()}>重试</button></p>
{:else if phase === 'ready'}
  {#if entries.length}
    <div class="card list">
      {#each entries as [id, p] (id)}
        <div class="line">
          <div class="lt"><b>{id}</b><span class="sub mono">{p.baseUrl ?? '—'}</span><span class="sub">{(p.models ?? []).map((m) => m.id).join('、') || '未填模型'}</span></div>
          <div class="row"><button class="btn ghost" onclick={() => void remove(id)}>删除</button><button class="btn" onclick={() => edit(id)}>编辑</button></div>
        </div>
      {/each}
    </div>
  {/if}
  {#if form}
    <form class="card form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <label><span>名称</span><input class="mono" bind:value={form.id} placeholder="local" spellcheck="false" /></label>
      <label><span>Base URL</span><input class="mono" bind:value={form.baseUrl} placeholder="http://localhost:1234/v1" spellcheck="false" /></label>
      <label><span>接口类型</span><select bind:value={form.api}>{#each APIS as [v, l] (v)}<option value={v}>{l}</option>{/each}</select></label>
      <label><span>API Key</span><input class="mono" type="password" autocomplete="off" bind:value={form.apiKey} placeholder={form.hasKey ? '已保存，留空不改' : '本地模型可留空'} /></label>
      <label class="wide"><span>模型 ID</span><textarea class="mono" bind:value={form.models} placeholder={'每行一个，例如\nqwen3-32b'} spellcheck="false"></textarea></label>
      <label><span>上下文长度</span><input class="mono" bind:value={form.context} placeholder="可选，例如 32768" /></label>
      <div class="acts"><button type="button" class="btn ghost" onclick={() => (form = null)}>取消</button><button class="btn primary" disabled={saving}>{saving ? '保存中…' : '保存端点'}</button></div>
    </form>
  {:else}
    <button class="btn add" onclick={() => edit()}><Plus size={13} />添加端点</button>
  {/if}
{/if}

<style>
  .add { margin-top: 2px; }
  .card + .add, .card + .form { margin-top: 12px; }
  .form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; padding: 16px 18px; animation: rise 180ms var(--ease-out); }
  .form label { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .form label span { font-size: 12px; color: var(--fg-3); }
  .form input, .form select { height: 32px; font-size: 12.5px; }
  @media (prefers-reduced-motion: reduce) { .form { animation: none; } }
  .form .wide { grid-row: span 2; }
  .form textarea { flex: 1; min-height: 70px; resize: vertical; font-size: 12px; line-height: 1.6; }
  .acts { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 6px; }
</style>
