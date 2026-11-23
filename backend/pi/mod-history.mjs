import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fail } from '../mods/files.mjs';
import { displayNames, replaceDisplayNames } from '../mods/display-names.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rootKey = root => path.resolve(root).toLowerCase();
const profiles = profile => profile ? { modIds: profile.modIds, modsInitialized: profile.modsInitialized ?? false, modsGameRoot: profile.modsGameRoot ?? null } : null;
function current(settings, change, root) {
  if (change.type === 'favorite-collection') return settings.favoriteCollections?.find(c => c.id === change.id) ?? null;
  if (change.type === 'display-name') return displayNames(settings, root)[change.id] ?? null;
  if (change.type === 'category') return settings.categories.find(c => c.id === change.id) ?? null;
  if (change.type === 'profile-mods') return profiles(settings.profiles.find(p => p.id === change.id));
  return settings[change.type]?.[change.id] ?? null;
}
export function metadataDelta(before, after, root) {
  const changes = [];
  for (const type of ['category', 'assignments', 'modMeta', 'profile-mods', 'display-name', 'favorite-collection', 'favoriteRefs']) {
    const keys = type === 'category' ? [...before.categories, ...after.categories].map(c => c.id)
      : type === 'profile-mods' ? [...before.profiles, ...after.profiles].map(p => p.id)
      : type === 'display-name' ? [...Object.keys(displayNames(before, root)), ...Object.keys(displayNames(after, root))]
      : type === 'favorite-collection' ? [...before.favoriteCollections ?? [], ...after.favoriteCollections ?? []].map(c => c.id)
      : [...Object.keys(before[type] ?? {}), ...Object.keys(after[type] ?? {})];
    for (const id of new Set(keys)) {
      const change = { type, id }, a = current(before, change, root), b = current(after, change, root);
      if (!equal(a, b)) changes.push({ ...change, before: copy(a), after: copy(b) });
    }
  }
  return changes;
}
export function historyEntries(settings, root) {
  const store = settings.modHistory;
  if (store && (store.version !== 1 || !Array.isArray(store.entries))) fail('mod_history_invalid', 'Mod 整理记录格式需要检查，原设置已保留。');
  return (store?.entries ?? []).filter(e => rootKey(e.gameRoot) === rootKey(root));
}
export async function commitMetadata(service, root, label, next) {
  historyEntries(service.settings,root);
  next=await service.prepareFavorites(next);
  const changes = metadataDelta(service.settings, next, root);
  if (!changes.length) return { historyId: null, changeCount: 0 };
  historyEntries(service.settings, root);
  const entry = { id: randomUUID(), gameRoot: root, label, createdAt: new Date().toISOString(), state: 'applied', changes };
  await service.save({ ...next, modHistory: { version: 1, entries: [...(service.settings.modHistory?.entries ?? []), entry].slice(-100) } });
  return { historyId: entry.id, changeCount: changes.length };
}
function restoreValue(next, change, root) {
  if (change.type === 'category' || change.type === 'favorite-collection') {
    const key = change.type === 'category' ? 'categories' : 'favoriteCollections';
    const rows = next[key] ??= [], index = rows.findIndex(c => c.id === change.id);
    if (change.before === null) next[key] = rows.filter(c => c.id !== change.id);
    else if (index < 0) rows.push(copy(change.before)); else rows[index] = copy(change.before);
  } else if (change.type === 'profile-mods') {
    const profile = next.profiles.find(p => p.id === change.id);
    if (!profile || !change.before) fail('mod_history_conflict', '相关方案已变化，请先检查方案。');
    profile.modIds = copy(change.before.modIds); profile.modsInitialized = change.before.modsInitialized;
    if (change.before.modsGameRoot === null) delete profile.modsGameRoot; else profile.modsGameRoot = change.before.modsGameRoot;
    profile.updatedAt = new Date().toISOString();
  } else if (change.type === 'display-name') {
    const names = { ...displayNames(next, root) };
    if (change.before === null) delete names[change.id]; else names[change.id] = change.before;
    next.modNames = replaceDisplayNames(next, root, names);
  } else if (['assignments', 'modMeta', 'favoriteRefs'].includes(change.type)) {
    next[change.type] ??= {};
    if (change.before === null) delete next[change.type][change.id]; else next[change.type][change.id] = copy(change.before);
  } else fail('mod_history_invalid', '整理记录中的操作类型需要检查。');
}
export function undoPreview(settings, root, historyId, knownIds) {
  const entry = historyEntries(settings, root).find(e => e.id === historyId);
  if (!entry || entry.state !== 'applied' || !Array.isArray(entry.changes)) fail('mod_history_missing', '请选择尚未撤销的整理记录。');
  const next = copy(settings);
  for (const change of entry.changes) {
    if (!equal(current(settings, change, root), change.after)) fail('mod_history_conflict', `「${entry.label}」涉及的 ${change.id} 已有后续修改，请先检查。`);
    if (['assignments', 'modMeta', 'display-name'].includes(change.type) && !knownIds.has(change.id)) fail('mod_history_conflict', `Mod 已移除，请先还原：${change.id}`);
    if (change.type === 'profile-mods') {
      const now = new Set(change.after?.modIds ?? []);
      if (change.before?.modIds?.some(id => !now.has(id) && !knownIds.has(id))) fail('mod_history_conflict', '待恢复的方案引用包含已移除的 Mod，请先还原文件。');
    }
    restoreValue(next, change, root);
  }
  const categories = new Set(next.categories.map(c => c.id));
  const groups = next.favoriteCollections ?? [];
  for (const c of groups) {
    if (c.modIds.some(id => !next.modMeta[id]?.favorite && !next.favoriteRefs?.[id]) || groups.some(other => other.id !== c.id && other.name.toLowerCase() === c.name.toLowerCase())) {
      fail('mod_history_conflict', '收藏或合集名称已有后续修改，请先检查「' + c.name + '」。');
    }
  }
  const removed = new Set(settings.categories.filter(c => !categories.has(c.id)).map(c => c.id));
  if (Object.values(next.assignments).some(id => removed.has(id)) || next.categories.some(c => removed.has(c.parentId))) {
    fail('mod_history_conflict', '待撤销的新分类已有其他条目或子分类使用，请先移动它们。');
  }
  for (const change of entry.changes) if (change.type === 'assignments' && change.before !== null && !categories.has(change.before)) {
    fail('mod_history_conflict', '原分类已移除，请先恢复分类。');
  }
  for (const change of entry.changes) if (change.type === 'category' && change.before) {
    const category = change.before;
    if (category.parentId && !categories.has(category.parentId)) fail('mod_history_conflict', '原上级分类已移除，请先恢复上级分类。');
    if (next.categories.some(c => c.id !== category.id && (c.parentId ?? '') === (category.parentId ?? '') && c.name.toLowerCase() === category.name.toLowerCase())) {
      fail('mod_history_conflict', '原位置已有同名分类，请先处理分类名称。');
    }
    const seen = new Set([category.id]); let parent = category.parentId;
    while (parent) {
      if (seen.has(parent)) fail('mod_history_conflict', '分类层级已有后续调整，请先检查上级分类。');
      seen.add(parent); parent = next.categories.find(c => c.id === parent)?.parentId;
    }
  }
  return { entry, next };
}
export async function undoMetadata(service, root, historyId, knownIds) {
  const { entry, next } = undoPreview(service.settings, root, historyId, knownIds);
  next.modHistory.entries.find(e => e.id === entry.id).state = 'undone';
  next.modHistory.entries.find(e => e.id === entry.id).undoneAt = new Date().toISOString();
  await service.save(next);
  return { status: 'undone', historyId, label: entry.label, changeCount: entry.changes.length };
}
