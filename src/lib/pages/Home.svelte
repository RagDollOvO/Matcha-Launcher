<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { launchFx } from '../launch-fx';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Check from '@lucide/svelte/icons/check';
  import Blocks from '@lucide/svelte/icons/blocks';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Layers from '@lucide/svelte/icons/layers';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CountUp from '../components/CountUp.svelte';
  import { gameSettings } from '../stores/game-settings.svelte';
  import { openSettings } from '../stores/nav.svelte';
  import { steam, loadSteamProfile } from '../stores/steam.svelte';
  import { shownMode } from '../launch-modes';
  import { enabledDllMods } from '../plugins/recorded-dll';
  if (gameSettings.status === 'idle') void gameSettings.load();
  import { app, ROOT } from '../stores/app.svelte';
  import { theme } from '../theme/theme.svelte';
  import { sfx } from '../sound/sfx.svelte';
  import { welcome } from '../stores/welcome.svelte';

  let menuOpen = $state(false);
  let clock = $state(Date.now());

  const p = $derived(app.activeProfile!);
  const conflicts = $derived(app.game.installed ? app.conflictReviews[p.id]?.counts.pending : undefined);
  const favorites = $derived(app.servers.filter((s) => s.favorite).slice(0, 3));
  const elapsed = $derived.by(() => {
    if (!app.launchedAt) return '00:00';
    const s = Math.max(0, Math.floor((clock - app.launchedAt) / 1000));
    const two = (n: number) => String(n).padStart(2, '0');
    return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
  });
  const bars = (ping: number | null) => (ping === null ? 0 : ping < 40 ? 4 : ping < 70 ? 3 : ping < 110 ? 2 : 1);

  // 左上角的时钟和问候
  const now = $derived(new Date(clock));
  const hh = $derived(String(now.getHours()).padStart(2, '0'));
  const mm = $derived(String(now.getMinutes()).padStart(2, '0'));
  const dateText = $derived(`${now.getMonth() + 1}月${now.getDate()}日 周${'日一二三四五六'[now.getDay()]}`);
  const greeting = $derived.by(() => {
    const h = now.getHours();
    return h < 5 ? '夜深了，月亮还在' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了，月亮还在';
  });

  // 启动方式：两种，做成卡片顶上的切换
  const mode = $derived(shownMode(app.launchConfig.mode));
  const missing = $derived(app.missingMods(p).length);
  const needsMods = $derived(mode !== 'clean' && missing > 0);
  const inGame = $derived(app.launchState === 'running' || app.stoppingGame);
  const modeLocked = $derived(!!app.busy || app.launchState !== 'idle');
  const MODES = [
    { id: 'modded', label: 'L4N 平台', icon: Blocks, title: 'L4N 平台启动：加载 Mod、DLL 模组和运行时' },
    { id: 'clean', label: '纯净对抗', icon: ShieldCheck, title: '纯净对抗：Steam 原版，不加载任何改动' },
  ] as const;

  // 玩家卡片的状态
  const dll = $derived(enabledDllMods(mode === 'clean', app.runtime, app.plugins, app.l4nPlugins, app.externalPacks, app.platforms));
  const dllHint = $derived(mode === 'clean' ? '纯净对抗：本模式不启用 DLL 模组' :
    `当前模式：Matcha 模组 ${dll.matcha} · L4N 子插件 ${dll.children} · 外来平台 ${dll.registered}`);
  const runtime = $derived(app.runtime.connected ? '已连接' : app.runtime.installed ? '已部署' : '未部署（可选）');
  const runtimeOk = $derived(app.runtime.connected || app.runtime.installed);
  const l4nOk = $derived(!!app.nativeLibraries?.l4n.enabled);
  const options = $derived(app.game.installed ? (gameSettings.status === 'ready' ? gameSettings.args(app.launchConfig.mode) : app.launchConfig.launchOptions).join(' ') : 'Steam · L4D2 尚未就绪');
  const renderRoute = $derived(options.toLowerCase().split(/\s+/).includes('-vulkan') ? 'vulkan' : 'default');
  const renderEntry = $derived(app.nativeLibraries?.dxvk.entries?.find(e=>e.route===renderRoute));
  const dxvk = $derived(renderEntry?.kind==='dxvk' ? (renderEntry.version??'版本待识别') : renderEntry ? '入口待核对' : '当前入口未检测到');
  const meta = $derived([mode === 'clean' || gameSettings.status !== 'ready' ? '' : gameSettings.summary(), options].filter(Boolean).join(' · '));

  // Steam 账号
  const name = $derived(
    (steam.status === 'ready' || steam.status === 'loading' ? steam.profile?.personaName : null) ??
      ({ idle: '读取 Steam 账号…', loading: '读取 Steam 账号…', ready: 'Steam 玩家', none: '未找到 Steam 账号', missing: 'Steam 玩家', error: '读不到 Steam 账号' } as const)[steam.status],
  );
  const sub = $derived(
    steam.profile && (steam.status === 'ready' || steam.status === 'loading')
      ? steam.profile.online === undefined ? 'Steam 账号' : steam.profile.online ? 'Steam · 已登录' : 'Steam · 未登录此账号'
      : steam.status === 'none' ? '登录 Steam 后会显示头像和昵称'
      : steam.status === 'missing' ? '头像和昵称待接入'
      : steam.status === 'error' ? '点头像重试'
      : '',
  );
  const initial = $derived(Array.from(steam.profile?.personaName?.trim() || 'M')[0]);

  onMount(() => {
    void loadSteamProfile();
    const tick = setInterval(() => (clock = Date.now()), 1000);
    void app.refreshServers(app.servers.filter(s => s.favorite).map(s => s.id));
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void app.refreshServers(app.servers.filter(s => s.favorite).map(s => s.id)); }, 30000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  });

  // 确认启动的那一刻（idle → launching）放特效；音效在 store 里，别的页面发起的启动也有
  let launchBtn = $state<HTMLButtonElement>();
  let avatarEl = $state<HTMLButtonElement>();
  let lastLaunch = app.launchState;
  $effect(() => {
    const s = app.launchState;
    if (s === 'launching' && lastLaunch === 'idle') untrack(() => launchFx(launchBtn, avatarEl));
    lastLaunch = s;
  });
  // 强制停止常驻在运行卡右侧（中性圆钮，悬停才转警示色），点了仍走确认框
  const stopBlock = $derived(app.stoppingGame ? '正在停止游戏' : app.game.pid && app.game.startedAt ? '' : '等待游戏进程信息');

  function launch() {
    if (needsMods) return app.openModPanel('missing', p.id);
    if (!app.game.installed || (!app.runtime.installed && !l4nOk && app.launchConfig.mode !== 'clean')) { app.route = 'plugins'; return; }
    if (app.launchState !== 'idle') return;
    void app.launch();
  }
  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (welcome.open || el.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      app.cycleProfile(e.key === 'ArrowLeft' ? -1 : 1);
      sfx.play('tab');
    }
  }
