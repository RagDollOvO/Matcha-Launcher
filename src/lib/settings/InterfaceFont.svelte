<script lang="ts">
  // 外观里的「界面字体」两行：选择 / 导入，下面一行预览。放在外观的「文字与显示」卡片里。
  import Upload from '@lucide/svelte/icons/upload';
  import { importFont, setFont, uiFont, type FontMode } from '../theme/font.svelte';
  let input: HTMLInputElement;
  let problem = $state('');
  async function pick(e: Event) {
    const el = e.currentTarget as HTMLInputElement, file = el.files?.[0];
    el.value = '';
    if (!file) return;
    problem = '';
    try { await importFont(file); }
    catch (e) { problem = e instanceof Error ? e.message : '字体导入失败，请重新选择文件。'; }
  }
  async function choose(mode: FontMode) {
    problem = '';
    try { await setFont(mode); }
    catch { problem = '字体设置保存失败，请检查本机存储空间。'; }
  }
</script>

<div class="line">
  <div class="lt">
    <b><label for="interface-font">界面字体</label></b>
    {#if problem || uiFont.error}<span class="sub err" role="alert">{problem || uiFont.error}</span>
    {:else}<span class="sub">也可以导入 TTF、OTF 或 WOFF 字体</span>{/if}
  </div>
  <div class="row">
    <select id="interface-font" value={uiFont.mode} disabled={uiFont.busy} onchange={e => void choose(e.currentTarget.value as FontMode)}>
      <option value="maiyuan">荆南麦圆体（默认）</option>
      <option value="system">系统字体</option>
      {#if uiFont.name}<option value="custom">{uiFont.name}</option>{/if}
    </select>
    <input bind:this={input} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onchange={pick} />
    <button class="btn" disabled={uiFont.busy} onclick={() => input.click()}><Upload size={14} />{uiFont.busy ? '正在导入…' : '导入…'}</button>
  </div>
</div>
<p class="specimen" aria-label="字体预览">求生之路 2 <span>·</span> Matcha 0123</p>

<style>
  label { cursor: inherit; }
  select { max-width: 200px; height: 30px; padding-block: 0; font-size: 12.5px; }
  .err { color: var(--danger); }
  .specimen { margin: 0; padding: 4px 18px 16px; color: var(--fg); font-size: 22px; line-height: 1.5; overflow-wrap: anywhere; }
  .specimen span { color: var(--md-primary); }
</style>
