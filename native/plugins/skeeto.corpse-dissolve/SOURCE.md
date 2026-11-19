# 尸体消散

来源：regoists/Skeeto 2.2.19，修订 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，GPL-3.0。原 `skeeto_proxy.cpp` 的 ClientUxDissolve / DissApply / DissCiHurt / ClientUxOnZombieDeath。

独立 DLL 使用 Flare API 1 和 beacon.source 0.4.0 的 Dissolve API 1、Entity、Effects、Resource API。构建目标 `skeeto_corpse_dissolve`；随包 source/ 提供 Windows x86 C++17 构建输入。SDK 与独立消费者已通过真实 x86 离线检查，游戏实测待进行。

## 五项原设置与独立开关

特感 / Tank 与普感 / Witch 默认关闭。类型 0 普通、1 电气、2 轻量电气（默认）、3 核心；时长 200–2000 毫秒，默认 550，菜单步长 50。兼容清理默认关闭，每 200 毫秒清理现存客户端布偶，独立于两个类别开关。Flare 另提供总开关和本 DLL 的持久化设置。

## 死亡事件和原节奏

`zombie_death.victim` / attacker 使用实体索引。普感与特感仅响应本地玩家击杀，Witch 响应所有击杀。最多 16 项待处理，延迟分别为 16 / 32 / 50 毫秒；SI / CI / Witch 排队期限为 700 / 900 / 1200 毫秒。每时钟刻及 100 毫秒窗口最多创建一个，普感间隔至少 175 毫秒，总活跃效果最多 6 个、普感对象最多 3 个。

普感优先使用死亡时完整实体引用，结合 96 单位死亡锚点；其次使用本地子弹轨迹记录的候选，最后查找 128 单位内的有类型布偶。射线在 Paint 中每 40 毫秒最多一次，向命中点延长 2 单位，12 项命中缓存沿用 70 / 700 / 900 毫秒节奏。普感布偶探测最多 192 个索引；SI / Witch 备用探测为末端 65 个索引、最多 16 个候选。特感保留 userid 和出生代次，Witch 也核对完整句柄。

## 原生效果与恢复

SDK 精确匹配原生创建函数及各调用目标，验证 C_EntityDissolve 虚表、初始化槽、字段 setter 和 ModelInfo 查找。保留原生父对象、绝对原点、四种类型、全部淡入 / 淡出字段和火花时刻。创建后的 Think / Draw 由引擎调度。

玩家和普感保持 NODRAW 原值，玩家也保持 FL_DISSOLVING 原值；Witch / 布偶可以隐藏。关闭、范围退出和退订排队回收所属效果，按实体完整句柄、对象、网络类、地图和玩家生命代次恢复字段；临时只读保留恢复点重试。已有原生效果保留优先权。原生异常记录为故障并停止继续创建；未完成构造的存储保留故障记录，避免反复分配。

与 `skeeto.combat-declutter` 共用 `skeeto.corpse.common` / `skeeto.corpse.special` 分类资源；`skeeto.corpse.dissolve` 提示跨类别的全局布偶清理协调。原上游源码保持只读，消费者只通过 SDK 访问游戏原生对象。

离线宿主 `dissolve_smoke` 已消费原生构造 / 初始化 / 模型 / 父对象 / 绝对原点 / 时间字段 / 回收接口，核对事件调度、命中缓存、布偶后备、容量、关闭恢复、复活保护和跨模块协调。构造、初始化、效果 setter、回收异常与签名不符另有对应失败路径检查；原 `corpses_smoke` 继续通过。检查只运行自有宿主与原生接口夹具。
