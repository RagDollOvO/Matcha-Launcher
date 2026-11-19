import type {
  Category, CfgEntry, Conflict, DxvkRuntime, GameInfo, L4NRuntime, LaunchFlag, Mod, Plugin, Profile, Server,
} from '../types';

export const game: GameInfo = {
  installed: true,
  root: 'E:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2',
  steamId: '550',
  build: '2.2.4.3',
  running: false,
};

export const categories: Category[] = [
  { id: 'cat-none', name: '未分类', builtin: true },
  { id: 'cat-weapon', name: '武器' },
  { id: 'cat-survivor', name: '生还者' },
  { id: 'cat-infected', name: '感染者' },
  { id: 'cat-sound', name: '音效' },
  { id: 'cat-ui', name: '界面' },
  { id: 'cat-map', name: '地图' },
];

export const mods: Mod[] = [
  { id: 'm01', file: '2981234401.vpk', title: '高清武器音效包', author: 'Krieg', version: '2.1', description: '替换全部主武器开火、换弹音效。', source: 'workshop', workshopId: '2981234401', sizeMB: 84.2, fileCount: 212, dirs: ['sound/weapons'], categoryId: 'cat-sound', updatedAt: '2026-10-28' },
  { id: 'm02', file: 'realistic_gunshots_v3.vpk', title: '写实枪声 v3', author: 'Sable', version: '3.0', description: '偏写实的室内外混响枪声。', source: 'local', sizeMB: 61.0, fileCount: 168, dirs: ['sound/weapons'], categoryId: 'cat-sound', updatedAt: '2026-09-02' },
  { id: 'm03', file: '3012200871.vpk', title: '4K 生还者材质', author: 'Moth', version: '1.4', description: '八名生还者的 4K 漫反射与法线贴图。', source: 'workshop', workshopId: '3012200871', sizeMB: 412.7, fileCount: 96, dirs: ['materials/models/survivors'], categoryId: 'cat-survivor', updatedAt: '2026-11-03' },
  { id: 'm04', file: 'classic_hud.vpk', title: '经典 HUD', author: 'Ponder', version: '1.0', description: '还原一代风格的血条与弹药显示。', source: 'local', sizeMB: 3.1, fileCount: 14, dirs: ['resource/ui', 'scripts'], categoryId: 'cat-ui', updatedAt: '2026-06-11' },
  { id: 'm05', file: '2876610023.vpk', title: '动态天气', author: 'Nimbus', version: '0.9', description: '为官方战役增加雨雾天空盒。', source: 'workshop', workshopId: '2876610023', sizeMB: 27.4, fileCount: 40, dirs: ['materials/skybox'], categoryId: 'cat-map', updatedAt: '2026-08-19' },
  { id: 'm06', file: '2790045512.vpk', title: 'AK47 换皮：铁锈', author: 'Rook', version: '1.2', description: 'AK47 第一/第三人称模型与贴图。', source: 'workshop', workshopId: '2790045512', sizeMB: 18.6, fileCount: 22, dirs: ['models/v_models', 'materials/models/weapons'], categoryId: 'cat-weapon', updatedAt: '2026-07-30' },
  { id: 'm07', file: 'ak47_neon.vpk', title: 'AK47 换皮：霓虹', author: 'Vex', version: '2.0', description: '荧光涂装 AK47。', source: 'local', sizeMB: 21.3, fileCount: 24, dirs: ['models/v_models', 'materials/models/weapons'], categoryId: 'cat-weapon', updatedAt: '2026-10-05' },
  { id: 'm08', file: '2654471190.vpk', title: 'Tank 重制模型', author: 'Grave', version: '1.1', description: '高面数 Tank 模型与新动作。', source: 'workshop', workshopId: '2654471190', sizeMB: 55.9, fileCount: 31, dirs: ['models/infected'], categoryId: 'cat-infected', updatedAt: '2026-05-14' },
  { id: 'm09', file: '2701193345.vpk', title: 'Witch 哭声替换', author: 'Hollow', version: '1.0', description: '更压抑的 Witch 环境音。', source: 'workshop', workshopId: '2701193345', sizeMB: 6.2, fileCount: 12, dirs: ['sound/npc/witch'], categoryId: 'cat-sound', updatedAt: '2026-04-22' },
  { id: 'm10', file: 'minimal_crosshair.vpk', title: '极简准星', author: 'Dot', version: '1.3', description: '单点准星，去掉扩散线。', source: 'local', sizeMB: 0.4, fileCount: 3, dirs: ['materials/vgui/hud'], categoryId: 'cat-ui', updatedAt: '2026-03-08' },
  { id: 'm11', file: '2933380017.vpk', title: '僵尸潮音乐重制', author: 'Choir', version: '1.0', description: '尸潮与 Tank 战斗音乐重编。', source: 'workshop', workshopId: '2933380017', sizeMB: 38.0, fileCount: 18, dirs: ['sound/music'], categoryId: 'cat-sound', updatedAt: '2026-09-27' },
  { id: 'm12', file: 'urban_flight.vpk', title: '城市航班（三方图）', author: 'Atlas', version: '4.2', description: '五关三方战役。', source: 'local', sizeMB: 236.5, fileCount: 1402, dirs: ['maps', 'materials', 'models'], categoryId: 'cat-map', updatedAt: '2026-02-17' },
  { id: 'm13', file: '3050012983.vpk', title: 'Zoey 新服装', author: 'Thread', version: '1.0', description: '替换 Zoey（Bill 位）模型。', source: 'workshop', workshopId: '3050012983', sizeMB: 12.8, fileCount: 9, dirs: ['models/survivors'], categoryId: 'cat-none', updatedAt: '2026-11-10' },
  { id: 'm14', file: 'blood_fx_hd.vpk', title: '高清血液粒子', author: 'Crimson', version: '2.3', description: '更细腻的血液粒子与贴花。', source: 'local', sizeMB: 9.7, fileCount: 27, dirs: ['particles', 'materials/decals'], categoryId: 'cat-none', updatedAt: '2026-08-01' },
];

