import { fail, samePath } from './files.mjs';
import { cleanFavoriteVersions, favoritePath } from './favorite-vault.mjs';
import { isFavoriteTrashId, keepRemovedFavorites } from './favorite-trash.mjs';

// The settings file stays the commit point for the vault, shelf and recycle bin.
export async function prepareFavoriteWrite(service, next) {
  const prev = service.settings;
  const prepared = await keepRemovedFavorites(service, prev, await service.prepareFavorites(next));
  return {
    next: prepared,
    discardNewVersions: () => cleanFavoriteVersions(service, prepared, prev),
    discardRetiredVersions: () => cleanFavoriteVersions(service, prev, prepared),
  };
}

export function favoriteAsset(service, id) {
  if (typeof id !== 'string' || !(id.startsWith('fav-asset:') || id.startsWith('favorite-file:'))) return;
  return favoritePath(service, service.settings.favoriteRefs?.[id.replace(/^fav-asset:/, '')]);
}

function matchesFavorite(service, ref, file) {
  return !!ref && typeof file === 'string' && (
    (!!ref.absolutePath && samePath(ref.absolutePath, file)) || (ref.vaultKey && samePath(favoritePath(service, ref), file))
  );
}

export function favoriteSource(service, id, file) {
  const ref = service.settings.favoriteRefs?.[id];
  if (!matchesFavorite(service, ref, file)) fail('favorite_missing', '收藏来源已变更，请重新选择。');
  return ref;
}

export async function linkFavoriteSource(service, id, file, gameRoot, modId) {
  const refs = service.settings.favoriteRefs ?? {};
  const ref = id ? refs[id] : undefined;
  if (!matchesFavorite(service, ref, file)) return;
  const mod = (await service.modManager.scan(gameRoot, { conflicts: false })).mods.find(m => m.id === modId);
  const library = { gameRoot, modId, version: mod?.packageVersion };
  await service.save({ ...service.settings, favoriteRefs: { ...refs, [ref.id]: { ...ref, library } } });
}

export function favoriteRefsView(service) {
  return Object.fromEntries(Object.entries(service.settings.favoriteRefs ?? {}).map(([id, ref]) =>
    [id, ref.vaultKey ? { ...ref, ownedPath: favoritePath(service, ref) } : ref]));
}

export async function trashThumbnail(service, trashId) {
  if (!isFavoriteTrashId(trashId)) return service.modTrash.thumbnail(await service.requireRoot(), trashId);
  const row = service.settings.favoriteTrash?.find(r => r.trashId === trashId);
  if (!row?.ref.vaultKey || row.state !== 'trashed' || !row.files.length) return { dataUrl: null, dirs: row?.ref.dirs ?? [] };
  return service.modManager.localThumbnail(favoritePath(service, row.ref), { archived: true });
}
