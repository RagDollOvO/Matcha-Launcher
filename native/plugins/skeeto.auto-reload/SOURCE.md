# 霰弹枪自动换弹 0.1.0

GPL-3.0，regoists/Skeeto contributors。Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`。proxy 的 `HoldSemiAutoReloadTick`、`HoldSemiReloadNeeded`、`HoldSemiPumpReloadActionReady` 与 `HoldSemiReloadIntervalMs`。

两类霰弹枪开关独立，200–300 毫秒间隔和至少 24 毫秒按下保持；单喷读取攻击 / 推击键和两种冷却。Source Input API 1 解析当前换弹绑定，支持原作扫描码 / 扩展键 / 鼠标五键；发送只在本地服、游戏前台且菜单关闭时发生。关停、范围退出和失焦释放所持有的按键。玩家当前按住换弹键时等待，保护人工输入。

弹匣容量来自 Source Weapon API 1 的精确本地武器脚本查找。缺失、签名不符或原生故障时沿用原作的单喷 8 / 连喷 10 发后备值；元数据故障会停用本进程的原生查找。完整源码和 SDK 头随包放入 source/，Windows x86 C++17 / CMake 3.22+。联机范围待定，当前本地服；实际游戏效果待实测。
