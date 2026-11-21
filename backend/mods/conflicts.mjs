import { PlatformError } from '../core.mjs';

// Keep only shared paths from the desktop scan. The renderer requests one page at a time.
export class ConflictFileIndex {
  #files = [];
  #sorted = false;

  add(path, owners) {
    this.#files.push({ path, owners });
    this.#sorted = false;
  }

  page({ modIds, query = '', page = 0 }) {
    if (!Array.isArray(modIds) || !modIds.every(id => typeof id === 'string') ||
      typeof query !== 'string' || !Number.isSafeInteger(page) || page < 0)
      throw new PlatformError('invalid_argument', '重叠文件查询参数无效。');

    const enabled = new Set(modIds), term = query.trim().replaceAll('\\', '/').toLowerCase();
    const pageSize = 50, files = [];
    let total = 0;
    if (enabled.size >= 2) {
      if (!this.#sorted) {
        this.#files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        this.#sorted = true;
      }
      for (const { path, owners } of this.#files) {
        if (!path.includes(term)) continue;
        let count = 0;
        for (const id of owners) if (enabled.has(id) && ++count === 2) break;
        if (count < 2) continue;
        if (total >= page * pageSize && files.length < pageSize)
          files.push({ path, modIds: owners.filter(id => enabled.has(id)) });
        total++;
      }
    }
    return { total, pageSize, files };
  }
}

export function compareResources(items, fileIndex) {
  const byPath = new Map(), pairs = new Map();
  for (const m of items) for (const resource of m.resources ?? []) {
    let owners = byPath.get(resource);
    if (owners === undefined) { byPath.set(resource, m.id); continue; }
    if (typeof owners === 'string') {
      owners = [owners];
      byPath.set(resource, owners);
      fileIndex?.add(resource, owners); // Subsequent providers append to this same list.
    }
    for (const other of owners) {
      const key = JSON.stringify([other, m.id]);
      let pair = pairs.get(key);
      if (!pair) { pair = { id: key, a: other, b: m.id, paths: [], pathCount: 0 }; pairs.set(key, pair); }
      pair.pathCount++;
      if (pair.paths.length < 200) pair.paths.push(resource);
    }
    owners.push(m.id);
  }
  return [...pairs.values()];
}
