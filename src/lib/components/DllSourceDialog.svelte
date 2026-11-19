<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import Github from '@lucide/svelte/icons/git-fork';
  import Store from '@lucide/svelte/icons/store';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import FileArchive from '@lucide/svelte/icons/file-archive';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/triangle-alert';
  import Ban from '@lucide/svelte/icons/ban';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { agent } from '../agent';
  import { api } from '../api';
  import { desktop, errorText, pickDirectory, pickDllPackage } from '../api/bridge';
  import { app } from '../stores/app.svelte';
  import { askAgent, intakePrompt, parseGithub, parseWorkshop, SOURCE_LABEL, type SourceKind } from '../plugins/intake';
  import type { IntakeDetails, IntakeResult } from '../types';

  let dialog = $state<HTMLDialogElement>();
  let kind = $state<SourceKind>('github');
  let github = $state(''), workshop = $state(''), local = $state('');
  const gh = $derived(parseGithub(github));
  const ws = $derived(parseWorkshop(workshop));
  const value = $derived(kind === 'github' ? gh?.url : kind === 'workshop' ? ws?.url : local.trim() || undefined);
  const ready = $derived(agent.connected && agent.modelReady);
  const blocked = $derived(!app.runtime.installed ? '先部署 Matcha 加载器' : app.game.running ? '退出游戏后可导入' : app.busy ? '正在' + app.busy : '');

  // 本地来源：选好就先静态检查（只读作者文件，暂存在 Matcha 数据目录），结果决定下一步。
  let checking = $state(false), checked = $state<IntakeResult | null>(null), details = $state<IntakeDetails | null>(null), failure = $state('');
  let run = 0;
  const installed = $derived(checked?.manifest ? app.plugins.find(p => p.id === checked!.manifest!.id && p.installed !== false) : undefined);
  const total = $derived((checked?.files ?? []).reduce((s, f) => s + f.bytes, 0));
  const HOST: Record<string, string> = { 'flare-sdk': 'Matcha SDK 接口', l4n: 'L4N 插件接口', library: '普通 DLL' };

  export function show(start: SourceKind = 'github') { kind = start; dialog?.showModal(); }
  function reset() { run++; checking = false; checked = null; details = null; failure = ''; }
  async function check(path = local.trim()) {
    if (!path || checking) return;
    const mine = ++run; checking = true; checked = null; details = null; failure = '';
    try {
      const r = await api.pluginIntakeInspect(path);
      if (mine !== run) return;
      checked = r;
      // 需要 Agent 时顺便读一下 DLL 接口，让玩家知道识别出了什么
      if (r.outcome === 'needs-agent') void api.pluginIntakeDetails(r.intakeId).then(d => { if (mine === run) details = d; }).catch(() => {});
    } catch (e) { if (mine === run) failure = errorText(e); }
    finally { if (mine === run) checking = false; }
  }
  async function pick(folder: boolean) {
    try {
      const p = folder ? await pickDirectory('选择 DLL 功能所在的文件夹') : await pickDllPackage();
      if (p) { local = p; reset(); await check(p); }
    } catch (e) { app.error = errorText(e); }
  }
  function close() { dialog?.close(); }
  function handOff(text: string) {
    const how = askAgent(text);
    close();
    app.toast(how === 'sent' ? '已交给茶茶，进度在右侧对话里' : '茶茶还没准备好，指令先放进对话框了');
  }
  function submit() {
    if (kind !== 'local') { if (value) handOff(intakePrompt(kind, value)); return; }
    if (checked?.outcome === 'needs-agent' && checked.agent.available) handOff(checked.agent.prompt);
  }
  async function importNow() {
    if (!checked) return;
    if (blocked) { app.toast(blocked); return; }
    const intake = checked;
    close();
    if (await app.importIntake(intake)) { local = ''; reset(); }
  }
  const size = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;
</script>

