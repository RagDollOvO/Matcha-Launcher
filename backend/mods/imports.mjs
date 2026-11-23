import fs from 'node:fs/promises';
import path from 'node:path';
import { fail, samePath } from './files.mjs';
import { folderSource, packModFolder } from './pack.mjs';
import { listBrowserArchive, browserImportFiles, creatorFields, releaseExtracted } from './browser-downloads.mjs';

const exists = async p => fs.access(p).then(() => true, () => false);

async function previewModInput(service, p) {
  if (typeof p.file !== 'string' || !path.isAbsolute(p.file)) fail('invalid_argument', '请提供 VPK 或素材文件夹的完整路径。');
  const s = await fs.lstat(p.file);
  if (s.isSymbolicLink()) fail('unsafe_path', '请拖入实际文件或文件夹。');
  if (s.isDirectory()) return folderSource(p.file, await service.requireRoot(), p.replaceExisting === true);
  if (!s.isFile() || !/\.vpk$/i.test(p.file)) return { kind: 'unsupported' };
  const numbered = /_\d{3}\.vpk$/i.test(p.file);
  if (numbered && await exists(p.file.replace(/_\d{3}\.vpk$/i, '_dir.vpk'))) return { kind: 'shard' };
  try {
    const input = await service.modManager.preview(p.file);
    const targetExists = p.replaceExisting === true && await exists(path.join(await service.requireRoot(), 'left4dead2', 'addons', input.name));
    return { ...input, kind: 'vpk', targetExists };
  } catch (e) {
    if (numbered && e.code === 'invalid_vpk') return { kind: 'shard' };
    throw e;
  }
}

function checkFavoriteInput(service, p) {
  if (!p.favoriteId) return;
  service.favoriteSource(p.favoriteId, p.file);
  if (p.replaceExisting) fail('file_exists', '请先处理 Mod 库中的同名文件。');
}

async function queueModFolder(service, p, confirmation) {
  checkFavoriteInput(service, p);
  service.confirm(confirmation);
  const gameRoot = await service.requireRoot();
  if (!samePath(p.gameRoot, gameRoot)) fail('game_changed', '游戏目录已切换，请重新拖入。');
  await service.modManager.idle(gameRoot);
  const input = await folderSource(p.file, gameRoot, p.replaceExisting === true);
  if (p.sourceStamp !== input.sourceStamp) fail('file_changed', '素材文件夹已变化，请重新拖入。');
  return service.tasks.create('pack', {
    file: input.file, ...(p.favoriteId && { favoriteId: p.favoriteId }),
    replaceExisting: p.replaceExisting === true, sourceStamp: input.sourceStamp, gameRoot,
    categoryId: service.settings.categories.find(c => !c.builtin && c.id === p.categoryId)?.id ?? 'cat-none',
  }, input.name);
}

async function importMod(service, p, confirmation) {
  checkFavoriteInput(service, p);
  const gameRoot = await service.requireRoot();
  if (p.gameRoot && !samePath(gameRoot, p.gameRoot)) fail('game_changed', '游戏目录已切换，请重新导入。');
  const result = await service.modManager.import({ gameRoot, file: p.file, confirmation, replaceExisting: p.replaceExisting === true });
  if (service.settings.modOrigins?.[result.id]) {
    const modOrigins = { ...service.settings.modOrigins }; delete modOrigins[result.id];
    await service.save({ ...service.settings, modOrigins });
  }
  // addonlist keeps the new entry off until the launch profile is applied.
  await service.linkFavoriteSource(p.favoriteId, p.file, gameRoot, result.id);
  if (p.favoriteId) return { ...result, enabled: false };
  const enabled = (await service.enableNewMods(gameRoot, [result.id])).includes(result.id);
  return { ...result, enabled, ...(enabled ? { applies: 'next-launch', profileId: service.settings.activeProfileId } : {}) };
}

