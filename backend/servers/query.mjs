import { GameDig } from 'gamedig';
import { parseServerAddress } from './address.mjs';

const modes = { coop: '战役', realism: '写实', versus: '对抗', survival: '生存', scavenge: '清道夫' };
const clean = (value, max = 256) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : '';
const count = value => Number.isInteger(value) && value >= 0 ? value : null;

export function emptyObservation() {
  return { name: '', map: '', mode: '未知', modeId: '', players: null, maxPlayers: null, bots: null, ping: null, playerList: null,
    tags: [], vac: null, password: null, status: 'unqueried', checkedAt: null, lastSeen: null, error: '', connectAddr: null };
}

export async function queryServer(entry, options = {}) {
  const endpoint = parseServerAddress(entry.addr);
  const base = emptyObservation();
  try {
    const result = await GameDig.query({ type: 'l4d2', host: endpoint.host, port: endpoint.port, ipFamily: 4,
      givenPortOnly: true, portCache: false, maxRetries: 1, requestPlayers: true, requestPlayersRequired: false, requestRules: true,
      requestRulesRequired: false, socketTimeout: options.socketTimeout ?? 1500, attemptTimeout: options.attemptTimeout ?? 5000 });
    const checkedAt = new Date().toISOString();
    if (result.raw.appId !== 550) return { ...base, status: 'wrong-game', checkedAt, error: `响应的游戏 AppID 为 ${result.raw.appId ?? '未知'}，请确认 L4D2 查询端口。` };
    const tags = (result.raw.tags ?? []).filter(x => typeof x === 'string').slice(0, 64).map(x => clean(x, 80));
    const modeId = clean(result.raw.rules?.mp_gamemode, 40) || tags.find(x => modes[x]) || '';
    // GameDig converts the EDF game port into connect. Only take its validated port;
    // the destination host remains the user's configured host.
    const reported = parseServerAddress(result.connect);
    const gamePort = entry.gamePort ?? reported.port;
    // Use the actual A2S rows: GameDig's public players/bots arrays classify bots
    // heuristically by duration. Keep unnamed connecting players and packet order.
    const playerList = result.raw.players?.length ? result.raw.players.map(p => ({
      name: clean(p.name), seconds: Number.isFinite(p.time) ? Math.max(0, p.time) : 0,
      score: Number.isFinite(p.score) ? p.score : 0,
    })) : result.numplayers === 0 ? [] : null;
    return { ...base, status: 'online', checkedAt, lastSeen: checkedAt, name: clean(result.name), map: clean(result.map, 128),
      mode: modes[modeId] ?? (modeId ? '自定义' : '未知'), modeId,
      players: count(result.numplayers), maxPlayers: count(result.maxplayers), bots: count(result.raw.numbots),
      playerList,
      ping: Number.isFinite(result.ping) && result.ping >= 0 ? Math.round(result.ping) : null,
      tags, vac: result.raw.secure === 1, password: !!result.password,
      connectAddr: `${endpoint.host}:${gamePort}`, reportedGamePort: reported.port };
  } catch (e) {
    const detail = `${e.message}\n${e.stack}`;
    const dns = /ENOTFOUND|EAI_AGAIN|ENODATA|getaddrinfo/i.test(detail);
    const timeout = /timeout|timed out/i.test(detail);
    return { ...base, status: timeout ? 'timeout' : 'error', checkedAt: new Date().toISOString(),
      error: dns ? '域名解析失败，请检查地址与网络。' : timeout ? 'A2S 查询超时，请检查查询端口或稍后重试。' : 'A2S 响应读取失败，请检查服务器状态与查询端口。' };
  }
}
