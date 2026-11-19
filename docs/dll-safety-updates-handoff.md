# DLL 后端交接：按需下载、SDK 更新、安全筛查

三个入口已接入桌面服务。玩家操作在 **DLL 模组**，开发者的更新声明和安全分档见 [DLL 规范 §9](platform/DLL_SPEC.md)，组件来源见[运行环境说明](platform/NATIVE_LIBRARIES.md)。

## L4N / DXVK：确认两次，分别管下载和游戏文件

1. `library-download-preview { id }` 返回 `planId, id, version, url, source, sizeBytes, sha256, target, license?`。便携包仅保留清单、许可及 Matcha 自身加载器。本版下载量为 L4N 2.58.0 **13,625,830 字节**、DXVK 3.1.1 **18,041,512 字节**。L4N 的功能说明来自该版本作者 README。
2. `library-download { planId }` 需要玩家确认，返回 `{ taskId }`。进度使用 `platform-download`、`native:l4n` / `native:dxvk`、`bytes`，校验解包期间为 `verifying`。只有通过 SHA-256 校验的原包才解到 Matcha 数据目录；大小或摘要错误会清理临时下载。
3. `objects_changed` 后刷新 `nativeLibraries`。`availability` 区分 `missing`、`downloaded`、`bundled`；`download` 提供缺少组件或高于已安装版本的发行资料。旧随包目录继续可用。启用仍走 `library-preview` → 单独确认 → `library-apply`。

## SDK：每天查元数据，玩家点更新才取附件

- 本地导入 SDK 时识别 `developer.updates: { type: "github-release", repo: "owner/name", asset: "matcha-x86-*.zip" }`；公开 GitHub 源码 URL 也可作为来源。玩家已经登记的 GitHub / 工坊来源继续沿用。
- `dll-updates-check {}` 返回 `{ checkedAt, updates }`。后台检查复用持久缓存和同仓库查询，遇 GitHub 限流遵守退避。已有来源检查失败会保留上次结果；手动检查会报告失败原因。
- `PlatformPlugin.update` 提供新版、发布时间、发布页、说明节选、附件大小、签名状态和检查时间。未发布证书资料时先报 `unknown`。发布者可在 ZIP 的 GitHub 附件 label 声明换签或未签名，见 DLL 规范。
- `plugin-update-fetch { id }` 需确认。`platform-download` 任务用 `plugin:<id>` 报进度；成品下载到暂存区后，核对包内 ID、版本、实际证书和安全检查。`sdk-ready` 返回 `intakeId, candidateId, updatePluginId`；非标准包交给茶茶核对。换签或由已签名变成未签名时，后端拦下一键更新并刷新签名状态。安装仍需预览确认。

## DLL：读取文件，给出能解释的判断

`IntakeResult.screening`、`IntakeImportPlan.screening`、`PlatformPlugin.screening` 和 `dll-screen { pluginId } | { intakeId }` 共用同一结构：`tier, rulesVersion, checkedAt, files[{path,sha256}], findings[{rule,severity,category,title,detail?,file?}]`。茶茶通过只读工具 `dll_screen` 或 `dll_package_inspect` 取得结果。

- **拦截**：跨进程注入的导入组合，凭据线索与联网组合，编码执行的 PowerShell 命令，以及签名或撤销核验失败。游戏目录写入前重新核对确认过的 DLL；准备好的候选被调换时也会停止。
- **需留意**：联网、单独的凭据线索、启动外部进程、可能的全局输入钩子、加壳 / 高熵 / 难以解析的导入。常见内存钩子列为说明，并给出对应文件及依据。
- 签名有效、闭源且无拦截或需留意项为 `closed`。公开且固定的源码、有效签名和与本次发布摘要绑定的独立复现、维护者审核证据齐全时为 `verified`。其余为 `unverified`。本版只做本地静态检查，未接第三方指纹信誉查询。

## 交付验证

离线使用真实 L4N / DXVK 压缩包做下载回放：校验错误时任务失败；两个正确归档均可解包，预览启用前游戏目录原样保留。SDK 用测试 Release 走通本地 ZIP 登记来源、元数据检查、暂存、确认及更新；两个临时证书签出的 SDK 版本实测会触发换签拦截。DLL 使用不可执行的 PE 数据验证「凭据 + 联网」拦截、「仅联网」提醒和确认后文件变化。以上均在隔离目录进行。
