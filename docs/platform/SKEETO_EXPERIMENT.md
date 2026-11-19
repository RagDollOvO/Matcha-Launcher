# Skeeto 接入实验：决策记录与旧整包协议

> claude（前端）起草，交 codex 实现后端部分。标「待核实」的是我从 Skeeto 仓库文档推断的，codex 读它的安装脚本后以实际为准。

## 当前方向：源码拆分（2026-11-16）

用户最新决定为保留现有整包，继续按 Beacon SDK 全量拆分功能并接入 Matcha，每个模块独立启停。当前执行文档为 [源码拆分接入](SKEETO_PORT.md)，作者格式为 [DLL 合集规范](DLL_COLLECTIONS.md)，49 项进度为 [skeeto-ports.json](skeeto-ports.json)。整包下载、安装、重新启用已撤下，现有安装状态保持，清理与恢复入口继续保留。

以下记录原整包实验与兼容恢复协议。

## 原实验目标

Skeeto（https://github.com/regoists/Skeeto，GPL-3.0）是一整套客户端增强平台，功能很多，但安装、启停、卸载、更新、说明各走各的：自己的 `Setup_安装 维护 卸载.bat` 和 `Maintain.ps1`，自己的 `bin\wininet.dll` 代理加载，自己的创意工坊自更新，自己的游戏内菜单。

实验目标：**不改 Skeeto 一行代码**，由 Matcha 给它套上统一的三件事，并把做法沉淀成以后所有外部平台包通用的格式。

- **入口**：安装、启用，经 Matcha 确认，可预览。
- **出口**：停用、卸载，能完整恢复安装前的状态。
- **页面**：用插件页同一套结构展示（标题区、核验状态、能力与联机、模块、说明文档、更新渠道）。

原预览阶段记录（2026-11-16，后续已发生安装，当前见 SKEETO_PORT.md）：`E:\SteamLibrary\steamapps\common\Left 4 Dead 2` 下尚未安装 Skeeto。用户已确认下载与安装预览，2.2.19 已保存到 Matcha 缓存；真实安装等待清单确认。

## 已核实的安装布局（上游 2.2.19）

| 项 | 内容 |
|---|---|
| 加载 | `bin\wininet.dll` 代理（Manifest role `proxy`），核心 `skeeto.dll`（role `core`）。不经过 Beacon |
| 文件清单 | 包内 `Skeeto\Manifest.json`：`semver`、`install_layout`、`requires_manual_migrate`、`files[]`（`relative` / `role` / `hash`=sha256）；`document` 角色允许省略 hash。当前官方安装只部署 `core/proxy/plugin`，另复制更新日志，随后清理游戏里的 Manifest、VERSION、工具和说明文档 |
| 发布 | GitHub Release 资产 `Skeeto_<版本>.zip`，2.2.19 的资产大小为 1,902,251 字节 |
| 自更新 | 创意工坊 3787239937，格式 zip-as-vpk，内含 `SKEETO_WORKSHOP.txt`（`SkeetoWorkshopPackage=1`、`engine_sha256`）。DLL 征得同意后运行包里的 `Maintain.ps1` 安装 |
| 外部程序 | cache host exe 嵌在 DLL 里，启用后解压到 LocalAppData 并启动 |
| 设置 | 游戏根目录 `skeeto_setting.ini`；`plugin_platform` 为插件平台开关，`workshop_update` 为工坊自更新开关。源码默认值分别为关闭、开启；子插件数据在 `left4dead2\skeeto\plugins\<id>\` |
| 子插件 | `bin\skeeto\plugins\`，Skeeto Plugin API 1.x，默认关闭 |
| 说明文档 | 包内 `Skeeto\README.txt`、`Skeeto\Commands.txt`、`Skeeto\DIY\*.txt`、`Skeeto_更新日志.txt` |
| 卸载 | 官方卸载保留设置和自定义资源，提示取消工坊订阅 |

## 适配描述（Matcha 维护，以后可请作者随包提供）

Skeeto 没有 Matcha 的 manifest，实验期间由 Matcha 自带一份适配描述。现放在 `backend/platforms/skeeto.json`；以下为简化格式（路径均相对游戏根目录）：

```json
{
  "schema": 1,
  "id": "skeeto",
  "name": "Skeeto",
  "kind": "external-platform",
  "source": { "repo": "https://github.com/regoists/Skeeto", "license": "GPL-3.0", "visibility": "public" },
  "release": { "type": "github-release", "asset": "Skeeto_{version}.zip" },
  "detect": { "manifest": "Skeeto/Manifest.json", "version": "VERSION.txt" },
  "loader": { "kind": "proxy-dll", "file": "bin/wininet.dll" },
  "settings": { "file": "skeeto_setting.ini" },
  "update": { "channel": "steam-workshop", "workshopId": "3787239937", "marker": "SkeetoWorkshopPackage=1" },
  "subPlugins": { "dir": "bin/skeeto/plugins", "switch": { "file": "skeeto_setting.ini", "key": "plugin_platform" } },
  "docs": [
    { "title": "使用说明", "path": "Skeeto/README.txt" },
    { "title": "控制台命令", "path": "Skeeto/Commands.txt" },
    { "title": "插件平台", "path": "Skeeto/DIY/Plugins_插件平台.txt" },
    { "title": "更新日志", "path": "Skeeto_更新日志.txt" }
  ],
  "modules": "见 skeeto-modules.json"
}
```

模块清单已由 claude 拆好：[skeeto-modules.json](skeeto-modules.json)，说明见下文「模块拆分」。

## 阶段 1：只读（先做，不写游戏目录）

### 后端已接入（2026-11-16）

`backend/platforms/skeeto.json` 是实际适配描述，模块分类直接读取本目录的 `skeeto-modules.json`。当前基于上游 `2.2.19`、提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c` 核对安装脚本与设置读取代码；各开关键保存了源码位置。

