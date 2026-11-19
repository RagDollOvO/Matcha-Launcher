# 持枪视角与镜像

来源：regoists/Skeeto 2.2.19，修订 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，GPL-3.0。原 `skeeto_proxy.cpp` 的 skviewmodel、ViewModelMenu*、ViewModelBind / Calc / Build / GamePump。

独立 DLL 使用 Flare API 1 与 beacon.source 0.4.0 Viewmodel API 1。目标 `skeeto_viewmodel`；source/ 附完整 C++17 Windows x86 构建输入和许可证。验证进度见仓库拆分执行记录。

## 模型配置与操作

- 六项设置：默认关闭、全局镜像关闭、逐模型镜像关闭、移动步长 0.1、旋转步长 1 度、编辑槽 0。两个模型槽分别读取原生路径 / MDL 校验值；Flare 动作覆盖原 20 项菜单功能。
- 位置 / 旋转原点每轴 ±100，旋转 ±180 度；0.1–5 倍整体比例。普通 / 精细调整分别使用步长及其十分之一；比例 0.05 / 0.005。原步长轮换序列保留，也可在设置里直接输入。
- 位置、旋转、全部三种重置保留；全部重置包含旋转原点、镜像和比例 1。逐模型镜像内容与镜像模式分开设置，每个确认动作只保存一个文件。全局镜像动作切回全局模式，打开时同时启用总开关。
- 沿用 `left4dead2/skeeto/viewmodel/profiles.ini` v2。规范化模型路径和 MDL checksum 联合键，Necola `_nclN` 归并；重复记录取最后一条、旧记录省略 scale 时为 1。最多 256 项 / 256 KiB。
- 初始化只读；控制线程原子保存，Paint 只读取发布的不可变副本。文件格式错误保留原件，禁止覆盖直到成功重读；编辑前复查外部修改，保存失败保留此前配置。未选择模型记录保持。

## 原生边界

Source SDK 在 CalcViewModelView 原生返回后叠加位置 / 旋转 / 旋转原点，BuildTransformations 原生返回后绕参与骨骼质心缩放，并按相机平面镜像。两个模型共享武器脚本且镜像设置相反时暂停镜像。完整句柄、地图代次、模型头与绑定编号共同识别对象；关闭归还自有字段 / 虚表入口。

菜单持续按键改用 Flare 的确认动作，控制线程处理配置 IO。原源码保持在参考目录，所有游戏原生访问由 SDK 负责。
