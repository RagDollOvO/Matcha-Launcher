# 本地调试

GPL-3.0。来源 Skeeto 2.2.19，提交 7a18b4988d089fdf6cc7e857560cf82a9609a32c。上游作者 regoists/Skeeto contributors。

src/skeeto/core/skeeto_proxy.cpp :: ClientUxApplyForceCvars localDebug

仅在本地服应用。已接入原作的 11 项数值型调试开关。碰撞箱命令、无敌点标记与传送继续待移植。各项默认关闭；换到远端服务器时恢复已修改的参数。

移植表在 preset.json；11 个参数条目独立编译为 skeeto.local-debug。Beacon Source 0.4.0 提供共享游戏线程和参数租约，保留原值、拒绝重叠占用，并在停用和离开适用环境时恢复。受限参数在本地服务器应用；sv_rollangle/sv_rollspeed 采用原作的客户端视觉路径。

source/ 内含完整编译输入、SDK、JSON 库和 CMake。Windows x86 C++17，CMake 3.22+。实际游戏表现待用户实测。
