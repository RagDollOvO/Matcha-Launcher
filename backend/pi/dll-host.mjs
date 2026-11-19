import path from 'node:path';
import { readPermissions } from './autonomy.mjs';
import { PlatformError } from '../core.mjs';

/** DLL tools reuse the desktop IPC and its live confirmation/serialization owner. */
export function dllHost(service, gameRoot) {
  return async (operation, params = {}, confirmation, signal) => {
    await service.ready;
    if (signal?.aborted) throw new PlatformError('operation_canceled', '操作已取消。');
    if (gameRoot && path.resolve(gameRoot).toLowerCase() !== path.resolve(await service.requireRoot()).toLowerCase())
      throw new PlatformError('context_changed', '游戏目录已切换，请重新连接助手后检查。');
    // Public network reads/downloads stay outside the metadata mutation queue.
    if (operation === 'dll-source-fetch') return service.sourceFetch(params, signal);
    if (operation === 'dll-source-download-preview') return service.dllSources.preview(params);
    if (operation === 'dll-source-download') return service.sourceDownload(params.planId, confirmation, signal);
    if (operation === 'dll-overlay-preview') return service.previewDllOverlay(params, signal);
    if (operation === 'dll-source-record') return service.recordDllSource(params, signal);
    return service.serial(async () => {
    if (signal?.aborted) throw new PlatformError('operation_canceled', '操作已取消。');
    if (gameRoot && path.resolve(gameRoot).toLowerCase() !== path.resolve(await service.requireRoot()).toLowerCase())
      throw new PlatformError('context_changed', '游戏目录已切换，请重新连接助手后检查。');
    switch (operation) {
      case 'dll-pack-remove-preview': return service.packRemoval.preview(await service.requireRoot(),params.id);
      case 'dll-pack-remove': {
        try { return await service.packRemoval.apply(await service.requireRoot(),params.planId,confirmation); }
        finally { service.emit('event',{type:'objects_changed'}); }
      }
      case 'dll-pack-set-enabled': {
        if(confirmation?.approved!==true || !(confirmation.source==='user' || confirmation.source==='permissions' && ['auto','full'].includes(readPermissions(service.piConfigDir).mode)))throw new PlatformError('confirmation_required','请确认切换方式。');
        return service.switchRecordedDll(params.id,params.enabled,gameRoot);
      }
      case 'dll-pack-review': return service.packRegister.review(await service.requireRoot(), params.planId);
      case 'dll-pack-preview':
      case 'dll-pack-save': {
        const root = await service.requireRoot(), inspection = await service.core.inspectGame(root);
        if (operation === 'dll-pack-preview') return service.packRegister.preview(root, inspection, params.pack);
        if (confirmation?.source === 'full-access' && readPermissions(service.piConfigDir).mode !== 'full')
          throw new PlatformError('confirmation_required','确认方式已改变，请重新登记。');
        const row = await service.packRegister.save(root, inspection, params.planId, confirmation);
        service.emit('event', { type: 'objects_changed' });
        return row;
      }
      case 'dll-screen': return service.screenDll(params);
      case 'dll-inventory': return service.dllInventory(params);
      case 'dll-inspect': {
        const id = params.intakeId ?? (await service.inspectDllIntake(params.file, signal)).intakeId;
        return service.dllIntake.details(id);
      }
      case 'dll-prepare': return service.prepareDllIntake(params, signal);
      case 'dll-import-preview': return service.previewDllImport(params);
      case 'dll-import': return service.applyDllImport(params.planId, confirmation);
      case 'dll-overlay-write': return service.applyDllOverlay(params.planId, confirmation);
      default: throw new PlatformError('COMMAND_SCOPE', '未知的 DLL 整理操作。');
    }
    });
  };
}
