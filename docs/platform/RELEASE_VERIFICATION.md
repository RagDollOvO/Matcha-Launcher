# Beacon：从 SDK 工程到可核验的开发发布包

首版离线链路已经接通：**模板 → Pi 本地规则检查 → Windows Sandbox 双次构建 → 字节比较 → CMS 开发签名 → Core 安装 → Runtime 加载前核验**。

## 使用现成示例

- 工程：`native/examples/demo.hello/`，API 1、Windows x86、`render-init`。
- 签名包：`checks/.artifacts/beacon-demo-release-02/`。
- 外部开发信任策略：`checks/.artifacts/beacon-demo-trust-02.json`。
- 构建输入、工具链清单及客体日志：`checks/.artifacts/beacon-sandbox-01/`。
- 安装和真实原生宿主报告：`checks/.artifacts/beacon-release-check-kihI3U/report.json`。

这些路径均相对于 `D:\Launcher`。源码和当前桌面已发布包分别维护；本轮保留 `release/latest.json` 指向的桌面版本。

```powershell
cd D:\Launcher
node backend/cli.mjs check-project --plugin-dir native/examples/demo.hello
node backend/cli.mjs verify-release --plugin-dir checks/.artifacts/beacon-demo-release-02 --policy checks/.artifacts/beacon-demo-trust-02.json
```

开发证书有效期至 **2026-12-16 09:35:10 UTC**。私钥由签名进程临时生成并销毁；下次签名生成新证书，需重新确认对应指纹。

## 收取待核验工程

