<script lang="ts">
  // 首次启动的欢迎引导：茶茶带着走四步——打招呼、找游戏、挑配色、出发。
  // 盖在整个窗口上，主界面在下面照常加载；走完整层淡出，露出主页。
  // 动画只动 transform / opacity，不用实时模糊（见 docs 里的「氛围底」约定）。
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Puzzle from '@lucide/svelte/icons/puzzle';
  import Compass from '@lucide/svelte/icons/compass';
  import Plug from '@lucide/svelte/icons/plug';
  import Server from '@lucide/svelte/icons/server';
  import Check from '@lucide/svelte/icons/check';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import SavedGameSettings from '../settings/SavedGameSettings.svelte';
  import LocalRender from './LocalRender.svelte';
  import ScanSearch from '@lucide/svelte/icons/scan-search';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import ImageUp from '@lucide/svelte/icons/image-up';
  import Leaf from '@lucide/svelte/icons/leaf';
  import Minus from '@lucide/svelte/icons/minus';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import Copy from '@lucide/svelte/icons/copy';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import WindowLooks from '../settings/WindowLooks.svelte';
  import Keys from './Keys.svelte';
  import { app } from '../stores/app.svelte';
  import { steam, loadSteamProfile } from '../stores/steam.svelte';
  import { theme, setWallpaper } from '../theme/theme.svelte';
  import { finishWelcome } from '../stores/welcome.svelte';
  import { desktop, errorText, pickDirectory, windowAction } from '../api/bridge';
  import { sfx } from '../sound/sfx.svelte';
  import { reduceMotion } from '../motion';
  import { agent } from '../agent';
  import { piHost, type PiProvider } from '../agent/host';
  import { checkup, laterCheckup, startCheckup } from '../agent/checkup.svelte';
  import Toggle from './Toggle.svelte';
  import Stethoscope from '@lucide/svelte/icons/stethoscope';

  const STEPS = ['你好', '游戏目录', '配色', '茶茶', '出发'] as const;
  const LAST = STEPS.length - 1;
  let step = $state(0);
  /** 1：往后翻，-1：往回翻。决定新内容从哪边滑进来 */
  let dir = $state(1);
  let leaving = $state(false);
  let primary = $state<HTMLButtonElement>();

  // ---------- 茶茶 ----------
  let pokeLine = $state('');
  let pokes = 0;
  let pokeTimer: ReturnType<typeof setTimeout> | undefined;
  const POKES = ['嘿嘿', '我是茶茶！', '别戳啦～', '好痒！'];
  function poke() {
    pokeLine = POKES[pokes++ % POKES.length];
    sfx.cute('boing', 1 + (pokes % 3) * 0.08);
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => (pokeLine = ''), 1600);
  }

  // ---------- Steam 昵称：有就用来打招呼 ----------
  const name = $derived(steam.status === 'ready' ? steam.profile?.personaName?.trim() ?? '' : '');

  // ---------- 游戏目录 ----------
  const game = $derived(app.ready ? app.game : null);
  const found = $derived(!!game?.installed);
  const root = $derived(game?.root?.replace(/[\\/]+$/, '') ?? '');
  const checking = $derived(!app.ready || app.busy === '检查游戏目录');
  const same = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
  const others = $derived(app.ready ? app.installations.filter(i => !root || !same(i.root, root)) : []);
  let manual = $state('');
  // 从「没找到」变成「找到了」时，茶茶高兴一下
  let wasFound: boolean | undefined;
  $effect(() => {
    const f = found;
    if (wasFound === false && f && step === 1) sfx.cute('sparkle');
    if (app.ready) wasFound = f;
  });
  async function browse() {
    try { const d = await pickDirectory('选择 Left 4 Dead 2 根目录'); if (d) await app.selectGame(d); }
    catch (e) { app.toast(errorText(e)); }
  }

  // ---------- 壁纸 ----------
  let wpInput = $state<HTMLInputElement>();
  async function pickWallpaper(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { app.toast('请选择图片文件'); return; }
    try { await setWallpaper(file); sfx.cute('sparkle'); }
    catch (err) { app.toast(`这张图片读不了：${errorText(err)}`); }
  }
  const LOOK_NAMES = { 'matcha-dark': '墨绿深色', 'matcha-light': '薄荷浅色', wallpaper: '随壁纸' } as const;

  // ---------- 茶茶的模型：默认 DeepSeek，填 API Key 就能用 ----------
  // 密钥走 pi-auth-set 写进茶茶自己的配置目录，界面之后只显示末 4 位。
  const DEEPSEEK: PiProvider = { id: 'deepseek', name: 'DeepSeek', configured: false, kind: 'api_key' };
  let providers = $state<PiProvider[] | null>(null);
  let providersMissing = $state(false);
  let prov = $state('deepseek');
  let keyDraft = $state('');
  let saving = $state(false);
  let saveError = $state('');
  let copied = $state('');
  /** 刚存好密钥、等茶茶连上后切过去的服务商 */
  let wantProvider = $state('');
  async function loadProviders() {
    const r = await piHost.providers();
    if (r.ok) { providers = r.value.providers; providersMissing = false; }
    else { providers = []; providersMissing = r.missing; }
  }
  $effect(() => { if (step === 3 && providers === null) void loadProviders(); });
  // 只列能填 API Key 的；订阅登录的去设置页
  const keyProviders = $derived.by(() => {
    const list = (providers ?? []).filter(p => p.kind !== 'oauth');
    return list.some(p => p.id === 'deepseek') ? list : [DEEPSEEK, ...list];
  });
  const provInfo = $derived(keyProviders.find(p => p.id === prov) ?? DEEPSEEK);
  const keyOk = $derived(!!provInfo.configured);
  const usingProv = $derived(agent.connected && agent.current?.provider === prov);
  const chachaReady = $derived(agent.connected && !!agent.current);
  async function saveKey() {
    const key = keyDraft.trim();
    if (!key || saving) return;
    saving = true; saveError = '';
    const r = await piHost.setKey(prov, key);
    saving = false;
    if (!r.ok) { saveError = r.missing ? '当前版本还不能在这里保存密钥，请按下面的终端方式登录。' : r.error; return; }
    keyDraft = '';
    sfx.cute('sparkle');
    wantProvider = prov;
    await loadProviders();
    if (agent.connected) agent.reconnect(); else agent.connect();
  }
  // 连上后，如果当前模型不是刚配的服务商，就切过去（DeepSeek 精确选择 V4.1 Flash）。
  // 切换走 set_model，茶茶会把它记成下次的默认模型。
  $effect(() => {
    const want = wantProvider;
    if (!want || !agent.connected || agent.connecting || agent.switching || agent.running) return;
    const list = agent.models.filter(m => m.provider === want);
    if (!list.length) return;
    wantProvider = '';
    const pick = want === 'deepseek'
      ? list.find(m => m.id === 'deepseek-v4.1-flash' || m.name === 'DeepSeek V4.1 Flash') ?? list.find(m => m.id === 'deepseek-flash')
      : list.find(m => m.id === agent.current?.id) ?? list.find(m => !m.reasoning) ?? list[0];
    if (!pick) { saveError = '当前模型目录缺少 DeepSeek V4.1 Flash，请更新模型目录。'; return; }
    if (agent.modelKey === `${pick.provider}/${pick.id}`) return;
    void agent.selectModel(`${pick.provider}/${pick.id}`);
  });
  const keyStatus = $derived.by((): { kind: 'busy' | 'ok' | 'warn' | 'bad'; text: string } | null => {
    if (saving) return { kind: 'busy', text: '正在保存密钥…' };
    if (saveError) return { kind: 'bad', text: saveError };
    if (usingProv) return { kind: 'ok', text: `连上啦，正在用 ${agent.model}` };
    if (agent.connecting || agent.switching) return keyOk || wantProvider ? { kind: 'busy', text: '正在叫醒茶茶…' } : null;
    if (!keyOk) return null;
    if (agent.connected && wantProvider) return { kind: 'busy', text: '密钥已保存，正在载入模型…' };
    if (agent.connected) return { kind: 'warn', text: agent.current ? `密钥已保存。茶茶现在用的是 ${agent.model}，可以在 设置 › 模型 里切过来` : '密钥已保存，但还没找到这个服务商的模型' };
    return { kind: 'warn', text: agent.connectionError ? `密钥已保存，茶茶还没连上：${agent.connectionError}` : '密钥已保存，茶茶连上后就能用' };
  });
  function copy(key: string, text: string) {
    void navigator.clipboard?.writeText(text).then(() => { copied = key; setTimeout(() => (copied = ''), 1200); });
  }

  // ---------- 出发后让茶茶体检：接上模型才给这个选项，默认开着 ----------
  let checkupOpt = $state(true);
  const offerCheckup = $derived(chachaReady && checkup.mark !== 'done');
  const wantCheckup = $derived(offerCheckup && checkupOpt);

  // ---------- 气泡台词 ----------
  const line = $derived(
    pokeLine ||
      (step === 0 ? '你好呀～'
        : step === 1 ? (checking ? '找找看…' : found ? '找到啦！' : '游戏藏哪儿了？')
        : step === 2 ? '挑个喜欢的～'
        : step === 3 ? (usingProv || chachaReady ? '我能说话啦！' : saving || agent.connecting ? '在连了在连了…' : '给我一把钥匙～')
        : '有事就叫我！'),
  );

  // ---------- 翻页 ----------
  function go(to: number) {
    if (to < 0 || to > LAST || to === step || leaving) return;
    dir = to > step ? 1 : -1;
    step = to;
    sfx.cute(dir > 0 ? 'pop' : 'blip', 1 + step * 0.06);
    queueMicrotask(() => primary?.focus({ preventScroll: true }));
  }
  const next = () => (step === LAST ? enter() : go(step + 1));

  // ---------- 出发：撒一把叶子，整层淡出 ----------
  let burst = $state(0);
  const SPARKS = Array.from({ length: 14 }, (_, i) => ({
    a: (i / 14) * 360 + (i % 2 ? 9 : -9),
    d: 70 + ((i * 37) % 5) * 16,
    r: ((i * 53) % 7) * 30 - 90,
    s: 0.7 + ((i * 29) % 4) * 0.15,
  }));
  function enter() {
    if (leaving) return;
    leaving = true;
    burst++;
    sfx.cute('yay');
    const run = wantCheckup;
    if (offerCheckup && !checkupOpt) laterCheckup();
    setTimeout(() => {
      finishWelcome();
      if (run) void startCheckup().catch((e) => app.toast(`体检没开始：${errorText(e)}`));
    }, reduceMotion() ? 0 : 640);
  }
  function skip() {
    if (leaving) return;
    leaving = true;
    setTimeout(finishWelcome, reduceMotion() ? 0 : 420);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
    // 焦点在按钮、输入框、单选上时交给它们自己处理
    if ((e.target as HTMLElement).closest?.('button, input, textarea, select, a, label, summary')) return;
    e.preventDefault();
    next();
  }

  const FEATURES = [
    { icon: Puzzle, title: 'Mod 与方案', note: 'VPK 一键启停，冲突一眼看到' },
    { icon: Compass, title: '发现', note: '创意工坊、B 站、GameMaps 直接下' },
    { icon: Plug, title: 'DLL 模组', note: 'L4N、DXVK 和各种增强模组' },
    { icon: Server, title: '服务器', note: '收藏常玩的服，看延迟一键连' },
  ];
  const WORD = Array.from('Matcha');
  /** 背景里一闪一闪的小点，位置写死，避开卡片中间 */
  const TWINKLES = [{ x: 6, y: 18 }, { x: 14, y: 78 }, { x: 22, y: 9 }, { x: 4, y: 52 }, { x: 93, y: 14 }, { x: 86, y: 84 }, { x: 96, y: 58 }, { x: 74, y: 6 }];

  onMount(() => {
    void loadSteamProfile();
    primary?.focus({ preventScroll: true });
    return () => clearTimeout(pokeTimer);
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="welcome" class:leaving role="dialog" aria-modal="true" aria-labelledby="welcome-title">
  <!-- 背景：有壁纸用预模糊的氛围底，没有就用配色渐变；几团慢慢飘的光斑 -->
  <div class="bg" aria-hidden="true">
    {#if theme.ambient}<div class="amb" style="background-image:url({theme.ambient})"></div>{:else}<div class="sky"></div>{/if}
    <div class="veil"></div>
    <i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>
    {#each TWINKLES as t, k (k)}<i class="twinkle" style="left:{t.x}%;top:{t.y}%;--k:{k}"></i>{/each}
  </div>

  <!-- 无边框窗口：顶上留一条拖动区和窗口按钮 -->
  <div class="drag" data-tauri-drag-region>
    <div class="win">
      <button aria-label="最小化" disabled={!desktop} data-sfx="none" onclick={() => windowAction('minimize')}><Minus size={14} /></button>
      <button aria-label="最大化" disabled={!desktop} data-sfx="none" onclick={() => windowAction('maximize')}><Square size={12} /></button>
      <button class="close" aria-label="关闭" disabled={!desktop} data-sfx="none" onclick={() => windowAction('close')}><X size={14} /></button>
    </div>
  </div>

  <div class="card">
    <!-- 左：茶茶 -->
    <aside class="art" data-step={step}>
      <span class="dots" aria-hidden="true"></span>
      <div class="mascot">
        <span class="halo" aria-hidden="true"></span>
        <button class="poke" tabindex="-1" aria-label="戳一下茶茶" data-sfx="none" onclick={poke}>
          <span class="bob"><span class="squish">
            <img src="/matcha.png" alt="" draggable="false" />
            <span class="badge" aria-hidden="true"><Leaf size={13} strokeWidth={2.6} /></span>
          </span></span>
        </button>
        {#key line}<span class="bubble" role="status">{line}</span>{/key}
      </div>
      <div class="sign">
        <b>茶茶</b>
        <span>Matcha 的向导</span>
      </div>
    </aside>

    <!-- 右：每一步的内容 -->
    <section class="pane">
      <header class="top">
        <ol class="progress" aria-label="引导进度">
          {#each STEPS as s, i (s)}
            <li class:done={i < step} class:on={i === step}>
              <button disabled={i > step || leaving} aria-current={i === step ? 'step' : undefined} data-sfx="none" onclick={() => go(i)} title={s}><i></i><span>{s}</span></button>
            </li>
          {/each}
        </ol>
        {#if step < LAST}<button class="skip" data-sfx="none" onclick={skip}>跳过引导</button>{/if}
      </header>

      <div class="stage">
        {#key step}
          <div class="page" in:fly={{ x: 28 * dir, duration: 380, delay: 90, easing: cubicOut }} out:fly={{ x: -20 * dir, duration: 160, easing: cubicOut }}>
            {#if step === 0}
              <p class="eyebrow">欢迎来到</p>
              <h1 id="welcome-title" class="word" aria-label="Matcha">{#each WORD as ch, i (i)}<span style="--i:{i}" aria-hidden="true">{ch}</span>{/each}</h1>
              <p class="lede">{name ? `${name}，你好！` : '你好！'}我是茶茶。花一分钟，把求生之路 2 的启动器配好，之后装 Mod、开 DLL 模组、进服务器都在这一个窗口里。</p>
              <ul class="features">
                {#each FEATURES as f, i (f.title)}
                  <li style="--i:{i}"><span class="fi"><f.icon size={17} strokeWidth={1.9} /></span><span><b>{f.title}</b><small>{f.note}</small></span></li>
                {/each}
              </ul>

            {:else if step === 1}
              <h2 id="welcome-title">先找到你的游戏</h2>
              <p class="lede">Mod、DLL 模组和启动都基于 Left 4 Dead 2 的安装目录。一般会自动从 Steam 里找到。</p>
              <div class="status" class:ok={found && !checking} class:bad={!found && !checking}>
                <span class="si">
                  {#if checking}<LoaderCircle size={20} class="spin" />{:else if found}<Check size={20} strokeWidth={2.6} />{:else}<CircleAlert size={20} />{/if}
                </span>
                <div class="st">
                  {#if checking}
                    <b>{app.ready ? '正在检查目录…' : app.error ? '在等本地服务' : '正在找 Left 4 Dead 2…'}</b>
                    <span class="sub">{app.error && !app.ready ? app.error : '读取 Steam 库里的安装位置'}</span>
                  {:else if found}
                    <b>找到了 Left 4 Dead 2{#if game?.build}<span class="ver mono">{game.build}</span>{/if}</b>
                    <span class="path mono" title={root}>{root}</span>
                    {#if app.nativeLibraries}<span class="sub">L4N · {app.nativeLibraries.l4n.version ?? (app.nativeLibraries.l4n.installed ? '版本待识别' : '未检测到')}</span>
                      <div class="sub">DXVK 渲染入口<LocalRender entries={app.nativeLibraries.dxvk.entries}/></div>{/if}
                    <SavedGameSettings compact />
                  {:else}
                    <b>还没找到游戏</b>
                    <span class="sub">装在别的盘？选包含 left4dead2.exe 的那个文件夹。</span>
                  {/if}
                </div>
              </div>
              <div class="acts">
                <button class="btn" disabled={checking || !!app.busy} onclick={() => app.selectGame('')}><ScanSearch size={14} />{found ? '重新查找' : '自动查找'}</button>
                {#if desktop}<button class="btn" disabled={checking || !!app.busy} onclick={browse}><FolderSearch size={14} />{found ? '换一个文件夹…' : '选择文件夹…'}</button>{/if}
              </div>
              {#each others as i (i.root)}
                <div class="other">
                  <span class="lt"><b>另一个安装{#if i.build}<span class="ver mono">{i.build}</span>{/if}</b><span class="path mono" title={i.root}>{i.root}</span></span>
                  <button class="btn sm" disabled={!!app.busy} onclick={() => app.selectGame(i.root)}>改用这个</button>
                </div>
              {/each}
              {#if !found && !checking}
                <form class="manual" onsubmit={(e) => { e.preventDefault(); if (manual.trim()) void app.selectGame(manual.trim()); }}>
                  <input class="mono" aria-label="游戏根目录" spellcheck="false" placeholder="或者直接粘贴路径：D:\SteamLibrary\steamapps\common\Left 4 Dead 2" bind:value={manual} />
                  <button class="btn" disabled={!!app.busy || !manual.trim()}>检查</button>
                </form>
              {/if}

            {:else if step === 2}
              <h2 id="welcome-title">挑一个配色</h2>
              <p class="lede">点一下就能看到效果。之后在 设置 › 外观 里随时能换。</p>
              <div class="looks"><WindowLooks /></div>
              <div class="wp">
                <span class="thumb" class:empty={!theme.wallpaper} style={theme.wallpaper ? `background-image:url(${theme.wallpaper})` : ''}></span>
                <span class="lt"><b>主页壁纸</b><span class="sub">{theme.wallpaper ? '已经设好了。选「随壁纸」时，界面颜色从图里取。' : '放一张喜欢的图当主页背景，二次元图尤其合适。'}</span></span>
                <input type="file" accept="image/*" hidden bind:this={wpInput} onchange={pickWallpaper} />
                <button class="btn" disabled={theme.busy} onclick={() => wpInput?.click()}>{#if theme.busy}<LoaderCircle size={14} class="spin" />{:else}<ImageUp size={14} />{/if}{theme.wallpaper ? '更换…' : '导入…'}</button>
              </div>

            {:else if step === 3}
              <h2 id="welcome-title">给茶茶接上模型</h2>
              <p class="lede">茶茶靠大模型听懂你的话。选择 DeepSeek 时，茶茶使用 V4.1 Flash。填入 API Key 即可连接。</p>
              {#if providersMissing}
                <div class="keybox">
                  <p class="sub">当前版本还不能在这里填密钥。复制下面的命令到 PowerShell 里运行，输入 <code>/login</code> 登录、<code>/model</code> 选模型，回来按 Ctrl K 就能用了。</p>
                  {#if agent.loginCommand}<div class="cmd"><pre class="mono">{agent.loginCommand}</pre><button class="icon-btn" title="复制命令" aria-label="复制命令" onclick={() => copy('login', agent.loginCommand)}>{#if copied === 'login'}<Check size={13} />{:else}<Copy size={13} />{/if}</button></div>{/if}
                </div>
              {:else}
                <form class="keybox" onsubmit={(e) => { e.preventDefault(); void saveKey(); }}>
                  <div class="kh">
                    <select aria-label="服务商" bind:value={prov} disabled={saving} onchange={() => { keyDraft = ''; saveError = ''; }}>
                      {#each keyProviders as p (p.id)}<option value={p.id}>{p.name}{p.id === 'deepseek' ? '（推荐）' : ''}</option>{/each}
                    </select>
                    <span class="pill" class:on={keyOk}>{keyOk ? (provInfo.source === 'env' ? '来自环境变量' : provInfo.keyHint ? `已配置 ••••${provInfo.keyHint}` : '已配置') : providers === null ? '读取中…' : '未配置'}</span>
                  </div>
                  <div class="kf">
                    <span class="kicon"><KeyRound size={15} /></span>
                    <input type="password" autocomplete="off" spellcheck="false" aria-label="{provInfo.name} API Key" placeholder={keyOk ? '粘贴新的 Key 可以更换' : prov === 'deepseek' ? '粘贴 sk- 开头的 API Key' : `粘贴 ${provInfo.name} 的 API Key`} bind:value={keyDraft} disabled={saving} />
                    <button class="btn primary" disabled={!keyDraft.trim() || saving}>{#if saving}<LoaderCircle size={14} class="spin" />{/if}保存并连接</button>
                  </div>
                  {#if keyStatus}
                    <p class="kstat {keyStatus.kind}" role="status">
                      {#if keyStatus.kind === 'busy'}<LoaderCircle size={13} class="spin" />{:else if keyStatus.kind === 'ok'}<Check size={13} strokeWidth={2.8} />{:else}<CircleAlert size={13} />{/if}{keyStatus.text}
                    </p>
                  {/if}
                </form>
                <div class="howto">
                  <b>使用说明</b>
                  {#if prov === 'deepseek'}
                    <ol>
                      <li>打开 DeepSeek 开放平台 <span class="url mono">platform.deepseek.com</span><button type="button" class="cp" title="复制网址" aria-label="复制网址" onclick={() => copy('url', 'https://platform.deepseek.com/api_keys')}>{#if copied === 'url'}<Check size={12} />{:else}<Copy size={12} />{/if}</button>，注册登录，先充一点余额（按用量计费）。</li>
                      <li>进「API Keys」创建一个密钥，复制 <code>sk-</code> 开头的那一串。它只显示一次，记得先复制。</li>
                      <li>粘贴到上面，点「保存并连接」。之后按 <Keys keys={['Ctrl', 'K']} /> 叫茶茶，直接说「看看当前方案有没有冲突」就行。</li>
                    </ol>
                  {:else}
                    <ol>
                      <li>在 {provInfo.name} 的官网控制台创建一个 API Key，复制下来。</li>
                      <li>粘贴到上面，点「保存并连接」。之后按 <Keys keys={['Ctrl', 'K']} /> 叫茶茶。</li>
                    </ol>
                  {/if}
                  <p class="fine">密钥只存在这台电脑上茶茶的配置里，之后只显示末 4 位。中转地址、订阅登录和其他服务商在 设置 › 服务商与密钥。</p>
                </div>
              {/if}

            {:else}
              <h2 id="welcome-title">准备好啦</h2>
              <p class="lede">遇到不会的，随时叫我。装 Mod、查冲突、找服务器，都可以直接问。</p>
              <div class="call">
                <span class="ci"><Leaf size={16} strokeWidth={2.4} /></span>
                <span class="lt"><b>叫出茶茶</b><span class="sub">在哪个页面都行，也可以点顶栏右边的小星星</span></span>
                <Keys keys={['Ctrl', 'K']} />
              </div>
              <ul class="summary">
                <li class:ok={found}><span class="ck">{#if found}<Check size={13} strokeWidth={2.8} />{/if}</span><span class="k">游戏目录</span><span class="v mono" title={root}>{found ? root : '稍后在 设置 › 游戏目录 里选'}</span></li>
                <li class:ok={chachaReady}><span class="ck">{#if chachaReady}<Check size={13} strokeWidth={2.8} />{/if}</span><span class="k">茶茶</span><span class="v">{chachaReady ? agent.model : keyOk ? '密钥已保存，连上后就能用' : '稍后在 设置 › 服务商与密钥 里填'}</span></li>
                <li class="ok"><span class="ck"><Check size={13} strokeWidth={2.8} /></span><span class="k">配色</span><span class="v">{LOOK_NAMES[theme.look]}{theme.wallpaper ? ' · 有壁纸' : ''}</span></li>
                <li class:ok={!!name}><span class="ck">{#if name}<Check size={13} strokeWidth={2.8} />{/if}</span><span class="k">Steam 账号</span><span class="v">{name || (steam.status === 'loading' || steam.status === 'idle' ? '读取中…' : '登录 Steam 后会显示')}</span></li>
              </ul>
              {#if offerCheckup}
                <div class="checkup" class:on={checkupOpt}>
                  <span class="ci"><Stethoscope size={16} strokeWidth={2.2} /></span>
                  <span class="lt"><b>进去后让茶茶做个体检</b><span class="sub">看一遍启动项、CFG、DLL 模组和 Mod 冲突，只读不改</span></span>
                  <Toggle on={checkupOpt} label="进去后让茶茶做个体检" onchange={() => (checkupOpt = !checkupOpt)} />
                </div>
              {/if}
            {/if}
          </div>
        {/key}
      </div>

      <footer class="foot">
        {#if step > 0}
          <button class="btn ghost back" disabled={leaving} data-sfx="none" onclick={() => go(step - 1)}><ChevronLeft size={15} />上一步</button>
        {:else}<span></span>{/if}
        <span class="go-wrap">
          <button bind:this={primary} class="go" class:final={step === LAST} disabled={leaving} data-sfx="none" onclick={next}>
            {step === 0 ? '开始设置' : step === LAST ? (wantCheckup ? '进入并体检' : '进入 Matcha') : (step === 1 && !found && !checking) || (step === 3 && !keyOk && !chachaReady) ? '先跳过' : '下一步'}<ArrowRight size={16} strokeWidth={2.2} />
          </button>
          {#key burst}
            {#if burst}
              <span class="burst" aria-hidden="true">
                {#each SPARKS as p, i (i)}<i style="--a:{p.a}deg;--d:{p.d}px;--r:{p.r}deg;--s:{p.s}"><Leaf size={12} strokeWidth={2.4} /></i>{/each}
              </span>
            {/if}
          {/key}
        </span>
      </footer>
    </section>
  </div>
</div>

<style>
  .welcome {
    position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 46px 32px 32px;
    color: var(--fg); transition: opacity 520ms var(--ease-out), transform 620ms var(--ease-out);
  }
  .welcome.leaving { opacity: 0; transform: scale(1.03); pointer-events: none; }

  /* ---------- 背景 ---------- */
  .bg { position: absolute; inset: 0; overflow: hidden; background: var(--md-surface); pointer-events: none; }
  .amb { position: absolute; inset: -4%; background-size: cover; background-position: center; }
  .sky {
    position: absolute; inset: 0;
    background:
      radial-gradient(60% 70% at 82% 12%, color-mix(in srgb, var(--md-tertiary-container) 85%, transparent), transparent 70%),
      radial-gradient(70% 80% at 8% 100%, color-mix(in srgb, var(--md-primary-container) 90%, transparent), transparent 70%),
      linear-gradient(160deg, var(--md-surface-container-high), var(--md-surface));
  }
  .veil { position: absolute; inset: 0; background: color-mix(in srgb, var(--md-surface) 38%, transparent); }
  .blob { position: absolute; border-radius: 50%; will-change: transform; }
  .b1 { width: 46vmax; height: 46vmax; left: -12vmax; top: -16vmax; background: radial-gradient(closest-side, color-mix(in srgb, var(--md-primary) 26%, transparent), transparent); animation: drift 22s ease-in-out infinite alternate; }
  .b2 { width: 38vmax; height: 38vmax; right: -10vmax; bottom: -14vmax; background: radial-gradient(closest-side, color-mix(in srgb, var(--md-tertiary) 24%, transparent), transparent); animation: drift 26s ease-in-out -8s infinite alternate-reverse; }
  .b3 { width: 24vmax; height: 24vmax; right: 18%; top: 8%; background: radial-gradient(closest-side, color-mix(in srgb, var(--md-secondary) 18%, transparent), transparent); animation: drift 30s ease-in-out -4s infinite alternate; }
  @keyframes drift { to { transform: translate3d(6vmax, 4vmax, 0) scale(1.12); } }
  .twinkle {
    position: absolute; width: 6px; height: 6px; border-radius: 50%; background: var(--md-primary); opacity: 0;
    animation: twinkle 4.8s ease-in-out calc(var(--k) * -0.6s) infinite;
  }
  @keyframes twinkle { 0%, 100% { opacity: 0; transform: scale(.4); } 50% { opacity: .55; transform: scale(1); } }

  /* ---------- 顶部拖动区 ---------- */
  .drag { position: absolute; top: 0; left: 0; right: 0; height: 46px; display: flex; justify-content: flex-end; align-items: center; padding-right: 8px; z-index: 2; }
  .win { display: flex; gap: 2px; }
  .win button { width: 40px; height: 30px; border-radius: 10px; display: grid; place-items: center; color: var(--fg-2); transition: background var(--dur), color var(--dur); }
  .win button:hover:not(:disabled) { background: color-mix(in srgb, var(--md-surface) 70%, transparent); color: var(--fg); }
  .win button:disabled { opacity: .45; cursor: default; }
  .win .close:hover:not(:disabled) { background: #c42b1c; color: #fff; }

  /* ---------- 卡片 ---------- */
  .card {
    position: relative; z-index: 1; display: grid; grid-template-columns: 290px minmax(0, 1fr);
    width: min(900px, 100%); height: min(600px, 100%); min-height: 0;
    border-radius: 30px; overflow: hidden;
    background: color-mix(in srgb, var(--md-surface) 90%, transparent); border: 1px solid var(--island-line);
    box-shadow: 0 40px 90px -40px rgb(0 0 0 / .55), 0 2px 0 0 color-mix(in srgb, var(--md-on-surface) 4%, transparent) inset;
    animation: card-in 720ms cubic-bezier(0.2, 0.9, 0.25, 1.05) both;
  }
  @keyframes card-in { from { opacity: 0; transform: translateY(18px) scale(.97); } }

  /* ---------- 左：茶茶的展台 ---------- */
  .art {
    position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; overflow: hidden;
    background:
      radial-gradient(90% 60% at 50% 42%, color-mix(in srgb, var(--md-surface) 30%, transparent), transparent 70%),
      linear-gradient(165deg, var(--md-primary-container), color-mix(in srgb, var(--md-tertiary-container) 85%, var(--md-primary-container)));
    color: var(--md-on-primary-container);
  }
  .dots {
    position: absolute; inset: 0; opacity: .55;
    background-image: radial-gradient(color-mix(in srgb, var(--md-on-primary-container) 20%, transparent) 1.3px, transparent 1.8px);
    background-size: 18px 18px;
    mask-image: linear-gradient(180deg, #000, transparent 55%, transparent 70%, #000);
  }
  .mascot { position: relative; width: 168px; height: 168px; margin-top: 18px; animation: mascot-in 760ms cubic-bezier(0.34, 1.56, 0.64, 1) 160ms backwards; }
  @keyframes mascot-in { from { opacity: 0; transform: translateY(14px) scale(.6) rotate(-6deg); } }
  .halo { position: absolute; left: 50%; top: 54%; width: 300px; height: 300px; margin: -150px 0 0 -150px; border-radius: 50%; pointer-events: none;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--md-surface) 55%, transparent), color-mix(in srgb, var(--md-surface) 18%, transparent) 55%, transparent); }
  .poke { position: relative; display: block; width: 100%; height: 100%; cursor: pointer; }
  .bob { display: block; width: 100%; height: 100%; animation: bob 3.6s ease-in-out 900ms infinite; }
  @keyframes bob { 50% { transform: translateY(-6px) rotate(-1.5deg); } }
  .squish { position: relative; display: block; width: 100%; height: 100%; transform-origin: 50% 90%; transition: transform 260ms var(--ease-out); }
  .poke:hover .squish { transform: rotate(-4deg) scale(1.04); }
  .poke:active .squish { transform: scale(1.08, .9); transition-duration: 90ms; }
  .squish img { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; -webkit-user-drag: none; filter: drop-shadow(0 12px 16px rgb(0 0 0 / .18)); }
  /* 盖住原图右下角的播放键（圆心约在 76.6%, 76.6%），换成茶茶的叶子 */
  .badge { position: absolute; left: calc(76.6% - 17px); top: calc(76.6% - 17px); display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
    background: var(--md-primary); color: var(--md-on-primary); box-shadow: 0 0 0 4px #fff, 0 6px 12px -4px rgb(0 0 0 / .3); }
  .bubble {
    position: absolute; left: 68%; bottom: 88%; z-index: 1; padding: 5px 12px; white-space: nowrap; font-size: 13px; line-height: 1.6; color: var(--fg);
    background: var(--md-surface); border-radius: 14px 14px 14px 4px;
    box-shadow: 0 10px 22px -12px color-mix(in srgb, var(--md-shadow) 55%, transparent);
    transform-origin: 0 100%; animation: bubble-in 440ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  }
  @keyframes bubble-in { from { opacity: 0; transform: translateY(4px) scale(.5); } }
  .sign { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; animation: rise 520ms var(--ease-out) 380ms backwards; }
  .sign b { font-size: 17px; font-weight: 700; letter-spacing: .06em; }
  .sign span { font-size: 12px; opacity: .72; }

  /* ---------- 右：内容 ---------- */
  .pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 26px 34px 24px 38px; }
  .top { display: flex; align-items: center; gap: 12px; }
  .progress { flex: 1; display: flex; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .progress li { flex: 1; min-width: 0; }
  .progress button { width: 100%; display: flex; flex-direction: column; gap: 6px; text-align: left; font-size: 11.5px; color: var(--fg-3); }
  .progress button:disabled { cursor: default; }
  .progress i { display: block; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--md-on-surface) 12%, transparent); overflow: hidden; position: relative; }
  .progress i::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--md-primary); transform: scaleX(0); transform-origin: left; transition: transform 420ms var(--ease-out); }
  .progress .done i::after, .progress .on i::after { transform: none; }
  .progress .on button { color: var(--fg); font-weight: 600; }
  .progress .done button { color: var(--fg-2); }
  .progress .done button:hover:not(:disabled) { color: var(--fg); }
  .skip { flex: none; align-self: flex-start; margin-top: -4px; padding: 4px 10px; border-radius: 10px; font-size: 12px; color: var(--fg-3); transition: color var(--dur), background var(--dur); }
  .skip:hover { color: var(--fg); background: var(--hover); }

  .stage { flex: 1; min-height: 0; display: grid; margin-top: 22px; }
  /* 左右各留 4px：配色卡选中时的外描边不被裁掉 */
  .page { grid-area: 1 / 1; min-height: 0; overflow-y: auto; overflow-x: hidden; margin-left: -4px; padding: 0 4px 4px; }

  .eyebrow { margin: 18px 0 0; font-size: 15px; color: var(--fg-2); animation: rise 520ms var(--ease-out) 120ms backwards; }
  .word { margin: 2px 0 0; font-family: var(--font-display); font-size: 54px; font-weight: 700; line-height: 1.1; letter-spacing: .01em; color: var(--md-primary); }
  .word span { display: inline-block; animation: hop 640ms cubic-bezier(0.34, 1.56, 0.64, 1) calc(220ms + var(--i) * 55ms) backwards; }
  @keyframes hop { from { opacity: 0; transform: translateY(22px) scale(.7); } }
  h2 { margin: 6px 0 0; font-size: 26px; font-weight: 700; letter-spacing: -.01em; line-height: 1.3; }
  .lede { margin: 10px 0 0; max-width: 34em; font-size: 14px; line-height: 1.75; color: var(--fg-2); animation: rise 520ms var(--ease-out) 160ms backwards; }

  .features { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 24px 0 0; padding: 0; list-style: none; }
  .features li {
    display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
    background: color-mix(in srgb, var(--md-surface-container-high) 70%, transparent);
    animation: rise 520ms var(--ease-out) calc(420ms + var(--i) * 70ms) backwards;
  }
  .fi { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .features b { display: block; font-size: 13.5px; }
  .features small { display: block; margin-top: 1px; font-size: 11.5px; color: var(--fg-3); }

  /* 游戏目录 */
  .status {
    display: flex; align-items: center; gap: 14px; margin-top: 22px; padding: 16px 18px; border-radius: 18px;
    background: color-mix(in srgb, var(--md-surface-container-high) 70%, transparent);
    transition: background 300ms var(--ease-out);
  }
  .status.ok { background: color-mix(in srgb, var(--md-primary-container) 70%, transparent); color: var(--md-on-primary-container); }
  .si { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 14px; background: var(--md-surface-container-highest); color: var(--fg-2); }
  .ok .si { background: var(--md-primary); color: var(--md-on-primary); animation: pop 460ms cubic-bezier(0.34, 1.56, 0.64, 1); }
  .bad .si { color: var(--md-error); }
  @keyframes pop { from { transform: scale(.5); } }
  .st, .lt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .st b, .lt b { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; }
  .sub { font-size: 12px; color: var(--fg-3); overflow-wrap: anywhere; }
  .ok .sub { color: inherit; opacity: .75; }
  .path { font-size: 11.5px; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ver { padding: 0 6px; border-radius: 6px; font-size: 10.5px; font-weight: 500; line-height: 17px; background: color-mix(in srgb, currentColor 12%, transparent); }
  .acts { display: flex; gap: 8px; margin-top: 12px; }
  .acts .btn, .manual .btn, .wp .btn { height: 32px; }
  .other { display: flex; align-items: center; gap: 12px; margin-top: 10px; padding: 10px 14px; border-radius: 14px; border: 1px dashed var(--line-strong); }
  .other .lt { flex: 1; }
  .manual { display: flex; gap: 8px; margin-top: 14px; }
  .manual input { flex: 1; min-width: 0; height: 32px; font-size: 12px; }

  /* 配色 */
  .looks { margin-top: 14px; }
  /* 引导卡片高度固定：配色和预设外观的缩略图压矮一点，主页壁纸那一行不用滚动就能看到 */
  .looks :global(.sample) { height: 70px; }
  .looks :global(.presets) { margin-top: 10px; }
  .looks :global(.presets .sample) { height: 56px; }
  .wp { display: flex; align-items: center; gap: 14px; margin-top: 12px; padding: 12px 14px; border-radius: 16px; background: color-mix(in srgb, var(--md-surface-container-high) 70%, transparent); }
  .wp .lt { flex: 1; }
  .thumb { flex: none; width: 72px; height: 46px; border-radius: 10px; background-size: cover; background-position: center 30%; border: 1px solid var(--line); }
  .thumb.empty { background: radial-gradient(70% 90% at 80% 10%, var(--md-tertiary-container), transparent 70%), linear-gradient(160deg, var(--md-primary-container), var(--md-surface-container-high)); }

  /* 茶茶：服务商 + 密钥 + 使用说明 */
  .keybox {
    display: flex; flex-direction: column; gap: 10px; margin-top: 16px; padding: 14px 16px; border-radius: 18px;
    background: color-mix(in srgb, var(--md-surface-container-high) 70%, transparent);
    animation: rise 520ms var(--ease-out) 220ms backwards;
  }
  .keybox .sub { margin: 0; line-height: 1.7; }
  .kh { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .kh select { height: 30px; padding: 0 8px; font-size: 13px; font-weight: 600; border-radius: 10px; background: var(--md-surface-container-highest); border-color: transparent; cursor: pointer; }
  .pill { flex: none; padding: 0 10px; border-radius: 99px; font-size: 11.5px; line-height: 22px; color: var(--fg-3); background: color-mix(in srgb, var(--md-on-surface) 7%, transparent); }
  .pill.on { color: var(--md-on-primary-container); background: var(--md-primary-container); }
  .kf { display: flex; align-items: center; gap: 8px; }
  .kicon { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .kf input { flex: 1; min-width: 0; height: 34px; font-size: 12.5px; border-radius: 11px; }
  .kf input:focus { border-color: var(--md-primary); }
  .kf .btn { height: 34px; border-radius: 11px; }
  .kf .btn:disabled { opacity: .5; cursor: default; }
  .kstat { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 12px; line-height: 1.6; color: var(--fg-2); overflow-wrap: anywhere; }
  .kstat :global(svg) { flex: none; margin-top: 3px; }
  .kstat.ok { color: var(--md-primary); font-weight: 600; }
  .kstat.ok :global(svg) { padding: 1px; border-radius: 50%; background: var(--md-primary); color: var(--md-on-primary); }
  .kstat.bad { color: var(--md-error); }
  .cmd { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; border-radius: 10px; background: var(--md-surface-container-highest); }
  .cmd pre { flex: 1; min-width: 0; margin: 0; font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  code { padding: 0 4px; border-radius: 4px; font-family: var(--font-mono); font-size: .92em; background: color-mix(in srgb, var(--md-on-surface) 9%, transparent); }

  .howto { margin-top: 12px; padding: 0 2px; animation: rise 520ms var(--ease-out) 300ms backwards; }
  .howto > b { font-size: 12.5px; color: var(--fg-2); }
  .howto ol { counter-reset: how; display: flex; flex-direction: column; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
  .howto li { counter-increment: how; position: relative; padding-left: 28px; font-size: 12.5px; line-height: 1.75; color: var(--fg-2); }
  .howto li::before {
    content: counter(how); position: absolute; left: 0; top: 2px; display: grid; place-items: center; width: 19px; height: 19px; border-radius: 50%;
    font: 600 11px/1 var(--font-mono); color: var(--md-on-secondary-container); background: var(--md-secondary-container);
  }
  .url { color: var(--fg); font-size: 12px; user-select: text; }
  .cp { display: inline-grid; place-items: center; width: 20px; height: 20px; margin: 0 2px; vertical-align: -5px; border-radius: 6px; color: var(--fg-3); transition: background var(--dur), color var(--dur); }
  .cp:hover { background: var(--hover); color: var(--fg); }
  .howto :global(.keys) { vertical-align: 1px; }
  .fine { margin: 10px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--fg-3); }

  /* 出发 */
  .call {
    display: flex; align-items: center; gap: 14px; margin-top: 22px; padding: 14px 16px; border-radius: 18px;
    background: color-mix(in srgb, var(--md-primary-container) 70%, transparent); color: var(--md-on-primary-container);
    animation: rise 520ms var(--ease-out) 240ms backwards;
  }
  .call .lt { flex: 1; }
  .call .sub { color: inherit; opacity: .75; }
  .ci { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--md-primary); color: var(--md-on-primary); }
  .summary { display: flex; flex-direction: column; margin: 16px 0 0; padding: 0; list-style: none; }
  .summary li { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 4px; font-size: 13px; animation: rise 520ms var(--ease-out) backwards; }
  .summary li:nth-child(1) { animation-delay: 320ms; }
  .summary li:nth-child(2) { animation-delay: 380ms; }
  .summary li:nth-child(3) { animation-delay: 440ms; }
  .summary li:nth-child(4) { animation-delay: 500ms; }
  .summary li + li { border-top: 1px solid var(--line-soft); }
  .ck { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1.5px dashed var(--line-strong); }
  .summary .ok .ck { border: 0; background: var(--md-primary); color: var(--md-on-primary); }
  .summary .k { flex: none; width: 76px; color: var(--fg-2); }
  .summary .v { flex: 1; min-width: 0; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .summary li:not(.ok) .v { color: var(--fg-3); }
  .summary .v.mono { font-size: 12px; }
  .checkup { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 10px 14px 10px 10px; border-radius: 16px; border: 1px solid var(--line);
    transition: background 240ms, border-color 240ms; animation: rise 520ms var(--ease-out) 560ms backwards; }
  .checkup.on { background: color-mix(in srgb, var(--md-primary-container) 45%, transparent); border-color: color-mix(in srgb, var(--md-primary) 30%, var(--line)); }
  .checkup .ci { width: 32px; height: 32px; border-radius: 10px; background: var(--md-secondary-container); color: var(--md-on-secondary-container); transition: background 240ms, color 240ms; }
  .checkup.on .ci { background: var(--md-primary); color: var(--md-on-primary); }
  .checkup .lt { flex: 1; min-width: 0; }

  /* ---------- 底部按钮 ---------- */
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
  .back { height: 38px; padding-inline: 10px 14px; border-radius: 13px; }
  .go-wrap { position: relative; }
  .go {
    display: inline-flex; align-items: center; gap: 8px; height: 46px; padding: 0 22px 0 26px; border-radius: 16px;
    font-size: 15px; font-weight: 700; letter-spacing: .04em; background: var(--md-primary); color: var(--md-on-primary);
    box-shadow: 0 14px 28px -14px color-mix(in srgb, var(--md-primary) 90%, transparent);
    transition: filter var(--dur), transform 200ms var(--ease-out);
  }
  .go:hover:not(:disabled) { filter: brightness(1.07); }
  .go:hover:not(:disabled) :global(svg) { transform: translateX(3px); }
  .go :global(svg) { transition: transform 220ms var(--ease-out); }
  .go:active:not(:disabled) { transform: scale(.97); }
  .go:disabled { cursor: default; }
  .go:focus-visible { outline: 3px solid color-mix(in srgb, var(--md-primary) 45%, transparent); outline-offset: 3px; }
  .go.final { padding-inline: 30px 26px; }

  /* 进入时撒出的叶子 */
  .burst { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
  .burst i {
    position: absolute; left: -6px; top: -6px; color: var(--md-primary); opacity: 0;
    animation: leaf 760ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
  }
  .burst i:nth-child(3n) { color: var(--md-tertiary); }
  .burst i:nth-child(3n + 1) { color: var(--md-secondary); }
  @keyframes leaf {
    0% { opacity: 1; transform: rotate(var(--a)) translateX(10px) rotate(0) scale(.4); }
    70% { opacity: 1; }
    100% { opacity: 0; transform: rotate(var(--a)) translateX(var(--d)) rotate(var(--r)) scale(var(--s)); }
  }

  /* 窗口矮时压一压 */
  @media (max-height: 760px) {
    .welcome { padding-top: 42px; padding-bottom: 20px; }
    .mascot { width: 140px; height: 140px; }
    .word { font-size: 46px; }
    .eyebrow { margin-top: 4px; }
    .features { margin-top: 18px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .blob, .twinkle, .bob, .card, .mascot, .bubble, .sign, .word span, .eyebrow, .lede, .features li, .call, .summary li, .ok .si, .keybox, .howto { animation: none; }
    .twinkle { opacity: .3; }
    .burst { display: none; }
  }
</style>
