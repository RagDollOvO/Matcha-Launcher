# 减少画面干扰 0.2.0

GPL-3.0。来源 Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，原作者 regoists/Skeeto contributors。对应 `skeeto_proxy.cpp` 的 ClientUxApplyCorpseLimit / ClientUxApplyNoCorpseCvars / ClientUxOnZombieDeath / ClientUxTrackCorpse / ClientUxPaintNoCorpse / ClientUxNoCorpseDestroyPump。

五个原配置字段与五项参数表保留。普通感染者 / Witch、特感 / Tank、全部地面尸体限额、第一人称曳光弹独立设置；联机范围待定，当前仅在本地服应用。功能由独立 SDK DLL 实现，Source 0.4.0 负责游戏帧、参数、实体引用、归属与原生调用。

zombie_death 的 victim 为实体索引，事件只排队，Paint 执行隐藏。CI / Witch 保留最多 64 项、2.5 秒追踪；SI / Tank 只安排布偶处理，玩家槽位 1–64 与玩家类始终保留。尸体生命值可能迟于死亡事件，使用确认事件与完整句柄 / 地图代次识别。死亡后四次 cl_destroy_ragdolls，首个延迟 50 毫秒、间隔 50 毫秒；三个 90 毫秒间隔的尾部探测，沿用 hi-48 到 hi 的原索引范围，新发现布偶补充短期探测。闲时保持事件驱动。

Corpse API 1 管理 NODRAW、renderMode 与 clrRender。保留原值与随后原生更新，关闭时只恢复仍属本模块的字段和位；原点、碰撞与玩家保持。身份更换 / 换图放弃旧引用，临时不可读页与恢复失败保留租约等待重试。此处替换上游硬编码的白色 / 正常模式恢复，避免覆盖原生或其他模块的值。已通过原生命令清理的布偶由后续游戏事件重新生成。

与尸体消散共享 `skeeto.corpse.common` / `skeeto.corpse.special` 两个分类资源，先占用者生效，设置保留；该布偶清理原生命令作用于现存客户端布偶。消散持有 `skeeto.corpse.dissolve` 时，全局布偶限额与清理脉冲暂停，类别限额继续；全部地面限额同时申请两个类别资源。SDK 逐实体拒绝重叠的隐藏 / 消散租约。回合、加载、范围退出、关闭选项及 DLL / Source shutdown 清理队列和归还租约。

`corpses_smoke` 在自有 x86 宿主检查实体字段、类型 / 句柄 / 地图代次归属、只读与 guard 页恢复、有限脉冲、分类、索引预算、FIFO、独立关闭和服务关闭；原 presets_smoke 验证五字段及参数表合同。实际游戏效果待用户实测。

`preset.json` 为声明来源，`customImplementation: true` 让生成器保留本模块的源码、作者说明和独立 CMake；生成 manifest 与 feature.hpp 时继续使用共同字段。完整源码、SDK、配置助手、JSON 头和 CMake 位于 source/。Windows x86 C++17，仓库目标 `skeeto_combat_declutter`，许可证见 LICENSE。
