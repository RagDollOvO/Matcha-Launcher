# 过关自动执行 CFG 0.2.0

移植来源：regoists/Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，`src/skeeto/core/skeeto_proxy.cpp` 的 `CfgOvScan` / `CfgOvLoad` / `CfgOvExtract` / `CfgOvApply` / `CfgOvCycle` 与 `ClientUxApplyMapStableCvars`。按上游 GPL-3.0 提供，原版权归上游贡献者。

独立 Beacon API 1 DLL，依赖 `beacon.source` 0.4.0。章节进入后在游戏线程执行所选 CFG。原 `file` / `automatic` 配置、任意合法相对 CFG 和手动 `apply` 动作保持；新增 `restore` 默认关闭，旧配置省略该字段时仍可加载。控制线程的保存、选择和手动应用先检查输出容量，再持久化或排队。

读取游戏 `left4dead2/cfg` 下的松散 `skeeto_*.cfg` 预设，保留原作 16 套上限、大小写无关排序、上一套 / 下一套 / 按名选择；切换开启章节自动执行并立即排队。同章切换保持叠加。预览读取前 64 KiB，显示最多 64 个非空行、每行 239 字节，处理 BOM / CRLF 并保留注释；原文件与原生完整 exec 保持。

可选恢复使用 Source Cvar API 4：执行前捕获最多 96 个数值参数的首次基线，按物理行首命令及 skt_cvar / skeeto_cvar 的参数名追踪。别名、嵌套 exec 和同一行后续命令交给原生解释器。新章节先恢复旧项，关闭自动执行、离开环境和退出模块时归还；关闭恢复选项则保留当前值并清空记录。受限参数使用本地服订阅，其他模块占用和环境跳过在状态里列出。恢复失败保留原基线、等待后重试，再提交新章节 CFG；变量身份更换时保留新对象值。

保存与实际执行前均检查规范路径、现存文件和目录包含关系；只写本模组 config.json。真实 x86 `cfg_smoke` 核对预设 / 预览、16 / 64 / 96 上限、同章 / 过关 / 关闭恢复、失败重试、独立归属和原生完整 exec；原 source_smoke 已复核旧调用合同。实际游戏执行待实测。

完整源码、SDK 头、JSON 头和独立 CMake 位于 `source/`。Windows x86 C++17，仓库构建目标 `skeeto_config_override`。合集封面来自同一上游的 `LOGO.png`。许可证见 LICENSE，JSON 库 MIT 许可证位于其头文件。