作者所需的 `manifest.developer` 字段、随包源码和许可证见 [DLL 模组开发规范 §9.2](DLL_SPEC.md#92-让发布包可核验)。此处记录维护者如何从固定输入生成和验证开发发布包。

示例在独立 CMake 工程里用 `BEACON_SDK_ROOT` 定位 SDK，固定 nlohmann/json 3.12.0；此次本地快照的 `commit: null`、`visibility: private`。公开推荐另需固定源码提交、可审查来源、独立复现、行为审核及实际兼容记录。

## Pi 负责发现接入问题

工具 `plugin_project_check({directory})` 经可信 UI 确认后，在本地读取 **manifest.json、plugin.cpp**。提供给模型的内容限于插件 ID、规则编号、字段或行号与固定规则提示。私有源码原文和构建脚本保留本地；进一步向模型提供源码时需重新取得范围授权。

机器报告包含 `kind/schemaVersion/rulesVersion/status/findings/scanScope`。主要规则：

- `SDK001/002`：ABI manifest 与源文件入口。
- `META* / SOURCE* / COMPAT* / CAP*`：作者、许可、源码提交、兼容环境及能力声明。
- `POLICY001`：明确拒绝项。
- `RISK001..004`：源码中跨进程操作、网络访问、外部执行/动态加载、Hook/内存修改调用的词法线索。

每条发现给出位置与 `error/warning`；敏感线索交维护者追踪真实用途。词法扫描覆盖指定文件，宏展开、依赖源码、混淆与运行时行为需要对应的审核证据。`ready-for-build` 表示接入规则允许进入构建阶段，行为审核保持 `pending`。

Pi 当前开放工程检查；隔离构建、信任策略变更和签名由维护者调用固定发布工具。既有 shell 禁用、自动发现关闭、写操作 UI 确认约束保持生效。

## 断网构建与比较

本机 Windows Sandbox 已启用，当前实际使用 llvm-mingw 20261104 / clang 23.1.5 / i686 Windows GNU。构建器复制明确输入，映射源码与工具链为只读；网络、剪贴板、音视频和打印重定向关闭；仅专用输出目录可写。客体执行平台固定脚本，构建两份 DLL 后自动结束。

```powershell
# 输出目录每次使用新名称，保留历史证据。
./scripts/beacon-sandbox-build.ps1 `
  -ProjectDirectory native/examples/demo.hello `
  -ToolchainDirectory .tools/llvm-mingw-20261104-ucrt-x86_64 `
  -OutputDirectory checks/.artifacts/my-build-01 -Run

# 等待 output/result.json 的 status 为 built 后再执行。
node scripts/beacon-prepare-release.mjs checks/.artifacts/my-build-01 checks/.artifacts/my-release-01
```

固定参数包含 C++17、x86、O2、静态运行库、无调试路径、禁用 PE 时间戳、固定源码路径映射和日期宏检查。`build-inputs.json` 固定 SDK、依赖头、源码、脚本及完整工具链文件摘要；宿主重新读取输入，并对两份 DLL 使用 Buffer 逐字节比较。发布清单记录全部交付文件的大小与 SHA-256。

两份产物来自同一个隔离构建任务的不同目录，报告标为 `repeated-byte-identical`；`independentReproduction: not-run` 留给另一维护者或独立构建环境。修改源码、依赖或编译参数后生成新构建与核验记录。

当前固定构建器支持单一 `plugin.cpp` 示例型工程。包含第三方构建系统或更多源码的项目，需要维护者先定义对应的显式输入和固定构建配方；陌生构建脚本仅在隔离环境评审后执行。

## 开发签名与信任策略

```powershell
# 使用 PowerShell 7；私钥只在此签名进程内存中存在。
./scripts/beacon-dev-sign.ps1 -PackageDirectory checks/.artifacts/my-release-01 `
  -TrustOutput checks/.artifacts/my-trust-01.json
```

发布包包含 `release.json` 与 CMS/PKCS#7 分离签名 `release.p7s`。签名覆盖 release 原始字节，release 再覆盖 manifest、入口 DLL、依赖 DLL、脚本及其它交付文件。`config.json` 为用户可变配置，`.l4p-package.json` 为平台安装账本，两者具有固定保留用途。

开发信任由包外策略显式指定证书 SHA-256 指纹、显示身份和 `channel: development`。核验器同时检查签名、证书有效期、预期指纹及撤销列表。包内证书只用于验签，信任身份来自外部策略。v1 实现仅接受开发通道；生产信任发布流程待维护者选择身份与密钥托管方式。

选型依据：已评估 [Cosign 的身份、签发者与信任根验证](https://docs.sigstore.dev/cosign/verifying/verify/)。当前离线 Windows 路径使用 [Windows CMS 验签 API](https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-cryptverifydetachedmessagesignature)，供后端与 x86 Runtime 共用同一实现。后续公共发布可加入 Sigstore bundle、固定 OIDC 身份/issuer 与信任根；届时独立定义生产策略。

## 安装、启用、撤销与恢复

对已安装新版 Runtime 的目标目录，用户确认开发证书来源后执行。新版具有 `L4P_RuntimeReleaseGateV1` 导出；旧版返回 `runtime_upgrade_required`，需先安排退出游戏后的 Runtime 升级。当前真实游戏与已发布桌面包保持原状。

```powershell
node backend/cli.mjs configure-release-trust --game-root "<目标游戏目录>" --policy "<已确认的策略文件>" --confirm
node backend/cli.mjs install-plugin --game-root "<目标游戏目录>" --plugin-dir "<发布包目录>" --confirm
node backend/cli.mjs enable-plugin --game-root "<目标游戏目录>" --plugin-id demo.hello --confirm
```

本轮命令实际消费离线 fixture。真实游戏的安装与启动由用户另行操作。

- 安装在源包、staging、最终目录分别核验；账本绑定精确 `releaseSha256`。默认停用，启用时检查依赖版本及状态。
- Core 启动预检与 Runtime `LoadLibraryExW` 前再次核验。剥离 release/signature、修改文件、增加未列文件、撤销或更换未授权签名均拒绝加载。失败项保留可见状态，支持停用。
- Runtime 锁住受管文件及目录，阻止已核验文件写入/替换。包内 DLL 使用平铺布局，静态 PE 导入递归覆盖全部清单 DLL；外部系统依赖限定 System32，预加载以固定搜索结果。检测已加载模块同名冲突；v1 受管包拒绝 delay-import 和嵌套 DLL。动态加载调用交行为审核核对。
- `revokedReleases` 填入 release SHA-256，`revokedSigners` 填入证书指纹。重新确认策略后，下次加载执行撤销；已映射 DLL 保持到游戏进程退出。
- 信任策略更新保留旧策略备份。`install-plugin` 遇到既有 ID 仍返回 `plugin_exists`。同 ID 更新走单独的 `update-plugin` 事务；旧包备份、配置和启停保留规则见 [DLL 模组开发规范 §9.1](DLL_SPEC.md#91-交付一个可直接导入的包)。
- 游戏运行时，安装、策略更新和启停操作返回进程保护错误，退出后由用户重试。客户端执行轻量本地核验，构建扫描留在发布侧。

本机信任策略、Runtime 与安装账本由平台和本机用户维护。已授权的原生 DLL可访问同进程资源；整个客户端信任目录被同权限恶意程序重写时，需要操作系统级保护与恢复。

## 核验状态交给前端分别展示

磁盘核验 `plugins[].verification` 和进程观测 `runtimeVerification` 的三种状态及对应文案见 [DLL 模组开发规范 §9.3](DLL_SPEC.md#93-在桌面上看到的状态)。快照还保留以下分项证据：

| 字段 | 显示内容 |
|---|---|
| `source.visibility/license/commit` | 源码可见性、许可、固定版本分别显示 |
| `build.status` / `independentReproduction` | 构建重复一致 / 独立复现待完成 |
| `signature/integrity` | 发布签名 / 安装文件完整性 |
| `behaviorReview.status` | 行为审核待完成 |

构建与源码等发布者声明标有 `evidenceOrigin: signed-publisher-statements`。公共推荐准入另待独立复现及维护者审查。当前没有 VAC 认证或联机实测结果。

用户已选择保留另一前端会话的所有权：本轮交付后端字段和 UI 文案，插件页视觉接入由该会话完成。

## 有效离线证据

- 两次隔离构建均为 **449,536 字节**，字节比较一致。
- Core 完成签名包安装、启用、账本绑定；旧插件仍显示未核验；缺少加载门禁的旧 Runtime 会拒绝受管包安装。
- x86 原生宿主实际调用 `hello`，返回 **Hello, Beacon!**，核验文件写入被拒绝。
- DLL、签名、签名元数据、其它清单文件被篡改，未列脚本、未知证书、撤销版本、剥离签名等情况均在插件映射前拒绝。
- Pi 接入检查的批准/取消路径通过；既有 JSONL 与 shell 禁用针对性检查通过。

检查脚本：`checks/beacon-release.mjs`、`native/tests/release_smoke.cpp`。机器报告记录每次 Runtime 状态和 `pluginMapped: false`。游戏加载、GPU/真实 DXVK、服务器兼容以及公共发布均保留相应后续验收。
