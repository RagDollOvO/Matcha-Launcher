# 感染者模型缩放

源自 Skeeto 2.2.19，GPL-3.0，修订 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`。

- 原作 `src/skeeto/core/skeeto_proxy.cpp`：`WModelScaleClassify`、`WModelScaleGamePump`、`Hooked_WModelBuild` 与 `HookedModelScaleProxy`。
- 三项设置：总开关、特感比例（含 Witch）、普通感染者比例，保留原作默认值和范围。
- 本地服订阅使用 Source Model API 1；玩家感染者采用字段路径，AI 感染者采用骨骼路径。每帧检查 1–64，其他实体分帧扫描，每帧最多 256 个。
- 依赖 `beacon.source` 0.4.0。新功能关闭后按对象身份恢复最近的原生值；地图换代清除旧引用。
- 独立包包含插件源码、配置定义、共享生命周期、SDK 头文件、JSON 库与 CMake 构建入口。
- 游戏显示待实测。
