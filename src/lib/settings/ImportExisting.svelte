<script lang="ts">
  // 玩家已有的参数（Steam 库里的启动选项、autoexec.cfg 里自己写的设置）还没进 Matcha 时，在启动项上方提示导入。
  // 后端：game-settings-import-preview / -apply（backend/game-settings-import.mjs），茶茶的 game_settings_import 用同一份。
  import { onMount } from 'svelte';
  import Import from '@lucide/svelte/icons/import';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { call, errorText } from '../api/bridge';
  import { app } from '../stores/app.svelte';
  import { gameSettings } from '../stores/game-settings.svelte';
  import { sfx } from '../sound/sfx.svelte';

  interface Change { field: string; label: string; beforeText: string; afterText: string }
  interface Candidate { accountId: string; text: string; recent?: boolean }
  interface Preview {
    planId: string | null;
    status?: 'nothing';
    launch: { candidates: Candidate[]; accountId: string | null; text: string; changes?: Change[]; added?: string[]; skipped?: { text: string; reason: string }[] } | null;
    cfg: { path: string; lines?: number; kept?: string[]; draftLines?: number; text?: string; hash?: string; backup?: string; reason?: string } | null;
    effective?: { after: { modded: string[] } };
  }

  const KEY = 'matcha.import.dismissed';
  let plan = $state<Preview | null>(null);
  let open = $state(false), busy = $state(false), useLaunch = $state(true), useCfg = $state(true);
  let account = $state<string | null>(null);

  const launchCount = $derived(plan?.launch?.changes?.length ?? 0);
  const cfgLines = $derived(plan?.cfg?.lines ?? 0);
  const filled = $derived(plan?.launch?.candidates.filter(c => c.text) ?? []);
  const signature = $derived(plan ? `${plan.launch?.text ?? ''}|${plan.cfg?.hash ?? ''}` : '');
  let dismissed = $state(readDismissed());
  const shown = $derived(!!plan && plan.status !== 'nothing' && (launchCount > 0 || cfgLines > 0) && dismissed !== signature);

  function readDismissed() { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } }
  function dismiss() {
    dismissed = signature;
    try { localStorage.setItem(KEY, signature); } catch { /* 本次会话有效 */ }
  }

  async function load(params: Record<string, unknown> = {}) {
    try {
      const next = await call<Preview>('game-settings-import-preview', params);
      plan = next;
      account = next.launch?.accountId ?? null;
    } catch (e) {
      // 旧版服务没有这个命令：不提示
      if (!['unknown_command', 'unsupported_capability', 'COMMAND_SCOPE'].includes((e as { code?: string })?.code ?? '')) console.warn('导入预览失败', e);
      plan = null;
    }
  }
  onMount(() => { void load(); });

  async function pickAccount(id: string) {
    account = id;
    await load({ accountId: id });
  }

  async function apply() {
    if (busy || (!useLaunch && !useCfg)) return;
    busy = true;
    try {
      // 按当前勾选重新预览一次，拿到新的计划再应用
      const fresh = await call<Preview>('game-settings-import-preview', { ...(account ? { accountId: account } : {}), launch: useLaunch, cfg: useCfg });
      if (!fresh.planId) { app.toast('没有需要导入的内容了'); await load(); return; }
      const result = await call<{ applied: boolean; backup?: string }>('game-settings-import-apply', { planId: fresh.planId });
      sfx.play('done');
      const parts = [useLaunch && fresh.launch?.changes?.length ? '启动项' : '', useCfg && fresh.cfg?.lines ? `CFG ${fresh.cfg.lines} 行` : ''].filter(Boolean);
      app.toast(`已导入${parts.join('和')}${result.backup ? '，原 autoexec.cfg 已备份' : ''}`);
      open = false;
      await gameSettings.load();
      await load();
    } catch (e) {
      app.toast(errorText(e));
      await load();
    } finally { busy = false; }
  }
</script>

