import type { ExternalPackRecord, ExternalPlatform, L4nPluginsState, PlatformPlugin, PlatformRuntime } from '../types';
export const filesLabel = {absent:'未安装', installed:'文件已就位', partial:'文件不齐', occupied:'入口或模块不匹配', unchecked:'待核查'};
export const runtimeLabel = {offline:'游戏未运行', loaded:'已装载', 'not-seen':'本局未见加载', unknown:'本局待核查'};
export const fileLabel = {missing:'缺失', match:'文件已就位', different:'文件不匹配', unchecked:'待核查'};
export const visibleRecord = (p:ExternalPackRecord) => p.files.some(f=>f.state==='match');
// Skeeto 的已识别代理随 Steam 生效。其他作者的启停状态须有自己的证据。
export const recordEnabled = (p:ExternalPackRecord) => p.control?.enabled===true && !p.control.reason && !p.conflicts.length;

/** Count enabled player-facing mods for the selected mode, once per mod, not once per DLL file. */
export function enabledDllMods(clean: boolean, runtime: PlatformRuntime | null, plugins: PlatformPlugin[], subs: L4nPluginsState | undefined, records: ExternalPackRecord[], platforms: ExternalPlatform[]) {
  const l4n = !clean && !!subs?.hostEnabled;
  const sdk = !clean && runtime?.installed && runtime.status !== 'restored' && (runtime.host !== 'l4n' || l4n);
  const matcha = sdk ? plugins.filter(p => p.installed !== false && p.enabled && p.loadRole !== 'dependency' && (p.host ?? 'flare') === 'flare').length : 0;
  const children = l4n ? subs!.plugins.filter(p => p.enabled).length : 0;
  const byId = new Map(platforms.map(p => [p.id, p.installed && p.state === 'enabled']));
  for (const p of records) byId.set(p.id, p.state === 'installed' && !p.conflicts.length &&
    (p.control ? recordEnabled(p) && !p.control.pending : true));
  const registered = clean ? 0 : [...byId.values()].filter(Boolean).length;
  return { total: matcha + children + registered, matcha, children, registered };
}
export const recordStatus = (p:ExternalPackRecord) => p.conflicts.length?'入口重叠':p.state==='absent'?filesLabel.absent:p.control?.reason|| (p.runtime==='loaded'?runtimeLabel.loaded:p.control?.pending?'切换待完成':p.control?.enabled===false?'已停用':p.control?.enabled===true?'已启用':filesLabel[p.state]);
export const recordSummary = (p:ExternalPackRecord) => p.id === 'skeeto' ? '从 Steam 启动游戏，进入主菜单后按 [ 打开 Skeeto 菜单。' : p.launch;
