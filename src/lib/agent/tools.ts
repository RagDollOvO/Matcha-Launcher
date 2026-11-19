// 平台工具的中文名与读写属性（和 backend/pi/platform-extension.mjs 的 label 对齐）。
// 后端提供 pi-tools 后以后端为准，这里只是兜底。
import Search from '@lucide/svelte/icons/search';
import Activity from '@lucide/svelte/icons/activity';
import Zap from '@lucide/svelte/icons/zap';
import Package from '@lucide/svelte/icons/package';
import ToggleRight from '@lucide/svelte/icons/toggle-right';
import Import from '@lucide/svelte/icons/import';
import FileCode from '@lucide/svelte/icons/file-code';
import Wrench from '@lucide/svelte/icons/wrench';
import Settings2 from '@lucide/svelte/icons/settings-2';

export interface ToolMeta { label: string; write: boolean; icon: typeof Search; description: string }

export const TOOLS: Record<string, ToolMeta> = {
  dll_pack_check: { label: '检查本地 DLL 入口', write: false, icon: Search, description: '核对关键文件、入口冲突和进程加载证据。' },
  dll_pack_set_enabled: {label:'切换本地 DLL',write:true,icon:ToggleRight,description:'使用已登记的开关启停，与模组卡片同步。'},
  dll_pack_record: { label: '登记本地 DLL', write: true, icon: FileCode, description: '记住来源、维护方式与最近验证结果。' },
  dll_pack_uninstall: { label: '完整卸载平台', write: true, icon: Wrench, description: '确认后清理游戏文件、专属配置和本机登记。' },
  player_memory_read: { label: '查看玩家记忆', write: false, icon: FileCode, description: '查看在各次对话中沿用的玩家偏好。' },
  player_memory_edit: { label: '更新玩家记忆', write: true, icon: FileCode, description: '茶茶按你的要求记住、更正或忘掉一条偏好，只写玩家记忆文档。' },
  platform_inspect: { label: '检查游戏平台', write: false, icon: Search, description: '只读检查游戏目录、平台状态、已装 DLL 模组及其动作。' },
  runtime_status: { label: '读取运行状态', write: false, icon: Activity, description: '只读查询正在运行的游戏进程的运行时状态。' },
  dll_inventory: { label: '查看 DLL 模组与加载状态', write: false, icon: Search, description: '查看 Matcha 和 L4N 模组、合并资料、来源、启停与加载诊断。' },
  dll_source_fetch: { label: '读取 DLL 来源', write: true, icon: Search, description: '读取 GitHub、工坊或本地来源，确认后下载到暂存区。' },
  dll_package_inspect: { label: '检查 DLL 来源包', write: false, icon: Search, description: '静态查看来源包的文件、缺口和 DLL 接口。' },
  dll_package_prepare: { label: '在暂存区整理 DLL', write: true, icon: Package, description: '按实际宿主整理文件，更新普通 DLL 时绑定已有模组。' },
  dll_package_import: { label: '确认导入 DLL 整理结果', write: true, icon: Import, description: '预览文件、宿主和更新目标，确认后安装或更新。' },
  dll_overlay_write: { label: '保存茶茶整理的资料', write: true, icon: FileCode, description: '确认后独立保存资料和依据，手动修改优先。' },
  dll_source_record: { label: '记录 DLL 来源版本', write: true, icon: Activity, description: '记录真实来源的最新版本与检查时间。' },
  server_inventory: { label: '查看服务器与自定义类别', write: false, icon: Search, description: '查看已保存服务器、类别、收藏和缓存探测。' },
  server_query: { label: '探测所选服务器', write: false, icon: Activity, description: '刷新所选地址的在线信息与查询时间。' },
  server_add: { label: '添加服务器', write: true, icon: Import, description: '规范化地址、去重，确认后批量添加。' },
  server_update: { label: '修改服务器资料', write: true, icon: FileCode, description: '确认修改备注、收藏和连接端口。' },
  server_organize: { label: '整理服务器分类', write: true, icon: Package, description: '确认后移入已有或自定义类别。' },
  server_category: { label: '维护服务器类别', write: true, icon: Package, description: '新建、重命名、排序和删除类别。' },
  server_remove: { label: '移除服务器', write: true, icon: Package, description: '确认地址及收藏、类别影响后移除。' },
  server_connection: { label: '查看服务器连接指引', write: false, icon: Search, description: '读取实际连接命令，启动由你在页面确认。' },
  mod_inventory: { label: '扫描 VPK Mod', write: false, icon: Package, description: '只读扫描本地与工坊 VPK、启用状态、资源重叠。' },
  read: { label: '读取内置技能', write: false, icon: FileCode, description: '读取 Matcha 随包提供的技能。' },
  mod_organize: { label: '整理 Mod 分类', write: true, icon: Package, description: '预览并确认归类清单，保留文件和启停状态。' },
  mod_delete: { label: '移入 Mod 回收站', write: true, icon: Package, description: '确认文件与受影响方案后移入回收站。' },
  mod_trash: { label: '查看 Mod 回收站', write: false, icon: Search, description: '查看回收文件及其原分类与方案引用。' },
  mod_restore: { label: '还原 Mod', write: true, icon: Package, description: '确认后还原文件、分类与方案草稿。' },
  mod_purge: { label: '永久删除回收条目', write: true, icon: Package, description: '单独确认永久移除选定的回收文件。' },
  mod_inspect: { label: '查看 Mod 内容', write: false, icon: Search, description: '查看包内资源、元信息和文本配置。' },
  mod_compare: { label: '核实 Mod 资源差异', write: false, icon: Search, description: '逐字节对比同路径资源，分开显示相同与差异。' },
  mod_mark: { label: '收藏与整理标记', write: true, icon: Package, description: '批量更新收藏和已整理标记，可撤销。' },
  mod_favorite_collections: { label: '查看收藏合集', write: false, icon: Package, description: '查看收藏页的合集与成员。' },
  mod_favorite_collection: { label: '整理收藏合集', write: true, icon: Package, description: '创建、改名、增减成员或删除收藏合集，可撤销。' },
  mod_rename: { label: '修改 Mod 显示名', write: true, icon: Package, description: '改名、加前缀或恢复原名，支持批量撤销。' },
  mod_category: { label: '维护 Mod 分类', write: true, icon: Package, description: '重命名、移动、合并和移除分类，保留文件。' },
  mod_profile_members: { label: '调整方案中的 Mod', write: true, icon: Package, description: '把 Mod 加入或移出已有方案草稿。' },
  mod_history: { label: '查看整理记录', write: false, icon: Activity, description: '查看跨重启保留的整理记录与前后状态。' },
  mod_undo: { label: '撤销 Mod 整理', write: true, icon: Wrench, description: '预览逆向变更并检查后续修改。' },
  mod_source: { label: '查看 Mod 来源条目', write: false, icon: Search, description: '读取工坊或 GameMaps 条目与作者说明。' },
  mod_search: { label: '搜索地图与 Mod', write: false, icon: Search, description: '搜索工坊或 GameMaps 的公开列表。' },
  mod_download: { label: '下载 Mod 到库', write: true, icon: Package, description: '确认后创建下载任务，完成后默认启用。' },
  mod_tasks: { label: '查看或等待 Mod 任务', write: false, icon: Activity, description: '跟进下载和解包进度及实际导入结果。' },
  mod_task_control: { label: '取消或重试 Mod 任务', write: true, icon: Activity, description: '使用下载页同一套任务控制。' },
  mod_browser_downloads: { label: '查看网页下载的 VPK', write: false, icon: Search, description: '列出已完成的 VPK/ZIP，并预览包内条目。' },
  mod_browser_import: { label: '导入网页下载的 Mod', write: true, icon: Import, description: '按选择导入 VPK 和分卷，保留下载来源。' },
  mod_extract: { label: '解包 Mod', write: true, icon: Package, description: '创建可取消的独立目录解包任务。' },
  plugin_project_check: { label: '检查 Matcha SDK 接入', write: false, icon: FileCode, description: '确认后读取模组工程的 manifest 与源码并跑规则检查。' },
  mod_set_enabled: { label: '更新 Mod 启停', write: true, icon: ToggleRight, description: '修改 addonlist.txt 的启用状态，自动备份，确认后执行。' },
  mod_import: { label: '导入 VPK Mod', write: true, icon: Import, description: '把本地 VPK 复制到 addons，默认启用，确认后执行。' },
  plugin_invoke: { label: '执行模组动作', write: true, icon: Zap, description: '调用已装 DLL 模组声明的动作，先显示参数由你批准。' },
  // 体检与设置（docs/agent-checkup-handoff.md）
  game_config_inspect: { label: '读取启动项与 CFG', write: false, icon: FileCode, description: '只读查看最终启动参数、Steam 启动选项和 cfg 目录里的文件。' },
  game_settings_import: { label: '导入已有启动项与 CFG', write: true, icon: Settings2, description: '把 Steam 启动选项和 autoexec.cfg 里已有的设置导入 Matcha，先列清单，确认后备份并写入。' },
  game_settings_update: { label: '修改启动项与 CFG', write: true, icon: Settings2, description: '列出改前改后和最终启动参数，确认后保存并写入 Matcha 管理段。' },
  launcher_settings_inspect: { label: '查看启动器设置', write: false, icon: Settings2, description: '只读查看下载、启动器、茶茶默认值和界面偏好。' },
  launcher_settings_update: { label: '修改启动器设置', write: true, icon: Settings2, description: '列出改前改后，确认后修改下载、启动器、茶茶默认值或界面偏好。' },
};

export const toolMeta = (name: string): ToolMeta => TOOLS[name] ?? { label: name || '工具', write: false, icon: Wrench, description: '' };

/** 参数的一行摘要：只取前两个简单值 */
export function argSummary(args: Record<string, unknown>) {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : Array.isArray(v) ? `${v.length} 项` : typeof v === 'object' ? '{…}' : String(v)}`)
    .join(' · ');
}
