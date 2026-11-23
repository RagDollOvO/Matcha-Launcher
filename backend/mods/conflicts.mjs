import { PlatformError } from '../errors.mjs';

const searchKey = text => text.trim().replaceAll('\\', '/').toLowerCase();
// Acknowledging a path covers only the providers (and VPK versions) shown at the time.
export const conflictRevision = (ids, mods) => JSON.stringify([...ids].sort().map(id => [id, mods.get(id)?.packageVersion ?? null]));

function reviewedRevision(path, active, { marks, mods }) {
  const expected = marks.get(path);
  return expected !== undefined && expected === conflictRevision(active, mods) ? expected : undefined;
}

const countViews = () => ({ pending: 0, overlap: 0, reviewed: 0 });
function reviewFile(path, active, review) {
  const contentVersions = new Set(active.map(owner => owner.signature)).size;
  if (contentVersions === 1) return { state: 'overlap', contentVersions };
  const revision = review.marks.has(path) ? reviewedRevision(path, active.map(owner => owner.id), review) : undefined;
  return { state: revision === undefined ? 'pending' : 'reviewed', contentVersions, revision };
}

function recordPair(pairs, a, b, path, limit) {
  const key = JSON.stringify([a, b]);
  let pair = pairs.get(key);
  if (!pair) { pair = { id: key, a, b, paths: [], pathCount: 0 }; pairs.set(key, pair); }
  pair.pathCount++;
  if (pair.paths.length < limit) pair.paths.push(path);
}

// Keep only shared paths from the desktop scan. The renderer requests one page at a time.
export class ConflictFileIndex {
  #files = new Map();
  #ordered = null;

  add(path, owners) {
    this.#files.set(path, owners);
    this.#ordered = null;
  }

  providers(path, modIds) {
    const enabled = new Set(modIds);
    return (this.#files.get(path) ?? []).filter(owner => enabled.has(owner.id)).map(owner => owner.id);
  }

  // One count per file, even when it is shared by three or more enabled Mods.
  summarize(modIds, review) {
    const enabled = new Set(modIds), byMod = new Map(), pendingPairs = new Map();
    const counts = countViews();
    if (enabled.size >= 2) for (const [path, owners] of this.#files) {
      const active = owners.filter(owner => enabled.has(owner.id));
      if (active.length < 2) continue;
      const { state } = reviewFile(path, active, review);
      counts[state]++;
      for (const [i, { id, signature }] of active.entries()) {
        let tally = byMod.get(id);
        if (!tally) byMod.set(id, tally = countViews());
        tally[state]++;
        if (state === 'pending')
          for (let j = 0; j < i; j++) {
            if (active[j].signature !== signature) recordPair(pendingPairs, active[j].id, id, path, 3);
          }
      }
    }
    return { counts, byMod: Object.fromEntries(byMod), pendingPairs: [...pendingPairs.values()] };
  }

  page({ modIds, query = '', page = 0 }, review) {
    if (!Array.isArray(modIds) || !modIds.every(id => typeof id === 'string') ||
      typeof query !== 'string' || !Number.isSafeInteger(page) || page < 0)
      throw new PlatformError('invalid_argument', '资源查询参数无效。');

    const enabled = new Set(modIds), term = searchKey(query);
    const pageSize = 50, files = [];
    const counts = countViews();
    const named = term && review ? new Set([...enabled].filter(id => {
      const mod = review.mods.get(id);
      return mod && [mod.title, mod.sourceTitle, mod.file].some(name => name && searchKey(name).includes(term));
    })) : null;
    let total = 0;
    const focus = review?.modId;
    if (enabled.size >= 2 && (!focus || enabled.has(focus))) {
      this.#ordered ??= [...this.#files.keys()].sort();
      for (const path of this.#ordered) {
        const owners = this.#files.get(path);
        if (focus && !owners.some(owner => owner.id === focus)) continue;
        if (!path.includes(term) && !owners.some(owner => named?.has(owner.id))) continue;
        const active = owners.filter(owner => enabled.has(owner.id));
        if (active.length < 2) continue;
        const file = review && reviewFile(path, active, review);
        if (file) counts[file.state]++;
        if (file && file.state !== review.view) continue;
        if (total >= page * pageSize && files.length < pageSize) {
          const ids = active.map(owner => owner.id);
          const modIds = focus ? [focus, ...ids.filter(id => id !== focus)] : ids;
          files.push({ path, modIds, ...(file && {
            revision: file.revision ?? conflictRevision(ids, review.mods), contentVersions: file.contentVersions,
          }) });
        }
        total++;
      }
    }
    return { total, pageSize, files, ...(review && { counts }) };
  }
}

export function compareResources(items, fileIndex) {
  const byPath = new Map(), pairs = new Map();
  for (const m of items) for (const [resource, signature] of m.resourceSignatures ?? []) {
    const owner = { id: m.id, signature };
    let owners = byPath.get(resource);
    if (owners === undefined) { byPath.set(resource, owner); continue; }
    if (!Array.isArray(owners)) {
      owners = [owners];
      byPath.set(resource, owners);
      fileIndex?.add(resource, owners); // Subsequent providers append to this same list.
    }
    for (const other of owners) recordPair(pairs, other.id, m.id, resource, 200);
    owners.push(owner);
  }
  return [...pairs.values()];
}
