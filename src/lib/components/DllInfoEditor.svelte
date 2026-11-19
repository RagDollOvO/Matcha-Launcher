<script lang="ts">
  // 编辑简单字段。保存到 Matcha 的补充资料，作者的包保持原样。
  import X from '@lucide/svelte/icons/x';
  import { api } from '../api';
  import { errorText } from '../api/bridge';
  import { app } from '../stores/app.svelte';
  import { GAME_MODES, pluginUsage } from '../plugins/catalog';
  import type { PlatformPlugin, PluginOverlayFields } from '../types';
  let { p }: { p: PlatformPlugin } = $props();
  let dialog = $state<HTMLDialogElement>();
  let saving = $state(false);
  let f = $state({ name: '', author: '', summary: '', description: '', tags: '', modes: [] as string[], hotkeys: '' });

  export function show() {
    const u = pluginUsage(p);
    f = {
      name: p.name, author: p.author ?? '', summary: p.presentation?.summary ?? p.description ?? '',
      description: p.presentation?.description ?? '', tags: (p.presentation?.tags ?? []).join('、'),
      modes: [...u.modes], hotkeys: u.hotkeys.map(h => `${h.keys.join('+')} = ${h.label}`).join('\n'),
    };
    dialog?.showModal();
  }
  const tags = $derived(f.tags.split(/[,，、]/).map(t => t.trim()).filter(Boolean));
  const hotkeys = $derived(f.hotkeys.split('\n').map(l => l.split('=')).filter(x => x.length === 2 && x[0].trim() && x[1].trim()).map(([k, l]) => ({ keys: k.trim(), label: l.trim() })));
  const invalid = $derived([...f.name.trim()].length > 80 || [...f.author.trim()].length > 80 ? '名称和作者最多 80 字' : hotkeys.some(h => [...h.keys].length > 40 || [...h.label].length > 80) ? '快捷键按键最多 40 字，说明最多 80 字' : [...f.summary].length > 160 ? '简介最多 160 字' : [...f.description].length > 12000 ? '说明最多 12000 字' : tags.length > 8 || tags.some(t => [...t].length > 24) ? '标签最多 8 个，每个 24 字以内' : hotkeys.length > 8 ? '快捷键最多 8 条' : '');

  async function save() {
    if (invalid || saving) return;
    const fields: PluginOverlayFields = { name: f.name.trim(), author: f.author.trim(), summary: f.summary.trim(), description: f.description.trim(), tags, modes: f.modes, hotkeys };
    saving = true;
    try { await api.pluginOverlaySave(p.id, fields); dialog?.close(); app.toast('资料已保存'); await app.refresh(); }
    catch (e) { app.toast(errorText(e), undefined, 6000); }
    finally { saving = false; }
  }
</script>

<dialog bind:this={dialog} class="edit" aria-labelledby="edit-title" oncancel={e => { e.preventDefault(); dialog?.close(); }}>
  <header><h2 id="edit-title">编辑资料</h2><button class="icon-btn" aria-label="关闭" onclick={() => dialog?.close()}><X size={16}/></button></header>
  <form class="body" onsubmit={e => { e.preventDefault(); void save(); }}>
    <p class="lead">修改会保存为 Matcha 的补充资料，标记为「手动修改」；作者的包保持原样。清空一项就恢复成开发者或茶茶整理的原资料。开发者编排的内容块不在这里编辑。</p>
    <div class="two"><label><span>名称</span><input bind:value={f.name}/></label><label><span>作者</span><input bind:value={f.author}/></label></div>
    <label><span>一句话简介 <em>{[...f.summary].length}/160</em></span><input bind:value={f.summary}/></label>
    <label><span>说明 <em>支持段落、列表、**粗体**、`代码`</em></span><textarea rows="7" bind:value={f.description}></textarea></label>
    <label><span>标签 <em>用顿号或逗号分隔，最多 8 个</em></span><input bind:value={f.tags} placeholder="HUD、本地合作"/></label>
    <fieldset><legend>适用模式</legend><div class="modes">{#each GAME_MODES as [id, label] (id)}<label class="check"><input type="checkbox" value={id} bind:group={f.modes}/>{label}</label>{/each}</div></fieldset>
    <label><span>快捷键 <em>每行一条：按键 = 说明</em></span><textarea rows="3" bind:value={f.hotkeys} placeholder="Ctrl+F8 = 切换发光"></textarea></label>
    <footer>{#if invalid}<span class="err">{invalid}</span>{/if}<span class="grow"></span><button type="button" class="btn" onclick={() => dialog?.close()}>取消</button><button class="btn primary" disabled={!!invalid || saving}>{saving ? '保存中…' : '保存'}</button></footer>
  </form>
</dialog>

<style>
  .edit { width: min(620px, 92vw); max-height: min(780px, 90vh); padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg-1); color: var(--fg); }
  .edit[open] { display: flex; flex-direction: column; }
  .edit::backdrop { background: #000c; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 4px 20px; }
  h2 { margin: 0; font-size: 16px; font-weight: 550; }
  .body { display: flex; flex-direction: column; gap: 14px; padding: 8px 20px 0; overflow-y: auto; }
  .lead { margin: 0; font-size: 12px; line-height: 1.7; color: var(--fg-3); }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--fg-3); }
  label em { margin-left: 8px; font-style: normal; color: var(--fg-4); }
  input:not([type]), textarea { font-size: 13px; }
  input:not([type]) { height: 34px; }
  textarea { resize: vertical; line-height: 1.7; padding: 8px 10px; font-family: inherit; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  fieldset { margin: 0; padding: 0; border: 0; }
  legend { padding: 0; margin-bottom: 8px; font-size: 12px; color: var(--fg-3); }
  .modes { display: flex; flex-wrap: wrap; gap: 8px 18px; }
  .check { flex-direction: row; align-items: center; gap: 6px; font-size: 13px; color: var(--fg); }
  footer { position: sticky; bottom: 0; display: flex; align-items: center; gap: 8px; padding: 14px 0 18px; background: var(--bg-1); }
  footer .btn { height: 32px; }
  .err { font-size: 12px; color: var(--danger); }
  .grow { flex: 1; }
</style>
