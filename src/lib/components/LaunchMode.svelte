<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { app } from '../stores/app.svelte';
  import { LAUNCH_MODES, shownMode } from '../launch-modes';
  import type { LaunchMode } from '../types';
</script>

<label class="launch-mode">
  <span class="lb">启动方式</span>
  <span class="pick">
    <select aria-label="启动方式" value={shownMode(app.launchConfig.mode)} disabled={!!app.busy || app.launchState !== 'idle'} onchange={e => app.setLaunchMode(e.currentTarget.value as LaunchMode)}>
      {#each LAUNCH_MODES as m (m.id)}<option value={m.id}>{m.detail}</option>{/each}
    </select>
    <ChevronDown size={14} />
  </span>
</label>

<style>
  .launch-mode { display: inline-flex; align-items: center; gap: 8px; color: var(--fg-2); font-size: 12px; white-space: nowrap; }
  .lb { flex: none; }
  .pick { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; color: var(--fg-3); }
  .pick :global(svg) { position: absolute; right: 10px; pointer-events: none; }
  select {
    appearance: none; -webkit-appearance: none; width: 100%; max-width: 220px; height: 34px; padding: 0 30px 0 12px;
    border-radius: 12px; border: 1px solid var(--line); background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent);
    font-size: 12px; color: var(--fg); cursor: pointer; transition: background var(--dur), border-color var(--dur);
  }
  select:hover:not(:disabled) { background: var(--md-surface-container-highest); }
  select:disabled { opacity: .5; cursor: default; }
  option { background: var(--md-surface-container); color: var(--md-on-surface); }
</style>
