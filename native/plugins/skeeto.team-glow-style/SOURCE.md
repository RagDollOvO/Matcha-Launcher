# 队友描边配色 0.1.0

GPL-3.0，regoists/Skeeto contributors。Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`。

完整抽取 proxy 的 `SurvivorGlow*`、`GlowState*`、`ClientUxApplyForceCvars` 描边部分，以及 `CampaignOutlineLaserSight` / `CampaignOutlinePump` 的激光升级包分支。角色识别和用户去重来自 HUD 的 `TeamHudResolveAvatarProp`、`TeamHudOfficialSet`、`TeamHudDedupRecs`，提取为随包的 `survivor_identity.hpp`。八角色预设、九色和精确自定义色、五组三通道状态色、50–200% 相对渲染、恢复动作均保留。

Source Glow API 1 管理颜色回调及原生描边归属；Cvar API 3 持有获取前基线，变量对象变更时重新获取基线。普通配色保留原生透明度；常亮与激光升级包在 LOCAL 订阅下运行。写实模式保持原生角色描边。激光分支按 200 毫秒、128 索引、8 个持有目标调度，模型与 owner / NODRAW 字段共同确认未拾取的原版升级包。

通过资源键 `skeeto.hud.hide-world` 和 `skeeto.hud.pause-sampling` 消费世界 HUD 的隐藏与暂停状态。round_end、map_transition、mission_lost、finale_vehicle_leaving、finale_win 撤销激光描边；round_start / 新地图恢复采样。原作菜单和控制台的颜色操作映射为 Flare 的独立设置及四个批量动作。

源码、SDK 头和作者许可证在 source/，Windows x86 C++17 / CMake 3.22+。实际游戏显示待实测。
