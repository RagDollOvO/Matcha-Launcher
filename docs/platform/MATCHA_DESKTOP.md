# 使用 Matcha 桌面端

日常使用双击桌面 **Matcha** 快捷方式，或发布目录内的 `Matcha.exe`。页面已嵌入程序，Node.js 和 Pi CLI 随发布文件夹提供；移动时保留整个文件夹。设置和方案继续使用 `%LOCALAPPDATA%\com.matcha.launcher`。

## 开发入口

在 `D:\Launcher` 打开终端：

```powershell
npm run desktop
```

桌面开发入口会复用正在运行的 Matcha Vite 服务，或启动它。`npm run dev` 单独提供浏览器开发界面；两种入口使用同一份能力服务。桌面版使用 Windows WebView2、Tauri 2 和本机 Node.js 22+，Pi 使用单独安装的 `@earendil-works/pi-coding-agent` CLI。

## 下载放在哪个盘

打开 **设置 › 存储** 查看实际位置。求生在非系统盘时，新下载和组件缓存默认放在游戏目录的 `left4dead2\.matcha-data`；设置、日志、任务记录和茶茶配置留在本机配置目录。

升级后，旧下载仍可从记录打开。点 **搬过来…** 才会迁移旧文件；也可以选择自己的目录。搬家中断时点 **继续**。浏览器资料在下次启动时切换位置，清理浏览器缓存会保留登录。

## 从游戏目录开始

作者提供安装器时，从 **DLL 模组 → 添加** 选择作者来源或本机 ZIP，交给茶茶核对安装。Skeeto 和其他已登记的模组使用同一套功能卡片；在 **本地 DLL** 可看到入口、模块和本局加载证据。

列表把文件和进程分开显示：「关键文件已就位」表示这次磁盘检查通过。按作者指定的方式启动游戏后点刷新，可查看当前游戏进程的加载结果。展开记录能看到来源、维护或卸载方式和最近一次登记。实际游戏文件由作者的安装方式维护。

1. 打开“插件 → 运行环境”，等待 Steam 自动探测；也可粘贴游戏根目录，桌面版支持文件夹选择器。
2. 点“部署 DLL 运行时”，检查目标目录并确认。已有 L4N 可跳过部署直接启动；只在要用 Matcha 模组时部署 L4N 子插件。首次部署的 DLL 列表默认全关。
3. 用“导入 DLL”选择本地 x86 DLL，或用“模组包”导入包含 `manifest.json` 和 `plugin.dll` 的 SDK 包，检查来源后确认。导入默认停用；启用时处理依赖并写入 `enabled.txt`。
   已安装的同 ID 插件会进入更新确认：保留配置与启停状态，旧包完整备份。平台本体升级与功能 DLL 更新分别处理。
4. 主页选择「L4N 平台」或「纯净对抗」，点「启动游戏」并确认。L4N 平台默认使用 `-steam -novid`；主页的[启动设置](GAME_SETTINGS.md)可调整启动项，或按画面、网络和 CFG 原文查看游戏配置。纯净对抗使用 Steam 登记的原版目录和默认渲染。
5. 在游戏里按 **Ctrl + F7** 打开已加载模块的设置。试用物资雷达及配置迁移见 [轻量模组与物资雷达](LIGHTWEIGHT_MODS.md)。既有插件声明的桌面动作继续可用。

游戏运行期间，安装、导入、启停和恢复入口会锁定。运行时已加载状态与下次启动的启用配置分开显示。当前使用 `render-init` 阶段。L4N 整包与 DXVK 本机版本识别见 [组件接入说明](NATIVE_LIBRARIES.md)。

“恢复原入口”保留插件、配置和日志。需要返回模组游玩时，在运行环境中选择“重新启用 DLL 运行时”。

## DLL、快速测试与内置浏览器

