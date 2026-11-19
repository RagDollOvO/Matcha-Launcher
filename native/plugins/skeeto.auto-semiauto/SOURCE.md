# 半自动武器按住连发 0.1.0

GPL-3.0，regoists/Skeeto contributors。Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`。proxy 的 `HoldSemiWeaponState`、`HoldSemiNameAllowed`、`ClientUxHoldSemiPump`、六档间隔表及 HUD 武器分类。

独立 DLL 保留六档节奏、16 毫秒松开窗口、60 毫秒武器分类刷新及猎枪模型修正。每帧读取玩家生命与当前完整武器句柄，切换武器时立即刷新分类。只在本地服生效，默认关闭。换弹由独立的 `skeeto.auto-reload` 管理。

Source Input API 2 持有物理左键监听和合成输入归属。工作线程只处理消息与原子状态；低级鼠标回调忽略合成事件，始终传给后续监听者。每次重新按下都检查真实按住、前台、菜单和本地服门禁，修复原作普通模式在松开窗口内失焦 / 物理松开后仍可能补按的问题。保留按下间隔硬下限，失败后 200 毫秒重试。关闭时交回物理长按并撤销监听。反作弊对抗模块继续剔除。

完整源码、GPL 许可和 SDK 头随包放入 source/。Windows x86 C++17 / CMake 3.22+。实际游戏效果待实测。
