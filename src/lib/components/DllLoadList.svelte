<script lang="ts">
  // 「本地 DLL」：这台机器下次启动（或本局）实际会加载哪些 DLL。
  // 一条宿主一行：左边是宿主（Matcha 加载器 / L4N），右边是它带起来的 DLL。只读，开关在环境条、卡片和 L4N 整包页里。
  import Cpu from '@lucide/svelte/icons/cpu';
  import { fileLabel } from '../plugins/recorded-dll';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import { app } from '../stores/app.svelte';
  import type { DllLoadStatus } from '../types';

  type Tone = 'live' | 'next' | 'ready' | 'muted' | 'danger';
  interface Status { text: string; tone: Tone; hint?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Item { key: string; name: string; file: string; path: string; note?: string; unavailable?: boolean; status: Status; icon: any }
  interface Lane { key: string; host: Item; items: Item[]; empty?: string }

  const win = (p: string) => p.replace(/\//g, '\\');
  const base = (p: string) => p.split('\\').pop() ?? p;
  // 后端 loadStatus 优先；旧服务只有 runtimeState
  function status(s: DllLoadStatus | undefined, runtimeState: string, error?: string): Status {
    if (s) return {
      text: s.label,
      tone: s.state === 'loaded' || s.state === 'initialized' ? 'live' : s.state === 'failed' ? 'danger' : s.state === 'pending' ? 'next' : 'muted',
      hint: s.message,
    };
    if (runtimeState === 'failed' || error) return { text: '加载失败', tone: 'danger', hint: error };
    if (runtimeState === 'initialized') return { text: '初始化完成', tone: 'live' };
    if (runtimeState === 'loaded') return { text: '已装载', tone: 'live' };
    return app.game.running ? { text: '待确认', tone: 'muted' } : { text: '下次启动加载', tone: 'next' };
  }
  const loads = (s: DllLoadStatus | undefined, enabled: boolean, runtimeState: string) =>
    enabled || ['loaded', 'initialized', 'failed'].includes(s?.state ?? runtimeState);

  const rt = $derived(app.runtime);
  const env = $derived(app.nativeLibraries);
  const dir = $derived(win(rt?.dir || 'bin\\l4p'));
  const next = (running: boolean): Status => running ? { text: '本局使用中', tone: 'live' } : { text: '下次启动加载', tone: 'next' };

  const modules = $derived(app.plugins.filter(p => p.installed !== false && (p.host ?? 'flare') === 'flare'));
  const subs = $derived(app.l4nPlugins?.plugins ?? []);

  const lanes = $derived.by(() => {
    const out: Lane[] = [];
    const clean=app.launchConfig.mode==='clean';
    const l4nSkipped=env?.l4n.launchEnabled===false;
    const skip:Status={text:clean?'纯净模式跳过':'随 L4N 跳过',tone:'muted'};
    const runtimeSkipped=clean || (rt?.host==='l4n' && l4nSkipped);
    const hostOk = !!rt?.installed && rt.status !== 'restored';
    const items: Item[] = [];
    for (const p of modules.filter(p => loads(p.loadStatus, p.enabled, p.runtimeState)).sort((a, b) => a.loadOrder - b.loadOrder))
      items.push({
        key: p.id, name: p.name, file: base(win(p.file)), path: `${dir}\\plugins\\${p.id}\\${win(p.file)}`, icon: Puzzle,
        note: p.loadRole === 'dependency' ? '依赖' : 'v' + p.version,
        status: runtimeSkipped && !p.loadStatus?.mapped ? skip : hostOk ? status(p.loadStatus, p.runtimeState, p.error) : { text: '加载器未部署', tone: 'muted' },
      });
    out.push({
      key: 'flare', items, empty: '没有启用的模块',
      host: { key: 'runtime', name: 'Matcha 加载器', file: 'l4p_runtime.dll', path: `${dir}\\l4p_runtime.dll`, note: /\d/.test(rt?.version ?? '') ? 'v' + rt!.version : undefined, icon: Cpu,
        status: !rt?.installed ? { text: '未部署', tone: 'muted' } : rt.status === 'restored' ? { text: '已恢复原入口', tone: 'muted' } : rt.connected ? { text: `已连接 · PID ${app.game.pid}`, tone: 'live' } : runtimeSkipped ? skip : next(false) },
    });
    if (env?.l4n.enabled) out.push({
      key: 'l4n', empty: '没有子插件',
      host: { key: 'l4n', name: 'L4N 整包', file: 'left4neko.dll', path: 'bin\\left4neko.dll', note: env.l4n.version ? 'v'+env.l4n.version : '版本待识别', icon: Boxes, status: app.l4nPlugins?.plugins.some(p=>p.loadStatus?.mapped) ? next(true) : clean || l4nSkipped ? skip : app.game.running ? {text:'本局待确认',tone:'muted'} : next(false) },
      items: subs.filter(p => loads(p.loadStatus, p.enabled, p.runtimeState)).map(p => ({
        key: p.id, name: p.name, file: base(win(p.entry)), path: win(p.entry), note: '子插件', icon: Puzzle, status: (clean || l4nSkipped) && !p.loadStatus?.mapped ? skip : status(p.loadStatus, p.runtimeState, p.error),
      })),
    });
    for (const p of app.externalPacks) {
      if (p.state === 'absent') continue;
      const entry = p.files.find(f=>f.role==='entry');
      if (!entry) continue;
      const item = (f:typeof entry, host:boolean):Item => {
        const rel = win(f.path), conflict=p.conflicts.some(c=>win(c.path).toLowerCase()===rel.toLowerCase());
        const text=conflict?'入口重叠':f.mapped?'已装载':f.parked?'入口已暂存':p.control?.enabled===false?'已停用':f.mapped===false?'本局未见加载':fileLabel[f.state];
        return { key:rel, name:host?p.name:base(rel), file:host?rel:'', note:text, path:rel,
          unavailable:f.parked || f.state==='missing' || f.state==='unchecked', icon:host?Boxes:Puzzle,
          status:{text,tone:conflict?'muted':f.mapped?'live':p.control?.enabled===false?'muted':f.state==='match'&&f.mapped===undefined?'ready':'muted',hint:p.launch} };
      };
      out.push({key:'record:'+p.id, host:item(entry,true),
        items:p.files.filter(f=>f!==entry && f.role!=='asset' && /\.dll$/i.test(f.path)).map(f=>item(f,false)),empty:'独立入口'});
    }
    return out;
  });

  // 页眉图例：按状态计数，列表里就不用每行重复文字
  const all = $derived(lanes.flatMap(l => [l.host, ...l.items]).filter(i => i.status.tone !== 'muted' && /\.dll$/i.test(i.path)));
  const legend = $derived((['live', 'next', 'ready', 'danger'] as const).map(tone => ({ tone, n: all.filter(i => i.status.tone === tone).length, text: {live:'已装载',next:'下次启动加载',ready:'文件已就位',danger:'加载失败'}[tone] })).filter(x => x.n));
  const off = $derived([
    env && !env.l4n.enabled && env.l4n.installed ? 'L4N 整包' : '',
    (n => n ? `${n} 个停用的模块` : '')(modules.filter(p => !loads(p.loadStatus, p.enabled, p.runtimeState)).length),
    (n => n ? `${n} 个停用的 L4N 子插件` : '')(subs.filter(p => !loads(p.loadStatus, p.enabled, p.runtimeState)).length),
  ].filter(Boolean));

  const root = $derived(app.game.root?.replace(/[\\/]+$/, '') ?? '');
  function reveal(rel: string) { if (root && win(rel).split('\\').every(part=>part && part!=='.' && part!=='..' && !part.includes(':'))) app.reveal(`${root}\\${rel}`); }
</script>

{#snippet tile(i: Item, host: boolean)}
  {@const Icon = i.icon}
  <button class="tile {i.status.tone}" class:host disabled={i.unavailable} title={`${i.status.text}${i.status.hint ? '：' + i.status.hint : ''}\n${i.path}`} onclick={() => reveal(i.path)}>
    <span class="ic"><Icon size={host ? 16 : 14}/></span>
    <span class="txt">
      <span class="name">{i.name}</span>
      <span class="file">{i.status.tone === 'danger' ? i.status.text : [i.file, i.note].filter(Boolean).join(' · ')}</span>
    </span>
    <i class="dot" aria-label={i.status.text}></i>
  </button>
{/snippet}

<section class="loads" aria-label="本地 DLL">
  <header class="lh">
    <h2>本地 DLL</h2>
    <span class="legend">
      {#each legend as l (l.tone)}<span class="lg {l.tone}"><i></i>{l.text} {l.n}</span>{/each}
    </span>
    {#if root}<button class="open" onclick={() => app.reveal(`${root}\\${dir}`)}><FolderOpen size={13}/>打开目录</button>{/if}
  </header>

  {#each lanes as lane (lane.key)}
    <div class="lane">
      {@render tile(lane.host, true)}
      <div class="kids" class:none={!lane.items.length}>
        {#each lane.items as i (i.key)}{@render tile(i, false)}{:else}<span class="empty">{lane.empty}</span>{/each}
      </div>
    </div>
  {/each}

  {#if off.length}<p class="off">没加载：{off.join('、')}</p>{/if}
</section>

<style>
  .loads { padding-top: 26px; }
  .lh { display: flex; align-items: center; gap: 14px; min-height: 28px; margin-bottom: 12px; }
  h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .legend { display: inline-flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--fg-3); }
  .lg { display: inline-flex; align-items: center; gap: 6px; }
  .lg i, .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-4); flex: none; }
  .lg.next i, .next .dot { background: color-mix(in srgb, var(--md-primary) 60%, transparent); }
  .lg.ready i, .ready .dot { background: transparent; border: 1px solid var(--fg-3); }
  .lg.live i, .live .dot { background: var(--md-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-primary) 22%, transparent); }
  .lg.danger { color: var(--danger); }
  .lg.danger i, .danger .dot { background: var(--danger); }
  .open { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; height: 26px; padding: 0 10px; border-radius: 9px; font-size: 12px; color: var(--fg-2); transition: background var(--dur), color var(--dur); }
  .open:hover { background: var(--hover); color: var(--fg); }

  /* 一条宿主一行：宿主 → 一段细线 → 它加载的 DLL */
  .lane { display: grid; grid-template-columns: 264px minmax(0, 1fr); gap: 28px; align-items: start; }
  .lane + .lane { margin-top: 10px; }
  .kids { position: relative; display: flex; flex-wrap: wrap; gap: 8px; min-height: 56px; align-items: center; }
  .kids::before { content: ''; position: absolute; left: -28px; top: 28px; width: 28px; border-top: 1px dashed var(--line); }
  .empty { font-size: 12px; color: var(--fg-4); }

  .tile {
    position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; height: 56px; padding: 0 30px 0 10px;
    border: 1px solid var(--island-line); border-radius: 14px; text-align: left;
    background: color-mix(in srgb, var(--md-surface-bright) 50%, transparent);
    transition: background var(--dur), border-color var(--dur), transform 200ms var(--ease-out);
  }
  .kids .tile { flex: 0 1 216px; }
  .tile.host { background: color-mix(in srgb, var(--md-surface-bright) 72%, transparent); }
  .tile:hover { background: color-mix(in srgb, var(--md-surface-bright) 92%, transparent); }
  .tile:active { transform: scale(.98); }
  .tile.danger { border-color: color-mix(in srgb, var(--md-error) 40%, transparent); }
  .tile.muted { opacity: .6; }
  .ic { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 10px; background: color-mix(in srgb, var(--md-surface-container-highest) 70%, transparent); color: var(--fg-2); }
  .host .ic { width: 36px; height: 36px; border-radius: 11px; background: color-mix(in srgb, var(--md-secondary-container) 85%, transparent); color: var(--md-on-secondary-container); }
  .txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .name { font-size: 13px; font-weight: 600; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .host .name { font-size: 14px; }
  .file { font: 11px var(--font-mono); color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .danger .file { font-family: var(--font-sans); color: var(--danger); }
  .dot { position: absolute; top: 10px; right: 10px; }

  .off { margin: 12px 0 0; font-size: 12px; color: var(--fg-3); }

  @container dll (max-width: 700px) {
    .lane { grid-template-columns: 1fr; gap: 8px; }
    .kids { padding-left: 18px; min-height: 0; }
    .kids::before { left: 8px; top: -8px; bottom: 28px; width: 10px; border-top: 0; border-left: 1px dashed var(--line); border-bottom: 1px dashed var(--line); }
    .kids.none::before { bottom: 8px; }
    .kids .tile { flex: 1 1 200px; }
  }
  @media (prefers-reduced-motion: reduce) { .tile:active { transform: none; } }
</style>