- **DLL 模组**：本地 DLL 按选择加载，SDK 模组按开发者声明的合集浏览。L4N 独立提供整包总开关，内部设置使用 L4N 菜单。旧 Beacon 与 Skeeto 合集从当前产品入口及分发包撤下。
- **Mod → 快速测试**：选择地图与 Mod，在独立环境运行小窗口测试。已移除自动发枪、装备选择和 F6 取枪；测试地图退出后请求退出测试游戏。当前隔离环境版本为 4，排除 Skeeto 的 wininet 入口。
- **创意工坊**：搜索、分类浏览、查看合集和选择下载内容。
- **社区加速**：在「设置 → 通用」启用随包的 Steam++，用于创意工坊和 Steam 网页。首次启用、异常恢复及分享方式见 [社区加速](COMMUNITY_ACCELERATION.md)。
- **GameMaps**：搜索地图和 Mod，查看作者说明，下载后导入「新下载」。也可打开原页面手动下载。
- **浏览器**：DSH 标签管理配合原生 WebView2，浏览作者页面、保存书签与下载记录；VPK 直接导入，ZIP 选择内容后导入，来源随 Mod 保留。

本次整合记录见 [2026-11-16 桌面更新](DESKTOP_UPDATE_2026-11-16.md)。

## 连接 Pi CLI

打开 Matcha 后，Pi CLI 自动在后台连接，助手面板收起时同样有效；打开面板即可使用。连接期间显示进度，失败时点「重试连接」。握手、历史消息和模型列表通过真实 RPC 获取。

整理 Mod 可直接输入「整理新下载的 Mod，按用途归类」或「看看哪些 Mod 可以清理」。内置技能先扫描当前库，沿用分类与收藏；改分类和移入回收站时显示清单确认。还原后恢复分类与方案草稿，启用状态由你下一次应用方案时选择。

也可以发工坊或 GameMaps 链接，让助手下载后归类、收藏并加入指定的已有方案；下载完成后仍保持停用。说「核实这两份 Mod 的资源差异」可查看内容对比；说「查看整理记录」「撤销刚才那次整理」可恢复分类、标记和方案成员调整。

模型未配置时，在 **设置 → 服务商与密钥** 添加密钥或端点，再选择模型。使用订阅账号登录时，按界面显示的独立配置目录执行：

```powershell
$env:PI_CODING_AGENT_DIR = '界面显示的独立 Pi 配置目录'
pi
```

进入 Pi 后使用 `/login` 完成登录、`/model` 选择模型，再回到 Matcha 点“重新连接”。凭据由 Pi 自己管理。Matcha 也提供已配置模型的选择器。

在「设置 → 工具与权限」查看 Pi 可用的工具。尚未选定游戏时，平台检查会返回 Steam 发现的安装。Pi 的确认、选择和输入请求独立显示，工具执行结束会刷新页面对象。停止操作同时清空排队任务、取消待确认请求并中止当前执行。

对 Pi 说「记住：新下载的 Mod 先给我看分类预览」，下次开新对话仍会沿用。也可以说「把这条改成……」或「忘掉这条」。本机笔记是 Pi 配置目录里的 `MEMORY.md`（默认 `%LOCALAPPDATA%\com.matcha.launcher\pi\MEMORY.md`）。可以直接编辑其中的列表；对话时这些偏好会随上下文提供给所选模型。

## 数据与开发入口

- 浏览器开发数据：`%LOCALAPPDATA%\Matcha`。
- `launch.json`：独立保存启动方式；原方案的 `launchOptions` 草稿继续保留，当前生效参数由所选启动方式生成。
- Tauri 桌面数据：Tauri 为 `com.matcha.launcher` 解析的本地数据目录；Pi 面板显示该入口的实际配置路径。
- `BEACON_DATA_DIR`：仅供开发/夹具指定服务数据目录。
- `BEACON_NODE`：桌面壳可指定 Node 可执行文件；默认使用本机 PATH 中的 `node`。
- `BEACON_PI_ENTRY`：可指定本机 Pi CLI 入口。默认探测当前 Node 安装旁和 npm 用户全局目录。

`npm run desktop:package` 构建嵌入前端的 Windows 程序，再生成带 Node / Pi 的完整便携文件夹，位置记录在 `release/latest.json`。`npm run desktop` 保留为开发入口。安装器与自动更新留待发布阶段。

服务启动问题会显示在界面；隐藏 Node 子进程的错误写入 `%LOCALAPPDATA%\com.matcha.launcher\logs\desktop-service.log`。

