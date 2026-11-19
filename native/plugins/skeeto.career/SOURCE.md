# 生涯档案 0.1.0

来源：[regoists/Skeeto](https://github.com/regoists/Skeeto)，2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，GPL-3.0。原作者与贡献者的版权归原权利人。

2026-11-16 Flare 移植自 `src/skeeto/core/skeeto_career.cpp`：保留 23 项通用统计、37 项武器的精确标识、武器顺序和正数击杀前 6 排名规则。新增独立 Beacon ABI 与 `flare.report.v1` 结果；展示迁入 Flare，按用户点击刷新读取。

## 读取与生命周期

仅借用游戏已加载的 `steam_api.dll`，每次刷新暂持模块引用。需要 `SteamAPI_SteamUserStats_v012`、`SteamAPI_ISteamUserStats_GetStatInt32`、`SteamAPI_ReleaseCurrentThreadMemory` 三个导出。使用游戏现有缓存，回调循环与 Steam 初始化由游戏负责；读取在 Beacon 串行控制线程进行，完成后释放该线程 Steam 临时内存及模块引用。配置、成就和统计均保持原状。

缺少 DLL、导出、接口或统计时返回可读等待状态；每次刷新重新读取。假值与负值记为缺失，0 保留。完整状态按 60 项全部有效判断；部分状态保留有效字段。上游按核心四字段判断就绪，移植版改用全字段完整度。终局/参与战役与每小时击杀使用原始计数直接计算，分母为 0 时留空，移植版保留计算值，移除上游显示上限。

当前游戏 `bin/steam_api.dll` 已离线确认 x86 与所需导出。真实游戏 Steam 就绪时序、统计可用性与联机环境待游戏实测。默认停用，开关在下次完整启动生效。

## 完整源码与构建

随包 `source/` 包含源文件、SDK 头、JSON 库与独立 CMakeLists。使用 Windows x86 C++17 工具链与 CMake 3.22+：

```powershell
cmake -S source -B build -A Win32
cmake --build build --config Release
```

LLVM-MinGW 使用 Ninja 并指定 i686 编译器。仓库入口：`cmake --build native/build-x86 --target skeeto_career`。构建只输出本地 DLL。许可证见 `LICENSE`；JSON 库的 MIT 许可位于其头文件开头。

接口依据：[Valve GetStat](https://partner.steamgames.com/doc/api/ISteamUserStats#GetStat)、[Steamworks API](https://partner.steamgames.com/doc/sdk/api)。离线 fixture 使用自有假 Steam DLL，覆盖完整、部分、缺失、0、负值、排序、参数与重复生命周期；与真实游戏实测分别记录。

合集封面 `catalog.png` 使用同一上游提交的 `LOGO.png`，版权归原作者与贡献者，随本包按上游 GPL-3.0 许可提供。
