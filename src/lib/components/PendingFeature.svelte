<script lang="ts">
  import { app } from '../stores/app.svelte';
  let { title, detail }: { title: string; detail: string } = $props();
</script>
<section>
  <span class="section-label">MATCHA / 待接入</span>
  <h2>{title}</h2>
  <p>{detail}</p>
  <button class="btn" onclick={() => app.route = 'plugins'}>管理 DLL 模组</button>
</section>
<style>
  section { padding: 48px 36px; max-width: 660px; }
  h2 { font-size: 28px; font-weight: 500; margin: 12px 0; }
  p { color: var(--fg-2); font-size: 14px; line-height: 1.8; margin-bottom: 24px; }
</style>
