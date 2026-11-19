# 闲置恢复与便利

来源：regoists/Skeeto 2.2.19，修订 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，GPL-3.0。`skeeto_proxy.cpp` 的 `IdleFlashlight*`、`IdleViewRestore*`、`IdlePersonRestore*`、`IdleWepRestore*` 与 `BotName*`。

独立 DLL 使用 Flare API 1，依赖 beacon.source 0.4.0。每项默认关闭；所有配置、作者说明、源码和许可证随包。目标 `skeeto_idle_restore`，包内 source/ 支持 Windows x86 C++17 / CMake 独立构建。

## 保留的行为

- 手电：200 毫秒活跃状态采样；闲置事件优先最后玩家状态；150 毫秒延迟、100 毫秒重查和 4 秒窗口。只切换一次，等待服务器确认。以声音过滤静音 flashlight 路径；结束后短尾保持原作时长。
- 原先关闭手电时，亮度以参数租约压到 0，关闭 / 超时 / 接管完成恢复。按 SDK 既有范围，受限 r_flashlightbrightness 在本地服应用；远端继续普通手电切换和静音。多模组争用按租约报告。
- 朝向：连续两个正在操纵帧后采样；闲置时冻结，保存观察人机的方向。接管等待 100 毫秒，最多两次纠正、650 毫秒窗口和 2 秒等待；渐进鼠标移动立刻停止恢复。
- 武器槽：原作五类完整类名匹配；完整句柄和地图代次缓存。接管等待 100 毫秒，最多两次普通 slot 命令，2 秒超时；倒地仅切副武器。所有动作重新确认本地活着的生还者、本人身份、观察状态和菜单。
- 人称：100 毫秒采样和接管延迟，2 秒超时。Player API 保留原作客户端 PE 时间戳 / 大小 / 三处指令前缀检查及精确 getter(-1) / first / third 调用，原生异常停用该接口。
- 八角色 BOT 名称：Nick / Rochelle / Coach / Ellis / Bill / Zoey / Francis / Louis 的原作 token；去首尾半角 / 全角空格，23 UTF-16 单位和合法代理对，控制字符拒绝。空值跟随游戏 / Mod。Localize API 保留原表、原查找和不可变文字指针；仅覆盖指定 token，其他名字透传。

## SDK 接入

Source 承担 Player API 1 和 Localize API 1 的原生边界。Player API 接受五个槽位或手电切换枚举，通过原生 ClientCmd_Unrestricted 提交普通玩家命令，原生命令标志保持。BOT 名称通过 VGUI_Localize005::Find 槽 2 的按归属覆盖；关闭恢复自有入口，外部接管时保留透明常驻前驱。配置、事件状态和名称草稿由本 DLL 保存。

离线检查与游戏实测分别记录在拆分工作日志中。
