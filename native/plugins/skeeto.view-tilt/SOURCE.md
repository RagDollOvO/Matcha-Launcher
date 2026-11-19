# 视角倾斜

GPL-3.0。来源 Skeeto 2.2.19，提交 7a18b4988d089fdf6cc7e857560cf82a9609a32c。上游作者 regoists/Skeeto contributors。

src/skeeto/core/skeeto_proxy.cpp :: ClientUxApplyViewRoll / ClampLocalViewRollAngle / ClampLocalViewRollSpeed

移植 Black Mesa View Tilt 的两个视觉参数：倾斜角度 0–12 度，侧移阈值 0–500。角度为 0 时释放倾斜参数。沿用客户端本地视觉参数，关闭后恢复。

移植表在 preset.json；2 个参数条目独立编译为 skeeto.view-tilt。Beacon Source 0.4.0 提供共享游戏线程和参数租约，保留原值、拒绝重叠占用，并在停用和离开适用环境时恢复。受限参数在本地服务器应用；sv_rollangle/sv_rollspeed 采用原作的客户端视觉路径。

source/ 内含完整编译输入、SDK、JSON 库和 CMake。Windows x86 C++17，CMake 3.22+。实际游戏表现待用户实测。
