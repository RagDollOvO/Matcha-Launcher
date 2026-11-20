import path from 'node:path';
import { fail } from './files.mjs';

// Copy current members into chosen profile drafts in one save. No subscription to a collection.
export function favoriteProfilePlan(settings, mods, views, root, {favoriteIds, profileIds}) {
  for (const ids of [favoriteIds, profileIds]) if (!Array.isArray(ids) || !ids.length || ids.some(id=>typeof id!=='string'||!id))
    fail('invalid_argument','请选择收藏和目标方案。');
  const same = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const library = new Map(mods.map(m=>[m.id,m]));
  const ids = new Set();
  for (const id of new Set(favoriteIds)) {
    const ref = settings.favoriteRefs?.[id];
    if (!ref && !settings.modMeta[id]?.favorite) fail('favorite_missing','收藏已变更，请重新选择。');
    const mod = ref ? (ref.library && same(ref.library.gameRoot,root) ? library.get(ref.library.modId) : undefined) : library.get(id);
    if (!mod || mod.error || mod.kind === 'platform-package') fail('favorite_unavailable','请先把所选收藏导入当前 Mod 库，并确认文件可以读取。');
    ids.add(mod.id);
  }
  const edits=new Map(), lines=[];
  let added=0;
  for (const id of new Set(profileIds)) {
    const p=views.find(p=>p.id===id);
    if (!p || (p.modsGameRoot && !same(root,p.modsGameRoot))) fail('profile_game_mismatch','目标方案已移除或属于其他游戏目录。');
    const more=[...ids].filter(id=>!p.modIds.includes(id));
    lines.push(p.name+'：新增 '+more.length+' 项，已有 '+(ids.size-more.length)+' 项');
    if (more.length) edits.set(id,{...p,modIds:[...p.modIds,...more],modsInitialized:true,modsGameRoot:root,updatedAt:new Date().toISOString()});
    added+=more.length;
  }
  return { next:{...settings,profiles:settings.profiles.map(p=>edits.get(p.id)??p)}, added, lines, label:'将收藏应用到所选方案',
    changeCount:edits.size, expected:{ ids:[...ids], targets:[...new Set(profileIds)].map(id=>[id,views.find(p=>p.id===id).modIds]), lines } };
}
