<script lang="ts">
  // 设置页：所有设置集中在这里。左侧目录（可搜索），右侧按节排列；各节样式见 src/lib/settings/settings.css。
  import { onMount, tick } from 'svelte';
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  import Rocket from '@lucide/svelte/icons/rocket';
  import FileCode from '@lucide/svelte/icons/file-code';
  import Bot from '@lucide/svelte/icons/bot';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import Wrench from '@lucide/svelte/icons/wrench';
  import Download from '@lucide/svelte/icons/download';
  import Network from '@lucide/svelte/icons/network';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import Palette from '@lucide/svelte/icons/palette';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import AppWindow from '@lucide/svelte/icons/app-window';
  import Database from '@lucide/svelte/icons/database';
  import Info from '@lucide/svelte/icons/info';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import HardDriveDownload from '@lucide/svelte/icons/hard-drive-download';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Toggle from '../components/Toggle.svelte';
  import KeywordInput from '../components/KeywordInput.svelte';
  import GameRoot from '../settings/GameRoot.svelte';
  import GameSettings from '../settings/GameSettings.svelte';
  import Endpoints from '../settings/Endpoints.svelte';
  import AgentTools from '../settings/AgentTools.svelte';
  import DownloadSettings from '../settings/DownloadSettings.svelte';
  import Storage from '../settings/Storage.svelte';
  import CommunityAcceleration from '../settings/CommunityAcceleration.svelte';
  import Appearance from '../settings/Appearance.svelte';
  import LauncherBehavior from '../settings/LauncherBehavior.svelte';
  import DataReset from '../settings/DataReset.svelte';
  import About from '../settings/About.svelte';
  import '../settings/settings.css';
  import { agent } from '../agent';
  import { THINKING_LABEL } from '../agent/chat.svelte';
  import { piHost, type PiProvider, type PiToolInfo, type PiConfirmMode } from '../agent/host';
  import { TOOLS } from '../agent/tools';
  import { isMissing, type PiModel, type ThinkingLevel } from '../agent/pi-protocol';
  import { prefs } from '../stores/prefs.svelte';
  import { biliFilter } from '../stores/bili-filter.svelte';
  import { nav } from '../stores/nav.svelte';
  import { sfx } from '../sound/sfx.svelte';
  import { app } from '../stores/app.svelte';
  import { errorText } from '../api/bridge';
  import { settingsEpoch } from '../stores/settings-sync.svelte';

  // ---------- 目录：分组 + 搜索关键词 ----------
  const toc = [
    { title: '游戏', items: [
      { id: 'root', label: '游戏目录', icon: HardDrive, keys: '路径 安装 steam 版本 文件夹' },
      { id: 'game', label: '启动项', icon: Rocket, keys: '启动方式 参数 帧率 fps 分辨率 窗口 无边框 控制台 novid 刷新率' },
      { id: 'cfg', label: '游戏配置', icon: FileCode, keys: 'cfg autoexec 准星 轮廓 net_graph 网络 画面' },
    ] },
    { title: '茶茶', items: [
      { id: 'model', label: '模型', icon: Bot, keys: '茶茶 助手 agent pi 连接 思考 强度 用量 token 费用 压缩' },
      { id: 'keys', label: '服务商与密钥', icon: KeyRound, keys: 'api key 密钥 登录 订阅 端点 中转 本地模型 ollama' },
      { id: 'assistant', label: '对话', icon: MessageSquare, keys: '茶茶 助手 聊天 发送 enter 排队 插话 思考过程 会话 提示音 自动压缩 重试' },
      { id: 'tools', label: '工具与权限', icon: Wrench, keys: '完全访问 自主 每次都问 工具 权限 写入 改动文件 玩家记忆' },
    ] },
    { title: '下载与发现', items: [
      { id: 'downloads', label: '下载', icon: Download, keys: '并发 同时 限速 通知 点赞 作者' },
      { id: 'storage', label: '存储', icon: HardDriveDownload, keys: 'c盘 系统盘 空间 磁盘 硬盘 位置 下载位置 缓存 清理 回收站 硬链接 压缩包 内存' },
      { id: 'network', label: '社区加速', icon: Network, keys: 'steam++ 加速 工坊 网络 证书' },
      { id: 'bili', label: 'B站过滤', icon: ListFilter, keys: 'b站 bilibili 过滤 关键词 屏蔽 正则' },
    ] },
    { title: '通用', items: [
      { id: 'look', label: '外观', icon: Palette, keys: '配色 主题 壁纸 深色 浅色 字体 缩放 动效 动画' },
      { id: 'sound', label: '声音', icon: Volume2, keys: '音量 静音 音效 音乐' },
      { id: 'launcher', label: '启动器', icon: AppWindow, keys: '最小化 托盘 关闭 开机 自启 茶茶 助手窗口 分栏' },
      { id: 'data', label: '数据与重置', icon: Database, keys: '数据 目录 日志 缓存 清理 导出 导入 恢复 默认 重置' },
      { id: 'about', label: '关于', icon: Info, keys: '版本 更新 快捷键 开源 许可' },
    ] },
  ];
  const all = toc.flatMap(g => g.items);
  let active = $state('root');
  let query = $state('');
  let scroller = $state<HTMLDivElement>();
  let storagePanel: ReturnType<typeof Storage>;
  const q = $derived(query.trim().toLowerCase());
  const hits = $derived(q ? all.filter(s => `${s.label} ${s.keys}`.toLowerCase().includes(q)) : []);

  // 点目录跳转：平滑滚动期间不让滚动监听把高亮带跑
  let lockUntil = 0;
  function go(id: string, smooth = true) {
    active = id;
    lockUntil = Date.now() + (smooth ? 700 : 80);
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }
  function onFind(e: KeyboardEvent) {
    if (e.key === 'Enter' && hits[0]) { go(hits[0].id); }
    else if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); query = ''; }
  }
  // 滚动高亮：取顶部之下第一个已经露头的节；滚到底时高亮最后一节。只读 15 个位置，直接算
  function spy() {
    const el = scroller;
    if (!el || Date.now() < lockUntil) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) { active = all[all.length - 1].id; return; }
    const top = el.getBoundingClientRect().top;
    let cur = all[0].id;
    for (const s of all) {
      const node = document.getElementById(`set-${s.id}`);
      if (node && node.getBoundingClientRect().top - top <= 96) cur = s.id;
    }
    active = cur;
  }
  onMount(() => {
    void loadProviders(); void loadTools(); void loadDefaults(); void loadConfirmMode();
    if (agent.connected) void agent.refreshStats();
  });
  // 茶茶改过自己的默认值（自动压缩、重试、默认模型…）后重读
  let piEpoch = settingsEpoch['pi-settings'];
  $effect(() => { const e = settingsEpoch['pi-settings']; if (e !== piEpoch) { piEpoch = e; void loadDefaults(); } });
  // 从首页「启动设置」、助手齿轮等处跳过来时定位到对应一节
  $effect(() => {
    const target = nav.settings;
    if (!target) return;
    nav.settings = '';
    void tick().then(() => go(target, false));
  });

  // ---------- 模型 ----------
  const groups = $derived.by(() => {
    const map = new Map<string, PiModel[]>();
    for (const m of agent.models) map.set(m.provider, [...(map.get(m.provider) ?? []), m]);
    return [...map.entries()];
  });
  const levels = $derived<ThinkingLevel[]>(agent.thinkingLevels.length ? agent.thinkingLevels : ['off', 'minimal', 'low', 'medium', 'high']);
  const fmtK = (n?: number | null) => (n == null ? '—' : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  const price = (m: PiModel) => (m.cost ? `$${m.cost.input} / $${m.cost.output}` : '');
  const thinkingOff = $derived(!agent.caps.thinking || agent.current?.reasoning === false);
  let copied = $state('');
  function copyText(key: string, text: string) { void navigator.clipboard?.writeText(text).then(() => { copied = key; setTimeout(() => (copied = ''), 1200); }); }

  // ---------- 服务商密钥（pi-auth-*，助手未连接时也能用） ----------
  let providers = $state<PiProvider[] | null>(null);
  let providersMissing = $state(false);
  let providersError = $state('');
  let editing = $state('');
  let keyDraft = $state('');
  let saving = $state(false);
  async function loadProviders() {
    providersError = '';
    const r = await piHost.providers();
    if (r.ok) { providers = r.value.providers; providersMissing = false; }
    else { providers = []; providersMissing = r.missing; providersError = r.missing ? '' : r.error; }
  }
  async function saveKey(p: PiProvider) {
    if (!keyDraft.trim()) return;
    saving = true;
    const r = await piHost.setKey(p.id, keyDraft.trim());
    saving = false;
    if (!r.ok) { app.toast(r.missing ? '当前版本还不能在这里保存密钥' : r.error); return; }
    keyDraft = ''; editing = '';
    app.toast(agent.connected ? `${p.name} 密钥已保存，正在刷新模型` : `${p.name} 密钥已保存，茶茶连上后可用`);
    await loadProviders();
    if (agent.connected) agent.reconnect();
  }
  async function removeKey(p: PiProvider) {
    if (!await app.confirm('移除密钥', `移除 ${p.name} 的 API Key？\n使用这个服务商的模型将不可用。`, '移除')) return;
    const r = await piHost.removeKey(p.id);
    if (!r.ok) { app.toast(r.missing ? '当前版本还不能在这里移除密钥' : r.error); return; }
    await loadProviders();
    if (agent.connected) agent.reconnect();
  }

  // ---------- 工具（pi-tools；旧后端用前端自带的清单） ----------
  let tools = $state<PiToolInfo[]>(Object.entries(TOOLS).map(([name, t]) => ({ name, label: t.label, description: t.description, write: t.write, enabled: true })));
  // ---------- 确认方式：自主 / 每次都问（pi-permissions；旧后端没有就不显示） ----------
  let confirmMode = $state<PiConfirmMode | null>(null);
  let savingMode = $state(false);
  const fullAccessNote = '茶茶按你的要求读取安装包、整理 Mod、登记本地 DLL，也可直接写入桌面和文档中的文本、Markdown 与 CSV。运行第三方程序、永久删除和系统改动仍会弹窗。';
  async function loadConfirmMode() {
    const r = await piHost.permissions();
    confirmMode = r.ok ? r.value.mode : null;
  }
  async function setConfirmMode(mode: PiConfirmMode) {
    if (savingMode || confirmMode === mode) return;
    savingMode = true;
    try {
      if (mode === 'full' && !await app.confirm('开启完全访问？',fullAccessNote,'开启完全访问')) return;
      const r = await piHost.savePermissions(mode);
      if (r.ok) confirmMode = r.value.mode; else app.toast(`没改成：${r.error}`);
    } finally { savingMode = false; }
  }
  async function loadTools() {
    const r = await piHost.tools();
    if (r.ok) tools = r.value.tools;
  }

  // ---------- 自动压缩 / 自动重试：已连接走 RPC（后端会顺带保存默认值），未连接直接写 settings.json ----------
  let autoRetry = $state(true);
  let defaultsMissing = $state(false);
  async function loadDefaults() {
    const r = await piHost.settings();
    if (r.ok) {
      if (r.value.autoRetry !== undefined) autoRetry = r.value.autoRetry;
      if (r.value.autoCompaction !== undefined && !agent.connected) agent.autoCompaction = r.value.autoCompaction;
    } else defaultsMissing = r.missing;
  }
  async function setFlag(kind: 'compaction' | 'retry', on: boolean) {
    try {
      if (agent.connected) await agent.query(kind === 'compaction' ? 'set_auto_compaction' : 'set_auto_retry', { enabled: on });
      else {
        const r = await piHost.saveSettings(kind === 'compaction' ? { autoCompaction: on } : { autoRetry: on });
        if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code });
      }
      if (kind === 'compaction') agent.autoCompaction = on; else autoRetry = on;
    } catch (e) { app.toast(isMissing(e) ? '当前版本还不能修改这个开关' : errorText(e)); }
  }

  const s = sfx.settings;
