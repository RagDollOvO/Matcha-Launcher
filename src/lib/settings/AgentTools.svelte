<script lang="ts">
  // 「工具与权限」：助手能调用的启动器工具，按用途分组、默认收起。只读：开关由后端 pi-tools 决定。
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { PiToolInfo } from '../agent/host';

  let { tools }: { tools: PiToolInfo[] } = $props();

  // 玩家记忆由 Pi 自己维护（只写 MEMORY.md），不算「改动文件」，执行前也不弹确认
  const selfManaged = (n: string) => n === 'player_memory_edit';
  const GROUPS = [
    { id: 'memory', label: '玩家记忆', detail: '记住你在各次对话里提过的偏好', test: (n: string) => n.startsWith('player_memory_') },
    { id: 'mod', label: 'Mod 管理', detail: '扫描、整理、导入、下载和回收站', test: (n: string) => n.startsWith('mod_') },
    { id: 'dll', label: 'DLL 模组', detail: '检查、拉取来源、整理资料和导入', test: (n: string) => n.startsWith('dll_') || n.startsWith('plugin_') },
    { id: 'server', label: '服务器', detail: '查询、添加、整理和连接', test: (n: string) => n.startsWith('server_') },
    { id: 'settings', label: '启动项与设置', detail: '体检时读启动项和 CFG，确认后改游戏和启动器设置', test: (n: string) => n.startsWith('game_') || n.startsWith('launcher_') },
    { id: 'other', label: '运行与平台', detail: '读取说明、查看游戏和加载器状态', test: () => true },
  ];
  const groups = $derived.by(() => {
    const left = [...tools];
    return GROUPS.map(g => {
      const list = left.filter(t => g.test(t.name));
      for (const t of list) left.splice(left.indexOf(t), 1);
      return { ...g, list, writes: list.filter(t => t.write && !selfManaged(t.name)).length, off: list.filter(t => !t.enabled).length };
    }).filter(g => g.list.length);
  });
</script>

<div class="card">
  {#each groups as g (g.id)}
    <details class="grp">
      <summary class="line">
        <div class="lt"><b>{g.label}<span class="w">{g.list.length}</span></b>
          <span class="sub">{g.detail}{g.writes ? ` · ${g.writes} 个会改动文件` : ''}{g.off ? ` · ${g.off} 个已停用` : ''}</span></div>
        <ChevronRight size={16} class="chev" />
      </summary>
      <ul>
        {#each g.list as t (t.name)}
          <li class:off={!t.enabled}>
            <div class="tt"><b>{t.label}</b>{#if selfManaged(t.name)}<span class="w" title="茶茶自己维护本机 MEMORY.md，不用每次确认">记忆</span>{:else if t.write}<span class="w">改动文件</span>{/if}{#if !t.enabled}<span class="w">已停用</span>{/if}<code>{t.name}</code></div>
            <p>{t.description}</p>
          </li>
        {/each}
      </ul>
    </details>
  {/each}
</div>

<style>
  .grp + .grp { border-top: 1px solid var(--line-soft); }
  summary { cursor: pointer; list-style: none; transition: background var(--dur); }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: color-mix(in srgb, var(--md-on-surface) 4%, transparent); }
  summary:focus-visible { outline: 2px solid var(--md-primary); outline-offset: -2px; }
  summary :global(.chev) { flex: none; color: var(--fg-3); transition: transform var(--dur) var(--ease-out); }
  .grp[open] summary :global(.chev) { transform: rotate(90deg); }
  ul { list-style: none; margin: 0; padding: 2px 18px 12px; }
  li { padding: 10px 0 10px 14px; border-left: 1px solid var(--line); }
  li + li { margin-top: 0; }
  li.off { opacity: .55; }
  .tt { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
  .tt b { font-size: 13px; font-weight: 550; }
  code { margin-left: auto; font: 11px var(--font-mono); color: var(--fg-4); user-select: text; }
  p { margin: 4px 0 0; max-width: 68ch; font-size: 12px; line-height: 1.65; color: var(--fg-3); }
</style>
