import { confirmAction, readPermissions } from './autonomy.mjs';
import { isAbsolute } from 'node:path';
import { requestMod } from './mod-bridge.mjs';
import { readSkill } from './skill-files.mjs';
import { dllTools } from './dll-tools.mjs';
import { serverTools } from './server-tools.mjs';
import { settingsTools } from './settings-tools.mjs';
import { extraModTools } from './mod-tools.mjs';
import { playerMemoryTools, registerPlayerMemory } from './player-memory.mjs';
import { localToolCatalog } from './local-catalog.mjs';

const object = properties => ({ type: 'object', properties, additionalProperties: false });
const pid = { type: 'integer', minimum: 1, maximum: 0xffffffff, description: '正在运行的游戏进程 PID。' };
const text = description => ({ type: 'string', minLength: 1, description });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value });

/** Loaded explicitly by PiTransport; all game operations go through the shared core. */
export function platformTools(gameRoot = process.env.L4P_GAME_ROOT, { modRequest = requestMod, memoryDir = process.env.PI_CODING_AGENT_DIR } = {}) {
  const tools = [];
  const registerTool = tool => tools.push(tool);
  if (gameRoot && !isAbsolute(gameRoot)) throw new Error('L4P_GAME_ROOT must be an absolute game path');
  const core = () => import('../core.mjs');
  let modManager;
  const mods = async () => {
    if (!gameRoot) throw new Error('请先在 Matcha 中选择游戏目录。');
    modManager ??= new (await import('../mods/manager.mjs')).ModManager();
    return modManager;
  };
  const checkAbort = signal => {
    if (signal?.aborted) throw new Error('操作已取消');
  };

  registerTool({
    name: 'read', label: '读取内置技能',
    description: '读取 Matcha 随包提供的 SKILL.md。使用技能清单给出的完整路径。',
    parameters: { ...object({ path: text('技能清单中的 SKILL.md 完整路径。'), offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 } }), required: ['path'] },
    async execute(_id, params, signal, _onUpdate, ctx) { checkAbort(signal); return readSkill(params, ctx?.cwd); },
  });

  registerTool({
    write: true, name: 'plugin_project_check', label: '检查 Matcha SDK 接入',
    description: '经用户确认后，本地读取选定目录的 manifest.json 与 plugin.cpp 并运行固定规则。返回规则编号与字段/行号位置，源码、README 和构建脚本内容保留本地。构建与签名由维护者发布工具执行。',
    parameters: { ...object({ directory: text('待检查工程的绝对路径。') }), required: ['directory'] },
    async execute(_id, params, signal, _onUpdate, ctx) {
      checkAbort(signal);
      if (!isAbsolute(params.directory)) throw new Error('需要绝对路径');
      if (!ctx.hasUI) throw new Error('工程检查需要范围确认界面');
      const approved = await confirmAction(ctx, '检查 SDK 接入声明', `${params.directory}\n文件：manifest.json、plugin.cpp\n\n本地规则读取这两个文件。规则结果、行号及插件 ID 将提供给 Pi；源码与声明原文保留本地。`, { signal, risk: 'routine' });
      checkAbort(signal);
      if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
      return result(await (await import('../releases.mjs')).checkProject(params.directory));
    },
  });

  registerTool({
    name: 'platform_inspect', label: '检查游戏平台',
    description: '只读检查已绑定的 L4D2 游戏目录、平台状态、已安装插件及其动作声明。',
    parameters: object({}),
    async execute(_toolCallId, _params, signal) {
      checkAbort(signal);
      const api = await core();
      if (!gameRoot) return result({ selectedGame: null, discovery: await api.discover() });
      const [game, plugins] = await Promise.all([api.inspectGame(gameRoot), api.listPlugins(gameRoot)]);
      return result({ game, plugins: plugins.filter(p => !/^(beacon\.|skeeto\.|demo\.hello$)/.test(p.manifest.id)) });
    },
  });

  registerTool({
    name: 'mod_inventory', label: '扫描 VPK Mod',
    description: '只读扫描本地及已下载工坊 VPK，返回启用状态、内容目录、分类、收藏/新下载标记、方案引用、资源重叠和解析错误。enabled 为 null 表示尚未登记。整理或清理 Mod 前先读取 matcha-mod-organizer 技能。',
    parameters: object({}),
    async execute(_id, _params, signal) {
      checkAbort(signal);
      if (process.env.FLARE_MOD_HOST === '1' || modRequest !== requestMod) return result(await modRequest('inventory', {}, undefined, signal));
      return result(await (await mods()).scan(gameRoot));
    },
  });

  const selected = { type: 'array', minItems: 1, uniqueItems: true, items: text('扫描或回收站返回的 ID。') };
  const approve = async (ctx, title, message, signal, risk = 'ask') => {
    if (!ctx.hasUI) throw new Error('此操作需要 Matcha 确认界面');
    const approved = await confirmAction(ctx, title, message, { signal, risk }); checkAbort(signal);
    return approved === true ? { approved: true, source: 'user' } : null;
  };
  const declined = () => result({ applied: false, reason: '用户取消了操作' });
  registerTool({
    write: true, name: 'mod_organize', label: '整理 Mod 分类',
    description: '按清单把 Mod 归入已有分类或新建分类，先显示前后分类并由用户确认。保留文件、启用状态、收藏和方案草稿；已归类的新下载移出收件箱。',
    parameters: { ...object({ moves: { type: 'array', minItems: 1, items: { ...object({ modId: text('Mod ID。'), categoryId: text('已有分类 ID；与 categoryName 二选一。'), categoryName: text('新分类名称；与 categoryId 二选一。'), parentId: text('新分类可选的已有上级分类 ID。') }), required: ['modId'] } } }), required: ['moves'] },
    async execute(_id, params, signal, _onUpdate, ctx) {
      checkAbort(signal);
      const plan = await modRequest('organize-preview', params, undefined, signal);
      if (!plan.changes.length) return result({ status: 'organized', count: 0, changes: [] });
      const confirmation = await approve(ctx, `整理 ${plan.changes.length} 个 Mod`,
        plan.changes.map(c => `${c.title} [${c.id}]\n${c.from} → ${c.to}`).join('\n\n') + '\n\n保存分类，保留文件与启停状态。', signal, 'routine');
      if (!confirmation) return declined();
      return result(await modRequest('organize', { ...params, expected: plan.expected }, confirmation, signal));
    },
  });
  registerTool({
    write: true, name: 'mod_delete', label: '移入 Mod 回收站',
    description: '将选中 Mod 及其 VPK 分卷、封面移入 Matcha 回收站。确认清单包含文件、大小、收藏及受影响方案；游戏退出后执行。支持随后还原。',
    parameters: { ...object({ modIds: selected }), required: ['modIds'] },
    async execute(_id, params, signal, _onUpdate, ctx) {
      checkAbort(signal);
      const plan = await modRequest('delete-preview', params, undefined, signal);
      const confirmation = await approve(ctx, `将 ${plan.mods.length} 个 Mod 移到回收站`, plan.mods.map(m =>
        `${m.title} [${m.modId}]${m.favorite ? ' · 已收藏' : ''}\n${(m.sizeBytes / 1048576).toFixed(1)} MiB\n${m.files.map(f => f.file).join('\n')}\n关联方案：${m.profileNames.join('、') || '无'}`
      ).join('\n\n') + '\n\n将同步移除这些方案中的引用；还原后恢复为方案草稿。Steam 订阅条目可能被 Steam 再次下载。', signal, 'routine');
      if (!confirmation) return declined();
      return result(await modRequest('delete', { ...params, expected: plan.expected }, confirmation, signal));
    },
  });
  registerTool({
    name: 'mod_trash', label: '查看 Matcha 回收站', description: '列出回收的 Mod 和收藏、原分类或合集、文件和仅记录条目。', parameters: object({}),
    async execute(_id, _params, signal) { checkAbort(signal); return result(await modRequest('trash-list', {}, undefined, signal)); },
  });
  for (const [operation, name, label, description] of [
    ['restore', 'mod_restore', '还原回收条目', '确认后，收藏回到收藏夹和原合集；库内 Mod 恢复分类和方案草稿，需先退出游戏。同名冲突保留在回收站。'],
    ['purge', 'mod_purge', '永久删除回收条目', '用户明确要求永久删除或清空回收站时使用。先列文件与大小，再单独确认永久移除。'],
  ]) registerTool({
    write: true, name, label, description,
    parameters: { ...object({ trashIds: selected }), required: ['trashIds'] },
    async execute(_id, params, signal, _onUpdate, ctx) {
      checkAbort(signal);
      const { entries } = await modRequest('trash-list', {}, undefined, signal);
      const chosen = params.trashIds.map(id => { const entry = entries.find(e => e.trashId === id); if (!entry) throw new Error('回收条目已变化，请刷新。'); return entry; });
      const confirmation = await approve(ctx, operation === 'purge' ? '永久删除回收条目' : '还原回收条目', chosen.map(m =>
        `${m.title} [${m.trashId}]\n${m.favorite ? '收藏夹' : 'Mod 库'} · ${m.favorite?.recordOnly?'仅收藏记录':(m.sizeBytes / 1048576).toFixed(1)+' MiB'}\n${m.files.map(f => f.file).join('\n')}`
      ).join('\n\n') + (operation === 'purge' ? '\n\n确认后将永久删除所选回收条目及其中的文件。' : '\n\n收藏还原到收藏夹和原合集；库内 Mod 恢复原分类和方案草稿。'), signal, operation === 'purge' ? 'ask' : 'routine');
      if (!confirmation) return declined();
      return result(await modRequest(operation, { ...params, expected: chosen }, confirmation, signal));
    },
  });
  registerTool({
    write: true, name: 'mod_set_enabled', label: '更新 Mod 启停',
    description: '修改指定 VPK 在 addonlist.txt 中的启用状态，备份原文件、保留其他条目；游戏退出且用户确认后执行，下次启动生效。Matcha 的方案草稿保持原样，可从游戏同步。',
    parameters: { ...object({ modIds: { type: 'array', minItems: 1, items: text('mod_inventory 返回的 Mod ID。') }, enabled: { type: 'boolean' } }), required: ['modIds', 'enabled'] },
    async execute(_id, params, signal, _onUpdate, ctx) {
      checkAbort(signal); const manager = await mods();
      if (!ctx.hasUI) throw new Error('修改 Mod 需要平台确认界面');
      const approved = await confirmAction(ctx, params.enabled ? '启用 VPK Mod' : '停用 VPK Mod', `${gameRoot}\n${params.modIds.join('\n')}\n\n备份并更新 addonlist.txt，下次启动生效。方案草稿保持原样。`, { signal, risk: 'routine' });
      checkAbort(signal);
      if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
      return result(await manager.setEnabled({ gameRoot, ...params, confirmation: { approved: true, source: 'user' } }));
    },
  });
  registerTool({
    write: true, name: 'mod_import', label: '导入 VPK Mod',
    description: '将本地 VPK（分卷包选择 _dir.vpk）复制到当前游戏 addons，保留来源和已有同名文件。游戏退出且用户确认后执行；默认加入当前启动方案，下次启动生效。',
    parameters: { ...object({ file: text('本地 VPK 的绝对路径。') }), required: ['file'] },
    async execute(_id, params, signal, _onUpdate, ctx) {
      checkAbort(signal); const manager = await mods(), info = await manager.preview(params.file);
      if (!ctx.hasUI) throw new Error('导入 Mod 需要平台确认界面');
      // Inside Matcha the import goes through the desktop service, which also turns the new Mod on.
      const hosted = process.env.FLARE_MOD_HOST === '1' || modRequest !== requestMod;
      const approved = await confirmAction(ctx, '导入 VPK Mod', `${info.title} · ${info.sizeMB.toFixed(1)} MiB\n来源：${params.file}\n目标：${gameRoot}\\left4dead2\\addons\n\n复制 ${info.files.length} 个文件，${hosted ? '默认启用，下次启动生效' : '默认停用'}。`, { signal, risk: 'routine' });
      checkAbort(signal);
      if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
      const confirmation = { approved: true, source: 'user' };
      if (hosted) return result(await modRequest('import', { file: params.file }, confirmation, signal));
      return result(await manager.import({ gameRoot, file: params.file, confirmation }));
    },
  });

  registerTool({
    name: 'runtime_status', label: '读取运行状态',
    description: '通过平台 Core 只读查询指定游戏 PID 的 L4P 原生运行时状态。',
    parameters: { ...object({ pid }), required: ['pid'] },
    async execute(_toolCallId, params, signal) {
      checkAbort(signal);
      return result(await (await core()).runtimeRequest(params.pid, { type: 'status' }));
    },
  });

  registerTool({
    write: true, name: 'plugin_invoke', label: '执行插件动作',
    description: '调用已安装插件声明的动作。平台先显示目标和参数，由用户在确认框中批准后执行。',
    parameters: { ...object({
      pid,
      pluginId: text('插件 manifest 中的唯一 ID。'),
      actionId: text('插件 manifest 中声明的动作 ID。'),
      args: { type: 'object', additionalProperties: true, description: '符合该动作参数 Schema 的对象。' },
    }), required: ['pid', 'pluginId', 'actionId', 'args'] },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAbort(signal);
      if (!gameRoot) throw new Error('请先在 Matcha 中选择游戏目录，再执行插件动作。');
      if (!ctx.hasUI) throw new Error('执行插件动作需要平台确认界面');
      const approved = await ctx.ui.confirm('执行插件动作',
        `游戏：${gameRoot}\n进程：${params.pid}\n插件：${params.pluginId}\n动作：${params.actionId}\n参数：\n${JSON.stringify(params.args, null, 2)}`,
        { signal });
      checkAbort(signal);
      if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
      const api = await core();
      checkAbort(signal);
      // This receipt is constructed only after the trusted UI returns approval.
      const confirmation = { approved: true, source: 'user' };
      return result(await api.invokePlugin({ gameRoot, pid: params.pid,
        pluginId: params.pluginId, actionId: params.actionId, args: params.args, confirmation }));
    },
  });
  tools.push(...extraModTools(modRequest));
  for (const tool of dllTools(modRequest)) registerTool(tool);
  for (const tool of serverTools(modRequest)) registerTool(tool);
  for (const tool of settingsTools(modRequest)) registerTool(tool);
  tools.push(...playerMemoryTools(memoryDir));
  return tools;
}

export function platformToolCatalog() {
  return [...platformTools(''), ...localToolCatalog()].map(({ name, label, description, write = false }) => ({ name, label, description, write, enabled: true }));
}

export default function platformExtension(pi) {
  pi.on('before_agent_start', event => ({ systemPrompt: event.systemPrompt+'\nMatcha 当前确认方式：'+({full:'完全访问，按玩家明确的任务直接办理本机整理和登记。',auto:'自主，按任务直接推进常规步骤。',ask:'每次都问，工具会展示确认框。'}[readPermissions().mode])+' 用户已经明确要求执行时，直接调用工具，由工具按设置展示必要的确认，不在聊天中重复索要同一授权。只有附件或只要求检查时先检查；遇到冲突、额外操作或真实选择再询问。读取 ZIP 内容优先复用 dll_package_inspect 返回的 originalDirectory，按 files 清单使用 local_read 或 local_grep。' }));
  for (const { write: _write, ...tool } of platformTools()) pi.registerTool(tool);
  registerPlayerMemory(pi, process.env.PI_CODING_AGENT_DIR);
}
