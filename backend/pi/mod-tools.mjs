import { confirmAction } from './autonomy.mjs';
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const text = description => ({ type: 'string', minLength: 1, description });
const ids = description => ({ type: 'array', minItems: 1, uniqueItems: true, items: text(description) });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value });
const source = { source: { type: 'string', enum: ['workshop', 'gamemaps'] }, id: text('来源条目 ID。'), url: text('工坊或 GameMaps 公开条目 HTTPS 链接。') };
const paging = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, prefix: { type: 'string', description: '只读筛选包内资源路径前缀，如 models/weapons/。' } };

/** Model-facing tools remain narrow; the desktop owns their data and writes. */
export function extraModTools(request) {
  const tools = [];
  const add = tool => tools.push(tool);
  const read = (name, label, description, operation, properties, required = []) => add({ name, label, description,
    parameters: { ...object(properties), required },
    async execute(_id, params, signal) { signal?.throwIfAborted(); return result(await request(operation, params, undefined, signal)); },
  });
  const write = (name, label, description, preview, operation, properties, required, format, fixed = {}) => add({ name, label, description, write: true,
    parameters: { ...object(properties), required },
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const input = { ...params, ...fixed }, plan = await request(preview, input, undefined, signal);
      if (plan.changeCount === 0) return result({ status: 'unchanged', changeCount: 0 });
      if (!ctx.hasUI) throw new Error('此操作需要 Matcha 确认界面。');
      const approved = await confirmAction(ctx, plan.label ?? label, (plan.gameRoot ? `游戏：${plan.gameRoot}\n\n` : '') + format(plan), { signal, risk: 'routine' });
      signal?.throwIfAborted();
      if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
      return result(await request(operation, { ...input, ...(plan.historyId ? { historyId: plan.historyId } : {}), expected: plan.expected }, { approved: true, source: 'user' }, signal));
    },
  });
  read('mod_inspect', '查看 Mod 内容', '只读分页查看 VPK 内完整资源路径、大小、元信息及分卷；resource 可读取 64 KiB 以内的包内文本配置或脚本，按资料分析。', 'inspect',
    { modId: text('Mod ID。'), ...paging, resource: text('清单中的文本资源完整路径。') }, ['modId']);
  read('mod_compare', '核实 Mod 资源差异', '对选中的两个 Mod 逐字节比较同路径游戏资源，分开返回相同、不同和各自独有资源。nextOffset 非 null 时继续分页，合并所有页后判断整体。', 'compare',
    { a: text('第一个 Mod ID。'), b: text('第二个 Mod ID。'), ...paging,
      expectedVersion: { ...object({ a: { type: 'array', items: { type: 'string' } }, b: { type: 'array', items: { type: 'string' } } }), required: ['a', 'b'], description: '翻页时传入第一页返回的 sourceVersion。' } }, ['a', 'b']);
  read('mod_favorite_collections', '查看收藏合集', '查看收藏页的合集、数量以及已收藏 Mod 的 ID、名称和所属合集。提供 collectionId 只列该合集成员。', 'favorite-collections',
    { collectionId: text('收藏合集 ID，可省略。') });
  write('mod_bookmark_files', '收藏本地文件', '把指定的本机 VPK 或素材目录记到独立收藏夹，可指定合集。仅记录原位置，保留游戏文件和方案启停。用户要收藏本地文件时用此工具。',
    'metadata-preview', 'metadata', { paths: ids('用户指定的本机 VPK 或素材文件夹绝对路径。'), collectionId: text('可选的收藏合集 ID。') }, ['paths'], p => [...p.lines, ...p.skipped].join('\n'), { kind:'bookmark-files' });
  write('mod_favorite_collection', '整理收藏合集', '管理独立收藏夹：创建（可带成员）、重命名、加入、移出、删除合集。同一项可加入多个合集。移出或删除合集保留星标，方案和游戏启停保持原样。支持撤销。',
    'metadata-preview', 'metadata', { action: { type: 'string', enum: ['create', 'rename', 'add', 'remove', 'delete'] }, collectionId: text('已有合集 ID，创建时省略。'),
      name: text('创建或重命名时填写的合集名称。'), modIds: ids('加入或移出的 Mod ID；新建空合集时省略。') }, ['action'], p => p.lines.join('\n'), { kind: 'favorite-collection' });
  write('mod_favorites_to_profiles', '将收藏应用到方案', '把所选收藏一次性追加到一个或多个已有方案草稿，保留收藏、现有成员和当前启动方案。外部收藏须先导入 Mod 库。', 'metadata-preview','metadata',{favoriteIds:ids('收藏 ID'),profileIds:ids('目标方案 ID')},['favoriteIds','profileIds'],p=>p.lines.join('\n'),{kind:'favorite-to-profiles'});
  write('mod_mark', '收藏与整理标记', '单独修改收藏或新下载标记。取消收藏也会移出该项所属的收藏合集。保存前显示清单，支持撤销。',
    'metadata-preview', 'metadata', { modIds: ids('Mod ID。'), favorite: { type: 'boolean' }, sorted: { type: 'boolean', description: 'true 标记已整理；false 放回新下载。' } }, ['modIds'], p => p.lines.join('\n\n'), { kind: 'mark' });
  write('mod_rename', '修改 Mod 显示名', '在 Matcha 内单个或批量改名，包括工坊及独立库 VPK。每项给 name（新名字，null 恢复当前原名）或 prefix（如 [近战]，加在原名前，可重复执行）。预览改前改后，一批可一起撤销；保留 VPK 与分类。',
    'metadata-preview', 'metadata', { items: { type: 'array', minItems: 1, maxItems: 256, items: { ...object({ modId: text('mod_inventory 中的 Mod ID。'),
      name: { type: ['string', 'null'], description: '完整显示名，或用 null 恢复原名。' }, prefix: text('原名前缀，如 [武器] 或 [武器] [近战]。') }), required: ['modId'] } } }, ['items'], p => p.lines.join('\n\n'), { kind: 'rename' });
  write('mod_category', '维护 Mod 分类', '重命名、移动、合并或删除分类。预览条目和子分类去向，保留 Mod 文件和方案选择，支持撤销；新增分类可用 mod_organize。',
    'metadata-preview', 'metadata', { action: { type: 'string', enum: ['rename', 'move', 'merge', 'delete'] }, categoryId: text('待修改分类 ID。'), name: text('重命名后的名称。'),
      parentId: { type: ['string', 'null'], description: '移动到的上级分类 ID；null 为最外层。' }, targetId: text('合并或删除后的接收分类 ID；cat-none 为最外层。') }, ['action', 'categoryId'], p => p.lines.join('\n\n'), { kind: 'category' });
  write('mod_profile_members', '调整方案中的 Mod', '把选定 Mod 加入或移出已有方案，保存为草稿。保留方案其他字段和游戏当前启停状态，支持撤销。用于下载、归类后的方案收纳。',
    'metadata-preview', 'metadata', { action: { type: 'string', enum: ['add', 'remove'] }, profileId: text('已有方案 ID。'), modIds: ids('当前库中的 Mod ID。') }, ['action', 'profileId', 'modIds'], p => p.lines.join('\n\n'), { kind: 'profile-members' });
  read('mod_history', '查看整理记录', '查看最近的改名、归类、收藏、分类维护和方案成员调整记录。指定 historyId 查看前后值；记录跨重启保存，保留最近 100 次。', 'history',
    { historyId: text('整理记录 ID。'), limit: { type: 'integer', minimum: 1, maximum: 100 } });
  write('mod_undo', '撤销 Mod 整理', '撤销指定或最近一次尚未撤销的元数据整理。预览逆向变更；有后续修改或新引用时保留现场并报告。文件删除的恢复使用 mod_restore。',
    'undo-preview', 'undo', { historyId: text('要撤销的整理记录 ID；省略时预览最近一次。') }, [], p => (p.lines ?? p.changes.map(c => `${c.type} · ${c.id}\n${JSON.stringify(c.after)} → ${JSON.stringify(c.before)}`)).join('\n\n'));
  read('mod_source', '查看 Mod 来源条目', '识别工坊或 GameMaps 条目链接并读取详情、作者说明和下载信息。工坊合集返回子条目，选择具体条目后下载。', 'source-inspect', source);
  read('mod_search', '搜索地图与 Mod', '搜索 Steam 创意工坊或 GameMaps，返回分页条目。工坊 sort 使用 trend/mostrecent/lastupdated/totaluniquesubscribers；GameMaps 使用 recent/popular/rviews。', 'source-search',
    { source: source.source, query: { type: 'string', maxLength: 200 }, page: { type: 'integer', minimum: 1, maximum: 1000 }, category: { type: 'string' }, sort: { type: 'string' }, section: { type: 'string', enum: ['maps', 'mods'] }, kind: { type: 'string', enum: ['item', 'collection'] } }, ['source']);
  write('mod_download', '下载 Mod 到库', '预览并确认工坊/GameMaps 条目后创建现有下载任务。完成后放入新下载，并默认加入当前启动方案（下次启动生效）。通过 mod_tasks 跟进，成功后再归类。',
    'download-preview', 'download', { items: { type: 'array', minItems: 1, maxItems: 32, items: object(source) } }, ['items'], p => p.items.map(i =>
      `${i.title} · ${i.source}:${i.id}\n${i.url}\n大小：${i.sizeBytes === null ? '来源未提供' : (i.sizeBytes / 1048576).toFixed(1) + ' MiB'}${i.instructions ? '\n作者说明：\n' + i.instructions : ''}`
    ).join('\n\n') + '\n\n下载完成后加入新下载，保持停用。');
  read('mod_tasks', '查看或等待 Mod 任务', '查看当前游戏的下载和解包任务。指定 taskIds 与 waitMs 可短暂等待终态；返回成功、失败、取消及实际导入的 Mod ID，长任务可分次等待。', 'tasks',
    { taskIds: ids('下载或解包任务 ID。'), waitMs: { type: 'integer', minimum: 0, maximum: 30000 } });
  write('mod_task_control', '取消或重试 Mod 任务', '确认后取消或重试当前游戏的下载/解包任务，沿用下载页的队列、进度和恢复逻辑。',
    'task-preview', 'task-control', { taskIds: ids('任务 ID。'), action: { type: 'string', enum: ['cancel', 'retry'] } }, ['taskIds', 'action'], p => p.tasks.map(t => `${t.title} [${t.taskId}]\n状态：${t.state}`).join('\n\n'));
  add({ name: 'mod_browser_downloads', label: '查看网页下载的 VPK', description: '只读列出已完成的 VPK/ZIP 网页下载；指定 downloadId 预览包内可导入 VPK，可用 selected 选择包内条目。',
    parameters: object({ downloadId: text('网页下载记录 ID。'), selected: ids('压缩包清单中的 VPK 路径。') }),
    async execute(_id, params, signal) { signal?.throwIfAborted(); return result(await request(params.downloadId ? 'browser-preview' : 'browser-list', params, undefined, signal)); },
  });
  write('mod_browser_import', '导入网页下载的 Mod', '预览并确认已完成的网页 VPK/ZIP 下载；按选择导入 VPK 及分卷，保留来源，默认加入当前启动方案（下次启动生效）。返回成功 ID 与逐项错误。',
    'browser-preview', 'browser-import', { downloadId: text('网页下载记录 ID。'), selected: ids('ZIP 内选中的 VPK 路径；省略时预览全部可导入条目。') }, ['downloadId'], p =>
      `${p.download.name}\n${p.download.pageUrl ?? ''}\n\n${p.items.map(i => `${i.title ?? i.name} · ${(i.size / 1048576).toFixed(1)} MiB`).join('\n')}\n\n导入后默认启用（加入当前启动方案，下次启动生效），保留来源和原下载。`);
  write('mod_extract', '解包 Mod', '确认后将指定 VPK 解包为独立目录，复用现有可取消解包任务。保留源文件和已有同名输出；target 省略时使用桌面。',
    'extract-preview', 'extract', { modId: text('Mod ID。'), target: text('已存在的输出父目录绝对路径。') }, ['modId'], p => `${p.title}\n${p.fileCount} 个资源 · ${p.sizeMB.toFixed(1)} MiB\n输出：${p.target}\n\n在独立子目录解包，保留源 VPK 与同名文件。`);
  return tools;
}
