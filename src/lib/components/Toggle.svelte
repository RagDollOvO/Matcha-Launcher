<script lang="ts">
  let { on, onchange, label, disabled = false, mixed = false, silent = false }: { on: boolean; onchange: () => void; label?: string; disabled?: boolean; mixed?: boolean; silent?: boolean } = $props();
</script>

<button class="tg" class:on={on && !mixed} class:mixed {disabled} data-sfx={silent ? 'none' : on ? 'toggleOff' : 'toggleOn'} role="switch" aria-checked={mixed ? 'mixed' : on} aria-label={label} onclick={(e) => { e.stopPropagation(); onchange(); }}>
  <i></i>
</button>

<style>
  .tg {
    width: 26px;
    height: 14px;
    border-radius: 7px;
    border: 1px solid var(--line-strong);
    position: relative;
    flex: none;
    transition: background var(--dur), border-color var(--dur);
  }
  .tg i {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-4);
    transition: transform var(--dur), background var(--dur);
  }
  /* 开：壁纸主色（和主页「启动游戏」同一个色） */
  .tg.on { background: var(--md-primary); border-color: var(--md-primary); }
  .tg.on i { transform: translateX(12px); background: var(--md-on-primary); }
  /* 部分启用：滑块停在中间 */
  .tg.mixed { border-color: color-mix(in srgb, var(--md-primary) 70%, transparent); }
  .tg.mixed i { transform: translateX(6px); background: var(--md-primary); }
</style>
