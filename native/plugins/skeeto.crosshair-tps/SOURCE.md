# 第三人称准星 0.1.0

GPL-3.0，原作者 regoists/Skeeto contributors。Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`。

来源 proxy 的 `SurfDrawThirdPersonAimMarker`、`XhairTpFactory`、`XhairThirdPersonActive`、`XhairSyncEngineHud` 和 host 的十色表。保留 8192 单位 MASK_SHOT 射线、本地实体排除、四个工厂形状、分辨率比例、双遍描边、大小与透明度。Source 0.4.0 的 View / Entity / Effects / Draw / Cvar / Resource 扩展分别提供只读视角、身份检查、射线、原生绘制和参数恢复。

独立配置包含总开关、样式、十色、大小、不透明度。关闭、第一人称、菜单、地图切换和结算隐藏，恢复本模块持有的 crosshair 参数。共有准星隐藏标记分别读取 `skeeto.crosshair.hide-all`、`skeeto.crosshair.reach-hidden`、`skeeto.crosshair.reload-hidden`；本模块实际显示时声明 `skeeto.crosshair.tps-active`。

待依赖接入：准星模块提供总隐藏与伸手动画状态，自身 HUD 提供换弹隐藏状态；第三人称弹道修正提供有效期 100 毫秒的实际输入方向。当前使用引擎视角，跨模块方向联动随输入模块一起验收。源码覆盖状态因此保持 partial。

包内 source/ 含完整构建输入，Windows x86 C++17 / CMake 3.22+。游戏表现待实测。
