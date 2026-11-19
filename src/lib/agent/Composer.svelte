<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Square from '@lucide/svelte/icons/square';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Check from '@lucide/svelte/icons/check';
  import Brain from '@lucide/svelte/icons/brain';
  import X from '@lucide/svelte/icons/x';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import { desktop, errorText, onFileDrop } from '../api/bridge';
  import { readAttachment, attachmentDraft as draft, attachmentMessage, clipboardFiles } from './attachments.svelte';
  import Settings from '@lucide/svelte/icons/settings-2';
  import { agent } from './index';
  import { THINKING_LABEL } from './chat.svelte';
  import type { PiImage, PiModel, ThinkingLevel } from './pi-protocol';
  import { app } from '../stores/app.svelte';
  import { prefs } from '../stores/prefs.svelte';
  import { openSettings } from '../stores/nav.svelte';
  import { sfx } from '../sound/sfx.svelte';

  let input = $state('');
  let area = $state<HTMLTextAreaElement>();
  let pop = $state<'' | 'model' | 'think' | 'usage'>('');
  const files = $derived(draft.files);
  let slashIndex = $state(0);
  let dragging = $state(false);

  const ready = $derived(agent.connected && agent.modelReady);
  const canImage = $derived(!!agent.current?.input?.includes('image'));
  const levels = $derived<ThinkingLevel[]>(agent.thinkingLevels.length ? agent.thinkingLevels : ['off', 'minimal', 'low', 'medium', 'high']);
  const thinkOk = $derived(agent.caps.thinking && agent.current?.reasoning !== false);
  // 其他页面交来的指令（如 DLL 页「交给 Agent 整理」）先放进输入框，模型就绪后由用户发送
  $effect(() => {
    const text = agent.draft;
    if (!text) return;
    input = input.trim() ? `${input}\n\n${text}` : text; agent.draft = '';
    queueMicrotask(() => { fit(); area?.focus(); });
  });
  onDestroy(() => {
    if (input.trim()) agent.draft = agent.draft && agent.draft !== input ? `${input}\n\n${agent.draft}` : input;
  });
  const usage = $derived(agent.stats?.contextUsage);
  const pct = $derived(usage?.percent ?? null);
  const groups = $derived.by(() => {
    const map = new Map<string, PiModel[]>();
    for (const m of agent.models) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    return [...map.entries()];
  });

  // ---------- 斜杠命令 ----------
  const COMMANDS = [
    { name: 'new', label: '新对话', run: () => agent.reset() },
    { name: 'compact', label: '压缩上下文，释放空间', run: () => void agent.compact() },
    { name: 'model', label: '切换模型', run: () => (pop = 'model') },
    { name: 'think', label: '调整思考强度', run: () => (pop = 'think') },
    { name: 'retry', label: '重新发送上一条', run: () => agent.retry() },
    { name: 'settings', label: '打开茶茶设置', run: () => openSettings('assistant') },
  ];
  const slash = $derived(!files.length && /^\/\S*$/.test(input) ? COMMANDS.filter(c => c.name.startsWith(input.slice(1).toLowerCase())) : []);
  $effect(() => { void slash.length; slashIndex = 0; });
  function runSlash(i = slashIndex) { const c = slash[i]; if (!c) return; input = ''; c.run(); fit(); }

  function submit() {
    if (slash.length && input.startsWith('/')) { runSlash(); return; }
    if (!ready || draft.loading || (!input.trim() && !files.length)) return;
    if (!canImage && files.some(f => f.image)) { app.toast('请切换到支持图片的模型，或移除图片'); return; }
    if (agent.send(attachmentMessage(input, files), files.flatMap(f => f.image ? [f.image] : []))) {
      sfx.play('send');
      input = ''; draft.files = []; fit();
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (slash.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); slashIndex = (slashIndex + 1) % slash.length; return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); slashIndex = (slashIndex - 1 + slash.length) % slash.length; return; }
      if (e.key === 'Tab') { e.preventDefault(); input = `/${slash[slashIndex].name}`; return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (prefs.enterSends && !e.shiftKey))) { e.preventDefault(); submit(); return; }
    if (e.key === 'Escape') { if (pop) pop = ''; else if (agent.running) agent.abort(); return; }
    // 空输入框按 ↑ 取回上一条
    if (e.key === 'ArrowUp' && !input && agent.lastPrompt) { e.preventDefault(); input = agent.lastPrompt; queueMicrotask(fit); }
  }
  function fit() {
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = Math.min(area.scrollHeight, 180) + 'px';
  }

  async function addFiles(sources: Iterable<File | string>) {
    draft.loading++;
    try {
      for (const source of sources) {
        try {
          const f = await readAttachment(source);
          if (draft.files.length >= 12) { app.toast('一次最多 12 个附件'); break; }
          if (f.image && draft.files.filter(i => i.image).length >= 4) { app.toast('一次最多 4 张图片'); continue; }
          draft.files = [...draft.files, f];
        } catch (err) { app.toast(errorText(err)); }
      }
    } finally { draft.loading--; }
  }
  function onPaste(e: ClipboardEvent) {
    const dt = e.clipboardData;
    const pasted = dt ? [...dt.files] : [];
    // 普通文字照常粘贴；桌面版剪贴板里没有文字时，可能是资源管理器复制的文件
    if (!pasted.length && (!desktop || dt?.types.includes('text/plain'))) return;
    e.preventDefault();
    void pasteFiles(pasted);
  }
  async function pasteFiles(pasted: File[]) {
    if (desktop) {
      try {
        const { paths, folders } = await clipboardFiles();
        if (folders) app.toast(`跳过了 ${folders} 个文件夹：请打包成 zip，或复制里面的文件`);
        if (paths.length) { await addFiles(paths); area?.focus(); return; }
        if (folders) return;
      } catch (err) { app.toast(errorText(err)); return; }
    }
    if (pasted.length) { await addFiles(pasted); area?.focus(); }
  }
  async function pick() {
    if (desktop) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const paths = await open({ multiple: true, title: '添加到茶茶对话' });
        if (paths) await addFiles(paths);
      } catch (err) { app.toast(errorText(err)); }
      return;
    }
    const el = document.createElement('input'); el.type = 'file'; el.multiple = true;
    el.onchange = () => void addFiles([...(el.files ?? [])]); el.click();
  }
  onMount(() => {
    const panel = area?.closest('aside.panel');
    if (!panel) return;
    let active = true;
    const off = onFileDrop(e => {
      if (!active) return;
      dragging = e.type === 'over' || e.type === 'enter';
      if (e.type === 'drop') void addFiles(e.paths);
    }, () => panel);
    const drag = (e: Event) => { const d = e as DragEvent; if (desktop || !d.dataTransfer?.types.includes('Files')) return;
      d.preventDefault(); dragging = d.type === 'dragover'; if (d.type === 'drop') void addFiles([...d.dataTransfer.files]); };
    panel.addEventListener('dragover', drag); panel.addEventListener('drop', drag);
    const leave = (e: Event) => { if (!panel.contains((e as DragEvent).relatedTarget as Node | null)) dragging = false; };
    panel.addEventListener('dragleave', leave);
    // 点过对话区（焦点落在 body 上）再按 Ctrl+V 也算粘贴给茶茶；别的输入框不管
    let lastInPanel = false;
    const down = (e: PointerEvent) => { lastInPanel = panel.contains(e.target as Node); };
    const paste = (e: ClipboardEvent) => {
      const t = e.target as Element | null;
      const field = t?.closest?.('input, textarea, select, [contenteditable]');
      if (field ? field !== area : !(panel.contains(t) || (lastInPanel && panel.checkVisibility()))) return;
      onPaste(e);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('paste', paste);
    return () => { active = false; void off.then(fn => fn()); panel.removeEventListener('dragover', drag); panel.removeEventListener('drop', drag); panel.removeEventListener('dragleave', leave);
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('paste', paste); };
  });

  const fmtK = (n?: number | null) => n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`;
  const R = 7, C = 2 * Math.PI * R;
</script>

<svelte:window onclick={() => (pop = '')} />

<div class="dock" hidden={!ready && !input.trim() && !files.length && !agent.messages.length && !agent.running && !agent.compacting}>
  {#if agent.queue.steering.length || agent.queue.followUp.length}
    <div class="queue">
      {#each agent.queue.steering as q, i (`s${i}`)}<div class="q"><span class="tag">插话</span><span class="qt">{q}</span></div>{/each}
      {#each agent.queue.followUp as q, i (`f${i}`)}<div class="q"><span class="tag">排队</span><span class="qt">{q}</span></div>{/each}
      <button class="qclear" onclick={() => agent.clearQueue()}>清空</button>
    </div>
  {/if}
  {#if agent.retrying}
    <div class="banner">请求失败，第 {agent.retrying.attempt}/{agent.retrying.max} 次重试中{agent.retrying.error ? ` · ${agent.retrying.error}` : ''}</div>
  {:else if agent.compacting}
    <div class="banner"><span class="shimmer">正在压缩上下文…</span></div>
  {/if}

  {#if slash.length}
    <div class="slash" role="listbox" aria-label="命令">
      {#each slash as c, i (c.name)}
        <button role="option" aria-selected={i === slashIndex} class:on={i === slashIndex} onmouseenter={() => (slashIndex = i)} onclick={(e) => { e.stopPropagation(); runSlash(i); }}>
          <span class="mono">/{c.name}</span><span>{c.label}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="composer" class:off={!ready} class:drag={dragging}
       role="group" aria-label="输入框">
    {#if dragging}<small>松开即可添加附件</small>{/if}
    {#if files.length}
      <div class="attachments">
        {#each files as f, i}
          <span class="attachment" title={f.path ?? f.name}>
            {#if f.image}<img src={'data:' + f.image.mimeType + ';base64,' + f.image.data} alt="" />{:else}<Paperclip size={13}/>{/if}
            <span>{f.name}<small>{f.image ? '图片' : f.text !== undefined ? '文本' : '本机路径'}</small></span>
            <button aria-label={'移除 ' + f.name} onclick={() => draft.files = files.filter((_, j) => j !== i)}><X size={12}/></button>
          </span>
        {/each}
      </div>
    {/if}
    <textarea id="agent-input" rows="1" bind:this={area} bind:value={input} disabled={!ready}
              placeholder={!agent.connected ? (agent.connectionError && !agent.connecting ? '连接失败，请重试' : '正在连接茶茶…') : !agent.modelReady ? '先在设置里选好模型' : agent.running ? (prefs.busySend === 'steer' ? '补充一句，会插进当前任务…' : '继续输入，这轮结束后发送…') : '让茶茶帮你做点什么… 输入 / 查看命令'}
              onkeydown={onKey} oninput={fit}></textarea>
    <div class="bar">
      <div class="pick">
        <button class="chip-btn" disabled={!agent.connected || agent.running || agent.switching} title="切换模型" onclick={(e) => { e.stopPropagation(); pop = pop === 'model' ? '' : 'model'; }}>
          <span class="mname">{agent.model}</span><ChevronDown size={12} />
        </button>
        {#if pop === 'model'}
          <div class="pop models" role="dialog" aria-label="选择模型" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
            {#each groups as [provider, list] (provider)}
              <div class="ph">{provider}</div>
              {#each list as m (`${m.provider}/${m.id}`)}
                {@const on = agent.modelKey === `${m.provider}/${m.id}`}
                <button class="opt" class:on onclick={() => { pop = ''; void agent.selectModel(`${m.provider}/${m.id}`); }}>
                  <span class="ck">{#if on}<Check size={12} />{/if}</span>
                  <span class="on-name">{m.name ?? m.id}</span>
                  <span class="caps">{#if m.reasoning}<i title="支持思考">思考</i>{/if}{#if m.input?.includes('image')}<i title="支持图片">图片</i>{/if}{#if m.contextWindow}<i class="mono">{fmtK(m.contextWindow)}</i>{/if}</span>
                </button>
              {/each}
            {:else}<p class="none">还没有可用模型。去设置里添加服务商密钥。</p>{/each}
            <button class="foot" onclick={() => { pop = ''; openSettings('keys'); }}><Settings size={12} />管理模型与账号</button>
          </div>
        {/if}
      </div>

      <div class="pick">
        <button class="chip-btn" disabled={!thinkOk || agent.running || agent.switching} title={!agent.caps.thinking ? '思考强度：后端还没放行 set_thinking_level' : agent.current?.reasoning === false ? '当前模型不支持思考' : '思考强度'} onclick={(e) => { e.stopPropagation(); pop = pop === 'think' ? '' : 'think'; }}>
          <Brain size={12} /><span>{THINKING_LABEL[agent.thinkingLevel] ?? agent.thinkingLevel}</span>
        </button>
        {#if pop === 'think'}
          <div class="pop levels" role="dialog" aria-label="思考强度" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
            {#each levels as l (l)}
              <button class="opt" class:on={agent.thinkingLevel === l} onclick={() => { pop = ''; void agent.setThinking(l); }}>
                <span class="ck">{#if agent.thinkingLevel === l}<Check size={12} />{/if}</span><span>{THINKING_LABEL[l]}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button class="tool" title="添加文件或图片，也可以拖进来或 Ctrl+V 粘贴" aria-label="添加附件" disabled={!ready} onclick={pick}><Paperclip size={14} /></button>
      <span class="grow"></span>

      <!-- 新对话还没用掉上下文时不显示空圆环（像个没勾的单选框） -->
      {#if prefs.showUsage && pct !== null && usage && (usage.tokens ?? 0) > 0}
        <div class="pick">
          <button class="ring" class:hot={pct >= 80} title={`上下文 ${fmtK(usage.tokens)} / ${fmtK(usage.contextWindow)}`} aria-label="上下文用量" onclick={(e) => { e.stopPropagation(); pop = pop === 'usage' ? '' : 'usage'; }}>
            <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r={R} class="tr" /><circle cx="9" cy="9" r={R} class="fl" stroke-dasharray={C} stroke-dashoffset={C * (1 - Math.min(100, pct) / 100)} /></svg>
          </button>
          {#if pop === 'usage'}
            <div class="pop usage" role="dialog" aria-label="用量" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
              <div class="ur"><span>上下文</span><b class="mono">{fmtK(usage.tokens)} / {fmtK(usage.contextWindow)} · {pct}%</b></div>
              {#if agent.stats?.tokens}<div class="ur"><span>本会话 tokens</span><b class="mono">{fmtK(agent.stats.tokens.total)}</b></div>{/if}
              {#if agent.stats?.cost !== undefined}<div class="ur"><span>费用</span><b class="mono">${agent.stats.cost.toFixed(3)}</b></div>{/if}
              <button class="btn sm" disabled={agent.running || agent.compacting || !agent.caps.compact} title={agent.caps.compact ? '' : '后端还没放行 compact'} onclick={() => { pop = ''; void agent.compact(); }}>压缩上下文</button>
            </div>
          {/if}
        </div>
      {/if}

      {#if agent.running}
        <button class="send stop" title="停止（Esc）" aria-label="停止" data-sfx="deny" onclick={() => agent.abort()}><Square size={11} fill="currentColor" /></button>
      {/if}
      {#if !agent.running || input.trim() || files.length}
        <button class="send" title={agent.running ? (prefs.busySend === 'steer' ? '插话' : '排队发送') : '发送（Enter）'} aria-label="发送" data-sfx="none" disabled={!ready || !!draft.loading || (!input.trim() && !files.length)} onclick={submit}><ArrowUp size={14} /></button>
      {/if}
    </div>
  </div>
</div>

<style>
  .dock { position: relative; flex: none; width: min(100%, 64ch); margin-inline: auto; padding: 0 14px 14px; }
  .dock[hidden] { display: none; }
  .queue { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; padding: 6px 8px; border: 1px dashed var(--line-strong); border-radius: var(--r); font-size: 12px; animation: rise 180ms var(--ease-out); }
  .q { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--fg-2); }
  .tag { flex: none; font-size: 10px; padding: 0 4px; border: 1px solid var(--line-strong); border-radius: 3px; color: var(--fg-3); }
  .qt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qclear { align-self: flex-end; font-size: 11px; color: var(--fg-3); }
  .qclear:hover { color: var(--fg); }
  .banner { margin-bottom: 6px; font-size: 12px; color: var(--fg-3); padding: 0 2px; }
  .shimmer { background: linear-gradient(90deg, var(--fg-3) 40%, var(--fg) 50%, var(--fg-3) 60%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: sweep-text 1.6s linear infinite; }
  @keyframes sweep-text { from { background-position: 100% 0; } to { background-position: -150% 0; } }

  .slash { position: absolute; left: 10px; right: 10px; bottom: calc(100% - 4px); z-index: 5; padding: 4px; background: var(--bg-1); border: 1px solid var(--line-strong); border-radius: var(--r); animation: rise 140ms var(--ease-out); }
  .slash button { display: flex; align-items: center; gap: 10px; width: 100%; height: 30px; padding: 0 8px; border-radius: var(--r-sm); font-size: 12px; color: var(--fg-2); text-align: left; }
  .slash button.on { background: var(--bg-3); color: var(--fg); }
  .slash .mono { width: 72px; color: var(--fg); }

  /* 输入框：浮起的卡片，聚焦时描边和外圈换成主色 */
  .composer { display: flex; flex-direction: column; gap: 6px; padding: 12px 9px 8px 14px; background: var(--card-hover, var(--md-surface-container-lowest)); border: 1px solid var(--island-line); border-radius: 18px;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--md-shadow) 6%, transparent), 0 14px 32px -20px color-mix(in srgb, var(--md-shadow) 45%, transparent);
    transition: border-color var(--dur), box-shadow 220ms var(--ease-out); }
  .composer:focus-within { border-color: color-mix(in srgb, var(--md-primary) 55%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-primary) 14%, transparent), 0 14px 32px -20px color-mix(in srgb, var(--md-primary) 55%, transparent); }
  .composer.drag { border-color: var(--md-primary); border-style: dashed; }
  .composer.off { opacity: .7; }
  textarea { width: 100%; min-height: 22px; max-height: 180px; resize: none; border: 0; background: none; padding: 2px 0; line-height: 1.55; font-size: 13px; }
  textarea:disabled { cursor: default; }
  .attachments { display:flex; flex-wrap:wrap; gap:5px; max-height:130px; overflow:auto; }
  .attachment { display:inline-flex; align-items:center; gap:6px; max-width:100%; padding:4px 7px; background:var(--md-secondary-container); border-radius:8px; font-size:12px; }
  .attachment img { width:30px; height:30px; border-radius:4px; object-fit:cover; }
  .attachment span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .attachment small { display:block; color:var(--fg-3); font-size:10px; }
  .attachment button { flex:none; padding:4px; }
  .bar { display: flex; align-items: center; gap: 2px; margin-left: -4px; }
  .grow { flex: 1; }
  .pick { position: relative; min-width: 0; }
  .chip-btn { display: inline-flex; align-items: center; gap: 4px; max-width: 150px; height: 24px; padding: 0 6px; border-radius: var(--r-sm); font-size: 12px; color: var(--fg-3); transition: background var(--dur), color var(--dur); }
  .chip-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--fg); }
  .chip-btn:disabled { opacity: .45; cursor: default; }
  .mname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool { display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--r-sm); color: var(--fg-3); }
  .tool:hover { background: var(--bg-3); color: var(--fg); }

  .pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 6; min-width: 200px; max-height: 340px; overflow-y: auto; padding: 4px; background: var(--bg-1); border: 1px solid var(--line-strong); border-radius: 8px; box-shadow: 0 12px 32px #000a; transform-origin: bottom left; animation: pop-in 160ms var(--ease-out); }
  @keyframes pop-in { from { opacity: 0; transform: translateY(4px) scale(0.97); } }
  .pop.models { width: 300px; }
  .pop.usage { left: auto; right: 0; transform-origin: bottom right; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; min-width: 220px; }
  .ph { padding: 6px 8px 2px; font-size: 11px; color: var(--fg-4); }
  .opt { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 30px; padding: 0 8px 0 4px; border-radius: var(--r-sm); font-size: 12px; color: var(--fg-2); text-align: left; }
  .opt:hover { background: var(--bg-3); color: var(--fg); }
  .opt.on { color: var(--fg); }
  .ck { display: grid; place-items: center; width: 16px; flex: none; }
  .on-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .caps { display: flex; gap: 4px; flex: none; }
  .caps i { font-style: normal; font-size: 10px; color: var(--fg-4); }
  .none { margin: 8px; font-size: 12px; color: var(--fg-3); }
  .foot { display: flex; align-items: center; gap: 6px; width: 100%; height: 30px; margin-top: 4px; padding: 0 8px; border-top: 1px solid var(--line); font-size: 12px; color: var(--fg-3); }
  .foot:hover { color: var(--fg); }
  .ur { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--fg-3); }
  .ur b { font-weight: 400; color: var(--fg); }

  .ring { display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--r-sm); }
  .ring:hover { background: var(--bg-3); }
  .ring svg { width: 16px; height: 16px; transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 2; }
  .ring .tr { stroke: var(--line-strong); }
  .ring .fl { stroke: var(--fg-2); transition: stroke-dashoffset 400ms var(--ease-out); }
  .ring.hot .fl { stroke: var(--danger); }

  /* 发送：有内容时亮成主色，空着时是安静的色块，而不是半透明的黑圆 */
  .send { display: grid; place-items: center; width: 28px; height: 28px; margin-left: 4px; flex: none; border-radius: 50%; background: var(--md-primary); color: var(--md-on-primary);
    box-shadow: 0 6px 14px -8px color-mix(in srgb, var(--md-primary) 90%, transparent);
    transition: background var(--dur), color var(--dur), box-shadow var(--dur), transform 160ms var(--ease-out); }
  .send:not(.stop):hover:not(:disabled) { background: var(--accent-hover); }
  .send:active:not(:disabled) { transform: scale(0.92); }
  .send:disabled { background: var(--md-surface-container-highest); color: var(--fg-4); box-shadow: none; cursor: default; }
  .send.stop { background: var(--bg-3); color: var(--fg); border: 1px solid var(--line-strong); box-shadow: none; }
  .send.stop:hover { background: var(--md-surface-container-high); }
  @media (prefers-reduced-motion: reduce) { .pop, .slash, .queue { animation: none; } .shimmer { animation: none; color: var(--fg-2); background: none; } }
</style>