async function importBrowserMods(service, p, confirmation) {
  service.confirm(confirmation);
  const gameRoot = await service.requireRoot();
  // Check before extracting as well as immediately before each publication.
  await service.modManager.idle(gameRoot);
  const { row, files } = await browserImportFiles(service.dataDir, p.id, p.selected, service.storage.downloadRoots('browser'));
  const manual = creatorFields(p.creators);
  const origin = { pageUrl: row.pageUrl, title: row.pageTitle || row.name, downloadId: row.id,
    ...(manual.creators ? manual : creatorFields(row.creators)) };
  const imported = [], errors = [], completed = [];
  for (const [i, file] of files.entries()) {
    try {
      const result = await service.modManager.import({ gameRoot, file, ownedDownload: true, confirmation });
      imported.push(result.id);
      await service.save({ ...service.settings,
        modMeta: { ...service.settings.modMeta, [result.id]: { ...service.settings.modMeta[result.id], inbox: true } },
        modOrigins: { ...service.settings.modOrigins, [result.id]: origin },
      });
      if (p.selected) completed.push([...new Set(p.selected)][i]);
    } catch (e) { errors.push(`${path.basename(file)}：${e.message}`); }
  }
  if (!imported.length && errors.length) fail('browser_import_failed', errors.join('\n'));
  await service.enableNewMods(gameRoot, imported);
  if (completed.length && /\.zip$/i.test(row.path)) {
    try {
      if (!errors.length) await releaseExtracted(row.path, files);
      const { items } = await listBrowserArchive(service.dataDir, p.id, service.storage.downloadRoots('browser'));
      const prior = row.selectionStamp === row.importStamp ? row.importedNames ?? [] : [];
      const names = [...new Set([...prior, ...completed])];
      await service.storage.patchBrowser(p.id, row.path, { selectionStamp: row.importStamp, importedNames: names });
      if (!errors.length && items.every(i => names.includes(i.name))) await service.storage.browserImported(row);
    } catch (e) { errors.push('Mod 已导入，压缩包清理待处理：' + e.message); }
  }
  return { imported, errors };
}

// The task builds outside the service queue. Only publication and its settings write run serially.
export async function packAndImportMod(service, request, ctx) {
  const checkRoot = async () => {
    if (!samePath(request.gameRoot, await service.requireRoot())) fail('game_changed', '游戏目录已切换，请在目标目录重新拖入。');
  };
  await checkRoot();
  await service.modManager.idle(request.gameRoot);
  return packModFolder(request, ctx, file => service.serial(async () => {
    await checkRoot();
    const { id, replaced } = await service.modManager.importPacked({
      gameRoot: request.gameRoot, file, replaceExisting: request.replaceExisting === true,
      confirmation: { approved: true, source: 'user' },
    });
    await service.linkFavoriteSource(request.favoriteId, request.file, request.gameRoot, id);
    if (request.favoriteId) return { modId: id };
    const enabled = await service.enableNewMods(request.gameRoot, [id]);
    const category = service.settings.categories.find(c => !c.builtin && c.id === request.categoryId)?.id ?? (replaced ? service.settings.assignments[id] : null) ?? 'cat-none';
    if ((service.settings.assignments[id] ?? 'cat-none') !== category || service.settings.modOrigins?.[id]) {
      const modOrigins = { ...service.settings.modOrigins }; delete modOrigins[id];
      try { await service.save({ ...service.settings, modOrigins, assignments: { ...service.settings.assignments, [id]: category } }); }
      catch (e) { return { modId: id, warning: `VPK 已导入，分类资料保存失败：${e.message}` }; }
    }
    return { modId: id, ...(!enabled.includes(id) && { warning: 'VPK 已导入，尚未加入当前启动方案。请检查方案的游戏目录和 Mod 状态。' }) };
  }));
}

// Commands stay inside DesktopService.execute, under the existing storage and serial guards.
export const modImportCommands = new Map([
  ['preview-mod', (service, p) => service.modManager.preview(p.file)],
  ['preview-mod-input', previewModInput],
  ['pack-mod-folder', queueModFolder],
  ['import-mod', importMod],
  ['browser-import', importBrowserMods],
]);
