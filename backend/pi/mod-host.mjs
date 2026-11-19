import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PlatformError } from '../core.mjs';
import { inspectMod, compareMods } from './mod-inspect.mjs';
import { planMetadata } from './mod-metadata.mjs';
import { commitMetadata, historyEntries, undoPreview, undoMetadata } from './mod-history.mjs';
import { ACQUIRE_OPS, acquireMod } from './mod-acquire.mjs';

const fail = (code, message) => { throw new PlatformError(code, message); };
const sameRoot = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const aborted = signal => { if (signal?.aborted) fail('operation_canceled', '操作已取消。'); };
function ids(value) {
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !id)) fail('invalid_argument', '请选择扫描结果中的 Mod 或回收条目 ID。');
  return [...new Set(value)];
}
const snapshot = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Reuse the desktop's live store, serialization, file guards and recycle transactions. */
export function modHost(service, gameRoot) {
  return async (operation, params = {}, confirmation, signal) => {
    await service.ready; aborted(signal);
    if (!sameRoot(gameRoot, await service.requireRoot())) fail('context_changed', '游戏目录已切换，请重新连接助手后扫描。');
    if (ACQUIRE_OPS.has(operation)) return acquireMod(service, gameRoot, operation, params, confirmation, signal);
    if (operation === 'inspect' || operation === 'compare') {
      const result = await (operation === 'inspect' ? inspectMod : compareMods)(service.modManager, gameRoot, params, signal);
      if (!sameRoot(gameRoot, await service.requireRoot())) fail('context_changed', '游戏目录已切换，请重新连接助手。');
      return result;
    }
    return service.serial(async () => {
    await service.ready; aborted(signal);
    if (!sameRoot(gameRoot, await service.requireRoot())) fail('context_changed', '游戏目录已切换，请重新连接助手后扫描。');
    const scan = () => service.modManager.scan(gameRoot);
    const currentMods = async selected => {
      const inventory = await scan();
      const mods = ids(selected).map(id => inventory.mods.find(mod => mod.id === id) ?? fail('mod_missing', '选中的 Mod 已移除，请重新扫描。'));
      if (mods.some(mod => mod.kind === 'platform-package')) fail('platform_package_readonly', '此项属于整包组件，请在插件页管理。');
      return { inventory, mods };
    };
    const organize = async moves => {
      if (!Array.isArray(moves) || !moves.length) fail('invalid_argument', '需要 Mod 归类清单。');
      const { mods } = await currentMods(moves.map(move => move?.modId));
      if (new Set(moves.map(move => move.modId)).size !== moves.length) fail('invalid_argument', '同一个 Mod 请保留一个目标分类。');
      const categories = snapshot(service.settings.categories), assignments = {}, changes = [];
      for (const move of moves) {
        const mod = mods.find(mod => mod.id === move.modId);
        const before = service.settings.assignments[move.modId] ?? 'cat-none';
        let category;
        if (move.categoryId && !move.categoryName && !move.parentId) category = categories.find(c => c.id === move.categoryId);
        else if (!move.categoryId && typeof move.categoryName === 'string' && move.categoryName.trim() && move.categoryName.trim().length <= 60) {
          if (move.parentId && !categories.some(c => c.id === move.parentId && !c.builtin)) fail('category_missing', '上级分类已变化，请重新扫描。');
          const name = move.categoryName.trim(), parentId = move.parentId || undefined;
          category = categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.parentId === parentId);
          if (!category) { category = { id: `cat-${randomUUID()}`, name, ...(parentId ? { parentId } : {}) }; categories.push(category); }
        }
        if (!category) fail('category_missing', '请选择已有分类 ID，或提供新分类名称及可选上级分类 ID。');
        assignments[mod.id] = category.id;
        if (before !== category.id) changes.push({ id: mod.id, title: mod.title, from: service.settings.categories.find(c => c.id === before)?.name ?? '未分类', to: category.name });
      }
      const expected = { categories: service.settings.categories, assignments: moves.map(m => [m.modId, service.settings.assignments[m.modId] ?? 'cat-none', service.settings.modMeta[m.modId] ?? null]) };
      return { categories, assignments, changes, expected: snapshot(expected) };
    };
    const deletion = async selected => {
      const { mods } = await currentMods(selected);
      const { records } = await service.modTrash.prepare(gameRoot, mods.map(m => m.id));
      return { mods: records.map(r => ({ ...service.modTrash.view(r), favorite: !!r.meta?.favorite,
        profileNames: r.profileIds.map(id => service.settings.profiles.find(p => p.id === id)?.name ?? id) })),
        sizeBytes: records.reduce((n, r) => n + r.sizeBytes, 0),
        expected: snapshot(records.map(({ modId, title, files, categoryId, profileIds, meta }) => ({ modId, title, files, categoryId, profileIds, meta }))) };
    };
    if (operation === 'inventory') {
      const inventory = await scan(), settings = service.settings, game = await service.core.inspectGame(gameRoot);
      return { ...inventory, gameRoot, gameRunning: !!game.processes.length, categories: settings.categories, activeProfileId: settings.activeProfileId,
        mods: inventory.mods.map(mod => ({ ...mod, categoryId: settings.assignments[mod.id] ?? 'cat-none', origin: settings.modOrigins?.[mod.id], ...settings.modMeta[mod.id] })),
        profiles: service.profileViews(inventory.mods).filter(p => !p.modsGameRoot || sameRoot(p.modsGameRoot, gameRoot)).map(({ id, name, modIds }) => ({ id, name, modIds })) };
    }
    if (operation === 'organize-preview') return organize(params.moves);
    if (operation === 'delete-preview') return deletion(params.modIds);
    if (operation === 'trash-list') return { entries: await service.modTrash.list(gameRoot) };
    const metadata = async () => {
      const inventory = await scan();
      return planMetadata(params.kind, params, service.settings, inventory, gameRoot, service.profileViews(inventory.mods));
    };
    if (operation === 'metadata-preview') {
      const { next: _next, ...plan } = await metadata(); return { ...plan, gameRoot };
    }
    if (operation === 'history') {
      const limit = params.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('invalid_argument', '记录数量范围为 1–100。');
      const entries = historyEntries(service.settings, gameRoot).slice().reverse();
      return { entries: entries.filter(e => !params.historyId || e.id === params.historyId).slice(0, limit).map(({ changes, ...entry }) => ({ ...entry, changeCount: changes.length, ...(params.historyId ? { changes } : {}) })) };
    }
    const undo = async () => {
      const id = params.historyId ?? historyEntries(service.settings, gameRoot).toReversed().find(e => e.state === 'applied')?.id;
      const inventory = await scan(), known = new Set(inventory.mods.map(m => m.id));
      return { ...undoPreview(service.settings, gameRoot, id, known), known, inventory };
    };
    if (operation === 'undo-preview') {
      const { entry, inventory } = await undo();
      const modName = id => `${inventory.mods.find(m => m.id === id)?.title ?? id} [${id}]`;
      const categoryName = id => service.settings.categories.find(c => c.id === id)?.name ?? entry.changes.find(c => c.type === 'category' && c.id === id)?.before?.name ?? '最外层';
      const lines = entry.changes.map(change => {
        if (change.type === 'display-name') {
          const mod = inventory.mods.find(m => m.id === change.id);
          return mod.title + ' → ' + (change.before ?? mod.sourceTitle) + '\n' + mod.id;
        }
        if (change.type === 'profile-mods') {
          const from = new Set(change.after.modIds), to = new Set(change.before.modIds);
          return `方案「${service.settings.profiles.find(p => p.id === change.id)?.name ?? change.id}」\n恢复加入：${[...to].filter(id => !from.has(id)).map(modName).join('、') || '无'}\n恢复移出：${[...from].filter(id => !to.has(id)).map(modName).join('、') || '无'}${change.before.modsInitialized ? '' : '\n恢复方案原有的游戏启用项推导状态。'}`;
        }
        if (change.type === 'assignments') return `${modName(change.id)}\n${categoryName(change.after)} → ${categoryName(change.before)}`;
        if (change.type === 'modMeta') return `${modName(change.id)}\n收藏：${change.after?.favorite ? '是' : '否'} → ${change.before?.favorite ? '是' : '否'}；新下载：${change.after?.inbox ? '是' : '否'} → ${change.before?.inbox ? '是' : '否'}`;
        return `分类「${change.after?.name ?? change.before?.name}」\n${change.after ? JSON.stringify(change.after) : '已移除'} → ${change.before ? JSON.stringify(change.before) : '撤销新增分类'}`;
      });
      return { historyId: entry.id, label: `撤销：${entry.label}`, gameRoot, createdAt: entry.createdAt, changes: entry.changes, lines };
    }
    service.confirm(confirmation); aborted(signal);
    if (operation === 'metadata') {
      const plan = await metadata();
      if (!equal(params.expected, plan.expected)) fail('mod_plan_changed', 'Mod 名称、标记、分类或方案刚有变化，请重新预览。');
      aborted(signal);
      const saved = await commitMetadata(service, gameRoot, plan.label, plan.next);
      service.emit('event', { type: 'objects_changed' });
      return { status: 'saved', label: plan.label, ...saved };
    }
    if (operation === 'undo') {
      const { entry, known } = await undo(); aborted(signal);
      const result = await undoMetadata(service, gameRoot, entry.id, known);
      service.emit('event', { type: 'objects_changed' }); return result;
    }
    if (operation === 'organize') {
      const plan = await organize(params.moves);
      if (!equal(params.expected, plan.expected)) fail('mod_plan_changed', '分类或 Mod 标记刚有变化，请重新扫描并确认。');
      aborted(signal);
      // Preserve all existing categories and omitted assignments; desktop owns this write.
      const next = { ...service.settings, categories: plan.categories, assignments: { ...service.settings.assignments, ...plan.assignments }, modMeta: { ...service.settings.modMeta } };
      for (const [id, category] of Object.entries(plan.assignments)) if (category !== service.settings.assignments[id] && next.modMeta[id]?.inbox) next.modMeta[id] = { ...next.modMeta[id], inbox: false };
      const saved = await commitMetadata(service, gameRoot, `整理 ${plan.changes.length} 个 Mod 分类`, next);
      service.emit('event', { type: 'objects_changed' });
      return { status: 'organized', count: plan.changes.length, changes: plan.changes, ...saved };
    }
    if (operation === 'delete') {
      const plan = await deletion(params.modIds);
      if (!equal(params.expected, plan.expected)) fail('mod_plan_changed', '待删文件、分类或方案引用刚有变化，请重新预览并确认。');
      aborted(signal);
      const result = await service.modTrash.delete(gameRoot, params.modIds, confirmation);
      service.emit('event', { type: 'objects_changed' }); return result;
    }
    if (operation === 'restore' || operation === 'purge') {
      const selected = ids(params.trashIds), entries = await service.modTrash.list(gameRoot);
      const current = selected.map(id => entries.find(e => e.trashId === id) ?? fail('trash_missing', '回收条目已变化，请刷新。'));
      if (!equal(params.expected, current)) fail('mod_plan_changed', '回收条目刚有变化，请重新预览并确认。');
      aborted(signal);
      const result = await service.modTrash[operation](gameRoot, selected, confirmation);
      service.emit('event', { type: 'objects_changed' }); return result;
    }
    fail('COMMAND_SCOPE', '未知的 Mod 管理操作。');
    });
  };
}
