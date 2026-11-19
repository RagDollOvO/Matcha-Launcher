import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parsePort, parseServerAddress, serverError } from './address.mjs';

const fail = (code, message) => { throw serverError(code, message); };
const own = (value, key) => Object.hasOwn(value, key);
const list = value => {
  if (!Array.isArray(value) || !value.length || value.length > 100) fail('invalid_argument', '每批请选择 1–100 项。');
  return value;
};
export function serverIds(value) {
  const ids = list(value);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
    fail('invalid_argument', '请使用服务器清单中的唯一 ID。');
  return ids;
}
function groupName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[\x00-\x1f]/.test(value))
    fail('server_group_invalid', '类别名称需要 1–40 个字符。');
  if (value.trim() === '未分组') fail('server_group_exists', '未分组是已有的固定入口，请使用其他类别名称。');
  return value.trim();
}
function label(value) {
  if (typeof value !== 'string' || value.length > 80) fail('server_label_invalid', '备注最多 80 个字符。');
  return value.trim();
}
const port = value => value === null || value === '' ? null : parsePort(value);

/** Build one metadata-only change set; execution belongs to ServerManager's write queue. */
export function planServerChange(state, action, params, observations = []) {
  const before = structuredClone(state), after = structuredClone(state);
  const changes = [], added = [], removed = [], skipped = [], errors = [];
  const names = new Map(observations.map(s => [s.id, s.name]));
  const subject = entry => `${names.get(entry.id) || entry.label || entry.addr} [${entry.id}] · ${entry.addr}`;
  const entry = id => after.entries.find(s => s.id === id) ?? fail('server_missing', '所选服务器已移除，请重新读取清单。');
  const group = id => after.layout.groups.find(g => g.id === id) ?? fail('server_group_missing', '类别已变化，请重新读取清单。');
  const place = id => after.layout.groups.find(g => g.serverIds.includes(id))?.id ?? 'loose';
  const placeName = id => id === 'loose' ? '未分组' : group(id).name;
  const change = (subject, before, after) => changes.push({ subject, before, after });
  const createGroup = name => {
    const n = groupName(name);
    if (after.layout.groups.some(g => g.name === n)) fail('server_group_exists', `已有类别「${n}」，请使用其 ID。`);
    const created = { id: `sg-${randomUUID()}`, name: n, serverIds: [] };
    after.layout.groups.push(created); change(`类别「${n}」`, '新建', '空类别');
    return created;
  };
  const prune = ids => {
    const set = new Set(ids);
    after.layout.groups.forEach(g => { g.serverIds = g.serverIds.filter(id => !set.has(id)); });
    after.layout.loose = after.layout.loose.filter(id => !set.has(id));
  };
  const move = (id, targetId, index) => {
    const selected = entry(id), from = place(id);
    if (targetId !== 'loose') group(targetId);
    if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) fail('invalid_argument', '类别内的位置使用从 0 开始的非负整数。');
    if (from === targetId && index === undefined) return;
    // Make the implicit ungrouped order explicit before inserting at an index.
    const assigned = new Set([...after.layout.groups.flatMap(g => g.serverIds), ...after.layout.loose]);
    after.layout.loose.push(...after.entries.filter(s => !assigned.has(s.id)).map(s => s.id));
    const old = structuredClone(after.layout); prune([id]);
    const target = targetId === 'loose' ? after.layout.loose : group(targetId).serverIds;
    target.splice(index === undefined ? target.length : Math.min(index, target.length), 0, id);
    if (!isDeepStrictEqual(old, after.layout))
      change(subject(selected), placeName(from), `${placeName(targetId)}${index === undefined ? '' : ` · 第 ${target.indexOf(id) + 1} 位`}`);
  };
  const remove = ids => {
    for (const id of ids) {
      const selected = entry(id);
      change(subject(selected), `${placeName(place(id))}${selected.favorite ? ' · 已收藏' : ''}`, '从 Matcha 列表移除');
      removed.push(id);
    }
    const set = new Set(ids); after.entries = after.entries.filter(s => !set.has(s.id)); prune(ids);
  };

  if (action === 'add') {
    for (const [index, item] of list(params.items).entries()) {
      try {
        if (!item || typeof item !== 'object') fail('invalid_argument', '需要服务器地址。');
        const { addr } = parseServerAddress(item.address);
        const existing = after.entries.find(e => e.addr === addr);
        if (existing) { skipped.push({ address: item.address, addr, id: existing.id, reason: '查询地址已存在，保留原资料' }); continue; }
        const name = own(item, 'label') ? label(item.label) : '';
        const gamePort = own(item, 'gamePort') ? port(item.gamePort) : null;
        const groupId = item.groupId ?? 'loose'; if (groupId !== 'loose') group(groupId);
        if (after.entries.length >= 100) fail('server_limit', '最多保存 100 个服务器，请先移除闲置条目。');
        const created = { id: randomUUID(), addr, label: name, gamePort, favorite: false };
        after.entries.push(created); added.push(created.id);
        change(subject(created), '新地址', `${gamePort === null ? '自动连接端口' : `连接端口 ${gamePort}`} · ${placeName(groupId)}`);
        if (groupId !== 'loose') group(groupId).serverIds.push(created.id);
      } catch (e) { errors.push({ index, address: item?.address ?? '', code: e.code ?? 'invalid_argument', message: e.message }); }
    }
  } else if (action === 'update') {
    const updates = list(params.updates); serverIds(updates.map(u => u?.id));
    for (const patch of updates) {
      const selected = entry(patch.id), previous = { ...selected };
      if (!['label', 'gamePort', 'favorite'].some(k => own(patch, k))) fail('invalid_argument', '请指定要改的备注、收藏或连接端口。');
      if (own(patch, 'label')) selected.label = label(patch.label);
      if (own(patch, 'gamePort')) selected.gamePort = port(patch.gamePort);
      if (own(patch, 'favorite')) {
        if (typeof patch.favorite !== 'boolean') fail('invalid_argument', '收藏状态需要布尔值。');
        selected.favorite = patch.favorite;
      }
      for (const [key, title] of [['label', '备注'], ['favorite', '收藏'], ['gamePort', '连接端口']]) {
        if (previous[key] !== selected[key]) change(`${subject(previous)} · ${title}`, previous[key], selected[key]);
      }
    }
  } else if (action === 'organize') {
    const moves = list(params.moves); serverIds(moves.map(m => m?.serverId));
    for (const item of moves) {
      if (own(item, 'groupId') === own(item, 'groupName')) fail('invalid_argument', '请选择已有类别 ID 或新类别名称。');
      let targetId = item.groupId;
      if (own(item, 'groupName')) {
        const name = groupName(item.groupName);
        targetId = after.layout.groups.find(g => g.name === name)?.id ?? createGroup(name).id;
      }
      move(item.serverId, targetId, item.index);
    }
  } else if (action === 'category') {
    if (params.action === 'create') {
      const created = createGroup(params.name);
      if (params.serverIds !== undefined) for (const id of serverIds(params.serverIds)) move(id, created.id);
    } else if (params.action === 'rename') {
      const selected = group(params.id), name = groupName(params.name);
      if (after.layout.groups.some(g => g.id !== selected.id && g.name === name)) fail('server_group_exists', `已有类别「${name}」。`);
      if (selected.name !== name) { change(`类别 [${selected.id}]`, selected.name, name); selected.name = name; }
    } else if (params.action === 'delete') {
      const selected = group(params.id), members = selected.serverIds.filter(id => after.entries.some(s => s.id === id));
      if (params.removeServers !== undefined && typeof params.removeServers !== 'boolean') fail('invalid_argument', '请选择是否一并移除类别中的服务器。');
      if (params.removeServers) remove(members);
      else {
        after.layout.loose.push(...members);
        for (const id of members) change(subject(entry(id)), selected.name, '未分组');
      }
      change(`类别「${selected.name}」 [${selected.id}]`, `${members.length} 台服务器`, params.removeServers ? '删除类别，并移除其中服务器' : '删除类别，服务器保留在未分组');
      after.layout.groups = after.layout.groups.filter(g => g.id !== selected.id);
    } else if (params.action === 'reorder') {
      const ids = serverIds(params.groupIds);
      if (ids.length !== after.layout.groups.length || ids.some(id => !after.layout.groups.some(g => g.id === id))) fail('server_group_invalid', '请提供全部自定义类别 ID 的新顺序。');
      const previous = after.layout.groups.map(g => g.name);
      after.layout.groups = ids.map(id => group(id));
      if (!isDeepStrictEqual(before.layout.groups, after.layout.groups)) change('类别顺序', previous.join(' → '), after.layout.groups.map(g => g.name).join(' → '));
    } else fail('invalid_argument', '请选择新建、重命名、删除或排序类别。');
  } else if (action === 'remove') remove(serverIds(params.serverIds));
  else fail('COMMAND_SCOPE', '未知的服务器整理操作。');
  return { action, before, after, changes, added, removed, skipped, errors };
}
