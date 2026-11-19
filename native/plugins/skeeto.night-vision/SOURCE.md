# 聚光灯夜视 0.1.0

GPL-3.0，原作者 regoists/Skeeto contributors。来源 Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c` 的 `skeeto_spotlight.cpp/.h`，以及 proxy 的 `SpotlightClampedOffset`。

保留原作 keyed dlight 布局、33 毫秒刷新、250 毫秒/移动后天花板检测、96 单位偏移、10 单位间距、12 单位最小偏移、亮度指数分解和三种色温。全部数值范围与默认值沿用原作。

共享实体引用、RecvProp 查找、时钟、TraceRay 与 keyed 灯光由 Beacon Source 0.4.0 提供。独立模块负责设置、存活幸存者约束、刷新与停止。联机范围待定，当前本地门禁。完整输入在 source/，CMake 3.22+、Windows x86 C++17。游戏实测待进行。
