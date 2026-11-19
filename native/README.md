# L4D2 Platform 原生运行时

这套源码实现 Flare 自有 x86 装载入口、DLL 模组宿主和 C ABI v1。渲染可选择官方 DXVK 或 Windows D3D9。L4N 通过桌面整包适配器独立接入，入口及设置保留原有格式。当前交付见 `docs/platform/NATIVE_LIBRARIES.md`；后文的旧服务与 Skeeto 部分保留为源码档案。

## 构建

首次配置工作区或只构建一个 DLL，见 [DLL 模组开发规范 §10.1](../docs/platform/DLL_SPEC.md#101-配置工作区并构建自己的-dll)。维护整套原生运行时可在已配置的工作区执行：

```powershell
cmake --build native/build-x86 -j 3
ctest --test-dir native/build-x86 --output-on-failure
```

`build-x86/dist` 是平台部署源，包含：

```text
bin/dxvk_d3d9.dll
bin/l4p/l4p_runtime.dll
bin/l4p/enabled.txt
bin/l4p/plugins/demo.hello/plugin.dll
bin/l4p/plugins/demo.hello/manifest.json
```

DXVK 后端由部署器从玩家自己的干净安装接入 `bin/l4p/backend/dxvk.dll`。原入口另行备份到 `bin/l4p/backups/original_dxvk_d3d9.dll`。本目录的构建和检查只处理工作区；实际游戏部署、启动由平台明确操作。

## 加载过程

游戏使用 `-vulkan` 时加载自有 `bin/dxvk_d3d9.dll`。shim 按自身目录定位下游 DXVK，透明转发 D3D9 名称及 ordinal 导出。第一次成功的 `Direct3DCreate9/Ex`（以及可用的 On12 工厂）触发 Runtime 初始化。插件加载次序来自 `enabled.txt`，每行一个 ID。ID 契约见 [DLL 模组开发规范 §2](../docs/platform/DLL_SPEC.md#2-包结构与命名)。

下游后端的两个普通 D3D9 工厂是必需入口；其它导出按所选 DXVK 版本解析。可选导出缺失时返回该调用的空/失败结果，首次加载失败会记入 shim 日志。安装前应记录真实后端版本及导出能力。

初始化与依赖加载位于 DllMain 之外；DXVK、Runtime 和插件模块按进程生命周期保留。shim 的 `L4P_PlatformShimVersion()` 返回 `1`，供安装器只读 PE 导出识别。

Runtime 校验 manifest 的 schema/API 版本、ID、entry、architecture、phase、依赖版本，以及 DLL 返回的 ABI 和 ID/version。当前入口为 `render-init`；Device 创建、Present、Reset 与引擎早期事件尚待后续实现。透明转发保持后端 COM 对象原样。

受管发布包在 LoadLibrary/DllMain 前由 `src/release_gate.hpp` 核验 CMS 分离签名、包外信任策略、账本版本及全部文件摘要，失败时保持 DLL 未映射。`beacon_verify.exe` 与 Runtime 复用此实现；构建输出为 `dist/tools/beacon_verify.exe`。开发通道及依赖搜索约定见 `docs/platform/RELEASE_VERIFICATION.md`。无发布资料的旧本地插件显示 `unverified`。

## 插件 ABI

宿主/插件接口、输出缓冲与线程生命周期见 [DLL 模组开发规范 §7](../docs/platform/DLL_SPEC.md#7-c-abi-与线程模型)；配置传入 `init` 的规则见 [§4.2](../docs/platform/DLL_SPEC.md#42-配置字段)。

## Source 游戏线程服务

工作区服务包为 `beacon.source` 0.4.0。按扩展查头文件、版本、调用线程和示例，见 [DLL 模组开发规范 §8](../docs/platform/DLL_SPEC.md#8-source-服务参考)。以下构建目标与夹具供维护服务时使用。

构建目标：`beacon_source skeeto_config_override skeeto_presets`。`source_smoke` 检查事件与 CFG；`presets_smoke <dist/plugins> <fixtures/source> <全新合成游戏目录> <报表.json>` 检查六个真实 DLL 的参数、恢复、门禁和配置。所需 fixture 目标为 `fake_source fake_cvar presets_smoke`；假引擎和假 Cvar DLL 只输出到 fixtures。

`include/l4p_sound.h` 提供声音过滤、移除与状态查询。Source 统一管理 S_StartSound 入口，`skeeto.volume-mixer` 独立处理 17 类音量。MinHook 1.3.4 作为私有静态库编译，源码、独立构建文件与许可证随 Source 包提供。

声音构建目标：`skeeto_volume_mixer fake_source sound_smoke`；离线入口 `sound_smoke <dist/plugins> <fixtures/source> <全新合成目录> <normal|missing|duplicate>`。夹具包含自有 x86 声音入口，覆盖实际跳板、17 类分类、启停、并发发声和入口冲突。Cvar API 2 的原生 setter 锁定与恢复由 `presets_smoke` 覆盖。实际游戏效果另行实测。

## 本机控制接口

命名管道：`\\.\pipe\l4p.<pid>`。DACL 仅授予当前进程用户，拒绝远程连接。请求使用 UTF-8 JSONL，单行上限 64 KiB；回复上限 256 KiB。空闲读取 15 秒超时，单次写入 5 秒超时。每条连接可收发多行。

```json
{"id":"status-1","type":"status"}
{"id":"hello-1","type":"invoke","pluginId":"demo.hello","actionId":"hello","params":{"name":"survivor"}}
```

返回 `{id,ok:true,result}` 或 `{id,ok:false,error:{code,message}}`。status 包含 protocolVersion、apiVersion、phase、pid、d3d9FactoryReadyCount 和 plugins。初始化过程中重入的工厂沿已就绪后端执行，外层初始化完成后发布 ready 通知。

invoke 的动作与参数契约见 [DLL 模组开发规范 §4.1](../docs/platform/DLL_SPEC.md#41-声明动作)。写动作或 `requiresConfirmation:true` 动作需要用户确认回执：

```json
{"confirmation":{"approved":true,"source":"user"}}
```

这是可信同用户控制模型中的确认回执。平台 Core、CLI 与可信 Pi 扩展负责实际用户确认；模型工具参数中不暴露该字段。插件 DLL 本身属于受信任原生代码，按平台授权加载。

日志写入 `bin/l4p/logs/runtime-<pid>.jsonl` 和 `shim-<pid>.log`。

## 离线检查与跨层宿主

`ctest` 创建带时间戳的 `build-x86/smoke-*` 独立目录，使用我们自行编译的 fake DXVK；真实分发目录保持无 fake 后端。检查涵盖导出/ordinal、工厂参数与结果转发、一次性初始化、manifest/ABI/ID 拒绝、管道状态与动作、参数校验、确认回执、显式退出、缺失后端与失败工厂。

要在合成目录保持 `l4p_smoke.exe` 运行、读取状态和日志，见[离线宿主操作步骤](../docs/platform/DLL_SPEC.md#102-用离线宿主看一次完整调用)。

## 依赖与参考

独立源码移植模块 `plugins/skeeto.crosshair` 使用 Beacon API 1，提供 20 种静态窗口准星。单独构建目标 `skeeto_crosshair`，随包默认停用；完整源码与独立 CMake 随 DLL 放在 `source/`。许可证为 GPL-3.0，来源与变化见该模块 `SOURCE.md`。桌面构建会编译此目标；`audio:build` 保持只构建音频工具。

针对性离线入口 `crosshair_smoke.exe <plugin.dll> <新建的配置目录> <gallery.png>`，覆盖独立 DLL 生命周期 / 配置与 20 种绘制输出。此入口使用自有窗口和配置目录，实际游戏显示另行实测。

`plugins/skeeto.career` 为第二份独立 API 1 模组，构建目标 `skeeto_career`，按显式动作读取 Steam 统计并返回通用报表。完整源码和许可证随包交付。离线入口：

```powershell
cmake --build native/build-x86 --target skeeto_career fake_steam career_smoke
native/build-x86/fixtures/career_smoke.exe `
  native/build-x86/dist/bin/l4p/plugins/skeeto.career/plugin.dll `
  native/build-x86/fixtures/career/steam_api.dll `<输出.json>`
```

`fake_steam` 仅输出到 fixtures；提供 60 项自有测试值和部分 / 缺失 / 零值场景，桌面包分发目录包含真实模组及对应源码。UI 联调使用 `node checks/desktop-fixture.mjs --career`，真实游戏 Steam 读取另行实测。

- JSON 解析：nlohmann/json **3.12.0**，MIT；原始头文件和许可证保存在 `vendor/nlohmann`。
- D3D9 导出约定参考 [DXVK v2.6.1 导出表](https://github.com/doitsujin/dxvk/blob/v2.6.1/src/d3d9/d3d9.def)，转发实现独立编写。
- [Microsoft DLL 初始化最佳实践](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-best-practices)。