### 从 Flare 旧名字迁移（2026-11-18）

Matcha 以前叫 Flare。新版第一次启动时自动改名，数据跟着走，不用手动搬：

| 旧 | 新 | 谁来改 |
|---|---|---|
| `%LOCALAPPDATA%\com.flare.launcher`（设置、方案、茶茶、WebView 存储） | `%LOCALAPPDATA%\com.matcha.launcher` | 桌面壳，在窗口创建之前（`src-tauri/src/legacy.rs`） |
| `%LOCALAPPDATA%\Flare`（浏览器开发数据） | `%LOCALAPPDATA%\Matcha` | 开发服务启动时 |
| 游戏 `left4dead2\.flare-data` / `.flare-library` / `.flare-backups` / `.flare-trash` | `.matcha-*` | 后端服务启动、切换游戏目录时（`backend/legacy-names.mjs`） |
| 游戏根目录 `.flare-tests` / `.flare-l4n-plugins` | `.matcha-*` | 同上 |
| 新部署的独立库副本 `addons\flare_ws_<id>.vpk` | `matcha_ws_<id>.vpk` | 已部署的保持原名，下次取消部署后再部署才换 |

- 旧版 Matcha 还开着时，新版弹窗请你先退出旧版（重试 / 取消）；取消就退出，数据不动。
- 改名后，数据目录里各 `.json` 记录、茶茶会话头的工作目录、内置浏览器下载记录里的旧路径一并改成新路径。
- 游戏目录里的文件夹被占用、改不动时，继续用旧名字，下次启动再试。新旧两个同时存在时不合并，用新的，旧的原样保留。
- 改名之后再打开更早的旧版，它会当成新装（看不到改名后的数据），请只用新版。
- 改名记录写进 `logs\desktop-service.log`。测试：`node --test backend/legacy-names.test.mjs`。
- 没改的内部名字：插件 id `flare.game-ui`、`flare_audio.exe`、界面偏好的 localStorage 键（`flare.*`）、下载/导入时的临时文件名。改它们要同步改原生插件或清掉玩家偏好，收益不大。

浏览器开发桥接只接受本机同源请求，POST 需要本次服务生成的令牌。正式桌面入口使用 Tauri IPC 和隐藏的 JSONL 子进程，关闭 Matcha 时结束它拥有的服务与 Pi 子进程。

## 当前页面范围

真实数据已接入游戏检查、Beacon 部署/恢复、DLL 插件导入/启停、声明动作、[VPK Mod 管理](MODS.md)、[A2S 服务器与收藏](SERVERS.md)、DLL 合集与 Skeeto 源码移植、内置创意工坊 / 浏览器和 Pi CLI。「设置 → 游戏配置」管理 autoexec.cfg 中的 Matcha 段落。VPK 方案支持保存、显式应用及启动前应用；DLL 启用列表仍独立管理。

## 有针对性的离线检查

```powershell
node --test backend/desktop/service.test.mjs
node checks/pi-chat.mjs
node checks/desktop-fixture.mjs
```

最后一个命令在 `http://localhost:5174` 提供隔离的 UI 夹具：真实 x86 Runtime 和示例 DLL 运行在自有 `l4p_smoke.exe` 中，游戏目录为项目内新建的合成目录。终端按回车关闭这个夹具与宿主。

追加 `--career` 可加载生涯档案与自有假 Steam DLL，在「DLL 模组 → Skeeto → 个人档案 → 生涯档案 → 刷新生涯档案」查看隔离测试数据。所需构建目标为 `skeeto_career fake_steam l4p_smoke`；假 Steam 库只保存在 fixtures 中。

离线宿主已通过界面动作返回 `Hello, Matcha 幸存者!`。用户随后启动真实游戏，日志确认 DXVK、Beacon Runtime 与 demo.hello 初始化成功，并生成 DXVK 状态缓存；用户手动退出游戏。VPK 的解析、导入和方案应用在隔离目录检查，真实目录完成只读扫描。

桥接实现参考：[Tauri commands](https://v2.tauri.app/develop/calling-rust/)、[Tauri events](https://v2.tauri.app/develop/calling-frontend/)、[资源布局](https://v2.tauri.app/develop/resources/)。
