<script lang="ts">
  // DLL 详情右栏的「安全检查」：四档徽标、一句话结论、发现清单、检查范围。
  // 静态检查证明不了一定安全，所以只说「未发现问题」，并写清规则版本和日期。
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { app } from '../stores/app.svelte';
  import { askAgent } from '../plugins/intake';
  import { CATEGORY_TEXT, SEVERITY_TEXT, screeningLine, screeningPrompt, screeningScope, sortedFindings, trustTier } from '../plugins/safety';
  import TrustBadge from './TrustBadge.svelte';
  import type { PlatformPlugin } from '../types';
  let { p, signature }: { p: PlatformPlugin; signature: string } = $props();
  const s = $derived(p.screening);
  const findings = $derived(s ? sortedFindings(s) : []);
  const lock = $derived(app.busy ? `正在${app.busy}` : '');
  function explain() {
    if (!s) return;
    app.toast(askAgent(screeningPrompt(p, s)) === 'sent' ? '已交给茶茶，进度在右侧对话里' : '茶茶还没准备好，指令先放进对话框了');
  }
</script>

<div class="card safety" aria-label="安全检查">
  <div class="head"><span>安全检查</span><TrustBadge level={trustTier(p)} size="sm"/></div>
  {#if s}
    <p class="line" class:bad={s.tier === 'blocked'}>{screeningLine(s)}</p>
    {#if findings.length}
      <ul class="findings">
        {#each findings as f, i (i)}
          <li class={f.severity}>
            <span class="sev">{SEVERITY_TEXT[f.severity]}</span>
            <div><strong>{f.title}</strong><small>{CATEGORY_TEXT[f.category]}{f.detail ? ` · ${f.detail}` : ''}{f.file ? ` · ${f.file}` : ''}</small></div>
          </li>
        {/each}
      </ul>
    {/if}
    {#if s.reputation}<p class="note">指纹信誉（{s.reputation.provider}）：{s.reputation.malicious ? `${s.reputation.total} 家里有 ${s.reputation.malicious} 家报毒` : `${s.reputation.total} 家都没报`}</p>{/if}
    <p class="note">{signature} · {screeningScope(s)}</p>
    <div class="acts">
      <button class="btn sm" onclick={explain}><Sparkles size={12}/>让茶茶解释</button>
      <button class="btn sm ghost" disabled={!!lock} title={lock || '按最新规则再查一遍'} onclick={() => app.screenPlugin(p.id)}><RefreshCw size={12}/>重新检查</button>
    </div>
  {:else}
    <p class="note">{signature}。这个 DLL 还没做危险筛查：会看它调用了哪些系统功能、里面有没有盗号之类的特征，不运行它。</p>
    <div class="acts"><button class="btn sm" disabled={!!lock} title={lock || undefined} onclick={() => app.screenPlugin(p.id)}>现在检查</button></div>
  {/if}
</div>

<style>
  .card { display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg-1); }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; color: var(--fg-3); }
  .line { margin: 0; font-size: 13px; color: var(--fg); line-height: 1.5; }
  .line.bad { color: var(--danger); }
  .findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .findings li { display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line-soft); font-size: 12px; }
  .findings li:first-child { border-top: 0; padding-top: 0; }
  .findings div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .findings strong { font-weight: 500; color: var(--fg); overflow-wrap: anywhere; }
  .findings small { color: var(--fg-3); overflow-wrap: anywhere; line-height: 1.5; }
  .sev { flex: none; height: 18px; padding: 0 6px; border: 1px solid var(--line-strong); border-radius: 9px; font-size: 11px; line-height: 16px; color: var(--fg-2); }
  .block .sev { border-color: var(--danger); color: var(--danger); }
  .info .sev { color: var(--fg-3); }
  .note { margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-3); }
  .acts { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
