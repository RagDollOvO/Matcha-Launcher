import type { ExternalPackRecord, ExternalPlatform, PlatformPlugin, PluginCollectionInfo } from '../types';
import { recordEnabled, recordSummary, visibleRecord } from './recorded-dll';
import { splitKeys } from './rich-text';

export interface DllCoverSource { owner: PlatformPlugin; kind: 'catalog' | 'collection' | 'module'; collectionId?: string }
export interface DllCollection {
  id: string; title: string; author: string; summary: string; description: string;
  plugins: PlatformPlugin[]; cover?: DllCoverSource;
}
export interface DllCatalog extends DllCollection {
  collections: DllCollection[]; platform?: ExternalPlatform; record?: ExternalPackRecord;
}
function collection(info: PluginCollectionInfo): DllCollection {
  return { ...info, description: info.description ?? info.summary, plugins: [], cover: undefined };
}

// Membership is presentation only: every occurrence points to the same plugin ID and state.
export function dllCatalogs(plugins: PlatformPlugin[], platforms: ExternalPlatform[], records: ExternalPackRecord[] = []): DllCatalog[] {
  const unique = new Map<string, PlatformPlugin>();
  for (const p of plugins) if (!/^(beacon\.|skeeto\.|demo\.hello$)/.test(p.id) && p.loadRole !== 'dependency' && (!unique.has(p.id) || p.installed !== false)) unique.set(p.id,p);
  const catalogs = new Map<string, DllCatalog>();
  catalogs.set('local-library', { id: 'local-library', title: '本机导入', author: '本机文件', summary: '导入 DLL，由 Matcha 按选择加载。', description: '选择本机 DLL，或导入使用 Matcha SDK 的模组包。开关在下次完整启动时生效。', plugins: [], collections: [{ id: 'all', title: '已导入的 DLL', author: '本机文件', summary: '按需启停', description: '由 Matcha 的轻量加载器加载。', plugins: [] }] });
  for (const plugin of [...unique.values()].sort((a,b)=>a.id.localeCompare(b.id))) {
    const p = plugin.presentation;
    const parent = p?.catalog ?? p?.collection ?? {
      id: 'local-library', title: '本机导入', author: '本机已导入',
      summary: '本机导入的独立功能，按需启停。', description: '尚未声明大合集的本地功能收录在这里。',
    };
    const id = p?.catalog ? `catalog:${parent.id}` : p?.collection ? `legacy:${parent.id}` : 'local-library';
    if (!catalogs.has(id)) catalogs.set(id,{...collection(parent),id,collections:[]});
    const catalog = catalogs.get(id)!;
    catalog.plugins.push(plugin);
    if (parent.cover && !catalog.cover) catalog.cover = {owner:plugin,kind:p?.catalog ? 'catalog' : 'collection'};
    const members = p?.catalog ? p.collections! : [{
      id:'all',title:'全部功能',author:parent.author,summary:parent.summary,description:parent.description,
    }];
    for (const info of members) {
      let sub = catalog.collections.find(c=>c.id===info.id);
      if (!sub) { sub=collection(info); catalog.collections.push(sub); }
      sub.plugins.push(plugin);
      if (info.cover && !sub.cover) sub.cover={owner:plugin,kind:'collection',collectionId:info.id};
    }
  }
  const external: DllCatalog[] = platforms.filter(p=>p.id !== 'skeeto' && (p.distribution!=='source-ports' || p.installed || p.pendingOperation)).map(platform=>({
    id:`platform:${platform.id}`,title:platform.distribution==='source-ports'?`${platform.name} · 旧整包`:platform.name,
    author:platform.identity.claimed,summary:platform.distribution==='source-ports'?'旧整包管理 · 停用与卸载':'外部平台包',
    description:`通过 ${platform.loader.file} 加载，保留当前状态与管理入口。`,
    plugins:[],collections:[],platform,
  }));
  return [...catalogs.values(),...external,...records.filter(visibleRecord).map(record => ({
    id:'record:'+record.id, title:record.name, author:record.author ?? '', summary:recordSummary(record),
    description:'', plugins:[], collections:[], record,
  }))];
}
export const GAME_MODES = [['coop','战役'],['realism','写实'],['survival','生还者'],['versus','对抗'],['scavenge','清道夫']] as const;
export interface PluginUsage { inGameMenu: boolean; hotkeys: { keys: string[]; label: string }[]; modes: string[]; library: boolean }
// manifest 的 presentation 原样透传，这里按前端约定再挑一遍：类型不对、超长的项直接跳过。
export function pluginUsage(p: PlatformPlugin): PluginUsage {
  const raw = p.presentation as { hotkeys?: unknown; modes?: unknown } | undefined;
  const hotkeys = Array.isArray(raw?.hotkeys) ? raw.hotkeys.flatMap(h => {
    const { keys, label } = (h ?? {}) as { keys?: unknown; label?: unknown };
    if (typeof keys !== 'string' || typeof label !== 'string' || !keys.trim() || !label.trim() || keys.length > 40 || [...label].length > 80) return [];
    const parts = splitKeys(keys);
    return parts.length && parts.length <= 4 ? [{ keys: parts, label: label.trim() }] : [];
  }).slice(0, 8) : [];
  const known = new Set<string>(GAME_MODES.map(([id]) => id));
  const modes = Array.isArray(raw?.modes) ? [...new Set(raw.modes.filter((m): m is string => typeof m === 'string' && known.has(m)))] : [];
  return { inGameMenu: p.dependencies.some(d => d.id === 'flare.game-ui'), hotkeys, modes, library: p.loadKind === 'library' };
}
export const pluginSummary =(p: PlatformPlugin) => p.presentation?.summary || p.description || '查看开发者说明与可用操作。';
export const pluginDescription = (p: PlatformPlugin) => p.presentation?.description || p.description || '开发者暂未填写功能说明。';
export const enabledCount = (c: DllCatalog) => c.record ? Number(recordEnabled(c.record)) : c.plugins.filter(p=>p.enabled).length;
export const featureCount = (c: DllCatalog) => c.record ? 1 : c.plugins.length;