<dialog bind:this={dialog} class="src" aria-labelledby="src-title" oncancel={e => { e.preventDefault(); close(); }}>
  <header>
    <h2 id="src-title">添加 DLL 功能</h2>
    <button class="icon-btn" aria-label="关闭" onclick={close}><X size={16}/></button>
  </header>
  <div class="tabs" role="tablist" aria-label="来源">
    {#each (['github', 'workshop', 'local'] as const) as k (k)}
      <button role="tab" aria-selected={kind === k} class:on={kind === k} onclick={() => kind = k}>
        {#if k === 'github'}<Github size={14}/>{:else if k === 'workshop'}<Store size={14}/>{:else}<FolderOpen size={14}/>{/if}{SOURCE_LABEL[k]}
      </button>
    {/each}
  </div>
  <div class="body">
    {#if kind === 'github'}
      <label><span>仓库或 Release 链接</span><input bind:value={github} placeholder="https://github.com/作者/仓库" spellcheck="false" autocomplete="off"/></label>
      <p class="parsed" class:bad={!!github.trim() && !gh}>{gh ? `仓库 ${gh.repo}` : github.trim() ? '不是 GitHub 仓库链接' : '支持仓库首页、Release 页或具体文件链接'}</p>
    {:else if kind === 'workshop'}
      <label><span>工坊链接或物品 ID</span><input bind:value={workshop} placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…" spellcheck="false" autocomplete="off"/></label>
      <p class="parsed" class:bad={!!workshop.trim() && !ws}>{ws ? `物品 ${ws.id}` : workshop.trim() ? '没认出工坊物品 ID' : '粘贴工坊页面地址，或直接填数字 ID'}</p>
    {:else}
      {#if desktop}
        <div class="picks">
          <button class="pick main" onclick={() => pick(false)}>
            <FileArchive size={18}/><span><b>选择 SDK 压缩包或 DLL</b><em>标准包检查通过就直接导入</em></span>
          </button>
          <button class="pick" onclick={() => pick(true)}>
            <FolderOpen size={18}/><span><b>选择文件夹</b><em>解压后的包或零散文件</em></span>
          </button>
        </div>
      {/if}
      <form class="path" onsubmit={e => { e.preventDefault(); void check(); }}>
        <input bind:value={local} oninput={reset} placeholder={desktop ? '或者粘贴完整路径' : 'D:\\Mods\\ragdoll.supply-radar.zip'} spellcheck="false" autocomplete="off" aria-label="ZIP、DLL 或文件夹的完整路径"/>
        <button class="btn" type="submit" disabled={!local.trim() || checking}>检查</button>
      </form>

      {#if checking}
        <div class="result wait" role="status"><LoaderCircle class="spin" size={15}/>正在检查包结构、manifest 和 DLL 接口…</div>
      {:else if failure}
        <div class="result rejected" role="alert"><p class="head"><Ban size={15}/>检查没完成</p><p class="note">{failure}</p></div>
      {:else if checked}
        {@const m = checked.manifest}
        {#if checked.outcome === 'sdk-ready' && m}
          <div class="result ok">
            <p class="head"><CircleCheck size={15}/>标准 Matcha SDK 包，可以直接导入</p>
            <dl>
              <div><dt>名称</dt><dd>{m.name} <span class="mono">v{m.version}</span></dd></div>
              <div><dt>ID</dt><dd class="mono">{m.id}</dd></div>
              <div><dt>加载方式</dt><dd>{m.loadKind === 'library' ? '整体加载' : '按模块加载'}</dd></div>
              <div><dt>文件</dt><dd>{checked.files.length} 个 · {size(total)}</dd></div>
              {#if installed}<div><dt>已安装</dt><dd>v{installed.version}，导入时会更新，保留设置和启停状态</dd></div>{/if}
            </dl>
          </div>
        {:else if checked.outcome === 'rejected'}
          <div class="result rejected" role="alert">
            <p class="head"><Ban size={15}/>没法导入这个包</p>
            <ul>{#each checked.issues as i, n (n)}<li>{#if i.file}<code>{i.file}</code>{/if}{i.message}</li>{/each}</ul>
            <p class="note">原文件和游戏目录都没动。请核对作者的完整发行包，或者重新下载后再试。</p>
          </div>
        {:else}
          <div class="result agent">
            <p class="head"><CircleAlert size={15}/>{checked.files.length === 1 && /\.dll$/i.test(checked.files[0].path) ? '这是一个普通 DLL，交给茶茶整理' : '不是标准 SDK 包，交给茶茶整理'}</p>
            <ul>{#each checked.issues as i, n (n)}<li>{#if i.file}<code>{i.file}</code>{/if}{i.message}</li>{/each}</ul>
            {#if details?.dlls.length}
              <div class="found">
                <span>识别到</span>
                {#each details.dlls.slice(0, 4) as d (d.path)}
                  <span class="dll"><code>{d.path}</code>{d.error ? '读取失败' : `${d.architecture ?? ''} · ${HOST[d.host ?? 'library']}`}</span>
                {/each}
              </div>
            {/if}
            <p class="note">茶茶只在暂存区按实际文件整理，补齐说明后再给你看文件清单，确认才导入。作者的文件保持原样。</p>
          </div>
        {/if}
      {/if}
    {/if}

    {#if kind !== 'local'}
      <ol class="how">
        <li>茶茶读取来源里的 manifest、说明、发布记录和图片，下载前先问你。</li>
        <li>下载下来的包走同一套检查：标准 SDK 包原样使用；不完整的，只补名称、简介、标签、快捷键等简单字段。补充的内容单独保存，并注明依据，不改作者的文件。</li>
        <li>导入前先给你看文件清单和整理结果，确认后才导入。</li>
      </ol>
    {:else if !checked && !checking && !failure}
      <ol class="how">
        <li>选好后会先检查包结构、manifest 和 DLL 接口。作者的文件保持原样。</li>
        <li>标准 Matcha SDK 压缩包检查通过就能直接导入，导入后默认停用。</li>
        <li>普通 DLL、结构不标准或缺文件的包，会列出具体问题，交给茶茶整理。</li>
      </ol>
    {/if}
    {#if !ready && (kind !== 'local' || checked?.outcome === 'needs-agent')}<p class="warn"><Sparkles size={13}/>茶茶还没配置模型，指令会先放进右侧对话框。</p>{/if}
  </div>
  <footer>
    <span class="grow"></span>
    <button class="btn" onclick={close}>取消</button>
    {#if kind !== 'local'}
      <button class="btn primary" disabled={!value} onclick={submit}><Sparkles size={14}/>交给茶茶整理</button>
    {:else if checked?.outcome === 'sdk-ready'}
      <button class="btn primary" disabled={!!blocked} title={blocked || '先看文件清单，确认后导入'} onclick={importNow}>{installed ? '更新…' : '导入…'}</button>
    {:else if checked?.outcome === 'needs-agent'}
      <button class="btn primary" disabled={!checked.agent.available} onclick={submit}><Sparkles size={14}/>交给茶茶整理</button>
    {/if}
  </footer>
</dialog>

<style>
  .src { width: min(560px, 92vw); max-height: min(720px, 92vh); padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-1); color: var(--fg); }
  .src[open] { display: flex; flex-direction: column; }
  .src::backdrop { background: #000c; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 4px 20px; }
  h2 { margin: 0; font-size: 16px; font-weight: 550; }
  .tabs { display: flex; gap: 4px; margin: 10px 20px 0; padding: 3px; border: 1px solid var(--line); border-radius: var(--r); }
  .tabs button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; height: 30px; border-radius: var(--r-sm); font-size: 13px; color: var(--fg-3); }
  .tabs button.on { background: var(--bg-3); color: var(--fg); }
  .body { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px 6px; overflow-y: auto; min-height: 0; }
  label { display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--fg-3); }
  input { height: 36px; font-size: 13px; }
  .parsed { margin: 0; font-size: 12px; color: var(--fg-3); }
  .parsed.bad { color: var(--danger); }

  .picks { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; }
  .pick { display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); text-align: left; color: var(--fg-3); transition: border-color .15s, background .15s; }
  .pick:hover { border-color: var(--fg-4); background: var(--bg-2); color: var(--fg-2); }
  .pick.main { border-color: var(--line-strong); color: var(--fg-2); }
  .pick span { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .pick b { font-size: 13px; font-weight: 550; color: var(--fg); }
  .pick em { font-style: normal; font-size: 11.5px; color: var(--fg-4); }
  .path { display: flex; gap: 8px; }
  .path input { flex: 1; min-width: 0; font-family: var(--mono, ui-monospace, monospace); font-size: 12px; }
  .path .btn { height: 36px; }

  .result { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--line); border-left-width: 2px; border-radius: var(--r); background: var(--bg); font-size: 12.5px; color: var(--fg-2); }
  .result .head { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; font-weight: 550; color: var(--fg); }
  .result.ok { border-left-color: var(--fg-2); }
  .result.agent { border-left-color: var(--fg-4); }
  .result.rejected { border-left-color: var(--danger); }
  .result.rejected .head { color: var(--danger); }
  .result.wait { flex-direction: row; align-items: center; gap: 9px; color: var(--fg-3); }
  .result :global(.spin) { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .result :global(.spin) { animation: none; } }
  dl { display: grid; gap: 6px; margin: 0; }
  dl div { display: grid; grid-template-columns: 64px 1fr; gap: 10px; }
  dt { color: var(--fg-4); }
  dd { margin: 0; color: var(--fg-2); overflow-wrap: anywhere; }
  .mono, code { font-family: var(--mono, ui-monospace, monospace); font-size: 11.5px; }
  ul { display: flex; flex-direction: column; gap: 5px; margin: 0; padding-left: 18px; line-height: 1.6; }
  li::marker { color: var(--fg-4); }
  li code { margin-right: 6px; padding: 1px 5px; border-radius: 3px; background: var(--bg-3); color: var(--fg-2); }
  .found { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; color: var(--fg-4); }
  .dll { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-3); }
  .note { margin: 0; font-size: 12px; line-height: 1.65; color: var(--fg-3); }

  .how { margin: 4px 0 0; padding: 14px 16px 14px 34px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); font-size: 12px; line-height: 1.75; color: var(--fg-2); }
  .how li + li { margin-top: 4px; }
  .warn { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 12px; color: var(--fg-3); }
  footer { display: flex; align-items: center; gap: 8px; padding: 14px 20px 18px; }
  footer .btn { height: 32px; gap: 6px; }
  .grow { flex: 1; }
  @media (max-width: 520px) { .picks { grid-template-columns: 1fr; } }
</style>
