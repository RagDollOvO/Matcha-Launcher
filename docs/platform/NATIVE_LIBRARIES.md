# Matcha DLL 接入与 L4N 整包

## 已有 L4N 的游戏可以直接启动

初始化时，Matcha 读取游戏目录中的 L4N 平台 DLL 版本和 EXE 的入口。已有 L4N 可以直接从主页启动。识别到支持 `-hide_neko` 的入口时，「随 Matcha 启动 L4N」开关只更改平台模式的启动参数，保留子插件选择、渲染文件和游戏 EXE。「纯净对抗」始终走 Steam 原版目录检查，忽略平台模式的参数。插件页把本机安装版本与可下载版本分别标注。

DXVK 只读检测两个游戏实际使用的文件：根目录 `d3d9.dll`（默认）与 `bin/dxvk_d3d9.dll`（显式 `-vulkan`）。存在表示磁盘上有这个入口，当前运行情况以游戏日志为准。历史备份不参与检测。Matcha 保留玩家的自定义启动参数，DXVK 由游戏管理。

需要 Matcha 自己的 DLL 时，在启用 L4N 后选择「部署 Matcha 加载器」：新增 `bin/neko/plugins/MatchaRuntime.dll`，通过 L4N SDK 回调启动 `bin/l4p` 中的运行时和已选模组。两个渲染 DLL 都保持原位。旧版 Matcha 用户可先「恢复原入口」，再「重新启用」迁移，保留模块和配置。

需要安装 L4N 时，先确认来源和下载大小，再确认对游戏目录的文件变更。已有独立安装的 L4N 沿用原入口。

- **本地 DLL 接入**：标准 Matcha SDK ZIP 可直接校验导入。普通 DLL、非标准包或文件缺失时，由 Agent 在暂存区核对、整理，并给玩家确认最终清单；原始文件保留。导入后先保持停用，由玩家选择启用。普通 DLL 整体加载；SDK 模组可注册自己的游戏内控件与动作。后端与 Agent 工具已就绪，前端对接见 [来源接入交接](../dll-source-handoff.md)。
- **RagDoll 自制模组**：物资雷达继续使用 Matcha API。游戏里按 **Ctrl + F7 → 物资雷达** 调整，布局与 INI 数据沿用。
- **L4N**：在「L4N · 特殊整包」启用。Matcha 备份并切换官方 `left4dead2.exe`、`bin/left4neko.dll` 及 Neko 着色器入口；停用时还原这些入口，保留个人设置和素材。进入地图后用 `l4n_menu` 打开 L4N 菜单。

「L4N 平台启动」默认使用 `-steam -novid` 和游戏默认安全模式。需要显式选择游戏的 Vulkan 装载路径时，可在「启动设置 → 自定义启动项」填写 `-vulkan`。纯净对抗使用默认 D3D9 路径与 Steam 原版目录，启动前会检查 L4N、Matcha 入口及附加内容。需要还原时请先退出游戏，按组件开关及「恢复原入口」操作。

### 原版 L4N 的加载方式

已静态核对上游 L4N 2.58.0：`left4dead2 no-insecure.bat` 执行 `start left4dead2.exe -steam -novid`。其 EXE 加载 `bin/left4neko.dll` 并调用 `LauncherMain`；加 `-hide_neko` 时转到原游戏 `launcher.dll`。SDK 示例把第三方插件放在 `bin/neko/plugins/`，导出 `GetL4NPluginInstance`，接收游戏及渲染初始化回调。原说明把 `-insecure` 留作玩家可选启动项，并提醒内存补丁及联机使用风险。

Matcha 保留这条 L4N 整包加载链；自己的 DLL 由 L4N 子插件接到 `bin/l4p` 的运行时。服务器连接使用游戏原有的连接流程。

### 外来 DLL 按宿主接入

- **Matcha SDK 模组**：由自有 Runtime 调用 `L4P_GetPluginApi`，按包声明管理依赖和游戏内设置。
- **L4N SDK 模组**：由 L4N 调用 `GetL4NPluginInstance` 并提供游戏、渲染和菜单回调，启用时保留在 `bin/neko/plugins/`。迁入 Matcha SDK 需作者适配。Matcha 后端已提供子插件扫描、默认停用导入、独立 DLL 开关及中断恢复；停用文件保存在游戏根目录 `.matcha-l4n-plugins/disabled/`，个人配置保持原位。前端对接见 [子插件与状态接口](../dll-runtime-handoff.md)。
- **普通独立 DLL**：按 `loadKind: "library"` 整体加载。需满足 x86 位数、依赖和作者要求的初始化方式；专用宿主或代理 DLL 按具体加载契约适配。

闭源 DLL 在加载入口受管理时，同样可控制下次启动加载或跳过。内部功能拆分需要 DLL 提供接口。桌面开关在完整退出游戏后操作，下次启动生效；游戏会话内保留已加载模块。

后端的 `loadStatus` 区分下次启用、本次已装载、SDK 初始化完成与具体失败原因。新 Runtime 仅在状态查询时观察 L4N 模块；前端接入新字段后随稳定版本发布。

## 组件版本与来源

本次核对并下载：

- L4N **2.58.0**：[版本备份仓库的原始发行附件](https://github.com/STC214/l4n-releases/releases/tag/L4N_v2.58.0)。附件内 `readme_l4n.txt` 标为 `[2.58.0] 2026-11-09`，平台 DLL 的产品版本为 `2.58.0.0`；原说明与 SDK 头文件随 L4N 下载保留。下载源为第三方版本备份仓库，校验值与该附件公布的 SHA-256 一致。
- [作者工坊 3558049615](https://steamcommunity.com/sharedfiles/filedetails/?id=3558049615) 当前返回 **2.51.0**。更新脚本同时检查工坊与版本备份仓库，读取压缩包内部版本，再按版本号选择较新的候选；来源记录随包保存。早前仅查询工坊而漏掉新发行版的问题已修正。

更新工作区组件可运行：

```powershell
node --use-system-ca scripts/fetch-native-libraries.mjs
```

此命令只下载到 `vendor`，保留来源和版本记录，并同步桌面包的精确资源目录。只更新 L4N 时追加 `--l4n-only`，DXVK 保留当前已选版本。来源暂时失败时会记录原因；更新脚本保留高于在线候选的本地已选版本。

## 文件切换有预览与恢复

操作先展示文件清单；确认后写入独立事务记录，保存安装前字节，逐项切换。游戏运行中锁定这些操作。组件文件有外部修改时提示具体路径，原现场保留；中断后可用对应的「恢复操作」。配置文件 `left4dead2/neko/config.vdf` 和雷达数据目录各自保留。

源码与旧实现继续保存在工作区；新发布包只包含轻量加载器、雷达及其设置服务、所选 L4N 发行包和官方 DXVK。历史发布入口保留，当前更新以这份说明为准。
