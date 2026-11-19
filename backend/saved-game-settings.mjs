import { platformPath, readBytes, decodeText } from './platforms/files.mjs';
import { autoexecState } from './game-config.mjs';

const ini = 'bin/l4p/data/ragdoll.supply-radar/settings.ini';
const labels = {
  Enabled: '启用雷达', RangeMeters: '探测范围', IconOpacity: '图标不透明度',
  WeaponIconOpacity: '整体不透明度', ClientItemGlow: '物品发光',
  ClientGlowRangeMeters: '发光距离', Scale: '整体大小', Rows: '行数', Columns: '列数',
};
export async function radarSettings(root) {
  try {
    const file = await platformPath(root, ini);
    if (!file) return { source: ini, status: 'missing', rows: [] };
    const body = decodeText(await readBytes(file, 256 * 1024));
    let section = '';
    const rows = new Map();
    for (const raw of body.split(/\r\n|\n|\r/)) {
      const line = raw.trim(), head = /^\[([^\]]+)\]$/.exec(line);
      if (head) { section = head[1].toLowerCase(); continue; }
      if (section !== 'supplyradar') continue;
      const hit = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!hit) continue;
      const key = Object.keys(labels).find(k => k.toLowerCase() === hit[1].toLowerCase()) ?? hit[1];
      rows.set(key, { key, label: Object.hasOwn(labels, key) ? labels[key] : key, value: hit[2] });
    }
    return { source: ini, status: 'read', rows: [...rows.values()].sort((a,b) => Number(Object.hasOwn(labels,b.key)) - Number(Object.hasOwn(labels,a.key))) };
  } catch (e) { return { source: ini, status: 'error', error: e.message, rows: [] }; }
}

export async function savedGameSummary(root) {
  const cfg = await autoexecState(root);
  return { root, autoexec: cfg.unreadable || cfg.reason || (cfg.managed?.broken ? '管理段标记异常' : cfg.managed?.present ? '已找到 Matcha 管理段' : cfg.truncated ? '文件较大，管理段待核对' : cfg.exists ? '已有玩家 CFG' : '尚无 autoexec.cfg'),
    radar: await radarSettings(root) };
}
