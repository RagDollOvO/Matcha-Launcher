# 分类音量 0.1.1

GPL-3.0。来源 regoists/Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`。`classifier.hpp` 逐字提取 `skeeto_proxy.cpp` 的 `SoundVolumeGroup`、路径归一化、分类函数和原有静态断言。17 类沿用原顺序和 0–100% 范围。

独立 DLL 实现 SDK 生命周期、动作、设置持久化和分类过滤。依赖 Beacon Source 0.4.0 的 `l4p_sound.h`。S_StartSound 入口由 SDK 统一管理；模块关闭时退订并恢复原声，默认全部 100% 时保持原始入口。

作者控制台 `skt_vol_*` 的交互移入 Flare 的中文配置表。音效反馈与音乐属于另两个功能的设置，按原模块清单分别移植。实际游戏表现待实测。

完整构建输入随包位于 source/，使用 Windows x86 C++17 和 CMake 3.22+；独立构建无需旧 Skeeto DLL。
