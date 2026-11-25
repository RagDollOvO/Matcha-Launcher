import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fail, samePath } from './files.mjs';
import { modImportCommands } from './imports.mjs';
import { saveProfile, selectProfile, deleteProfile, removeMissingProfileMods } from './profiles.mjs';
import { disableConflictProvider, setConflictReviewed } from './conflict-reviews.mjs';
import { bookmarkFiles, collectionPlan } from './favorite-files.mjs';
import { withoutMembers } from './favorite-collections.mjs';
import { previewRecycleSources, recycleSources } from './favorite-recycle.mjs';
import { favoriteProfilePlan } from './favorite-profiles.mjs';
import { favoritePath, importFavoriteCopy } from './favorite-vault.mjs';
import { favoriteTrashView } from './favorite-trash.mjs';
import { planMetadata } from '../pi/mod-metadata.mjs';
import { commitMetadata } from '../pi/mod-history.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const exists = async p => fs.access(p).then(() => true, () => false);

async function renameMod(service, { gameRoot, id, name, expected }, confirmation) {
  service.confirm(confirmation);
  const root = await service.requireRoot();
  if (!samePath(root, gameRoot)) fail('game_changed', '游戏目录已切换，请重新选择 Mod。');
  const inventory = await service.modManager.scan(root, { conflicts: false });
  const plan = planMetadata('rename', { items: [{ modId: id, name }] }, service.settings, inventory, root);
  const mod = inventory.mods.find(m => m.id === id);
  if (mod.title !== expected?.title || mod.sourceTitle !== expected?.sourceTitle)
    fail('mod_name_changed', '这个 Mod 的名称刚有更新，请重新打开改名窗口。');
  return commitMetadata(service, root, plan.label, plan.next);
}

async function saveCategories(service, p) {
  const modMeta = { ...service.settings.modMeta };
  for (const [id, category] of Object.entries(p.assignments ?? {})) if (category !== service.settings.assignments[id] && modMeta[id]?.inbox) modMeta[id] = { ...modMeta[id], inbox: false };
  await service.save({ ...service.settings, modMeta, categories: p.categories, assignments: { ...service.settings.assignments, ...p.assignments } });
  return { status: 'saved' };
}

async function saveModMeta(service, p) {
  if (!p.patch || typeof p.patch !== 'object' || Array.isArray(p.patch)) fail('invalid_argument', '需要按 Mod ID 保存的标记。');
  const modMeta = { ...service.settings.modMeta };
  for (const [id, value] of Object.entries(p.patch)) {
    if (!id || ['__proto__', 'prototype', 'constructor'].includes(id) || (value !== null && (typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, v]) => !['favorite', 'inbox'].includes(key) || typeof v !== 'boolean')))) fail('invalid_argument', 'Mod 标记需要 favorite / inbox 布尔值或 null。');
    if (p.scope === 'inbox') {
      const next = { ...modMeta[id] };
      if (value?.inbox) next.inbox = true; else delete next.inbox;
      if (Object.keys(next).length) modMeta[id] = next; else delete modMeta[id];
      continue;
    }
    // Each supplied ID replaces its complete record; omitted fields are cleared.
    if (value === null) delete modMeta[id]; else modMeta[id] = { ...value };
  }
  if (p.scope === 'inbox') {
    await service.save({ ...service.settings, modMeta });
    return { status: 'saved' };
  }
  const unstarred = new Set(Object.keys(p.patch).filter(id => !modMeta[id]?.favorite && (service.settings.modMeta[id]?.favorite || p.patch[id] === null)));
  const favoriteRefs = { ...service.settings.favoriteRefs };
  for (const id of unstarred) delete favoriteRefs[id];
  await service.save({ ...service.settings, modMeta, favoriteRefs, favoriteCollections: withoutMembers(service.settings.favoriteCollections, unstarred) });
  return { status: 'saved' };
}

async function importCopy(service, p, confirmation) {
  service.confirm(confirmation);
  const root = await service.requireRoot();
  if (!samePath(root, p.gameRoot)) fail('game_changed', '游戏目录已切换，请重新选择。');
  return importFavoriteCopy(service, p.id, root, confirmation);
}

async function applyFavoritesToProfiles(service, p, confirmation) {
  service.confirm(confirmation);
  const root = await service.requireRoot();
  if (!samePath(root, p.gameRoot)) fail('game_changed', '游戏目录已切换，请重新选择方案。');
  const { mods } = await service.modManager.scan(root, { conflicts: false });
  const plan = favoriteProfilePlan(service.settings, mods, service.profileViews(mods), root, p);
  if (plan.changeCount) await service.save(plan.next);
  return { added: plan.added, lines: plan.lines };
}

async function packFavoriteFolder(service, p, confirmation) {
  service.confirm(confirmation);
  const ref = service.settings.favoriteRefs?.[p.id];
  if (ref?.referenceKind !== 'folder') fail('favorite_missing', '请选择收藏的素材文件夹。');
  favoritePath(service, ref);
  return service.tasks.create('pack', {
    favoriteExport: ref, exportDir: await service.getDesktop(), gameRoot: service.settings.gameRoot || '',
  }, ref.title);
}

async function recycleFavorites(service, p, confirmation, commit) {
  if (commit) service.confirm(confirmation);
  const plan = await previewRecycleSources(service, p.ids, projectRoot);
  if (!commit) return plan;
  if (!isDeepStrictEqual(plan, p.plan)) fail('file_changed', '来源文件已变化，请重新核对删除清单。');
  return recycleSources(plan, path.join(projectRoot, 'native/build-x86/dist/tools/matcha_recycle.exe'));
}