- 桌面 `snapshot.platforms`、`platform-doc { id, path }` 已实现；CLI 提供 `platforms --game-root DIR`、`platform-doc --game-root DIR --id skeeto --path Skeeto/README.txt`。
- 49 个模块中，34 个定位了完整关闭键组，14 个只定位了部分设置，生涯档案按需打开页面、独立持久总开关待定位。8 项 `review` 分类保持原清单。`switchable` 依据完整键组，阶段 2 后端接口版本为 `capabilities.platformManagementVersion: 1`。Claude 已接入确认流程，桌面整合版开启 `platformManagement:true`。
- `modules[].stateSource='saved-settings'` 表示读取已保存设置。`switches[]` 附 `key / value / off / source`，`switchCoverage` 为 `complete / partial / unknown`。完整键组均为各自 `off` 值时显示 `off`；发现开启键显示 `on`；缺失键、冲突重复键或部分映射全关时显示 `unknown`。布尔键 `value` 为 boolean/null，`valueType: integer` 的键为 number/null。本地 lerp 的关闭值为 -1，空中加速的原版值为 10。
- 官方安装缺少 Manifest 时，通过 x86 PE 导出识别加载文件，从核心内 `SkeetoInstalledSemver=` 标记读取版本；完整性显示 `unknown`。有清单时，`integrity.scope='manifest-hashed-files'` 仅汇总声明了哈希的条目；文档未声明哈希时保留 `hash_not_provided` 原因。代理 `owned` 仍严格依据清单哈希。
- 文档只读取适配描述中精确列出的游戏相对路径，返回 `{text}`，上限 1 MiB；缺失返回 `platform_doc_missing`。官方安装后说明文档可能已清理，前端按 `docs[].present` 展示可读项。Matcha 管理的安装从已校验缓存读取说明；实际已缓存的声明文档才标为可读。
- `3787239937.vpk` 或带有效 `SKEETO_WORKSHOP.txt` 标记的 ZIP 标成 `platform-package`，排除资源重叠、默认 Mod 草稿和快速测试地图候选。普通 Mod 应用保留此包原有 addonlist 条目；直接启停返回 `platform_package_readonly`。损坏的已知工坊包显示更新包警告。
- 运行态读取目标游戏进程的模块列表；读取失败保留 `loaded:null` 与问题记录。同时加载 Beacon 时显示共存提醒，游戏内兼容性待实测。

