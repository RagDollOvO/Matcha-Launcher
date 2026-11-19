# 本地画面参数

GPL-3.0。来源 Skeeto 2.2.19，提交 7a18b4988d089fdf6cc7e857560cf82a9609a32c。上游作者 regoists/Skeeto contributors。

src/skeeto/core/skeeto_proxy.cpp :: ClientUxApplyForceCvars

仅在本地服应用。已移植去雾、最大渲染距离、关闭雨雪、全亮、关闭模型贴花与两类颜色校正预设。原作的自定义 Cvar 命令、手电组合参数、导演面板仍待移植。各预设独立恢复原值。

移植表在 preset.json；11 个参数条目独立编译为 skeeto.forced-cvars。Beacon Source 0.4.0 提供共享游戏线程和参数租约，保留原值、拒绝重叠占用，并在停用和离开适用环境时恢复。受限参数在本地服务器应用；sv_rollangle/sv_rollspeed 采用原作的客户端视觉路径。

source/ 内含完整编译输入、SDK、JSON 库和 CMake。Windows x86 C++17，CMake 3.22+。实际游戏表现待用户实测。
