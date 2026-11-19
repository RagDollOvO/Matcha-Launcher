<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Activity from '@lucide/svelte/icons/activity';
  import FileCode from '@lucide/svelte/icons/file-code';
  import Pipette from '@lucide/svelte/icons/pipette';
  import SavedGameSettings from './SavedGameSettings.svelte';
  import Toggle from '../components/Toggle.svelte';
  import { app } from '../stores/app.svelte';
  import { gameSettings as g } from '../stores/game-settings.svelte';
  import { applySnippet, snippetGroups, snippetRows } from './cfg-snippets';

  let { saveState }: { saveState: Snippet } = $props();
  const tabs = [{ name: '画面', id: 'visual', icon: Monitor }, { name: '网络', id: 'network', icon: Activity }, { name: 'CFG 原文', id: 'source', icon: FileCode }] as const;
  type Tab = typeof tabs[number]['id'];
  let active = $state<Tab>('visual'), visualTitle = $state('队友轮廓'), feedback = $state('');
  const cfg = $derived(g.value.autoexec);
  const commands = $derived(g.cfgText());
  const visuals = snippetGroups.find(group => group.label === '画面')!.items;
  const graph = snippetGroups.find(group => group.label === '网络')!.items[0];
  const snippet = $derived(active === 'network' ? graph : visuals.find(item => item.title === visualTitle) ?? visuals[0]);
  const rows = $derived(snippetRows(commands, snippet));
  const used = $derived(rows.filter(row => row.present).length);

  // ---------- 颜色：轮廓 cvar 是 0–1，准星是 0–255 ----------
  const tint = $derived.by(() => {
    if (active !== 'visual') return null;
    const cross = snippet.title === '准星';
    return { keys: cross ? ['cl_crosshair_red', 'cl_crosshair_green', 'cl_crosshair_blue'] : snippet.lines.map(line => line.split(' ')[0]), scale: cross ? 1 : 255 };
  });
  const hex = $derived.by(() => {
    if (!tint) return '';
    const channels = tint.keys.map(key => {
      const v = rows.find(row => row.key === key)?.value;
      return v?.trim() ? Number(v) * tint.scale : NaN;
    });
    return channels.every(v => Number.isFinite(v) && v >= 0 && v <= 255) ? '#' + channels.map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : '';
  });
  const canDrop = typeof window !== 'undefined' && 'EyeDropper' in window;

  // ---------- 每项用什么控件、取值范围 ----------
  const names: Record<string, string> = {
    cl_crosshair_dynamic: '动态准星', cl_crosshair_thickness: '粗细', cl_crosshair_alpha: '不透明度',
    cl_crosshair_red: '红', cl_crosshair_green: '绿', cl_crosshair_blue: '蓝',
    net_graph: '显示级别', net_graphpos: '显示位置', net_graphproportionalfont: '字体缩放',
    net_graphshowinterp: '插值曲线', net_graphshowlatency: '延迟曲线',
  };
  const SWITCH = new Set(['cl_crosshair_dynamic', 'net_graphproportionalfont', 'net_graphshowinterp', 'net_graphshowlatency']);
  const CHOICES: Record<string, [string, string][]> = {
    net_graph: [['0', '关闭'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
    net_graphpos: [['0', '左侧'], ['1', '右侧'], ['2', '居中']],
  };
  const RANGE: Record<string, [number, number, boolean]> = {
    cl_crosshair_thickness: [0, 20, false], cl_crosshair_alpha: [0, 255, true],
    cl_crosshair_red: [0, 255, true], cl_crosshair_green: [0, 255, true], cl_crosshair_blue: [0, 255, true],
  };
  const range = (key: string): [number, number, boolean] => key.startsWith('cl_glow_') ? [0, 1, false] : RANGE[key] ?? [0, 9999, false];
  function label(key: string) {
    return names[key] ?? (({ r: '红', g: '绿', b: '蓝' } as Record<string, string>)[key.slice(-1)] ?? key);
  }
  function choices(key: string, value: string) {
    const list = CHOICES[key];
    return list.some(([v]) => v === value) ? list : [...list, [value, value] as [string, string]];
  }

  // ---------- 改值 = 改 CFG；有内容就写进游戏，清空就撤掉 Matcha 那一段 ----------
  function write(text: string) {
    const on = text.trim() !== '';
    if (cfg.enabled !== on) { cfg.enabled = on; if (text === commands) { g.change(); return; } }
    g.setCfgText(text);
  }
  function set(values: Record<string, string>) { feedback = ''; write(applySnippet(commands, snippet, values)); }
  function commit(key: string, input: HTMLInputElement, current: string) {
    const raw = input.value.trim(), n = Number(raw), [min, max, int] = range(key);
    if (raw === current) return;
    if (!raw || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
      feedback = `${label(key)}的范围是 ${min}–${max}${int ? '，填整数' : ''}`;
      input.value = current;
      return;
    }
    set({ [key]: String(n) });
  }
  function pickColor(color: string) {
    if (!tint) return;
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color) ?? /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
    if (!m) return;
    const rgb = m.slice(1, 4).map(c => color.startsWith('#') ? parseInt(c, 16) : Number(c));
    const { keys, scale } = tint;
    set(Object.fromEntries(keys.map((key, i) => [key, scale === 1 ? String(rgb[i]) : String(Math.round(rgb[i] / 255 * 1000) / 1000)])));
  }
  async function eyedrop() {
    try {
      const picked = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open();
      pickColor(picked.sRGBHex);
    } catch { /* 按了 Esc */ }
  }

  function show(id: Tab) { active = id; feedback = ''; }
  function navigate(e: KeyboardEvent, i: number) {
    const j = ({ ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault(); show(tabs[j].id); document.getElementById('cfg-tab-' + tabs[j].id)?.focus();
  }
  async function edit() { show('source'); await tick(); document.getElementById('cfg-source')?.focus({ preventScroll: true }); }

  const pending = $derived(g.saving || (g.status === 'ready' && !g.effective));
  const fileState = $derived(
    g.status === 'missing' ? '当前服务不支持写入游戏，草稿保存在启动器'
    : !commands.trim() ? '改动后写入 left4dead2/cfg/autoexec.cfg'
    : !cfg.enabled ? '这份 CFG 还没写进游戏'
    : !g.autoexecPath ? '选择游戏目录后写入'
    : pending ? '正在写入…'
    : app.launchState === 'running' ? '游戏运行中，下次 L4N 启动前写入'
    : '已写入 autoexec.cfg，游戏启动时加载');
</script>

<section id="set-cfg" class="cfg">
  <div class="heading">
    <h2>游戏配置 {@render saveState()}</h2>
  </div>
  {#if g.status === 'error'}<p class="hint err" role="alert">{g.error} <button onclick={() => void g.load()}>重试</button></p>{/if}
  <div role="tablist" aria-label="游戏配置分类" class="tabs">
    {#each tabs as tab, i (tab.id)}
      <button id={'cfg-tab-' + tab.id} role="tab" aria-selected={active === tab.id} aria-controls="cfg-panel"
        tabindex={active === tab.id ? 0 : -1} onclick={() => show(tab.id)} onkeydown={(e) => navigate(e, i)}>
        <tab.icon size={15} />{tab.name}
      </button>
    {/each}
  </div>
  <div id="cfg-panel" role="tabpanel" aria-labelledby={'cfg-tab-' + active}>
    {#if active === 'source'}
      <div class="editor-label"><label for="cfg-source">完整 CFG <code class="mono">autoexec.cfg</code></label><span>清空就从游戏里撤掉这一段</span></div>
      <textarea id="cfg-source" aria-label="CFG 命令" class="mono" spellcheck="false" rows="7" disabled={!g.loaded} placeholder="// 在这里写 CFG，每行一条命令"
        value={commands} oninput={(e) => write(e.currentTarget.value)}></textarea>
    {:else}
      <div class="card">
        <div class="toolbar">
          <div class="topic">
            {#if tint}
              <label class="pick" class:unknown={!hex} style:--c={hex || 'transparent'} title="选颜色">
                <input type="color" aria-label={`选择${snippet.title}颜色`} disabled={!g.loaded} value={hex || '#ffffff'} oninput={(e) => pickColor(e.currentTarget.value)} />
              </label>
            {/if}
            {#if active === 'visual'}
              <select aria-label="选择画面项目" value={visualTitle} onchange={(e) => { visualTitle = e.currentTarget.value; feedback = ''; }}>
                {#each visuals as item (item.title)}<option value={item.title}>{item.title}</option>{/each}
              </select>
              {#if hex}<span class="hex mono">{hex.toUpperCase()}</span>{/if}
            {:else}<strong>帧率与网络信息</strong>{/if}
          </div>
          <div class="tools">
            {#if tint && canDrop}<button class="tool" disabled={!g.loaded} title="从屏幕上任意位置取色" onclick={() => void eyedrop()}><Pipette size={14} />取色</button>{/if}
            <button class="tool ghost" title="在 CFG 原文里编辑" onclick={() => void edit()}><FileCode size={14} />原文</button>
          </div>
        </div>
        <div class="values">
          {#each rows as row (row.key)}
            {@const id = 'cfg-v-' + row.key}
            {@const tag = used > 0 && !row.present}
            <div class="item" title={row.key + ' ' + row.value}>
              {#if SWITCH.has(row.key)}
                <span class="lbl">{label(row.key)}{#if tag}<small>建议</small>{/if}</span>
                <div class="sw"><Toggle disabled={!g.loaded} on={row.value === '1'} label={label(row.key)} onchange={() => set({ [row.key]: row.value === '1' ? '0' : '1' })} /><span>{row.value === '1' ? '开' : row.value === '0' ? '关' : row.value}</span></div>
              {:else if CHOICES[row.key]}
                <label class="lbl" for={id}>{label(row.key)}{#if tag}<small>建议</small>{/if}</label>
                <select {id} disabled={!g.loaded} value={row.value} onchange={(e) => set({ [row.key]: e.currentTarget.value })}>
                  {#each choices(row.key, row.value) as [value, text] (value)}<option {value}>{text}</option>{/each}
                </select>
              {:else}
                <label class="lbl" for={id}>{label(row.key)}{#if tag}<small>建议</small>{/if}</label>
                <input {id} class="num" inputmode="decimal" autocomplete="off" disabled={!g.loaded} value={row.value}
                  onchange={(e) => commit(row.key, e.currentTarget, row.value)}
                  onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = row.value; e.currentTarget.blur(); } }} />
              {/if}
            </div>
          {/each}
        </div>
        <div class="caption" aria-live="polite">
          {#if feedback}<span class="err">{feedback}</span>
          {:else if used === 0}建议值，还没写进 CFG。改任意一项，整组一起写入。<button class="link" disabled={!g.loaded} onclick={() => set({})}>直接用这组</button>
          {:else if used === rows.length}来自你的 CFG，改完自动保存并写入游戏。
          {:else}CFG 里已有 {used} 项；标「建议」的会在下次改动时一起补上。{/if}
        </div>
      </div>
    {/if}
    <p class="file" title={g.autoexecPath || 'left4dead2/cfg/autoexec.cfg'}><FileCode size={13} />{fileState}
      {#if g.status !== 'missing' && commands.trim() && !cfg.enabled}<button class="link" disabled={!g.loaded} onclick={() => { cfg.enabled = true; g.change(); }}>写入游戏</button>{/if}
    </p>
  </div>
  <SavedGameSettings />
</section>

<style>
  .cfg { container-type: inline-size; }
  .heading, .toolbar, .topic, .tools, .file, .tabs, .tabs button, .tool, .editor-label, .sw { display: flex; align-items: center; }
  .heading, .toolbar, .editor-label { justify-content: space-between; gap: 12px; }
  .tabs { gap: 5px; border-bottom: 1px solid var(--line); margin: 3px 0 10px; }
  .tabs button { position: relative; gap: 7px; height: 38px; padding: 0 12px; color: var(--fg-3); font-size: 13px; }
  .tabs button:hover { color: var(--fg); background: var(--hover); }
  .tabs button[aria-selected="true"] { color: var(--md-primary); font-weight: 600; }
  .tabs button[aria-selected="true"]::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 3px; background: var(--md-primary); border-radius: 3px 3px 0 0; }
  .toolbar { min-height: 50px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
  .topic { gap: 10px; min-width: 0; }
  .topic select { height: 30px; max-width: 100%; font-size: 13px; }
  .topic strong { font-size: 13px; font-weight: 500; }
  .hex { font-size: 12px; color: var(--fg-3); letter-spacing: .04em; }
  .tools { gap: 6px; flex: none; }

  /* 色块本身就是取色器：点开系统调色板 */
  .pick { position: relative; flex: none; width: 28px; height: 28px; border-radius: 9px; background: var(--c); border: 1px solid var(--line-strong); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--bg-1) 55%, transparent); cursor: pointer; transition: transform var(--dur) var(--ease-out), box-shadow var(--dur); }
  .pick:hover { transform: scale(1.06); }
  .pick:focus-within { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--bg-1) 55%, transparent), 0 0 0 2px var(--md-primary); }
  .pick.unknown { background: repeating-linear-gradient(135deg, var(--fg-4) 0 3px, transparent 3px 7px); }
  .pick input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; padding: 0; border: 0; }
  .pick input:disabled { cursor: default; }

  .tool { gap: 5px; height: 29px; padding: 0 10px; border-radius: var(--r); background: var(--md-secondary-container); color: var(--md-on-secondary-container); font-size: 12px; white-space: nowrap; }
  .tool:hover:not(:disabled) { background: var(--md-primary); color: var(--md-on-primary); }
  .tool.ghost { background: none; color: var(--fg-2); }
  .tool.ghost:hover { background: var(--hover); color: var(--fg); }

  .values { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px 18px; padding: 12px 16px 8px; }
  .item { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .lbl { display: flex; align-items: baseline; gap: 6px; }
  .item .num, .item select { width: 100%; height: 32px; font-size: 14px; font-variant-numeric: tabular-nums; }
  .sw { gap: 8px; height: 32px; color: var(--fg-2); font-size: 13px; }
  .lbl, .caption, .file, .editor-label, small { color: var(--fg-3); font-size: 12px; }
  small { font-weight: 400; color: var(--md-primary); }
  .caption { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 4px 16px 10px; }
  .link { color: var(--md-primary); font-size: 12px; text-decoration: underline; text-underline-offset: 3px; }
  .link:disabled { opacity: .5; }
  .file { gap: 6px; flex-wrap: wrap; margin: 7px 0 0; }
  .editor-label { margin-bottom: 6px; }
  textarea { display: block; width: 100%; min-height: 108px; resize: vertical; padding: 11px 14px; margin: 0; font-size: 13px; line-height: 1.65; tab-size: 2; }
  .err { color: var(--danger) !important; }
  @container (max-width: 380px) { .values { grid-template-columns: repeat(2,minmax(0,1fr)); } .tabs button { padding: 0 8px; } }
  @media (prefers-reduced-motion: reduce) { .pick { transition: none; } .pick:hover { transform: none; } }
</style>