export const conflicts: Conflict[] = [
  {
    id: 'c1', a: 'm01', b: 'm02', winner: 'm01',
    paths: ['sound/weapons/ak47/gunfire/ak47_01.wav', 'sound/weapons/rifle/gunfire/rifle_fire_1.wav', 'sound/weapons/auto_shotgun/gunfire/auto_shotgun_fire_1.wav'],
  },
  {
    id: 'c2', a: 'm06', b: 'm07', winner: 'm07',
    paths: ['models/v_models/v_rifle_ak47.mdl', 'materials/models/weapons/v_rifle_ak47/v_rifle_ak47.vtf'],
  },
];

export const profiles: Profile[] = [
  {
    id: 'p-real', name: '写实战役', note: '高清材质 + 写实音效，配合写实服',
    modIds: ['m01', 'm02', 'm03', 'm05', 'm06', 'm07', 'm08', 'm09', 'm11', 'm14'],
    pluginIds: ['pl-radar', 'pl-fx', 'pl-minimap'],
    launchOptions: '-novid -console -high +fps_max 0', updatedAt: '2026-11-14',
  },
  {
    id: 'p-vs', name: '对抗纯净', note: '只保留界面类，避免服务器 sv_consistency 踢出',
    modIds: ['m04', 'm10'],
    pluginIds: [],
    launchOptions: '-novid -console', updatedAt: '2026-11-02',
  },
  {
    id: 'p-fun', name: '娱乐整活', note: '三方图 + 换皮',
    modIds: ['m07', 'm12', 'm13', 'm14'],
    pluginIds: ['pl-fx', 'pl-stattrak'],
    launchOptions: '-novid', updatedAt: '2026-10-20',
  },
];

export const l4n: L4NRuntime = { installed: true, version: '2.50.3', dir: 'bin\\neko', apiVersion: 'v2' };

export const dxvk: DxvkRuntime = { installed: true, enabled: true, version: '2.7.1', dll: 'd3d9.dll' };

export const plugins: Plugin[] = [
  { id: 'pl-radar', file: 'L4N_SupplyRadar.dll', name: '补给雷达', version: '1.5.8', author: 'RagDoll', description: '在 HUD 上标注附近补给与特殊物资。', api: 'v2' },
  { id: 'pl-fx', file: 'L4N_WeaponFX.dll', name: '武器特效', version: '1.0.2', author: 'RagDoll', description: '按武器组替换枪口火焰与曳光弹。', api: 'v2' },
  { id: 'pl-minimap', file: 'L4N_Minimap.dll', name: '小地图', version: '0.1.60', author: 'L4N', description: '右上角实时小地图。', api: 'v2' },
  { id: 'pl-stattrak', file: 'L4N_StatTrak.dll', name: '击杀计数器', version: '0.3.8', author: 'L4N', description: '在武器模型上显示击杀数。', api: 'v2' },
];

