import { fail, samePath } from './files.mjs';
import { missingModIds } from './manager.mjs';

export function profileViews(profiles, mods) {
  return profiles.map(p => p.modsInitialized || p.modIds?.length ? p : {
    ...p, modIds: mods.filter(m => m.kind !== 'platform-package' && !m.error && m.storage !== 'library' && m.enabled !== false).map(m => m.id),
  });
}

export function missingModsByProfile(profiles, mods, root) {
  return Object.fromEntries(profiles.flatMap(profile => {
    if (profile.modsGameRoot && !samePath(profile.modsGameRoot, root)) return [];
    const missing = missingModIds(profile.modIds ?? [], mods);
    return missing.length ? [[profile.id, missing]] : [];
  }));
}

export async function applyModProfile(service, id, confirmation) {
  const root = await service.requireRoot();
  const inventory = await service.modManager.scan(root, { conflicts: false });
  const profile = profileViews(service.settings.profiles, inventory.mods).find(x => x.id === id);
  if (!profile) fail('profile_missing', '方案已不存在。');
  if (profile.modsGameRoot && !samePath(profile.modsGameRoot, root)) fail('profile_game_mismatch', '此 Mod 方案属于另一游戏目录，请先从当前游戏同步方案。');
  let result;
  try { result = await service.modManager.apply({ gameRoot: root, enabledIds: profile.modIds, confirmation }); }
  catch (e) {
    if (e.code === 'mod_missing' && e.details?.modIds) e.details.profileId = profile.id;
    throw e;
  }
  await service.save({ ...service.settings, activeProfileId: profile.id, profiles: service.settings.profiles.map(x => x.id === profile.id ? { ...profile, modsInitialized: true, modsGameRoot: root } : x) });
  return result;
}

export async function removeMissingProfileMods(service, { id, gameRoot, modIds }, confirmation) {
  service.confirm(confirmation);
  if (!Array.isArray(modIds) || !modIds.length || modIds.some(modId => typeof modId !== 'string'))
    fail('invalid_argument', '请选择要移出方案的缺失 Mod。');
  const root = await service.requireRoot();
  if (typeof gameRoot !== 'string' || !samePath(gameRoot, root))
    fail('context_changed', '游戏目录已切换，请重新检查方案。');
  const profile = service.settings.profiles.find(row => row.id === id);
  if (!profile) fail('profile_missing', '方案已不存在。');
  if (profile.modsGameRoot && !samePath(profile.modsGameRoot, root))
    fail('profile_game_mismatch', '此 Mod 方案属于另一游戏目录。');

  const inventory = await service.modManager.scan(root, { conflicts: false });
  if (inventory.issues.length) fail('mod_scan_incomplete', 'Mod 清单未完整读取，请检查目录后重新扫描。');
  const requested = new Set(modIds);
  const removed = missingModIds(profile.modIds ?? [], inventory.mods).filter(modId => requested.has(modId));
  if (removed.length) {
    const removedIds = new Set(removed);
    const next = { ...profile, modIds: profile.modIds.filter(modId => !removedIds.has(modId)),
      modsInitialized: true, modsGameRoot: root, updatedAt: new Date().toISOString().slice(0, 10) };
    await service.save({ ...service.settings, profiles: service.settings.profiles.map(row => row.id === id ? next : row) });
  }
  return { removed };
}

/** Add the usable new Mods to the launch profile for next launch, keeping addonlist and inbox marks as-is.
 *  Call inside the service queue. A draft save failure leaves the completed import usable. */
export async function enableNewMods(service, gameRoot, ids) {
  try {
    if (!ids?.length) return [];
    const inventory = await service.modManager.scan(gameRoot);
    const profile = profileViews(service.settings.profiles, inventory.mods).find(p => p.id === service.settings.activeProfileId);
    if (!profile || (profile.modsGameRoot && !samePath(profile.modsGameRoot, gameRoot))) return [];
    const usable = new Set(inventory.mods.filter(m => !m.error && m.kind !== 'platform-package').map(m => m.id));
    const enabled = [...new Set(ids)].filter(id => usable.has(id));
    const added = enabled.filter(id => !profile.modIds.includes(id));
    if (!added.length) return enabled;
    const next = { ...profile, modIds: [...profile.modIds, ...added], modsInitialized: true, modsGameRoot: gameRoot, updatedAt: new Date().toISOString() };
    await service.save({ ...service.settings, profiles: service.settings.profiles.map(p => p.id === next.id ? next : p) });
    return enabled;
  } catch { return []; }
}

export async function saveProfile(service, profile) {
  if (!profile || typeof profile.id !== 'string' || typeof profile.name !== 'string' || !profile.name.trim()) fail('invalid_profile', '方案需要 ID 和名称。');
  if (!Array.isArray(profile.modIds) || profile.modIds.some(id => typeof id !== 'string')) fail('invalid_profile', '方案需要有效的 Mod ID 列表。');
  const previous = service.settings.profiles.find(x => x.id === profile.id);
  const profiles = service.settings.profiles.filter(x => x.id !== profile.id);
  profiles.push({ ...profile, modIds: [...new Set(profile.modIds)], name: profile.name.trim() });
  // Only Mods the player adds in this save count as organized. New Mods are on by default,
  // so members that were already in the profile keep their inbox mark.
  const kept = new Set(previous?.modsInitialized || previous?.modIds?.length ? previous.modIds : []);
  const modMeta = { ...service.settings.modMeta };
  for (const id of profile.modIds) if (!kept.has(id) && modMeta[id]?.inbox) modMeta[id] = { ...modMeta[id], inbox: false };
  await service.save({ ...service.settings, profiles, modMeta });
  return { status: 'saved', applies: 'draft' };
}

export async function selectProfile(service, id) {
  if (!service.settings.profiles.some(x => x.id === id)) fail('profile_missing', '方案已不存在。');
  await service.save({ ...service.settings, activeProfileId: id });
  return { status: 'saved' };
}

export async function deleteProfile(service, id) {
  const profiles = service.settings.profiles.filter(x => x.id !== id);
  if (!profiles.length) fail('last_profile', '至少保留一个方案。');
  const modConflictReviews = service.settings.modConflictReviews?.filter(row => row.profileId !== id);
  await service.save({ ...service.settings, profiles, ...(modConflictReviews && { modConflictReviews }),
    activeProfileId: service.settings.activeProfileId === id ? profiles[0].id : service.settings.activeProfileId });
  return { status: 'saved' };
}