</script>

<div class="settings">
  <nav class="toc" aria-label="设置目录">
    <h1>设置</h1>
    <label class="find">
      <Search size={14} />
      <input aria-label="搜索设置" placeholder="搜索设置" spellcheck="false" bind:value={query} onkeydown={onFind} />
      {#if query}<button class="clear" aria-label="清空搜索" onclick={() => (query = '')}><X size={13} /></button>{/if}
    </label>
    {#if q}
      {#each hits as sec (sec.id)}
        <button class:on={active === sec.id} onclick={() => go(sec.id)}><sec.icon size={15} />{sec.label}</button>
      {:else}
        <p class="none">没有找到「{query.trim()}」</p>
      {/each}
    {:else}
      {#each toc as grp (grp.title)}
        <div class="tg">{grp.title}</div>
        {#each grp.items as sec (sec.id)}
          <button class:on={active === sec.id} aria-current={active === sec.id ? 'true' : undefined} onclick={() => go(sec.id)}><sec.icon size={15} />{sec.label}</button>
        {/each}
      {/each}
    {/if}
  </nav>

  <div class="scroll" bind:this={scroller} onscroll={spy}>
    <div class="inner">
      <GameRoot />
      <GameSettings />

      <!-- ================= 模型 ================= -->
      <section id="set-model">
        <h2>模型</h2>
        <div class="card">
          <div class="line">
            <div class="lt">
              <b>连接<span class="conn" class:on={agent.connected}><i></i>{agent.connected ? '已连接' : agent.connecting ? '连接中' : '未连接'}</span></b>
              {#if agent.connected && agent.models.length}<span class="sub">{agent.model}</span>{:else if !agent.connected && agent.connectionError}<span class="sub">{agent.connectionError}</span>{/if}
            </div>
            {#if agent.connected}<button class="btn ghost" disabled={agent.running || agent.connecting} onclick={() => agent.reconnect()}><RotateCcw size={13} />重新连接</button>
            {:else}<button class="btn primary" disabled={agent.connecting} onclick={() => agent.connect()}>{#if agent.connecting}<LoaderCircle size={13} class="spin" />连接中…{:else}重试连接{/if}</button>{/if}
          </div>
          {#if agent.connected && agent.stats?.tokens?.total}
            {@const st = agent.stats}
            <div class="line">
              <div class="lt"><b>本次会话</b>
                <span class="sub nums">上下文 {st.contextUsage?.percent ?? '—'}%（{fmtK(st.contextUsage?.tokens)} / {fmtK(st.contextUsage?.contextWindow)}）· {fmtK(st.tokens!.total)} tokens · 约 ${(st.cost ?? 0).toFixed(3)} · {st.userMessages ?? 0} 轮</span></div>
              <div class="row">
                <button class="btn ghost" disabled={agent.running || agent.compacting || !agent.caps.compact} onclick={() => void agent.compact()}>压缩上下文</button>
                <button class="icon-btn" title="刷新用量" aria-label="刷新用量" onclick={() => void agent.refreshStats()}><RefreshCw size={13} /></button>
              </div>
            </div>
          {/if}
        </div>

        {#if agent.connected}
          {#if !agent.models.length}
            <div class="card">
              <div class="line">
                <div class="lt"><b>还没有可用的模型</b><span class="sub">先填一个服务商的 API Key，或者添加自定义端点</span></div>
                <button class="btn primary" onclick={() => go('keys')}>去填写<ChevronRight size={14} /></button>
              </div>
            </div>
          {:else}
            <h3>当前模型</h3>
            <div class="card models" role="radiogroup" aria-label="当前模型">
              {#each groups as [provider, list] (provider)}
                <div class="ph">{provider}</div>
                {#each list as m (`${m.provider}/${m.id}`)}
                  {@const on = agent.modelKey === `${m.provider}/${m.id}`}
                  <button class="model" class:on role="radio" aria-checked={on} disabled={agent.running || agent.switching} onclick={() => void agent.selectModel(`${m.provider}/${m.id}`)}>
                    <span class="radio" class:on></span>
                    <span class="mn"><b title={m.id}>{m.name ?? m.id}</b>
                      <span class="badges">
                        {#if m.reasoning}<i>思考</i>{/if}{#if m.input?.includes('image')}<i>看图</i>{/if}
                        {#if m.contextWindow}<i>{fmtK(m.contextWindow)} 上下文</i>{/if}
                        {#if price(m)}<i class="mono" title="每百万 tokens 输入 / 输出价格">{price(m)}</i>{/if}
                      </span></span>
                    <span class="mid mono">{m.id}</span>
                  </button>
                {/each}
              {/each}
            </div>
            <div class="card">
              <div class="line">
                <div class="lt"><b>思考强度</b><span class="sub">{thinkingOff ? '当前模型不支持调节思考' : '越高越仔细，也越慢、越费 token'}</span></div>
                <div class="seg" role="radiogroup" aria-label="思考强度">
                  {#each levels as l (l)}
                    <button role="radio" aria-checked={agent.thinkingLevel === l} class:on={agent.thinkingLevel === l} disabled={thinkingOff || agent.switching} onclick={() => void agent.setThinking(l)}>{THINKING_LABEL[l]}</button>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </section>

      <!-- ================= 服务商与密钥 ================= -->
      <section id="set-keys">
        <h2>服务商与密钥</h2>
        <p class="lead">密钥仅保存在本机。</p>
        {#if providersMissing}
          <div class="card">
            <div class="note">
              当前版本还不能在这里填密钥，可以先在终端里登录：
              <ol><li>复制下面的命令，在 PowerShell 里运行</li><li>进入后输入 <code>/login</code> 登录，<code>/model</code> 选模型</li><li>回到这里点「重试连接」</li></ol>
              {#if agent.loginCommand}<div class="code"><pre class="mono">{agent.loginCommand}</pre><button class="icon-btn" title="复制命令" aria-label="复制命令" onclick={() => copyText('login', agent.loginCommand)}>{#if copied === 'login'}<Check size={13} />{:else}<Copy size={13} />{/if}</button></div>{/if}
            </div>
          </div>
        {:else if providersError}<p class="hint">{providersError} <button class="link" onclick={() => void loadProviders()}>重试</button></p>
        {:else if providers === null}<p class="hint"><LoaderCircle size={12} class="spin" /> 读取中…</p>
        {:else}
          <div class="card">
            {#each providers as p (p.id)}
              <div class="prov">
                <div class="line">
                  <div class="lt"><b>{p.name}{#if p.configured}<span class="w ok">已配置</span>{/if}</b>
                    <span class="sub">{p.configured ? (p.source === 'env' ? '来自环境变量' : p.source === 'oauth' ? '已用订阅账号登录' : p.keyHint ? `密钥 ••••${p.keyHint}` : '已保存密钥') : p.kind === 'oauth' ? '用订阅账号登录' : '未配置'}</span></div>
                  {#if p.kind !== 'oauth'}
                    <div class="row">
                      {#if p.configured && p.source === 'auth'}<button class="btn ghost" onclick={() => void removeKey(p)}>移除</button>{/if}
                      <button class="btn" aria-expanded={editing === p.id} onclick={() => { editing = editing === p.id ? '' : p.id; keyDraft = ''; }}>{p.configured ? '更换密钥' : '填写密钥'}</button>
                    </div>
                  {:else}<span class="sub">在终端里 <code>/login</code></span>{/if}
                </div>
                {#if editing === p.id}
                  <form class="keyform" onsubmit={(e) => { e.preventDefault(); void saveKey(p); }}>
                    <input type="password" autocomplete="off" spellcheck="false" placeholder={`${p.name} API Key`} bind:value={keyDraft} />
                    <button class="btn primary" disabled={!keyDraft.trim() || saving}>{saving ? '保存中…' : '保存'}</button>
                  </form>
                {/if}
              </div>
            {/each}
          </div>
          {#if agent.loginCommand}
            <details class="oauth"><summary><ChevronRight size={14} class="chev" />用订阅账号登录（Claude Pro、ChatGPT 等）</summary>
              <p class="hint">运行下面的命令，输入 <code>/login</code>，登录后点「重新连接」。</p>
              <div class="code"><pre class="mono">{agent.loginCommand}</pre><button class="icon-btn" title="复制命令" aria-label="复制命令" onclick={() => copyText('login', agent.loginCommand)}>{#if copied === 'login'}<Check size={13} />{:else}<Copy size={13} />{/if}</button></div>
            </details>
          {/if}
        {/if}
        <Endpoints />
      </section>

      <!-- ================= 对话 ================= -->
      <section id="set-assistant">
        <h2>对话</h2>
        <div class="card">
          <div class="line"><div class="lt"><b>Enter 发送</b><span class="sub">{prefs.enterSends ? 'Shift+Enter 换行' : '关闭后用 Ctrl+Enter 发送，Enter 换行'}</span></div><Toggle on={prefs.enterSends} onchange={() => (prefs.enterSends = !prefs.enterSends)} label="Enter 发送" /></div>
          <div class="line"><div class="lt"><b>回复中再发消息</b></div>
            <div class="seg sm" role="radiogroup" aria-label="回复中再发消息">
              <button role="radio" aria-checked={prefs.busySend === 'followUp'} class:on={prefs.busySend === 'followUp'} onclick={() => (prefs.busySend = 'followUp')}>排队</button>
              <button role="radio" aria-checked={prefs.busySend === 'steer'} class:on={prefs.busySend === 'steer'} onclick={() => (prefs.busySend = 'steer')}>插话</button>
            </div></div>
          <div class="line"><div class="lt"><b>思考过程</b></div>
            <div class="seg sm" role="radiogroup" aria-label="思考过程">
              {#each [['auto', '自动'], ['expanded', '展开'], ['collapsed', '收起'], ['hidden', '隐藏']] as [v, l] (v)}
                <button role="radio" aria-checked={prefs.thinking === v} class:on={prefs.thinking === v} onclick={() => (prefs.thinking = v as typeof prefs.thinking)}>{l}</button>
              {/each}
            </div></div>
          <div class="line"><div class="lt"><b>显示上下文用量</b></div><Toggle on={prefs.showUsage} onchange={() => (prefs.showUsage = !prefs.showUsage)} label="显示上下文用量" /></div>
          <div class="line"><div class="lt"><b>自动命名会话</b></div><Toggle on={prefs.autoTitle} onchange={() => (prefs.autoTitle = !prefs.autoTitle)} label="自动命名会话" /></div>
          <div class="line"><div class="lt"><b>回复完成提示音</b></div><Toggle on={prefs.replySound} onchange={() => (prefs.replySound = !prefs.replySound)} label="回复完成提示音" /></div>
        </div>
        {#if agent.connected || !defaultsMissing}
          <h3>上下文</h3>
          <div class="card">
            <div class="line"><div class="lt"><b>自动压缩</b><span class="sub">上下文将满时摘要早先的对话</span></div>
              <Toggle on={agent.autoCompaction} onchange={() => void setFlag('compaction', !agent.autoCompaction)} label="自动压缩" /></div>
            <div class="line"><div class="lt"><b>出错自动重试</b><span class="sub">适用于服务商过载或限流</span></div>
              <Toggle on={autoRetry} onchange={() => void setFlag('retry', !autoRetry)} label="出错自动重试" /></div>
          </div>
        {/if}
      </section>

      <!-- ================= 工具 ================= -->
      <section id="set-tools">
        <h2>工具与权限</h2>
        {#if confirmMode}
          <div class="card">
            <div class="line">
              <div class="lt"><b>确认方式</b>
                <span class="sub">{confirmMode === 'full' ? fullAccessNote : confirmMode === 'auto'
                  ? '读取和可撤销的整理直接执行。运行程序、删除文件、联网下载、系统改动及可疑 DLL 仍需确认。'
                  : '读取本机文件、运行命令和修改内容前逐次确认。'}</span></div>
              <div class="seg" role="radiogroup" aria-label="确认方式">
                {#each [['ask','每次都问'],['auto','自主'],['full','完全访问']] as const as [mode, label] (mode)}
                  <button role="radio" disabled={savingMode} aria-checked={confirmMode === mode} class:on={confirmMode === mode} onclick={() => void setConfirmMode(mode)}>{label}</button>
                {/each}
              </div>
            </div>
          </div>
        {/if}
        <AgentTools {tools} />
      </section>

      <DownloadSettings />
      <Storage bind:this={storagePanel} />
      <CommunityAcceleration />

      <!-- ================= B站过滤 ================= -->
      <section id="set-bili">
        <h2>B站过滤</h2>
        <p class="lead">关键词匹配标题、简介、标签和 UP 主名，忽略大小写。</p>
        <div class="card">
          <div class="line"><div class="lt"><b>只看 Mod 发布</b></div><Toggle on={biliFilter.mode === 'mod'} onchange={() => (biliFilter.mode = biliFilter.mode === 'mod' ? 'all' : 'mod')} label="只看 Mod 发布" /></div>
          <div class="line"><div class="lt"><b>只看有下载链接的</b></div><Toggle on={biliFilter.onlyRes} onchange={() => (biliFilter.onlyRes = !biliFilter.onlyRes)} label="只看有下载链接的" /></div>
          <div class="line kw">
            <div class="lt"><b>必须包含{#if biliFilter.include.length}<span class="w">{biliFilter.include.length}</span>{/if}</b><span class="sub">匹配任一词；支持正则，如 <code>/第.+期/</code></span></div>
            <KeywordInput bind:words={biliFilter.include} label="必须包含的关键词" placeholder="例如：武器、贴皮、人物 —— 回车添加" />
          </div>
          <div class="line kw">
            <div class="lt"><b>屏蔽词{#if biliFilter.exclude.length}<span class="w">{biliFilter.exclude.length}</span>{/if}</b><span class="sub">屏蔽词优先</span></div>
            <KeywordInput bind:words={biliFilter.exclude} label="屏蔽词" placeholder="例如：原神、三角洲 —— 回车添加" />
          </div>
        </div>
      </section>

      <Appearance />

      <!-- ================= 声音 ================= -->
      <section id="set-sound">
        <h2>声音</h2>
        <div class="card">
          <div class="line">
            <div class="lt"><b>音量</b>{#if s.muted}<span class="sub">已静音</span>{/if}</div>
            <div class="vol">
              <button class="icon-btn" aria-pressed={s.muted} title={s.muted ? '取消静音' : '静音'} aria-label={s.muted ? '取消静音' : '静音'} onclick={() => (s.muted = !s.muted)}>{#if s.muted || s.volume === 0}<VolumeX size={15} />{:else}<Volume2 size={15} />{/if}</button>
              <input type="range" min="0" max="1" step="0.05" bind:value={s.volume} class:muted={s.muted} aria-label="音量" />
              <span class="val">{Math.round(s.volume * 100)}</span>
            </div>
          </div>
          <div class="line"><div class="lt"><b>界面音效</b></div><Toggle on={s.ui} onchange={() => (s.ui = !s.ui)} label="界面音效" /></div>
          <div class="line"><div class="lt"><b>背景音乐</b><span class="sub">游戏运行或窗口收起时暂停</span></div><Toggle on={s.ambient} onchange={() => (s.ambient = !s.ambient)} label="主页音乐" /></div>
        </div>
      </section>

      <LauncherBehavior />
      <DataReset changeStorage={() => storagePanel.browse()} />
      <About />
    </div>
  </div>
</div>

<style>
  /* 目录搜索 */
  .find { position: relative; display: flex; align-items: center; gap: 8px; height: 34px; margin: 0 2px 6px; padding: 0 10px; border-radius: 10px; color: var(--fg-3);
    background: color-mix(in srgb, var(--md-on-surface) 6%, transparent); border: 1px solid transparent; transition: border-color var(--dur), background var(--dur); }
  .find:focus-within { border-color: color-mix(in srgb, var(--md-primary) 55%, transparent); background: var(--bg-1); color: var(--fg-2); }
  .find input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: none; font-size: 13px; }
  .find .clear { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; color: var(--fg-3); }
  .find .clear:hover { background: var(--hover); color: var(--fg); }
  .none { margin: 10px 10px 0; font-size: 12px; color: var(--fg-3); }

  /* 模型 */
  .conn { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 400; color: var(--fg-3); }
  .conn i { width: 6px; height: 6px; border-radius: 50%; background: var(--fg-4); }
  .conn.on { color: var(--md-primary); }
  .conn.on i { background: var(--md-primary); }
  .nums { font-variant-numeric: tabular-nums; }
  .models { padding: 4px 0 6px; }
  .ph { padding: 10px 18px 4px; font-size: 11.5px; font-weight: 600; color: var(--fg-3); }
  .model { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 7px 18px; text-align: left; transition: background var(--dur); }
  .model:hover:not(:disabled) { background: color-mix(in srgb, var(--md-on-surface) 5%, transparent); }
  .model.on { background: color-mix(in srgb, var(--md-primary) 8%, transparent); }
  .model:disabled { cursor: default; }
  .model:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
  .radio { width: 16px; height: 16px; flex: none; border: 1.5px solid var(--fg-4); border-radius: 50%; transition: border-color var(--dur), box-shadow var(--dur); }
  .radio.on { border-color: var(--md-primary); box-shadow: inset 0 0 0 3px var(--bg-1), inset 0 0 0 8px var(--md-primary); }
  .mn { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .mn b { font-size: 13px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badges { display: flex; gap: 4px; flex-wrap: wrap; }
  .badges i { font-style: normal; font-size: 11px; height: 18px; line-height: 18px; padding: 0 6px; border-radius: 6px; color: var(--fg-3); background: color-mix(in srgb, var(--md-on-surface) 7%, transparent); white-space: nowrap; }
  .mid { flex: none; max-width: 38%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--fg-4); }

  /* 密钥 */
  .prov + .prov { border-top: 1px solid var(--line-soft); }
  .w.ok { color: var(--md-primary); background: color-mix(in srgb, var(--md-primary) 13%, transparent); }
  .keyform { display: flex; gap: 8px; padding: 0 18px 14px; animation: rise 180ms var(--ease-out); }
  .keyform input { flex: 1; height: 32px; font-family: var(--font-mono); font-size: 12px; }
  .keyform .btn { height: 32px; }
  .note ol { margin: 8px 0 12px; padding-left: 18px; }
  code { padding: 1px 5px; border-radius: 5px; background: color-mix(in srgb, var(--md-on-surface) 8%, transparent); font: 11.5px var(--font-mono); color: var(--fg-2); }
  .code { display: flex; align-items: flex-start; gap: 8px; padding: 8px 8px 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
  .code pre { flex: 1; margin: 0; font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; color: var(--fg-2); }
  .oauth { margin: 12px 0 0; font-size: 12.5px; color: var(--fg-3); }
  .oauth summary { display: inline-flex; align-items: center; gap: 6px; padding: 4px 2px; cursor: pointer; list-style: none; }
  .oauth summary::-webkit-details-marker { display: none; }
  .oauth summary:hover { color: var(--fg); }
  .oauth summary :global(.chev) { transition: transform var(--dur) var(--ease-out); }
  .oauth[open] summary :global(.chev) { transform: rotate(90deg); }
  .oauth .code { margin-top: 8px; }

  /* B站关键词：标签在上，输入框占满 */
  .kw { flex-direction: column; align-items: stretch; gap: 10px; padding-bottom: 14px; }

  /* 声音 */
  .vol input.muted { opacity: .45; }

  @media (prefers-reduced-motion: reduce) { .keyform { animation: none; } }
</style>
