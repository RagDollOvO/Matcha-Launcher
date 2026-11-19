<script lang="ts">
  /** 核验等级徽章：颜色、图标、文字一起出现；彩色只用在这里 */
  type TrustLevel = 'verified' | 'closed' | 'unverified' | 'blocked';
  let { level, label, size = 'md' }: { level: TrustLevel; label?: string; size?: 'sm' | 'md' } = $props();
  const text: Record<TrustLevel, string> = { verified: '已核验', closed: '闭源 · 未发现问题', unverified: '未核验', blocked: '已拦截' };
  const icon = $derived(size === 'md' ? 15 : 13);
</script>

<span class="badge {level} {size}">
  <svg aria-hidden="true" width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    {#if level === 'verified'}
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" />
    {:else if level === 'closed'}
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 22V2" />
    {:else if level === 'blocked'}
      <circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" />
    {:else}
      <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
    {/if}
  </svg>
  {label ?? text[level]}
</span>

<style>
  .badge { display: inline-flex; align-items: center; gap: 6px; flex: none; box-sizing: border-box; border: 1px solid; border-radius: var(--r-sm); font-weight: 500; line-height: 1; white-space: nowrap; }
  .md { height: 28px; padding: 0 10px; font-size: 13px; }
  .sm { height: 22px; padding: 0 7px; gap: 5px; font-size: 12px; }
  .verified { color: #6cc287; background: #0f1b13; border-color: #24452f; }
  .closed { color: #d8a548; background: #1b160b; border-color: #46371a; }
  .unverified { color: #b5b5b5; background: var(--bg-2); border-color: #333; }
  .blocked { color: #e56060; background: #1f0e0e; border-color: #522020; }
</style>
