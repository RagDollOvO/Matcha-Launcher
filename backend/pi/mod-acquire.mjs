import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { workshopId } from '../mods/library.mjs';
import { gameMapsId } from '../mods/gamemaps.mjs';
import { browserDownload, listBrowserArchive, creatorFields } from '../mods/browser-downloads.mjs';
import { regular, identity } from '../mods/vpk.mjs';
import { fail, directory } from '../mods/files.mjs';

export const ACQUIRE_OPS = new Set(['source-inspect', 'source-search', 'download-preview', 'download', 'tasks', 'task-preview', 'task-control', 'browser-list', 'browser-preview', 'browser-import', 'extract-preview', 'extract', 'import']);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameRoot = (a, b) => typeof a === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const terminal = value => ['done', 'failed', 'canceled'].includes(value);
const abort = signal => signal?.throwIfAborted();
export function sourceItem(params) {
  let { source, id } = params;
  if (params.url !== undefined) {
    let url; try { url = new URL(params.url); } catch { fail('invalid_argument', '需要工坊或 GameMaps 条目链接。'); }
    if (url.protocol !== 'https:' || url.port || url.username || url.password) fail('download_origin', '请选择 HTTPS 的公开条目链接。');
    let parsed;
    if (['steamcommunity.com', 'www.steamcommunity.com'].includes(url.hostname) && /^\/(sharedfiles|workshop)\/filedetails\/?$/.test(url.pathname)) parsed = { source: 'workshop', id: url.searchParams.get('id') };
    if (['gamemaps.com', 'www.gamemaps.com'].includes(url.hostname) && /^\/details\/[1-9][0-9]*\/?$/.test(url.pathname)) parsed = { source: 'gamemaps', id: url.pathname.split('/')[2] };
    if (!parsed || (source && source !== parsed.source) || (id && id !== parsed.id)) fail('download_origin', '来源、ID 与条目链接需要一致。');
    ({ source, id } = parsed);
  }
  if (source === 'workshop' && workshopId(id)) return { source, id };
  if (source === 'gamemaps') return { source, id: gameMapsId(id) };
  fail('invalid_argument', '需要 workshop 或 gamemaps 来源与有效条目 ID。');
}

