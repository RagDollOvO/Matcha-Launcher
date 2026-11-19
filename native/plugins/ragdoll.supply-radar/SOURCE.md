# 物资雷达 1.5.9 · Flare 版

作者：RagDoll。移植自已归档的 1.5.8 烟花识别修复版。保留扫描预算、HUD 和布局、单个烟花盒识别、逐物品发光及颜色。Flare 版在本地战役、写实、生还者地图运行。L4N 版的工程和二进制保留在原归档。

在 Flare 的「RagDoll 自制模组 → 战役 HUD」启用雷达，以「L4N 平台启动」启动。在游戏内按 **Ctrl + F7** →「物资雷达」。方向键选择与调节，Enter 确认，Esc 返回。进入位置编辑后，方向键移动、Shift 快移、Alt 自由移动、+/- 缩放、Enter 保存、Esc 撤销。1.5.9 移除对 `-insecure` 的初始化要求，保留本地地图与游戏模式检查。

Flare 配置位于游戏目录 `bin/l4p/data/ragdoll.supply-radar/settings.ini`，随模组单独保存。若要沿用旧雷达配置，退出游戏后把原 `L4N_SupplyRadar/settings.ini` 复制到上述位置即可；保留旧文件。插件更新不会覆盖数据目录。

随包 `source/` 可使用 Windows x86 LLVM-MinGW 工具链，通过 CMake 构建（编译器指向工具链的 `i686-w64-mingw32-clang++.exe`）。雷达用 MSVC x86 ABI 编译，加载时依赖 Flare 游戏内设置服务 `flare.game-ui@0.1.0`。

归属：雷达素材 **GLOBAL RADAR 2020 – By Ellie**；HUD 与字体素材由 **20Cat** 提供，烟花图标使用原交付中用户提供的蓝底火箭。四种彩色物资原图及烟花源图见 `source/radar/assets`。