检查：`node --test backend/tests/platforms.test.mjs` 的针对性离线检查通过。本机游戏目录只读扫描结果为 Skeeto 未安装、代理入口空闲、工坊包缺失。阶段 2 后端已实现，接口与离线验收见下一节；真实游戏安装另按清单确认，阶段 3 按原安排另排。

依据：[维护脚本](https://github.com/regoists/Skeeto/blob/7a18b4988d089fdf6cc7e857560cf82a9609a32c/packages/Skeeto-dev/Skeeto/Maintain.ps1)、[设置与开关读取](https://github.com/regoists/Skeeto/blob/7a18b4988d089fdf6cc7e857560cf82a9609a32c/src/skeeto/core/skeeto_proxy.cpp)、[核心版本标记](https://github.com/regoists/Skeeto/blob/7a18b4988d089fdf6cc7e857560cf82a9609a32c/src/skeeto/core/skeeto_workshop.cpp)。

### snapshot 新增 `platforms[]`

```ts
interface ExternalPlatform {
  id: string;                      // 'skeeto'
  name: string;
  kind: 'external-platform';
  installed: boolean;
  managed?: boolean;             // 有 Matcha 安装账本
  pendingOperation?: boolean;    // 中断事务待恢复
  version: string | null;          // 已安装版本
  state: 'not-installed' | 'enabled' | 'disabled' | 'broken';
  source: { repo: string; license: string; visibility: 'public' | 'private' | 'closed' };
  identity: { verified: boolean; claimed: string };          // 实验期没有签名：verified=false
  verification: { state: 'unverified' | 'verified-development' | 'rejected'; error?: { message: string } };
  loader: {
    kind: 'proxy-dll';
    file: string;                  // 'bin/wininet.dll'
    present: boolean;
    owned: boolean;                // 哈希和该平台 Manifest 的 proxy 一致
    foreign?: string;              // 位置被别的代理占用时，说明是什么
  };
  integrity: {
    state: 'match' | 'mismatch' | 'unknown';               // 对照作者自己的 Manifest.json
    scope: 'manifest-hashed-files' | 'managed-deployed-files';
    files: { path: string; role: string; ok: boolean; reason?: string }[];
  };
  runtime: { loaded: boolean | null };                      // 运行中的游戏进程是否映射了 skeeto.dll；无游戏为 null
  update: {
    channel: 'steam-workshop' | 'flare' | 'none';
    workshopId?: string;
    selfUpdate: boolean | null;    // Skeeto 自更新开关，读不到为 null
    packagePresent: boolean;       // addons/workshop/<id>.vpk 是否存在
    packageVersion?: string;
  };
  subPlugins: { platformOn: boolean | null; items: { file: string; name?: string; version?: string }[] };
  modules: {
    id: string; name: string;
    kind: 'cosmetic' | 'self-info' | 'intel' | 'input' | 'bypass' | 'local' | 'system' | 'loader' | 'update';
    online: 'any' | 'no-versus' | 'local-only' | 'blocked' | 'review';
    touches: string[];
    state: 'on' | 'off' | 'unknown';      // 从 Skeeto 自己的设置里读出来；读不到为 unknown
    switchable: boolean;                   // Matcha 找到了能关它的开关
  }[];
  docs: { title: string; path: string; present: boolean }[];
  coexist: { beacon: 'ok' | 'warn' | 'unknown'; note?: string };
  issues: { code: string; message: string }[];
}
```

### 命令

- `platform-doc { id, path }` → `{ text }`：只允许读适配描述 `docs[]` 里列出的路径，给前端当作者页面显示（纯文本，前端不执行任何内容）。

### Mod 扫描

- 识别创意工坊 zip-as-vpk 平台包（`addons/workshop/3787239937.vpk`，或包内有 `SkeetoWorkshopPackage=1`）：`mods[]` 里标 `kind: 'platform-package'`、`platformId: 'skeeto'`，不报「解析失败」，不参与资源路径重叠。普通方案应用保留它原有的 addonlist 条目。

## 阶段 2：入口和出口（写操作，全部要确认）

共同要求：游戏运行时拒绝；先给预览计划再执行；有备份；写安装账本；进度走 task 事件；失败能回滚。

| 命令 | 作用 |
|---|---|
| `platform-check-update { id }` | 查 GitHub Release 最新版本，返回版本号、发布时间、更新日志摘要。只提示，不自动下载 |
| `platform-download { id, version }` | 用户点「更新」或「安装」后，从固定的 `github.com/regoists/Skeeto` Release 下载 zip 到 Matcha 缓存，走 task 进度 |
| `platform-preview-install { id, version }` | 读已下载的 zip，按包内 Manifest 校验哈希，返回计划：要写的文件、是否会替换已有 `bin/wininet.dll`（属于谁）、`requires_manual_migrate`、大小 |
| `platform-install { id, planId }` | 按计划复制文件、写账本。**不运行**包里的 bat / ps1；`requires_manual_migrate=true` 时拒绝，提示用 Skeeto 自己的安装器 |
| `platform-set-enabled { id, enabled, planId }` | 停用前备份当前入口，再移除或还原原代理；启用从校验缓存恢复。接管已有同源 Skeeto 时，停用移除入口，卸载恢复安装前的入口 |
| `platform-uninstall { id, planId }` | 只删账本里记录的文件；保留 `skeeto_setting.ini` 和自定义资源；提示是否还订阅着工坊更新包 |
| `platform-set-self-update { id, enabled, planId }` | 改游戏根目录 `skeeto_setting.ini` 的 `workshop_update`。Matcha 管理期间关闭，更新走 Matcha 提示与用户确认 |

出口的验收标准：安装 → 卸载之后，游戏目录和安装前逐文件一致（用户设置除外）。

更新流程：Matcha 发现新版本只提示，用户选「更新」才下载；也可以留在当前版本。Matcha 管理期间关闭 Skeeto 自己的工坊自更新，避免两条更新路线打架。

### 已交付后端与前端接法（2026-11-16）

实现位于 `backend/platforms/{releases,lifecycle,transactions,settings,launch}.mjs`，桌面命令由 `backend/desktop/service.mjs` 暴露。Skeeto 源码保持原样。CLI 的 `platforms`、`platform-doc` 也能读受管安装；写流程使用桌面桥接。

**下载、预览、确认分开调用：**

1. `platform-check-update {id:'skeeto'}` → `{version,publishedAt,summary,url,asset,installedVersion,updateAvailable,verification}`。只读 GitHub 发布元数据，空发布说明返回空字符串。
2. 用户选择下载后，`platform-download {id,version}` + 确认 → `{taskId}`。从固定仓库的公开 Release asset API 获取二进制，只接受 GitHub 官方资产 CDN 跳转。完成后才开放安装预览。[GitHub 接口依据](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)。
3. `platform-preview-install {id,version}` → 计划。前端显示文件、已有代理、大小、模块调整、迁移要求与“未核验”。
4. 用户确认此计划后，`platform-install {id,planId}` + 确认 → `{taskId}`。该接口使用计划内的精确版本。

启停、卸载、自更新和恢复先调用 `platform-preview-operation {id,operation,enabled?}`。`operation` 为 `set-enabled`、`uninstall`、`set-self-update`、`recover`；对应执行命令均携带返回的 `planId`，启停和自更新同时携带原 `enabled`。管理期间只接受 `set-self-update enabled:false`。

确认放在桥接请求顶层：`confirmation:{approved:true,source:'user'}`，沿用现有确认交互。计划只在当前服务进程内有效，最长 15 分钟；文件、设置、账本或连接上下文改变时重新预览。旧写任务的 `task-retry` 返回 `platform_plan_required`；下载任务可重试。

普通计划字段：

```ts
{
  planId, id, gameRoot, operation, params, revision, version, enabled,
  requiresManualMigrate, sizeBytes, packageBytes?,
  loader?: { file, occupant: 'absent'|'skeeto'|'foreign-unknown', replaced },
  files: [{path, action:'create'|'replace'|'remove'|'backup', before, after, sizeBytes}],
  modules: [{id, name, reason, changed}], warnings: string[],
  verification: {state:'unverified'}
}
```

`before/after` 是用于预览一致性和恢复的 SHA-256，缺失文件为 null；`backup` 为保存现有同内容文件的恢复基线。恢复预览返回 `recovery:{transactionId,status,files:[{path,before,after}]}`。`requiresManualMigrate:true` 的计划可展示，执行返回 `platform_manual_migrate`。版本尚未完成开关键适配时，安装预览明确列出“安装后停用”；启用等待适配更新。

**任务与快照：**

- `kind` 为 `platform-download`、`platform-operation`、`platform-launch`。继续消费 `task_progress`；下载单位 `bytes`，写入单位 `files`。提交开始后 `cancelable:false`。完成或失败发 `objects_changed`，刷新平台状态。
- 受管安装 `managed:true`、更新渠道 `flare`；中断时 `pendingOperation:true`，恢复入口优先显示。受管完整性检查实际部署的文件，`integrity.scope='managed-deployed-files'`；停用代理的文件记录标 `location:'cache'`，核对缓存内代理，加载入口 `owned:false`。
- 账本、事务备份与包缓存分别在 Matcha 数据目录 `platforms/installs/<安装ID>/`、其 `transactions/`、`platforms/cache/skeeto/<版本>/`。桌面版的数据目录为 `%LOCALAPPDATA%\com.matcha.launcher`，开发版默认 `%LOCALAPPDATA%\Matcha`；`BEACON_DATA_DIR` 可显式指定。CLI 自动寻找这两处的活动账本，发现重复归属时提示检查。
- 安装写 `skeeto.dll`、`bin/wininet.dll`、更新日志与设置；Manifest、工具和其余作者文档保存在缓存。包内工具只按清单核对。卸载恢复受管文件的安装前副本，保留设置、自定义资源与未纳入账本的子插件。
- 2.2.19 的真实 Release 使用未置 UTF-8 标记的 GBK 文件名；适配描述的 `release.legacyZipNameEncoding:'gb18030'` 用于这类条目，带 UTF-8 标记的条目按 UTF-8 解析。中央目录与本地头使用相同编码规则，路径限制和文件哈希检查照常执行。校验失败的完整下载保留在 `download-<ID>/` 并附 `rejection.json`，供诊断；有效版本目录只接收校验通过的包。

**首页和服务器页接启动预览：**

调用 `platform-preview-launch {mode,profileId,serverId?}`。无受管 Skeeto 返回 `required:false`，沿用原启动流程；`required:true` 时显示 `modules.filter(m=>m.changed)` 与 warnings，确认后向原 `launch` / `connect-server` 传 `platformPlanId:planId` 和同一 mode、profileId、服务器 id。这种启动返回 `{taskId}`；收到任务完成的 `status:'requested'` 后开始观测游戏 PID。

服务在执行时重新用现有 A2S 查询服务器，目标地址或模式变化即要求重新预览，先于任何 Mod 方案写入。禁止模块总关闭；非回环地址关闭本地专用模块；对抗、清道夫关闭情报模块；未识别的远端模式也按情报关闭处理。34 个完整映射已覆盖这些规则涉及的全部模块。8 项 `review` 分类保持待定。

CLI / Pi 经过共享 Core 的只读启动检查；需要改设置时提示回 Matcha 确认。快速测试的隔离环境排除 wininet 代理，环境版本升为 4；现有运行中的游戏和旧测试目录保留。

**交付与验收：**

- 针对性离线检查通过：安装→停用恢复原代理→启用→升级→卸载逐文件恢复（设置除外），同源入口接管，损坏清单、越界路径、外部修改、游戏运行、失败回滚、中断恢复、A2S 变化、原直启入口及快速测试隔离。
- 用户已确认下载与预览，真实 2.2.19 包共读取 31 个清单文件，其中 7 个声明哈希的文件全部匹配。`requires_manual_migrate:false`；真实游戏入口空闲。预览将新增 `skeeto.dll`、`Skeeto_更新日志.txt`、`skeeto_setting.ini`、`bin/wininet.dll`，共 5,060,261 字节，关闭 AAC 与工坊自更新。清单保存在 `%LOCALAPPDATA%\com.matcha.launcher\platforms\cache\skeeto\2.2.19\flare-install-preview.json`。这份文件用于阅读；执行时重新生成并核对当前计划。真实安装与游戏内兼容性观察分别等待确认，核验状态仍为 `unverified`。
- Claude 的确认框、任务状态与首页 / 服务器启动预览已接入。Codex 整合恢复计划的独立结构、中文模块调整原因及中断事务检查，开放 `capabilities.platformManagement:true`，协议版本为 1。

## 模块拆分

Skeeto 菜单里有 936 个设置项、24 个分组，但分组是按菜单位置分的，同一组里混着不同性质的东西。比如 Skeetoscript 一组里，既有弹壳落地音，也有半自动连发和反作弊对抗。claude 按「这个功能对联机公平性有什么影响」重新拆成 49 个模块，每个模块只属于一类：

| 类别 | 模块数 | 联机 | 例子 |
|---|---|---|---|
| 外观与音效 `cosmetic` | 16 | 任何服务器 | 命中反馈、准星、持枪视角、主菜单背景、自定义 ESC 菜单 |
| 自身与队友信息 `self-info` | 6 | 任何服务器 | 弹药与道具 HUD、队友血条、击杀统计、生涯档案 |
| 额外情报 `intel` | 11 | 对抗类停用 / 待定 | 导演压力、特感仇恨、Tank 行为预测、物资雷达、穿墙描边 |
| 改变输入 `input` | 3 | 只在本地 / 待定 | 半自动连发、霰弹枪自动换弹、第三人称弹道修正 |
| 绕过限制 `bypass` | 2 | 禁止 / 只在本地 | 反作弊对抗（AAC）、强制修改受限 Cvar |
| 本地服 `local` | 2 | 只在本地 | Tick 与 lerp、调试可视化与传送 |
| 稳定性与加载 `system` | 6 | 任何服务器 | 防闪退、缓存搬运、加载提速、性能预设、菜单与帮助 |
| 加载第三方代码 `loader` | 2 | 待定 | Necola 联动、插件平台 |
| 更新渠道 `update` | 1 | — | 创意工坊自更新 |

分类依据是菜单名、帮助文字和命令说明；开关键读取和关闭值另行对照源码。标 `review` 的 8 项等用户拍板。

### codex 要做的

1. **找到每个模块的开关**：对照 `skeeto_setting.ini`、`Commands.txt` 里的 ConVar 和命令，给每个模块填 `switches`（ini 键或 cvar），能读出当前开关状态。找不到开关的模块标 `switchable: false`。
2. **启动前按规则关模块**（游戏未运行时改 ini，改前备份）：
   - `blocked`：Matcha 管理期间一律关闭。
   - `local-only`：通过 Matcha 连接非本地服务器时关闭。
   - `no-versus`：连接的服务器是对抗、清道夫模式时关闭。服务器模式用服务器页已有的 A2S 数据。
   - 启动前把这次关掉了哪些模块列给用户看。
3. **限制要写明**：Skeeto 是一个整体 DLL，Matcha 只能通过它自己的开关去关模块；玩家进游戏后自己换服或手动打开，Matcha 管不到。真正合规要靠作者把 `input`、`bypass` 类模块拆成单独的 DLL，或者在合规版里直接编译掉。

## 给 DLL 作者的模块规范（v0，从 Skeeto 实验里总结）

每个功能是一个模块，模块要做到：

1. **一个模块只做一类事**：外观、信息、输入、绕过限制不能混在同一个模块里。例如 AAC 不能是连发功能里的一个子选项，它本身就是一个模块。
2. **声明**：id、名字、用途、`kind`、`touches`（hooks / memoryRead / memoryWrite / input / filesystem / network / externalPrograms / loader）、联机范围。
3. **有自己的开关**，关掉它不影响别的模块；平台能在启动前读写这个开关。
4. **设置存在自己的命名空间**，不和别的模块混在一个键里。
5. **禁止项不进合规版**：反作弊对抗、替玩家操作这类模块，平台可以要求作者提供不含它们的构建。
6. 平台据此给每个模块显示联机范围，并在启动时按服务器模式自动开关。

## 阶段 3：核验（以后，另排）

- 沙箱里准备 MSVC x86 工具链（现在是 llvm-mingw），用 `/Brepro` 和固定工具链版本复现 `skeeto.dll`、`wininet.dll`，对照 Release 资产。
- 作者身份：请作者用 GitHub Actions 签名发布（Sigstore），信任列表绑定 `regoists/Skeeto` 的发布流程。
- 每版审核只审与上一个已核验版本的差异。
- 在核验接上之前，Skeeto 一律显示「未核验」，完整性一栏只说明「文件和作者清单一致」。

## 前端（claude）这边

阶段 1 已接上真实接口（2026-11-16）：

- 插件页底部「外部平台」分组：Skeeto 卡片显示状态、核验徽章和按联机范围统计的模块数，点开进入详情（`app.platformOpen`）。
- 当前详情（`src/lib/components/PlatformDetail.svelte`）展示标题、核验状态、加载入口、文件完整性、更新渠道、子插件和检测提示；48 个功能模块按联机范围分组，另有 1 个更新模块由 Matcha 管理。开关状态来自已保存设置；说明经 `platform-doc` 按纯文本显示。
- 安装 / 启停 / 卸载等入口使用阶段 2 的计划确认流程；后端管理能力关闭时禁用。
- Mod 页：`kind: 'platform-package'` 显示「平台更新包」，没有方案开关，不进方案、不参与启用和停用筛选，右键和详情里都能跳到插件页的 Skeeto。

阶段 2 已接上（2026-11-16，claude）：

- 插件页改成左列表 + 右详情；游戏目录、Beacon 部署、DXVK 收进「运行环境」对话框。
- Skeeto 详情：打开时 `platform-check-update`（store 缓存 10 分钟）；按状态给出「安装… / 交给 Matcha 管理… / 更新到 vX… / 启用 / 停用 / 卸载… / 恢复中断的操作」，受管且自更新还开着时给「关闭工坊自更新」。进行中的 `platform-download` / `platform-operation` 任务在详情里显示进度，不进 Mod 任务托盘。
- 安装：先预览；返回 `platform_download_required` 时先确认下载、等任务完成，再预览一次并确认计划。`requiresManualMigrate` 只展示、不执行。启停、卸载、自更新、恢复都是 `platform-preview-operation` → 确认 → 带 `planId`（和原 `enabled`）执行 → 等任务 → 刷新。
- 计划确认框沿用全局确认框，新增两列清单：游戏目录里的变化、模块调整、恢复文件；`warnings` 放在提示块里。
- 启动和连接服务器：有 `managed` 平台时先 `platform-preview-launch`，模块调整列进原确认框，再把 `platformPlanId` 传给 `launch` / `connect-server`，等 `platform-launch` 任务完成后进入「已请求」。预览报错直接提示，不启动。
- 前端同时检查 `capabilities.platformManagement:true` 和 `platformManagementVersion >= 1`；恢复计划独立读取 `recovery.files`，安装与启动计划读取 `files/modules/warnings`。
- 验证：5173 预览里真实走到「下载 Skeeto 2.2.19」确认框后取消；安装计划、启动预览两个确认框用样例数据看过渲染。没有下载、没有写游戏目录，真实安装等用户自己点。

## 已定（2026-11-16）

1. 安装和更新由 Matcha 从 `github.com/regoists/Skeeto` 的 Release 下载；有新版本只提示，用户选择是否更新。
2. 目标是让 DLL 作者把每个功能封装成独立模块。Skeeto 的模块拆分见 [skeeto-modules.json](skeeto-modules.json)。
3. Matcha 管理期间关闭 Skeeto 自己的工坊自更新（由第 1 条推出，用户可以推翻）。

## 还要用户决定

`skeeto-modules.json` 里 `online: "review"` 的 8 个模块：优化听声辨位、减少画面干扰、聚光灯夜视、感染者模型缩放、无声特感补发提示音、霰弹枪自动换弹、Necola 联动、插件平台。
