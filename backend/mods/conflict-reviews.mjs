import { fail, samePath } from './files.mjs';
import { conflictRevision } from './conflicts.mjs';
import { profileViews } from './profiles.mjs';

const marksFor = (rows, inScope) => new Map(Object.entries(rows.find(inScope)?.paths ?? {}));
const reviewOf = (index, profile, marks) => index.fileIndex.summarize(profile.modIds, { marks, mods: index.modsById });

export function conflictReviewSummaries(index, profiles, rows = []) {
  return Object.fromEntries(profiles.flatMap(profile => {
    if (profile.modsGameRoot && !samePath(profile.modsGameRoot, index.root)) return [];
    return [[profile.id, reviewOf(index, profile, marksFor(rows,
      row => row.profileId === profile.id && samePath(row.gameRoot, index.root)))]];
  }));
}

function scope(service, { gameRoot, profileId }) {
  const index = service.modFileIndex;
  if (typeof gameRoot !== 'string' || !samePath(index?.root, gameRoot) ||
      (service.settings.gameRoot && !samePath(service.settings.gameRoot, gameRoot)))
    fail('context_changed', '游戏目录或 Mod 清单已变化，请重新扫描。');
  const saved = service.settings.profiles.find(profile => profile.id === profileId);
  if (!saved) fail('profile_missing', '方案已不存在，请重新选择。');
  if (saved.modsGameRoot && !samePath(saved.modsGameRoot, index.root))
    fail('profile_game_mismatch', '此方案属于另一游戏目录，请先从当前游戏同步方案。');

  const [profile] = profileViews([saved], index.mods);
  const rows = service.settings.modConflictReviews ?? [];
  const inScope = row => row.profileId === profile.id && samePath(row.gameRoot, index.root);
  const marks = marksFor(rows, inScope);
  return { index, profile, rows, inScope, marks };
}

export function conflictReviewPage(service, params) {
  const { view, modId } = params;
  if (!['pending', 'overlap', 'reviewed'].includes(view) || (modId !== undefined && (typeof modId !== 'string' || !modId)))
    fail('invalid_argument', '请选择要查看的资源。');
  const { index, profile, marks } = scope(service, params);
  return index.fileIndex.page({ modIds: profile.modIds, query: params.query, page: params.page },
    { view, modId, marks, mods: index.modsById });
}

function currentFile(service, params) {
  const { path, revision } = params;
  if (typeof path !== 'string' || !path || typeof revision !== 'string')
    fail('invalid_argument', '请选择要处理的重叠路径。');
  const current = scope(service, params);
  const providers = current.index.fileIndex.providers(path, current.profile.modIds);
  if (providers.length < 2 || revision !== conflictRevision(providers, current.index.modsById))
    fail('conflict_changed', '这条路径的参与 Mod 已变更，请核对新结果。');
  return { ...current, providers };
}

export async function setConflictReviewed(service, params) {
  const { path, revision, reviewed } = params;
  if (typeof reviewed !== 'boolean') fail('invalid_argument', '请选择要保存的确认状态。');
  const { index, profile, rows, inScope, marks } = currentFile(service, params);
  const alreadyReviewed = marks.get(path) === revision;
  if (alreadyReviewed !== reviewed) {
    if (reviewed) marks.set(path, revision); else marks.delete(path);
    const next = rows.filter(row => !inScope(row));
    if (marks.size) next.push({ profileId: profile.id, gameRoot: index.root, paths: Object.fromEntries(marks) });
    await service.save({ ...service.settings, modConflictReviews: next });
  }
  return { reviewed, summary: reviewOf(index, profile, marks) };
}

// Apply the single change to the saved draft, preserving edits made while the list was open.
export async function disableConflictProvider(service, params) {
  const { index, profile, providers } = currentFile(service, params);
  if (!providers.includes(params.modId)) fail('conflict_changed', '此 Mod 已不在当前重叠结果中。');
  const next = { ...profile, modIds: profile.modIds.filter(id => id !== params.modId),
    modsInitialized: true, modsGameRoot: index.root, updatedAt: new Date().toISOString().slice(0, 10) };
  const profiles = service.settings.profiles.map(row => row.id === next.id ? next : row);
  await service.save({ ...service.settings, profiles });
  return { status: 'saved', applies: 'draft' };
}
