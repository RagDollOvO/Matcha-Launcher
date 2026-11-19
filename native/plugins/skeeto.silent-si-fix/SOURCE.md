# 无声特感补发提示音 0.1.0

GPL-3.0，原作者 regoists/Skeeto contributors。Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，来源 `skeeto_proxy.cpp` 的 `SilentSi*`、`EngEmitLocalSpatialVoice` 与 `TeamHudModelNameInner`。

移植出生事件队列（最多 8 条、每轮处理 2 条、1500 毫秒到期）、32 个特感槽、100 毫秒采样、300/400 单位距离迟滞、4 秒近距离冷却、每轮一条声音、已有实体抑制、幽灵/死亡/观察状态、女 Boomer 音色、alert/出场音乐和 450 毫秒配置检查音。实体身份增加原生句柄序列与地图代次，复用槽位重新识别。SDK 按 GUID 清理本模块音频。

原作的出生与近距离屏幕预警归属独立 `hud-intel` 模块，状态 HUD 绘制随该模块接入。联机范围保留待定，当前本地门禁。Source 0.4.0；完整编译输入位于 source/，使用 CMake 3.22+ 和 Windows x86 C++17。游戏实测待进行。
