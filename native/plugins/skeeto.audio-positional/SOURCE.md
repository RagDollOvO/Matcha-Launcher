# 优化听声辨位

GPL-3.0。来源 Skeeto 2.2.19，提交 7a18b4988d089fdf6cc7e857560cf82a9609a32c。上游作者 regoists/Skeeto contributors。

src/skeeto/core/skeeto_proxy.cpp :: DspLockWriteVal / DspLockVerify / DspLockRestore

联机范围继续待定，当前仅在本地服应用。独立控制空间混响与整体 DSP 开关。空间混响参数通过原生浮点 setter 即时锁定为零，辅以 250 毫秒漂移修正；关闭选项、离开本地服或退订后恢复原值。 与枪声听感增强共享互斥组，先应用的功能保留控制；关闭后另一功能自动接续，两个功能的保存设置各自保留。 枪声房间混响也参与先占用者优先的协调；它可与枪声听感共同工作。

移植表在 preset.json；2 个参数条目独立编译为 skeeto.audio-positional。Beacon Source 0.4.0 提供共享游戏线程和参数租约，保留原值、拒绝重叠占用，并在停用和离开适用环境时恢复。受限参数在本地服务器应用；sv_rollangle/sv_rollspeed 采用原作的客户端视觉路径。

source/ 内含完整编译输入、SDK、JSON 库和 CMake。Windows x86 C++17，CMake 3.22+。实际游戏表现待用户实测。
