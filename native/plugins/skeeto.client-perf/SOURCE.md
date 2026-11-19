# 客户端性能预设

GPL-3.0。来源 Skeeto 2.2.19，提交 7a18b4988d089fdf6cc7e857560cf82a9609a32c。上游作者 regoists/Skeeto contributors。

src/skeeto/core/skeeto_proxy.cpp :: kClientPerfEntries / ClientPerfPump

保留原作五组、29 个参数和目标值，各组默认关闭。粒子与骨骼组降低效果负载；声音异步设置可能影响听感。本地网络组仅对自己运行的本地服生效。受限参数在本地服应用，远端会显示等待状态。关闭任一组恢复该组参数；资源加载参数继续交给资源加载模块。

移植表在 preset.json；29 个参数条目独立编译为 skeeto.client-perf。Beacon Source 0.4.0 提供共享游戏线程和参数租约，保留原值、拒绝重叠占用，并在停用和离开适用环境时恢复。受限参数在本地服务器应用；sv_rollangle/sv_rollspeed 采用原作的客户端视觉路径。

source/ 内含完整编译输入、SDK、JSON 库和 CMake。Windows x86 C++17，CMake 3.22+。实际游戏表现待用户实测。