const serverExamples: Omit<Server, 'status' | 'checkedAt' | 'lastSeen' | 'error' | 'connectAddr' | 'label' | 'gamePort' | 'bots' | 'modeId'>[] = [
  { id: 's1', name: '[CN] 写实专家 | 多特 12', addr: '43.248.10.21:27015', map: 'c2m1_highway', mode: '写实', players: 7, maxPlayers: 8, ping: 38, tags: ['多特', '专家'], vac: true, password: false, favorite: true },
  { id: 's2', name: '[CN] 纯净战役 #3', addr: '110.42.3.77:27016', map: 'c8m1_apartment', mode: '战役', players: 3, maxPlayers: 4, ping: 24, tags: ['官方图'], vac: true, password: false, favorite: false },
  { id: 's3', name: '[HK] Versus League', addr: '103.97.2.14:27015', map: 'c5m1_waterfront', mode: '对抗', players: 8, maxPlayers: 8, ping: 52, tags: ['联赛'], vac: true, password: false, favorite: true },
  { id: 's4', name: '[CN] 生存挑战 | 灯塔', addr: '47.101.8.6:27015', map: 'c7m3_port', mode: '生存', players: 2, maxPlayers: 4, ping: 31, tags: ['生存'], vac: true, password: false, favorite: false },
  { id: 's5', name: '[JP] Realism Tokyo', addr: '153.127.0.40:27015', map: 'c11m1_greenhouse', mode: '写实', players: 4, maxPlayers: 8, ping: 87, tags: ['三方图'], vac: true, password: false, favorite: false },
  { id: 's6', name: '[CN] 清道夫 24h', addr: '121.36.9.3:27017', map: 'c1m4_atrium', mode: '清道夫', players: 6, maxPlayers: 8, ping: 29, tags: ['清道夫'], vac: false, password: false, favorite: false },
  { id: 's7', name: '[SG] Expert Realism', addr: '139.99.1.8:27015', map: 'c4m2_sugarmill_a', mode: '写实', players: 1, maxPlayers: 4, ping: 132, tags: ['专家'], vac: true, password: true, favorite: false },
  { id: 's8', name: '[CN] 多特 20 | 地狱', addr: '82.157.4.90:27015', map: 'c10m1_caves', mode: '战役', players: 8, maxPlayers: 8, ping: 45, tags: ['多特'], vac: true, password: false, favorite: false },
];

export const servers: Server[] = serverExamples.map(s => ({ ...s, status: 'online', checkedAt: null, lastSeen: null, error: '', connectAddr: s.addr, label: '', gamePort: null, bots: 0, modeId: '' }));

export const cfg: CfgEntry[] = [
  { key: 'fps_max', value: '0', group: '画面', desc: '帧率上限，0 为不限' },
  { key: 'mat_queue_mode', value: '-1', group: '画面', desc: '多核渲染，2 为强制开启' },
  { key: 'mat_motion_blur_enabled', value: '1', group: '画面', desc: '动态模糊' },
  { key: 'cl_forcepreload', value: '0', group: '画面', desc: '进图时预载资源，减少卡顿' },
  { key: 'rate', value: '30000', group: '网络', desc: '最大下行字节/秒' },
  { key: 'cl_cmdrate', value: '30', group: '网络', desc: '每秒上行指令包' },
  { key: 'cl_updaterate', value: '30', group: '网络', desc: '每秒请求快照数' },
  { key: 'cl_interp', value: '0.1', group: '网络', desc: '插值时间（秒）' },
  { key: 'snd_mixahead', value: '0.1', group: '声音', desc: '音频缓冲，越小延迟越低' },
  { key: 'net_graph', value: '0', group: '其他', desc: '网络与帧率叠加显示' },
];

export const launchFlags: LaunchFlag[] = [
  { flag: '-novid', desc: '跳过开场视频' },
  { flag: '-console', desc: '启动时打开控制台' },
  { flag: '-high', desc: '进程高优先级' },
  { flag: '-nojoy', desc: '禁用手柄支持' },
  { flag: '-insecure', desc: '关闭 VAC（仅本地/私服）' },
  { flag: '+fps_max 0', desc: '启动即解除帧率上限' },
];
