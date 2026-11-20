import { randomUUID } from 'node:crypto';
import { fail } from './files.mjs';

export function withoutMembers(collections = [], ids) {
  return collections.map(c => c.modIds.some(id => ids.has(id)) ? { ...c, modIds: c.modIds.filter(id => !ids.has(id)) } : c);
}

/** One transaction for the Mod page and 茶茶. Collections reference favorites; they never own VPKs. */
export function planFavoriteCollection(settings, { action, collectionId, name, modIds = [] }, mods) {
  const groups = settings.favoriteCollections ?? [];
  const creating = action === 'create', naming = creating || action === 'rename';
  if (!['create', 'rename', 'add', 'remove', 'delete'].includes(action)) fail('invalid_argument', '请选择收藏合集操作。');
  const group = creating ? { id: 'fav-' + randomUUID(), name: '', modIds: [] } : groups.find(c => c.id === collectionId);
  if (!group) fail('collection_missing', '这个收藏合集已移除，请重新选择。');
  const title = naming && typeof name === 'string' ? name.trim() : group.name;
  if (naming && (typeof name !== 'string' || !title || title.length > 60 || /[\x00-\x1f\x7f]/u.test(title))) fail('invalid_argument', '合集名称需要 1–60 个单行字符。');
  if (naming && groups.some(c => c.id !== group.id && c.name.toLowerCase() === title.toLowerCase())) fail('collection_duplicate', '已有同名收藏合集，换个名字试试。');
  if (!Array.isArray(modIds) || (!creating && ['add','remove'].includes(action) && !modIds.length) || (modIds.length && !['create','add','remove'].includes(action))) fail('invalid_argument', '请提供此次整理的 Mod 清单。');
  const library = new Map([...mods, ...Object.values(settings.favoriteRefs ?? {})].map(m => [m.id, m])), ids = [...new Set(modIds)];
  for (const id of ids) if (!library.has(id)) fail('mod_missing', '所选 Mod 已离开当前库，请刷新后重选。');
  const members = new Set(group.modIds), modMeta = { ...settings.modMeta }, lines = [];
  for (const id of ids) {
    if (action === 'remove') {
      if (members.delete(id)) lines.push('移出 · ' + library.get(id).title);
    } else {
      if (!members.has(id)) lines.push((modMeta[id]?.favorite || settings.favoriteRefs?.[id] ? '加入 · ' : '收藏并加入 · ') + library.get(id).title);
      members.add(id);
      if (!settings.favoriteRefs?.[id]) modMeta[id] = { ...modMeta[id], favorite: true };
    }
  }
  const updated = { ...group, name: title, modIds: [...members] };
  const favoriteCollections = creating ? [...groups, updated] : action === 'delete' ? groups.filter(c => c.id !== group.id) : groups.map(c => c.id === group.id ? updated : c);
  const label = ({create:'新建收藏合集', rename:'重命名收藏合集', add:'加入收藏合集', remove:'移出收藏合集', delete:'删除收藏合集'})[action] + '「' + (naming ? title : group.name) + '」';
  if (action === 'rename') lines.push(group.name + ' → ' + title);
  if (action === 'delete') lines.push('移除合集，保留其中 ' + members.size + ' 个 Mod 的收藏。');
  if (!lines.length) lines.push(creating ? '创建空合集。' : '所选成员已是目标状态。');
  return { next: { ...settings, favoriteCollections, modMeta }, label, lines, collectionId: group.id };
}