</script>

<svelte:window onclick={() => (menuOpen = false)} onkeydown={onKey} />

<section class="home">
  <!-- 左上：时钟直接印在壁纸上。 -->
  <div class="clock" class:photo={!!theme.wallpaper} aria-label="现在 {hh}:{mm}">
    <div class="time">{hh}<span class="colon">:</span>{mm}</div>
    <div class="date">{dateText}<i></i>{greeting}</div>
  </div>

  <!-- 左下：玩家卡片。头像探出卡片顶边，下面依次是昵称、启动方式、状态、启动 -->
  <aside class="player">
    <button bind:this={avatarEl} class="avatar" class:online={steam.profile?.online} title={steam.profile ? `${steam.profile.personaName}\nSteamID ${steam.profile.steamId}` : '刷新 Steam 账号'} data-sfx="none" onclick={() => void loadSteamProfile(true)}>
      {#if steam.profile?.avatar}
        <img src={steam.profile.avatar} alt="" draggable="false" />
      {:else}
        <span class="ph" class:loading={steam.status === 'loading' || steam.status === 'idle'}>{initial}</span>
      {/if}
      {#if steam.status === 'error'}<span class="retry"><RotateCw size={14} /></span>{/if}
    </button>
    <div class="name" title={name}>{name}</div>
    {#if sub}<div class="sub">{#if steam.profile?.online}<i class="on"></i>{/if}{sub}</div>{/if}

    <div class="modes" role="radiogroup" aria-label="启动方式">
      {#each MODES as m (m.id)}
        <button role="radio" aria-checked={mode === m.id} class:on={mode === m.id} disabled={modeLocked} title={m.title} data-sfx="tab" onclick={() => { if (mode !== m.id) app.setLaunchMode(m.id); }}>
          <m.icon size={14} strokeWidth={2} />{m.label}
        </button>
      {/each}
    </div>

    <div class="facts">
      <button class="fact" data-sfx="tab" title="查看本方案启用的 Mod" onclick={() => { app.editingProfileId = p.id; app.modFilter.category = ROOT; app.modFilter.status = 'on'; app.route = 'mods'; }}>
        <b>{app.capabilities.mods ? p.modIds.length - missing : '—'}</b><span>Mod</span>
      </button>
      <button class="fact" class:conflict={!!conflicts} data-sfx="tab" disabled={conflicts === undefined}
        title={conflicts === undefined ? '扫描 Mod 后显示冲突' : '查看本方案的资源冲突'}
        onclick={() => app.openModPanel('conflicts', p.id)}>
        <b>{#if conflicts === undefined}—{:else}<CountUp value={conflicts} />{/if}</b><span>冲突</span>
      </button>
      <button class="fact" data-sfx="tab" title={dllHint} onclick={() => (app.route = 'plugins')}><b><CountUp value={dll.total} /></b><span>DLL</span></button>
    </div>
    <div class="line">
      <button class:bad={!runtimeOk} data-sfx="tab" onclick={() => (app.route = 'plugins')}>运行时{runtime}</button>
      <i></i>
      <button class:bad={!l4nOk && mode !== 'clean'} data-sfx="tab" onclick={() => (app.route = 'plugins')}>L4N {mode==='clean' ? (l4nOk ? '需原版目录' : '纯净检查') : l4nOk && app.nativeLibraries?.l4n.launchEnabled===false ? '下次跳过' : l4nOk ? '已启用' : '已停用'}</button>
      <i></i>
      <span>DXVK {dxvk}</span>
    </div>

    {#if inGame}
      <div class="session" class:stopping={app.stoppingGame}>
        <span class="beacon" aria-hidden="true">
          {#if app.stoppingGame}<LoaderCircle size={17} class="spin" />{:else}<i></i>{/if}
        </span>
        <span class="st" role="status">
          <b>{app.stoppingGame ? '正在停止游戏…' : '游戏运行中'}</b>
          <small><span class="mono" title="本次运行时长">{elapsed}</span><i></i><span class="pn">{mode === 'clean' ? '纯净对抗' : p.name}</span></small>
        </span>
        <button class="stop" type="button" aria-label="强制停止游戏" title={stopBlock || '强制停止游戏'}
                disabled={!!stopBlock} onclick={() => void app.stopGame()}>
          <Square size={11} fill="currentColor" strokeWidth={0} /><span>停止</span>
        </button>
      </div>
    {:else}
      <button bind:this={launchBtn} class="launch" class:needs-mods={needsMods} class:busy={app.launchState === 'launching' || app.launchState === 'requested'} data-sfx="open" title={needsMods ? '查看方案中找不到的 VPK' : meta + (app.game.build ? `\nBUILD ${app.game.build}` : '')} disabled={!!app.busy || app.launchState === 'launching' || app.launchState === 'requested'} onclick={launch}>
        <span class="fill"></span>
        <span class="lbl">
          <b>
            {#if app.launchState === 'launching'}提交中<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{:else if app.launchState === 'requested'}等待游戏响应<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{:else if needsMods}<TriangleAlert size={16} />查看缺失 Mod{:else if !app.game.installed}选择游戏目录{:else if !app.runtime.installed && !l4nOk && app.launchConfig.mode !== 'clean'}配置 DLL 运行时{:else}<Play size={16} fill="currentColor" />启动游戏{/if}
          </b>
          <small>{mode === 'clean' ? '纯净对抗 · Steam 原版' : needsMods ? p.name + ' · ' + missing + ' 个文件未找到' : p.name}</small>
        </span>
      </button>
    {/if}
    <div class="row2">
      <div class="picker">
        <button class="sec" data-sfx={menuOpen ? 'close' : 'open'} onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen; }}>
          <Layers size={14} />方案选择<ChevronUp size={13} class="chev" />
        </button>
        {#if menuOpen}
          <div class="menu fade-in">
            {#each app.profiles as pr (pr.id)}
              <button onclick={() => app.setActiveProfile(pr.id, true)}>
                <span class="ck">{#if pr.id === p.id}<Check size={13} />{/if}</span>
                <span class="nm">{pr.name}</span>
                <span class="mono muted">{pr.modIds.length}</span>
              </button>
            {/each}
            <div class="sep"></div>
            <button data-sfx="tab" onclick={() => { app.editingProfileId = p.id; app.route = 'mods'; }}><span class="ck"></span>管理方案…</button>
          </div>
        {/if}
      </div>
      <button class="sec" data-sfx="tab" disabled={mode === 'clean'} title={mode === 'clean' ? '纯净对抗按 Steam 原版参数启动' : '编辑启动项和常用 CFG'} onclick={() => openSettings('game')}>
        <SlidersHorizontal size={14} />启动设置
      </button>
    </div>
  </aside>

  {#if favorites.length}
    <aside class="live">
      <div class="lh"><span class="live-dot"></span>收藏服务器<span class="lh-sub">每 30 秒探测</span></div>
      {#each favorites as s, i (s.id)}
        <button class="srv rise" style="animation-delay:{300 + i * 80}ms" title={app.launchState === 'running' || (s.vac && app.launchConfig.vacMode === 'insecure') ? '复制连接命令' : '启动并连接'} disabled={s.status !== 'online' || app.launchState === 'requested' || app.launchState === 'launching' || !!app.busy} onclick={() => app.connectServer(s.id)}>
          <span class="sn">{s.name}</span>
          <span class="meta mono">
            <span class="sig" aria-label="信号">{#each [1, 2, 3, 4] as b (b)}<i class:on={b <= bars(s.ping)} style="height:{b * 3 + 2}px"></i>{/each}</span>
            <span class="ping">{s.ping === null ? '—' : `${s.ping}ms`}</span>
            <span>{s.players ?? '—'}/{s.maxPlayers ?? '—'}{s.vac ? ' · VAC' : ''}</span>
          </span>
        </button>
      {/each}
    </aside>
  {/if}
</section>

<style>
  /* 主页内容区透明，壁纸、遮罩和视差在 Backdrop.svelte */
  .home { position: absolute; inset: 0; overflow: hidden; }

  /* ---------- 左上：时钟（无底框） ---------- */
  .clock { position: absolute; left: 28px; top: 22px; z-index: 1; color: var(--fg); animation: fade 0.9s 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .time {
    font-size: 64px; font-weight: 300; line-height: 1; letter-spacing: -0.01em; font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px color-mix(in srgb, var(--md-surface) 50%, transparent), 0 4px 28px color-mix(in srgb, var(--md-surface) 75%, transparent);
  }
  .colon { display: inline-block; margin: 0 2px; animation: blink 2s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0.35; } }
  /* 小字在浅云上发虚：字色往 --fg 靠一点，再用一圈贴身的底色描边托住字形、叠一层大范围柔光 */
  .date {
    --date-fg: color-mix(in srgb, var(--fg) 65%, var(--fg-2));
    display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-left: 3px; font-size: 13px; color: var(--date-fg);
    text-shadow:
      0 0 2px color-mix(in srgb, var(--md-surface) 85%, transparent),
      0 0 8px color-mix(in srgb, var(--md-surface) 70%, transparent),
      0 1px 18px color-mix(in srgb, var(--md-surface) 85%, transparent);
  }
  .date i { width: 3px; height: 3px; border-radius: 50%; background: var(--date-fg); box-shadow: 0 0 4px color-mix(in srgb, var(--md-surface) 80%, transparent); }
  .clock.photo { color: white; }
  .clock.photo .time, .clock.photo .date { text-shadow: 0 1px 3px rgb(0 0 0 / .8), 0 2px 14px rgb(0 0 0 / .58); }
  .clock.photo .date { --date-fg: #fff; }
  .clock.photo .date i { box-shadow: 0 1px 3px rgb(0 0 0 / .65); }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  /* ---------- 左下：玩家卡片 ---------- */
  .player {
    position: absolute; left: 16px; bottom: 16px; width: 300px; z-index: 2;
    display: flex; flex-direction: column; align-items: stretch; padding: 0 16px 16px;
    border-radius: 26px; background: color-mix(in srgb, var(--md-surface) 82%, transparent); border: 1px solid var(--island-line);
    box-shadow: 0 24px 56px -28px rgb(0 0 0 / .5);
    animation: up-in 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes up-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

  .avatar {
    position: relative; align-self: center; width: 92px; height: 92px; margin-top: -46px; border-radius: 30px; padding: 0;
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--md-surface) 92%, transparent), 0 14px 30px -12px rgb(0 0 0 / .45);
    transition: transform 240ms var(--ease-out);
  }
  .avatar:hover { transform: translateY(-2px) scale(1.03); }
  .avatar img, .avatar .ph { width: 100%; height: 100%; border-radius: 30px; display: block; object-fit: cover; }
  .avatar .ph {
    display: grid; place-items: center; font-size: 36px; font-weight: 700; color: var(--md-on-primary-container);
    background: radial-gradient(80% 80% at 75% 15%, var(--md-tertiary-container), transparent 70%), linear-gradient(150deg, var(--md-primary-container), var(--md-secondary-container));
  }
  .avatar .ph.loading { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .55; } }
  .avatar.online::after { content: ''; position: absolute; right: -3px; bottom: -3px; width: 18px; height: 18px; border-radius: 50%; background: var(--md-primary); box-shadow: 0 0 0 4px var(--md-surface); }
  .retry { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 30px; background: color-mix(in srgb, var(--md-surface) 55%, transparent); color: var(--fg); }
  .name { margin-top: 12px; font-size: 18px; font-weight: 700; text-align: center; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 3px; font-size: 12px; color: var(--fg-3); }
  .sub i.on { width: 6px; height: 6px; border-radius: 50%; background: var(--md-primary); }

  /* 启动方式：整条分段切换 */
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 16px; padding: 4px; border-radius: 16px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); }
  .modes button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; border-radius: 12px; font-size: 13px; color: var(--fg-2); transition: background var(--dur), color var(--dur), box-shadow var(--dur); }
  .modes button:hover:not(:disabled):not(.on) { color: var(--fg); }
  .modes button.on { background: var(--md-primary); color: var(--md-on-primary); font-weight: 600; box-shadow: 0 6px 14px -8px color-mix(in srgb, var(--md-primary) 90%, transparent); }
  .modes button:disabled { cursor: default; }
  .modes button:disabled:not(.on) { opacity: .45; }

  /* 状态：三格数字 + 一行小字 */
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 14px; }
  .fact { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 0; border-radius: 12px; transition: background var(--dur); }
  .fact + .fact { box-shadow: -1px 0 0 0 var(--line); border-top-left-radius: 0; border-bottom-left-radius: 0; }
  button.fact:not(:disabled):hover { background: var(--hover); }
  .fact b { font-size: 20px; font-weight: 700; line-height: 1.15; color: var(--fg); font-variant-numeric: tabular-nums; }
  .fact span { font-size: 11px; color: var(--fg-3); }
  .fact.conflict b { color: var(--md-error); }
  .line { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 8px 0 14px; font-size: 11px; color: var(--fg-3); white-space: nowrap; }
  .line button { color: inherit; transition: color var(--dur); }
  .line button:hover { color: var(--fg); }
  .line .bad { color: var(--md-error); }
  .line i { width: 2px; height: 2px; border-radius: 50%; background: var(--fg-4); }

  .launch {
    position: relative; overflow: hidden; width: 100%; height: 64px; border-radius: 18px;
    background: var(--md-primary); color: var(--md-on-primary);
    box-shadow: 0 14px 30px -14px color-mix(in srgb, var(--md-primary) 90%, transparent);
    transition: filter var(--dur), transform 200ms var(--ease-out);
  }
  .launch:hover { filter: brightness(1.07); }
  .launch.needs-mods { background: var(--md-tertiary-container); color: var(--md-on-tertiary-container); box-shadow: none; }
  .launch:active { transform: scale(0.985); }
  .launch:disabled { cursor: default; }
  .launch::after {
    content: ''; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%;
    background: linear-gradient(100deg, transparent, rgb(255 255 255 / 0.26), transparent);
    transition: none;
  }
  .launch:hover::after { left: 120%; transition: left 0.7s ease; }
  .launch .lbl { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .launch .lbl b { display: inline-flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 700; letter-spacing: 0.12em; }
  .launch .lbl b :global(svg) { transition: transform 260ms var(--ease-out); }
  .launch:hover:not(:disabled) .lbl b :global(svg) { transform: translateX(3px) scale(1.12); }
  .launch .lbl small { max-width: 230px; font-size: 11px; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .launch .fill { position: absolute; inset: 0; width: 0; background: color-mix(in srgb, var(--md-on-primary) 18%, transparent); }
  .launch.busy { cursor: default; }
  .launch.busy .lbl b { letter-spacing: 0.04em; font-size: 15px; }
  /* 等待中：一排斜条纹慢慢往右流（只平移，一个周期正好 24px），省略号三个点轮流跳 */
  .launch.busy .fill {
    left: -24px; width: auto;
    background: repeating-linear-gradient(120deg, transparent 0 10.39px, color-mix(in srgb, var(--md-on-primary) 13%, transparent) 10.39px 20.78px);
    animation: flow 0.9s linear infinite, fade 0.4s ease-out both;
  }
  @keyframes flow { to { transform: translateX(24px); } }
  .dots { display: inline-flex; align-items: flex-end; gap: 3px; height: 1em; margin-left: -4px; }
  .dots i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; animation: hopdot 1.1s ease-in-out infinite; }
  .dots i:nth-child(2) { animation-delay: 0.14s; }
  .dots i:nth-child(3) { animation-delay: 0.28s; }
  @keyframes hopdot { 0%, 60%, 100% { transform: translateY(0); opacity: .55; } 30% { transform: translateY(-5px); opacity: 1; } }

  /* 运行中：占启动按钮的位置和尺寸，换成安静的容器色；停止是右侧中性胶囊，悬停才转警示色 */
  .session {
    position: relative; display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 12px 0 14px; border-radius: 18px;
    background: color-mix(in srgb, var(--md-primary-container) 72%, var(--md-surface)); color: var(--md-on-primary-container);
    border: 1px solid color-mix(in srgb, var(--md-primary) 22%, transparent);
    animation: session-in 420ms var(--ease-out) both;
  }
  @keyframes session-in { from { opacity: 0; transform: scale(.97) translateY(4px); } to { opacity: 1; transform: none; } }
  .beacon { position: relative; display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%; color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 16%, transparent); }
  .beacon i { position: relative; width: 10px; height: 10px; border-radius: 50%; background: currentColor; }
  .beacon i::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: currentColor; animation: ripple 2s var(--ease-out) infinite; }
  @keyframes ripple { from { transform: scale(1); opacity: .55; } to { transform: scale(3.4); opacity: 0; } }
  .st { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .st b { font-size: 15px; font-weight: 700; letter-spacing: .04em; white-space: nowrap; }
  .st small { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; color: color-mix(in srgb, currentColor 72%, transparent); white-space: nowrap; }
  .st small .mono { font-variant-numeric: tabular-nums; }
  .st small i { flex: none; width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: .6; }
  .st .pn { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .stop {
    flex: none; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 13px 0 12px; border-radius: 17px;
    font-size: 13px; font-weight: 600; color: var(--md-on-primary-container);
    background: color-mix(in srgb, var(--md-on-primary-container) 10%, transparent);
    transition: background var(--dur), color var(--dur), transform 160ms var(--ease-out);
  }
  .stop:hover:not(:disabled) { background: var(--md-error-container); color: var(--md-on-error-container); }
  .stop:active:not(:disabled) { transform: scale(.96); }
  .stop:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
  .stop:disabled { opacity: .45; cursor: default; }
  .session.stopping .beacon { color: var(--fg-2); background: var(--hover); }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--md-primary); animation: beat 1.6s ease-in-out infinite; }
  @keyframes beat { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .picker { position: relative; display: grid; }
  .sec { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; border-radius: 13px; font-size: 13px; color: var(--fg); background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); transition: background var(--dur); }
  .sec:hover:not(:disabled) { background: var(--md-surface-container-highest); }
  .sec:disabled { color: var(--fg-4); cursor: default; }
  .sec :global(.chev) { color: var(--fg-3); margin-left: -2px; }
  .menu { position: absolute; bottom: 100%; left: 0; margin-bottom: 8px; min-width: 240px; z-index: 5; background: var(--bg-1); border: 1px solid var(--line-strong); border-radius: 14px; padding: 6px; box-shadow: 0 16px 40px -16px rgb(0 0 0 / .45); }
  .menu button { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--r); text-align: left; }
  .menu button:hover { background: var(--hover); }
  .menu .ck { width: 14px; display: grid; place-items: center; color: var(--md-primary); }
  .menu .nm { flex: 1; }
  .sep { height: 1px; background: var(--line); margin: 4px 0; }

  /* ---------- 右下：收藏服务器 ---------- */
  .live {
    position: absolute; right: 16px; bottom: 16px; width: 280px; z-index: 1; display: flex; flex-direction: column; gap: 2px; padding: 12px 10px 8px;
    border-radius: 22px; background: color-mix(in srgb, var(--md-surface) 78%, transparent); border: 1px solid var(--island-line);
    animation: fade 0.8s 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .lh { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--fg-2); padding: 0 8px 6px; }
  .lh-sub { margin-left: auto; font-size: 11px; font-weight: 400; color: var(--fg-3); }
  .srv { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 8px 10px; border-radius: 12px; text-align: left; transition: background var(--dur); }
  .srv:hover:not(:disabled) { background: var(--hover); }
  .srv:disabled { cursor: default; opacity: 0.55; }
  .sn { font-size: 13px; font-weight: 500; color: var(--fg); }
  .meta { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--fg-3); }
  .sig { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
  .sig i { width: 3px; border-radius: 1px; background: var(--line-strong); }
  .sig i.on { background: var(--md-primary); }
  .ping { min-width: 38px; }
  .rise { animation: rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both; }

  /* 窗口矮时：时钟让位 */
  @media (max-height: 700px) { .clock { display: none; } }

  @media (prefers-reduced-motion: reduce) {
    .player, .clock, .live, .rise, .live-dot, .session, .beacon i::after, .colon, .avatar .ph.loading, .launch.busy .fill, .dots i { animation: none; }
    .launch.busy .fill { left: 0; }
  }
</style>