{#if shown && plan}
  <div class="card import" role="region" aria-label="导入已有参数">
    <div class="line">
      <div class="lt">
        <b><Import size={15} />待导入的游戏参数</b>
        <span class="sub">
          {[launchCount ? `Steam 启动选项 ${launchCount} 项` : '', cfgLines ? `autoexec.cfg ${cfgLines} 行设置` : ''].filter(Boolean).join(' · ')}{#if launchCount} · Matcha 尚未使用这些 Steam 启动项{/if}
        </span>
      </div>
      <div class="row">
        <button class="btn ghost" onclick={dismiss}>暂不</button>
        <button class="btn" aria-expanded={open} onclick={() => (open = !open)}><ChevronRight size={14} class={open ? 'chev on' : 'chev'} />查看</button>
      </div>
    </div>
    {#if open}
      <div class="detail">
        {#if launchCount && plan.launch}
          <label class="part">
            <input type="checkbox" bind:checked={useLaunch} />
            <span><b>启动项</b>：复制 Steam 账号 {plan.launch.accountId} 的启动选项，Steam 里的保持不动</span>
          </label>
          {#if filled.length > 1}
            <div class="accounts" role="radiogroup" aria-label="选择 Steam 账号">
              {#each filled as c (c.accountId)}
                <button role="radio" aria-checked={account === c.accountId} class:on={account === c.accountId} onclick={() => void pickAccount(c.accountId)}>
                  {c.accountId}{c.recent ? '（最近登录）' : ''}
                </button>
              {/each}
            </div>
          {/if}
          <code class="mono src">{plan.launch.text}</code>
          <ul class="changes">
            {#each plan.launch.changes ?? [] as c (c.field)}
              <li><span>{c.label}</span><s>{c.beforeText}</s><span class="to">{c.afterText}</span></li>
            {/each}
          </ul>
          {#each plan.launch.skipped ?? [] as s (s.text)}<p class="sub warn">不导入 <code class="mono">{s.text}</code>：{s.reason}</p>{/each}
        {/if}
        {#if cfgLines && plan.cfg}
          <label class="part">
            <input type="checkbox" bind:checked={useCfg} />
            <span><b>CFG</b>：autoexec.cfg 里 {cfgLines} 行设置搬进 Matcha 管理段，之后在下面「游戏配置」里改{plan.cfg.draftLines ? `；Matcha 里还没写进游戏的 ${plan.cfg.draftLines} 行草稿接在最后` : ''}</span>
          </label>
          <p class="sub">原文件先整份备份到 <span class="path">{plan.cfg.backup}</span></p>
          {#if plan.cfg.kept?.length}<p class="sub warn">{plan.cfg.kept.length} 行引号不成对，留在原位置：<code class="mono">{plan.cfg.kept.join(' / ')}</code></p>{/if}
          <details class="cfg">
            <summary>接管后的管理段</summary>
            <pre class="mono">{plan.cfg.text}</pre>
          </details>
        {/if}
        <div class="row end">
          <button class="btn primary" disabled={busy || (!useLaunch && !useCfg)} onclick={apply}>
            {#if busy}<LoaderCircle size={14} class="spin" />{/if}导入到 Matcha
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .import { margin-bottom: 14px; border-color: color-mix(in srgb, var(--md-primary) 40%, var(--line)); background: color-mix(in srgb, var(--md-primary-container) 22%, var(--bg-1)); }
  .import .lt b :global(svg) { color: var(--md-primary); }
  .import :global(.chev) { transition: transform var(--dur); }
  .import :global(.chev.on) { transform: rotate(90deg); }
  .detail { display: grid; gap: 8px; padding: 4px 18px 16px; border-top: 1px solid var(--line-soft); }
  .part { display: flex; align-items: flex-start; gap: 9px; margin-top: 10px; font-size: 12.5px; line-height: 1.6; color: var(--fg-2); cursor: pointer; }
  .part input { margin-top: 3px; accent-color: var(--md-primary); }
  .part b { color: var(--fg); font-weight: 600; }
  .src, pre { display: block; margin: 0; padding: 8px 12px; border-radius: 10px; background: color-mix(in srgb, var(--md-on-surface) 5%, transparent); color: var(--fg-2); font-size: 11.5px; line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; user-select: text; }
  pre { max-height: 220px; overflow: auto; }
  .changes { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; font-size: 12px; }
  .changes li { display: flex; align-items: baseline; gap: 8px; color: var(--fg-3); }
  .changes li span:first-child { min-width: 7em; color: var(--fg-2); }
  .changes s { color: var(--fg-3); }
  .changes .to { color: var(--fg); font-family: var(--font-mono); overflow-wrap: anywhere; }
  .warn { color: var(--warn, var(--fg-3)); }
  .accounts { display: flex; flex-wrap: wrap; gap: 6px; }
  .accounts button { height: 26px; padding: 0 10px; border-radius: 8px; font-size: 12px; color: var(--fg-2); background: color-mix(in srgb, var(--md-on-surface) 6%, transparent); }
  .accounts button.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); font-weight: 600; }
  .cfg summary { cursor: pointer; font-size: 12px; color: var(--fg-2); margin-bottom: 6px; }
  .row.end { justify-content: flex-end; margin-top: 4px; }
</style>