async function bookmark(service, p, confirmation, commit) {
  const root = await service.root();
  const mods = root && await exists(path.join(root, 'left4dead2')) ? (await service.modManager.scan(root, { conflicts: false })).mods : [];
  const plan = await bookmarkFiles(service.settings, mods, service.modManager, p, root);
  if (!commit) return { duplicates: plan.duplicates, expected: plan.expected };
  if (plan.duplicates.length) {
    service.confirm(confirmation);
    if (!p.expected) fail('favorite_duplicate', '收藏夹中有同名文件，请预览后选择替换或取消。');
  }
  if (p.expected && !isDeepStrictEqual(p.expected, plan.expected)) fail('favorite_changed', '收藏或来源文件刚有变化，请重新确认。');
  await service.save(plan.next);
  return { ids: plan.ids, count: plan.count, skipped: plan.skipped };
}

async function editCollection(service, p, confirmation, commit) {
  const root = await service.root();
  const needsInventory = Array.isArray(p.modIds) && p.modIds.some(id => !service.settings.favoriteRefs?.[id] || p.fromLibraryIds?.includes(id));
  const mods = needsInventory ? (await service.modManager.scan(await service.requireRoot(), { conflicts: false })).mods : [];
  const plan = await collectionPlan(service.settings, mods, service.modManager, p, root);
  if (!commit) return { duplicates: plan.duplicates, expected: plan.expected };
  if (plan.duplicates.length) {
    service.confirm(confirmation);
    if (!p.expected) fail('favorite_duplicate', '请先确认替换同名收藏。');
  }
  if (p.expected && !isDeepStrictEqual(p.expected, plan.expected)) fail('favorite_changed', '合集或原文件已变化，请重新确认。');
  await service.save(plan.next);
  return { id: plan.collectionId, favoriteCollections: plan.next.favoriteCollections };
}

async function removeFavorites(service, p, withTrashReceipt) {
  if (!Array.isArray(p.ids) || p.ids.some(id => typeof id !== 'string' || !id)) fail('invalid_argument', '请选择要移除的收藏。');
  const { favoriteRefs: refs = {}, modMeta: meta, favoriteCollections: groups } = service.settings;
  const ids = new Set(p.ids.filter(id => Object.hasOwn(refs, id) || meta[id]?.favorite || groups.some(c => c.modIds.includes(id))));
  const before = new Set((service.settings.favoriteTrash ?? []).map(r => r.trashId));
  if (!ids.size) return withTrashReceipt ? { count: 0, trashed: [] } : { count: 0 };
  const favoriteRefs = { ...refs }, modMeta = { ...meta };
  for (const id of ids) {
    delete favoriteRefs[id];
    if (!modMeta[id]?.favorite) continue;
    const { favorite, ...rest } = modMeta[id];
    if (Object.keys(rest).length) modMeta[id] = rest;
    else delete modMeta[id];
  }
  await service.save({ ...service.settings, modMeta, favoriteRefs, favoriteCollections: withoutMembers(groups, ids) });
  const trashed = (service.settings.favoriteTrash ?? []).filter(r => !before.has(r.trashId)).map(favoriteTrashView);
  return withTrashReceipt ? { count: trashed.length, trashed } : { count: ids.size };
}

// Dispatched inside the existing DesktopService queue; import tasks publish through that same queue.
export const modCommands = new Map([
  ...modImportCommands,
  ['save-profile', (service, p) => saveProfile(service, p.profile)],
  ['select-profile', (service, p) => selectProfile(service, p.id)],
  ['delete-profile', (service, p) => deleteProfile(service, p.id)],
  ['remove-missing-profile-mods', removeMissingProfileMods],
  ['apply-mod-profile', (service, p, confirmation) => service.applyModProfile(p.id, confirmation)],
  ['set-mod-conflict-reviewed', setConflictReviewed],
  ['disable-mod-conflict-provider', disableConflictProvider],
  ['rename-mod', renameMod],
  ['save-categories', saveCategories],
  ['save-mod-meta', saveModMeta],
  ['import-favorite-copy', importCopy],
  ['favorite-to-profiles', applyFavoritesToProfiles],
  ['pack-favorite-folder', packFavoriteFolder],
  ['preview-recycle-favorites', (service, p) => recycleFavorites(service, p, undefined, false)],
  ['recycle-favorite-files', (service, p, confirmation) => recycleFavorites(service, p, confirmation, true)],
  ['preview-bookmark-files', (service, p) => bookmark(service, p, undefined, false)],
  ['bookmark-files', (service, p, confirmation) => bookmark(service, p, confirmation, true)],
  ['preview-favorite-collection', (service, p) => editCollection(service, p, undefined, false)],
  ['edit-favorite-collection', (service, p, confirmation) => editCollection(service, p, confirmation, true)],
  ['remove-favorites', (service, p) => removeFavorites(service, p, false)],
  ['trash-favorites', (service, p) => removeFavorites(service, p, true)],
  ['preview-delete-mods', async (service, p) => service.modTrash.preview(await service.requireRoot(), p.ids)],
  ['delete-mods', async (service, p, confirmation) => service.modTrash.delete(await service.requireRoot(), p.ids, confirmation)],
  ['restore-mods', (service, p, confirmation) => service.changeTrash('restore', p.trashIds, confirmation)],
  ['purge-trash', (service, p, confirmation) => service.changeTrash('purge', p.trashIds, confirmation)],
]);
