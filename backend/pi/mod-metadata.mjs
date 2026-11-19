import { fail } from '../mods/files.mjs';
import path from 'node:path';
import { metadataDelta } from './mod-history.mjs';
import { displayNames, replaceDisplayNames } from '../mods/display-names.mjs';
import { planFavoriteCollection, withoutMembers } from '../mods/favorite-collections.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const sameRoot = (a, b) => !a || path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const validName = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) fail('invalid_argument', '分类名称需要 1–60 个字符。');
  return value.trim();
};
export function planMetadata(kind, params, settings, inventory, root, views) {
  if (kind === 'favorite-collection') {
    const plan = planFavoriteCollection(settings, params, inventory.mods);
    const changes = metadataDelta(settings, plan.next, root);
    // A new collection gets its permanent ID on commit; compare the inputs the user actually previewed.
    const expected = { group: settings.favoriteCollections?.find(c => c.id === params.collectionId) ?? null, lines: plan.lines,
      before: changes.map(({ type, id, before }) => ({ type, id: params.action === 'create' && type === 'favorite-collection' ? null : id, before })) };
    return { ...plan, changeCount: changes.length, expected };
  }
  const next = copy(settings), lines = [];
  const chosen = () => {
    if (!Array.isArray(params.modIds) || !params.modIds.length || new Set(params.modIds).size !== params.modIds.length) fail('invalid_argument', '需要去重的 Mod ID 清单。');
    return params.modIds.map(id => {
      const mod = inventory.mods.find(mod => mod.id === id);
      if (!mod || mod.kind === 'platform-package') fail('mod_missing', '请选择当前库中的普通 VPK Mod。');
      return mod;
    });
  };
  let label, renamePreview;
  if (kind === 'rename') {
    const items = params.items;
    if (!Array.isArray(items) || !items.length || items.length > 256) fail('invalid_argument', '每批请选择 1–256 个 Mod。');
    const lookup = new Map(inventory.mods.map(mod => [mod.id, mod])), names = { ...displayNames(settings, root) }, seen = new Set();
    renamePreview = [];
    for (const item of items) {
      const mod = lookup.get(item?.modId);
      if (!mod || mod.kind === 'platform-package') fail('mod_missing', '请选择当前库中的普通 VPK Mod。');
      if (seen.has(mod.id)) fail('invalid_argument', '同一个 Mod 请保留一个目标名称。');
      seen.add(mod.id);
      const prefix = Object.hasOwn(item, 'prefix');
      if (prefix === Object.hasOwn(item, 'name')) fail('invalid_argument', '每项填写 name 或 prefix；name 为 null 时恢复原名。');
      let value = prefix ? item.prefix : item.name;
      if (prefix || value !== null) {
        if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f\u2028\u2029]/u.test(value)) fail('invalid_argument', '显示名和前缀需要单行非空文本。');
        value = value.trim();
        if (prefix) value = mod.sourceTitle.startsWith(value + ' ') || mod.sourceTitle === value ? mod.sourceTitle : value + ' ' + mod.sourceTitle;
        if (value.length > 512) fail('invalid_argument', '显示名最多 512 个字符：' + mod.id);
      }
      if (value === null || value === mod.sourceTitle) delete names[mod.id]; else names[mod.id] = value;
      const after = names[mod.id] ?? mod.sourceTitle;
      renamePreview.push([mod.id, mod.sourceTitle, mod.title, after]);
      if ((displayNames(settings, root)[mod.id] ?? null) !== (names[mod.id] ?? null)) lines.push(mod.title + ' → ' + after + '\n' + mod.id);
    }
    next.modNames = replaceDisplayNames(settings, root, names);
    label = '修改 ' + lines.length + ' 个 Mod 的显示名';
  } else if (kind === 'mark') {
    if (params.favorite === undefined && params.sorted === undefined) fail('invalid_argument', '请指定 favorite 或 sorted。');
    for (const key of ['favorite', 'sorted']) if (params[key] !== undefined && typeof params[key] !== 'boolean') fail('invalid_argument', 'Mod 标记需要布尔值。');
    const mods = chosen(); label = `更新 ${mods.length} 个 Mod 标记`;
    if (params.favorite === false) {
      const ids = new Set(mods.map(m => m.id));
      for (const c of settings.favoriteCollections ?? []) if (c.modIds.some(id => ids.has(id))) lines.push('同时移出收藏合集「' + c.name + '」');
      next.favoriteCollections = withoutMembers(settings.favoriteCollections, ids);
    }
    for (const mod of mods) {
      const before = settings.modMeta[mod.id] ?? {}, value = { ...before };
      if (params.favorite !== undefined) { if (params.favorite) value.favorite = true; else delete value.favorite; }
      if (params.sorted !== undefined) { if (params.sorted) delete value.inbox; else value.inbox = true; }
      if (value.favorite && params.sorted === false) fail('invalid_argument', '放回新下载时，请同时将 favorite 设为 false。');
      if (value.favorite) delete value.inbox;
      if (Object.keys(value).length) next.modMeta[mod.id] = value; else delete next.modMeta[mod.id];
      lines.push(`${mod.title} [${mod.id}]\n收藏：${before.favorite ? '是' : '否'} → ${value.favorite ? '是' : '否'}；新下载：${before.inbox ? '是' : '否'} → ${value.inbox ? '是' : '否'}`);
    }
  } else if (kind === 'profile-members') {
    if (!['add', 'remove'].includes(params.action)) fail('invalid_argument', '请选择 add 或 remove。');
    const profile = next.profiles.find(profile => profile.id === params.profileId);
    if (!profile || !sameRoot(profile.modsGameRoot, root)) fail('profile_missing', '请选择当前游戏的方案。');
    const view = views.find(p => p.id === profile.id), mods = chosen(), selected = new Set(view.modIds);
    label = `${params.action === 'add' ? '加入' : '移出'}方案「${profile.name}」`;
    for (const mod of mods) {
      const before = selected.has(mod.id);
      if (params.action === 'add') {
        if (mod.error) fail('invalid_vpk', `请先处理 VPK 解析错误：${mod.title}`);
        selected.add(mod.id);
        if (next.modMeta[mod.id]?.inbox) { const value = { ...next.modMeta[mod.id] }; delete value.inbox; next.modMeta[mod.id] = value; }
      } else selected.delete(mod.id);
      lines.push(`${mod.title} [${mod.id}]\n方案选择：${before ? '已加入' : '未加入'} → ${selected.has(mod.id) ? '已加入' : '未加入'}`);
    }
    Object.assign(profile, { modIds: [...selected], modsInitialized: true, modsGameRoot: root, updatedAt: new Date().toISOString() });
    lines.push('保存为方案草稿，游戏当前启用状态保持原样。');
  } else if (kind === 'category') {
    const category = next.categories.find(c => c.id === params.categoryId && !c.builtin);
    if (!category) fail('category_missing', '请选择已有的普通分类。');
    const descendants = new Set([category.id]);
    for (let n = 0; n < next.categories.length; n++) for (const c of next.categories) if (descendants.has(c.parentId)) descendants.add(c.id);
    const destination = id => {
      const target = id && id !== 'cat-none' ? next.categories.find(c => c.id === id && !c.builtin) : undefined;
      if (id && id !== 'cat-none' && !target) fail('category_missing', '目标分类已变化，请重新扫描。');
      if (target && descendants.has(target.id)) fail('category_cycle', '请选择当前分类及其子分类以外的目标。');
      return target;
    };
    if (params.action === 'rename') { const before = category.name; category.name = validName(params.name); label = `重命名分类「${before}」`; lines.push(`${before} → ${category.name}`); }
    else if (params.action === 'move') {
      if (!Object.hasOwn(params, 'parentId')) fail('invalid_argument', '移动分类时请指定 parentId；null 为最外层。');
      const target = destination(params.parentId);
      const before = settings.categories.find(c => c.id === category.parentId)?.name ?? '最外层';
      if (target) category.parentId = target.id; else delete category.parentId;
      label = `移动分类「${category.name}」`; lines.push(`${before} → ${target?.name ?? '最外层'}（包含子分类）`);
    } else if (params.action === 'merge' || params.action === 'delete') {
      if (params.action === 'merge' && !params.targetId) fail('invalid_argument', '合并分类需要 targetId。');
      const target = destination(params.targetId ?? category.parentId), targetId = target?.id ?? 'cat-none';
      label = `${params.action === 'merge' ? '合并' : '删除'}分类「${category.name}」`;
      for (const [id, assigned] of Object.entries(next.assignments)) if (assigned === category.id) {
        next.assignments[id] = targetId;
        if (next.modMeta[id]?.inbox) next.modMeta[id] = { ...next.modMeta[id], inbox: false };
        lines.push(`${inventory.mods.find(mod => mod.id === id)?.title ?? id} [${id}] → ${target?.name ?? '最外层'}`);
      }
      for (const child of next.categories.filter(c => c.parentId === category.id)) {
        if (target) child.parentId = target.id; else delete child.parentId;
        lines.push(`子分类「${child.name}」→ ${target?.name ?? '最外层'}`);
      }
      next.categories = next.categories.filter(c => c.id !== category.id);
      lines.push('移除该分类条目，Mod 文件与方案选择保留。');
    } else fail('invalid_argument', '分类操作支持 rename、move、merge、delete。');
    const names = new Set();
    for (const c of next.categories.filter(c => !c.builtin)) {
      const key = JSON.stringify([c.parentId ?? '', c.name.toLowerCase()]);
      if (names.has(key)) fail('category_duplicate', '目标位置有同名分类，请先明确需要合并的分类。');
      names.add(key);
    }
  } else fail('COMMAND_SCOPE', '未知的 Mod 元数据操作。');
  const changes = metadataDelta(settings, next, root);
  return { next, label, lines, changeCount: changes.length,
    expected: { ...(renamePreview ? { titles: renamePreview } : {}), ...(kind === 'category' ? { categories: copy(settings.categories) } : {}), before: changes.map(({ type, id, before }) => ({ type, id, before })) } };
}
