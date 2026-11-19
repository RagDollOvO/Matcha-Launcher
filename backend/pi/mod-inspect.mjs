import { readVpk, readResource, resourceChunks, assertVpkUnchanged, textContent } from '../mods/vpk.mjs';
import { fail } from '../mods/files.mjs';

function page(params, paths) {
  const offset = params.offset ?? 0, limit = params.limit ?? 100;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) fail('invalid_argument', '资源分页需要非负 offset 和 1–200 的 limit。');
  return { offset, selected: paths.slice(offset, offset + limit), nextOffset: offset + limit < paths.length ? offset + limit : null };
}
function filter(paths, prefix = '') {
  if (typeof prefix !== 'string' || prefix.includes('..') || prefix.includes('\\')) fail('invalid_argument', '请使用包内资源路径前缀。');
  return paths.filter(p => p.startsWith(prefix.toLowerCase())).sort();
}
async function equalContent(a, b, signal) {
  if (a.size !== b.size) return false;
  const left = resourceChunks(a, signal)[Symbol.asyncIterator](), right = resourceChunks(b, signal)[Symbol.asyncIterator]();
  let x, y, i = 0, j = 0, bytes = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      while (!x || (!x.done && i === x.value.length)) { x = await left.next(); i = 0; }
      while (!y || (!y.done && j === y.value.length)) { y = await right.next(); j = 0; }
      if (x.done || y.done) return x.done && y.done && bytes === a.size;
      const n = Math.min(x.value.length - i, y.value.length - j);
      if (!x.value.subarray(i, i + n).equals(y.value.subarray(j, j + n))) return false;
      bytes += n; i += n; j += n;
    }
  } finally { await left.return?.(); await right.return?.(); }
}

export function inspectMod(manager, root, params, signal) {
  return manager.reading(root, async () => {
    signal?.throwIfAborted();
    const vpk = await readVpk(await manager.resolve(root, params.modId), { includeEntries: true });
    const paths = filter([...vpk.entries.keys()], params.prefix), paging = page(params, paths);
    let text;
    if (params.resource !== undefined) {
      if (typeof params.resource !== 'string') fail('invalid_argument', '需要包内资源路径。');
      const key = params.resource.toLowerCase(), entry = vpk.entries.get(key);
      if (!entry || !/\.(txt|cfg|nut|vmt|vdf|res|json|kv|vmf)$/i.test(key)) fail('resource_scope', '请选择清单中的文本配置或脚本资源。');
      const body = await readResource(entry, 64 * 1024);
      if (body.includes(0) && !(body[0] === 0xff && body[1] === 0xfe)) fail('resource_binary', '该资源含二进制数据，请通过解包入口查看。');
      text = { path: entry.path, text: textContent(body) };
    }
    signal?.throwIfAborted(); await assertVpkUnchanged(vpk);
    return { modId: params.modId, title: vpk.title, author: vpk.author, version: vpk.versionLabel, description: vpk.description,
      warning: vpk.warning, dirs: vpk.dirs, sizeMB: vpk.sizeMB, files: vpk.files.map(f => ({ name: f.file.split(/[\\/]/).pop(), size: f.size })),
      totalResources: vpk.entries.size, matchedResources: paths.length, offset: paging.offset, nextOffset: paging.nextOffset,
      resources: paging.selected.map(key => { const entry = vpk.entries.get(key); return { path: entry.path, size: entry.size }; }), ...(text ? { resource: text } : {}) };
  });
}

export function compareMods(manager, root, params, signal) {
  return manager.reading(root, async () => {
    const a = await readVpk(await manager.resolve(root, params.a), { includeEntries: true });
    const b = await readVpk(await manager.resolve(root, params.b), { includeEntries: true });
    const sourceVersion = { a: a.files.map(f => f.identity), b: b.files.map(f => f.identity) };
    if (params.expectedVersion && JSON.stringify(params.expectedVersion) !== JSON.stringify(sourceVersion)) fail('file_changed', '对比目标已变化，请从第一页重新核实。');
    const aPaths = filter(a.resources, params.prefix), bPaths = filter(b.resources, params.prefix);
    const aSet = new Set(aPaths), bSet = new Set(bPaths), shared = aPaths.filter(p => bSet.has(p));
    const paging = page(params, shared), same = [], different = [];
    for (const key of paging.selected) {
      signal?.throwIfAborted();
      (await equalContent(a.entries.get(key), b.entries.get(key), signal) ? same : different).push(key);
    }
    await assertVpkUnchanged(a); await assertVpkUnchanged(b);
    const onlyA = aPaths.filter(p => !bSet.has(p)), onlyB = bPaths.filter(p => !aSet.has(p));
    return { a: params.a, b: params.b, titles: [a.title, b.title], sourceVersion, mode: 'byte-comparison', scope: params.prefix || 'all-game-resources',
      sharedCount: shared.length, examined: paging.selected.length, offset: paging.offset, nextOffset: paging.nextOffset,
      same, different, onlyACount: onlyA.length, onlyBCount: onlyB.length, onlyA: onlyA.slice(0, 200), onlyB: onlyB.slice(0, 200),
      sameGameResources: paging.offset === 0 && paging.nextOffset === null ? !different.length && !onlyA.length && !onlyB.length : null,
      ignored: ['addoninfo.txt', 'addonimage.jpg', 'addonimage.jpeg', 'addonimage.png', 'addonimage.vtf', 'addonimage.vmt'] };
  });
}