/** Network calls and task waits stay outside the metadata queue used by task commits. */
export async function acquireMod(service, root, operation, params, confirmation, signal) {
  const guard = async () => { abort(signal); if (!sameRoot(await service.requireRoot(), root)) fail('context_changed', '游戏目录已切换，请重新连接助手。'); };
  await guard(); await service.tasks.ready;
  const detail = async raw => {
    const item = sourceItem(raw);
    const data = item.source === 'workshop' ? await service.workshop.detail(root, item.id) : await service.gamemaps.detail(item.id);
    await guard(); return { ...data, ...item, url: data.workshopUrl ?? data.url };
  };
  const downloadPlan = async () => {
    if (!Array.isArray(params.items) || !params.items.length || params.items.length > 32) fail('invalid_argument', '每批选择 1–32 个下载条目。');
    const selected = params.items.map(sourceItem);
    if (new Set(selected.map(i => `${i.source}:${i.id}`)).size !== selected.length) fail('invalid_argument', '下载清单有重复条目。');
    const items = [];
    for (const item of selected) {
      const d = await detail(item);
      if (d.error || (item.source === 'workshop' && (!d.downloadable || d.kind === 'collection'))) fail('download_unavailable', d.reason || '请展开合集并选择可下载的具体条目。');
      items.push({ ...item, title: d.title, url: d.url, sizeBytes: d.sizeBytes ?? null, updatedAt: d.updatedAt ?? '', file: d.file ?? null, instructions: d.instructions ?? '' });
    }
    return { gameRoot: root, items, expected: items };
  };
  const taskRows = () => service.tasks.list().filter(task => ['download', 'extract'].includes(task.kind) && sameRoot(task.gameRoot, root));
  const selectedTasks = () => {
    if (!Array.isArray(params.taskIds) || !params.taskIds.length) fail('invalid_argument', '需要任务 ID 清单。');
    return [...new Set(params.taskIds)].map(id => taskRows().find(t => t.taskId === id) ?? fail('task_missing', '请选择当前游戏的 Mod 下载或解包任务。'));
  };
  const browserPlan = async () => {
    const row = await browserDownload(service.dataDir, params.downloadId,service.storage?.downloadRoots('browser')), stat = await regular(row.path);
    const zip = /\.zip$/i.test(row.name), listing = zip ? (await listBrowserArchive(service.dataDir, row.id,service.storage?.downloadRoots('browser'))).items
      : /\.vpk$/i.test(row.name) ? [{ name: row.name, size: stat.size, title: (await service.modManager.preview(row.path)).title }] : [];
    if (!listing.length) fail('archive_format', '此下载记录没有可导入的 VPK。');
    const selected = params.selected ?? listing.map(i => i.name);
    if (!Array.isArray(selected) || !selected.length || selected.some(name => !listing.some(item => item.name === name))) fail('invalid_argument', '请选择压缩包清单中的 VPK。');
    return { gameRoot: root, download: { id: row.id, name: row.name, pageUrl: row.pageUrl, pageTitle: row.pageTitle, ...creatorFields(row.creators) }, items: listing.filter(i => selected.includes(i.name)), selected,
      expected: { path: row.path, identity: identity(stat), selected } };
  };
  const extractPlan = async () => {
    const vpk = await service.modManager.cached(await service.modManager.resolve(root, params.modId));
    const target = params.target ?? await service.getDesktop();
    if (typeof target !== 'string' || !path.isAbsolute(target)) fail('invalid_argument', '需要输出父目录的绝对路径。');
    await directory(target);
    return { gameRoot: root, modId: params.modId, title: vpk.title, fileCount: vpk.fileCount, sizeMB: vpk.sizeMB, target,
      expected: { files: vpk.files.map(f => f.identity), target } };
  };
  if (operation === 'source-inspect') return detail(params);
  if (operation === 'source-search') {
    if (params.source === 'workshop') return { source: 'workshop', ...await service.workshop.browse(root, { search: params.query ?? '', page: params.page ?? 1, tag: params.category ?? '', sort: params.sort ?? 'trend', kind: params.kind ?? 'item' }) };
    if (params.source === 'gamemaps') return { source: 'gamemaps', ...await service.gamemaps.browse({ q: params.query ?? '', page: params.page ?? 1, section: params.section ?? 'maps', category: params.category ?? '', sort: params.sort ?? 'recent' }) };
    fail('invalid_argument', '请选择 workshop 或 gamemaps。');
  }
  if (operation === 'download-preview') return downloadPlan();
  if (operation === 'browser-preview') return browserPlan();
  if (operation === 'extract-preview') return extractPlan();
  if (operation === 'browser-list') {
    let rows; try { rows = JSON.parse(await fs.readFile(path.join(service.dataDir, 'browser/downloads.json'), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return { downloads: [] }; throw e; }
    return { downloads: rows.filter(r => r.state === 'done' && !r.cleaned && /\.(zip|vpk)$/i.test(r.name)).map(({ id, name, size, pageUrl, pageTitle, creators }) => ({ id, name, size, pageUrl, pageTitle, ...creatorFields(creators) })) };
  }
  if (operation === 'tasks') {
    const waitMs = params.waitMs ?? 0;
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30000) fail('invalid_argument', '等待时间范围为 0–30000 毫秒。');
    const end = Date.now() + waitMs;
    while (params.taskIds?.length && Date.now() < end && selectedTasks().some(t => !terminal(t.state))) { await delay(Math.min(200, end - Date.now()), undefined, { signal }); await guard(); }
    return { tasks: params.taskIds?.length ? selectedTasks() : taskRows() };
  }
  if (operation === 'task-preview') {
    if (!['cancel', 'retry'].includes(params.action)) fail('invalid_argument', '请选择 cancel 或 retry。');
    const tasks = selectedTasks(); return { gameRoot: root, tasks, expected: tasks.map(({ taskId, kind, source, workshopId, sourceId }) => ({ taskId, kind, source, workshopId, sourceId })) };
  }
  service.confirm(confirmation); await guard();
  if (operation === 'download') {
    const plan = await downloadPlan();
    if (!equal(params.expected, plan.expected)) fail('mod_plan_changed', '下载条目的名称、版本或作者说明有变化，请重新确认。');
    const taskIds = [], errors = [];
    for (const item of plan.items) {
      await guard();
      try {
        if (item.source === 'gamemaps') await service.modManager.idle(root);
        const result = await service.dispatch(item.source === 'workshop' ? 'workshop-download' : 'gamemaps-download', item.source === 'workshop' ? { ids: [item.id] } : { id: item.id }, confirmation);
        taskIds.push(...(result.taskIds ?? [result.taskId]));
      } catch (e) { errors.push({ ...item, error: e.message }); }
    }
    return { taskIds, errors };
  }
  if (operation === 'task-control') {
    const tasks = selectedTasks(), expected = tasks.map(({ taskId, kind, source, workshopId, sourceId }) => ({ taskId, kind, source, workshopId, sourceId }));
    if (!equal(params.expected, expected) || !['cancel', 'retry'].includes(params.action)) fail('mod_plan_changed', '任务清单有变化，请重新确认。');
    const results = [];
    for (const task of tasks) { await guard(); results.push(await service.dispatch(params.action === 'cancel' ? 'task-cancel' : 'task-retry', { taskId: task.taskId }, confirmation)); }
    return { results };
  }
  if (operation === 'browser-import') {
    const plan = await browserPlan();
    if (!equal(params.expected, plan.expected)) fail('mod_plan_changed', '下载文件或 ZIP 选择有变化，请重新确认。');
    await guard(); return service.dispatch('browser-import', { id: params.downloadId, selected: plan.selected }, confirmation);
  }
  if (operation === 'import') {
    // Same path as the Mod page: process guard, name protection, then on by default in the launch profile.
    if (typeof params.file !== 'string' || !path.isAbsolute(params.file)) fail('invalid_argument', '需要本地 VPK 的绝对路径。');
    return service.dispatch('import-mod', { file: params.file }, confirmation);
  }
  if (operation === 'extract') {
    const plan = await extractPlan();
    if (!equal(params.expected, plan.expected)) fail('mod_plan_changed', '源 Mod 或输出目录有变化，请重新确认。');
    await guard(); return service.dispatch('extract-mod', { id: params.modId, target: plan.target }, confirmation);
  }
  fail('COMMAND_SCOPE', '未知的 Mod 获取操作。');
}
