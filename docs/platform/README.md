# Matcha · DLL 接入与启动器

Matcha 统一管理本地 DLL、SDK 模组以及特殊的 L4N 整包；DXVK 只显示游戏目录里的版本。当前组件、版本、启停和恢复方法见 [DLL 与 L4N 整包](NATIVE_LIBRARIES.md)。底层目录 `bin/l4p`、C ABI 的 `L4P_*` 标识继续沿用。

Svelte 前端已接共享 Core 和 Pi CLI；桌面入口、配置目录与当前功能见 [Matcha 使用说明](MATCHA_DESKTOP.md)。

## 先看这三处

- **模组作者**：[Matcha SDK：DLL 模组开发规范](DLL_SPEC.md)。从物资雷达跑通导入与启停，或用 `native/examples/demo.hello/` 写第一个动作；ABI 头文件为 `native/include/l4p_plugin.h`。
- **前端作者**：[前端接入说明](FRONTEND_HANDOFF.md)、`backend/desktop/service.mjs` 的共享能力服务、[Pi CLI 接入](PI_CLI.md)。
- **平台维护者**：[加载架构](ARCHITECTURE.md)、`native/README.md`、`backend/README.md`。

## 当前可以运行的入口

以下命令在项目根目录执行，只显示帮助或校验编译后的示例包：

```powershell
node backend/cli.mjs help
node backend/cli.mjs validate-plugin --plugin-dir native/build-x86/dist/bin/l4p/plugins/demo.hello
```

原生产物位于 `native/build-x86/dist/`。插件 API 1 提供 `render-init` 初始化、日志和 JSON 动作，Runtime 可查询本次加载状态。DLL 的开关在下次完整启动应用；游戏帧和事件由可选的 [Source 服务](DLL_SPEC.md#8-source-服务参考)提供。

## 准备 Steam 原版安装后

先在 Steam 中下载 L4D2，暂时保持原始安装。已有改装目录、配置和工坊订阅保留。下载完成后选择这份安装目录，由平台只读检查文件布局、位数和图形入口。

只读检查和安装计划：

```powershell
node backend/cli.mjs inspect --game-root '你的游戏安装目录'
node backend/cli.mjs plan-install --game-root '你的游戏安装目录' --out install-plan.json
```

查看计划后，由用户明确执行应用：

```powershell
node backend/cli.mjs apply-install --plan install-plan.json --confirm
```

应用前会重新确认计划对应的文件、原入口和进程状态。原入口保存为恢复副本，平台组件位于 `bin/l4p/`。遇到外部修改、游戏运行中或未完成操作时，会返回具体错误和恢复条件。

游戏启动是独立用户操作。桌面可选「L4N 平台启动」，CLI 显式指定 `--mode modded` 使用同一路径；请先打开并登录 Steam：

```powershell
node backend/cli.mjs launch --game-root '你的游戏安装目录' --mode modded --confirm
```

`requested` 表示进程已创建或请求已交给 Steam，Runtime 是否加载由实际管道状态确认。`modded` 与旧 `direct` 默认使用 `-steam -novid`；CLI 省略 mode 时使用开发模式 `-insecure`。`--connect 域名:端口` 可附加连接目标。

退出游戏后，可以显式恢复原入口：

```powershell
node backend/cli.mjs restore --game-root '你的游戏安装目录' --confirm
```

恢复会保留 `bin/l4p/` 中的插件、配置、日志和账本。首次安装、恢复、插件导入和启停已提供独立操作；已有平台的升级与重新部署需要后续版本迁移入口。

## 验证的含义

原生离线检查使用自有 fake DXVK 后端，检查 DLL 转发、初始化、参数和错误路径。`checks/native-core.mjs` 负责 Core → 实际 x86 Runtime → 示例 DLL 的跨层检查，并在夹具中恢复入口。它运行的是 `l4p_smoke.exe` 离线宿主。

本次跨层检查已完成：安装真实编译产物，经过本机管道调用 `demo.hello`，收到 DLL 返回的 `Hello, 幸存者!`，宿主退出后恢复原入口。Windows 工作区中 DLL 目录重命名失败的问题，已通过账本管理的逐文件发布修复；入口 DLL 的原子替换保留为最终提交点。

Pi 接入已用本机 Pi CLI 完成会话状态握手，并使用独立离线场景验证消息与确认流程。真实模型服务按用户配置启用。

用户已通过真实游戏启动确认 DXVK、Beacon Runtime 与 demo.hello 的初始化链路，DXVK 状态缓存已落盘，游戏由用户手动退出。VPK 管理已接入；操作说明见 [Mod 管理](MODS.md)。
