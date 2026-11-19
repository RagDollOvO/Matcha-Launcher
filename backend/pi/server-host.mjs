import path from 'node:path';
import { launchSpec } from '../launch.mjs';
import { parseServerAddress, serverError } from '../servers/address.mjs';
import { serverIds } from '../servers/organize.mjs';

const check = signal => { if (signal?.aborted) throw serverError('operation_canceled', '操作已取消。'); };

async function context(service, connect) {
  const root = await service.root(), issues = [];
  let inspection;
  if (root) try { inspection = await service.core.inspectGame(root); }
  catch (e) { issues.push({ code: e.code ?? 'game_inspection_failed', message: e.message }); }
  const profile = service.settings.profiles.find(p => p.id === service.settings.activeProfileId);
  return { game: { root, installed: !!inspection, running: !!inspection?.processes.length,
    pid: inspection?.processes.find(p => p.path && path.basename(p.path).toLowerCase() === 'left4dead2.exe')?.pid },
    launch: launchSpec(service.launchMode, connect, service.gameSettings()),
    activeProfile: profile ? { id: profile.id, name: profile.name } : null, issues };
}

/** All server metadata is shared with the page; network probes retain the manager's bounded queue. */
export function serverHost(service) {
  const changed = () => service.emit('event', { type: 'servers_changed' });
  async function inventory(params = {}) {
    const state = await service.serverManager.snapshot();
    let selected = state.servers;
    if (params.groupId !== undefined) {
      if (params.groupId === 'loose') {
        const grouped = new Set(state.serverLayout.groups.flatMap(g => g.serverIds));
        selected = selected.filter(s => !grouped.has(s.id));
      } else {
        const group = state.serverLayout.groups.find(g => g.id === params.groupId);
        if (!group) throw serverError('server_group_missing', '类别已变化，请重新读取清单。');
        selected = group.serverIds.flatMap(id => selected.find(s => s.id === id) ?? []);
      }
    }
    const ids = params.serverIds === undefined ? undefined : serverIds(params.serverIds);
    if (ids) {
      if (ids.some(id => !state.servers.some(s => s.id === id))) throw serverError('server_missing', '所选服务器已移除，请重新读取清单。');
      selected = selected.filter(s => ids.includes(s.id));
    }
    if (params.favorite !== undefined) {
      if (typeof params.favorite !== 'boolean') throw serverError('invalid_argument', '收藏筛选需要布尔值。');
      selected = selected.filter(s => s.favorite === params.favorite);
    }
    return { ...state, servers: selected, scope: selected.map(s => s.id), ...await context(service), checkedAt: new Date().toISOString() };
  }
  async function query(ids, signal) {
    const selected = serverIds(ids), current = await service.serverManager.list();
    if (selected.some(id => !current.some(s => s.id === id))) throw serverError('server_missing', '所选服务器已移除，请重新读取清单。');
    check(signal); await service.serverManager.query(selected); changed(); check(signal);
    return selected;
  }
  return async (operation, params = {}, confirmation, signal) => {
    await service.ready; check(signal);
    if (operation === 'server-inventory') return inventory(params);
    if (operation === 'server-query') return inventory({ serverIds: await query(params.serverIds, signal) });
    if (operation === 'server-preview') return service.serverManager.previewChange(params.action, params.params);
    if (operation === 'server-apply') {
      const result = await service.serverManager.applyChange(params.planId, confirmation, signal); changed(); return result;
    }
    if (operation === 'server-connection') {
      await query([params.serverId], signal);
      const server = (await service.serverManager.list()).find(s => s.id === params.serverId);
      if (!server) throw serverError('server_missing', '服务器已移除，请重新选择。');
      const endpoint = parseServerAddress(server.addr);
      const connectAddr = server.connectAddr ?? `${endpoint.host}:${server.gamePort ?? endpoint.port}`;
      const state = await context(service, connectAddr);
      return { server, ...state, connectAddr, command: `connect ${connectAddr}`,
        portSource: server.gamePort !== null ? 'manual' : server.connectAddr ? 'a2s' : 'query-fallback',
        nextStep: state.game.running ? 'copy-command' : server.vac && state.launch.vacMode === 'insecure' ? 'review-launch-mode' : 'confirm-on-server-page' };
    }
    throw serverError('COMMAND_SCOPE', '未知的服务器助手操作。');
  };
}
