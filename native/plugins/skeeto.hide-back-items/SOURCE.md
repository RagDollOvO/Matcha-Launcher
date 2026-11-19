# 隐藏背部挂件 0.1.0

GPL-3.0，原作者 regoists/Skeeto contributors。Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，proxy 的 `ClientUxBackItemCategory`、`ClientUxFilterAddonBits` 和 `ClientUxBackItemsPump`。

四个分类保留原作武器 ID：药品 15/23，医疗 12/24，投掷物 13/14/25；挂件位 5 为舌头，6 为无电极电击器，位 7 与未知物品保持。感染者仅处理舌头位。选择为空时撤销过滤器。

Source Addon API 1 统一解析原生更新入口、验证 RecvProp 0x1880/0x1884 与函数内部读指令、维护 MinHook 生命周期。临时显示位通过 MSVC-target C SEH 边界在正常返回或原生异常展开时恢复，原异常继续传播。消费者只编入分类规则和独立配置；原始数据、实体地址与 Hook 均在共享服务内。

完整源码在 source/，Windows x86 C++17 / CMake 3.22+。实际游戏表现待实测。
