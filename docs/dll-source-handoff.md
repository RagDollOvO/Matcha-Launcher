# DLL 来源接入：Agent 拉取与资料整理

> 2026-11-17。Claude 原交接中的来源读取、确认下载、资料合并与编辑、版本记录、详情页图片已接入后端。来源检查与更新由 Agent 推进。

> 面向作者的包布局、交付与同 ID 更新见 [DLL 模组开发规范 §9.1](platform/DLL_SPEC.md#91-交付一个可直接导入的包)。下文保留桌面和 Agent 共用的接入协议。

## 用户的决定

- 玩家只需提供来源：**GitHub 链接**、**创意工坊链接**或**本地文件**。由 Agent（pi）拉取、核对、整理成 Matcha 的展示资料。
- 本地来源先检查，按下文的 `outcome` 分流；完整作者页原样展示。资料缺项的[补充范围与来源标注](platform/DLL_SPEC.md#57-资料不全时)适用于同一模组的本地与远端接入。补充资料单独保存，玩家可手动编辑。
- 「更新」只做显示：记录来源，由 Agent 检查有没有新版本；后续怎么处理也交给 Agent。启动器不自动下载或替换文件。

## 前端已经做好的

- DLL 页「添加」按钮打开 `DllSourceDialog`，有 GitHub、创意工坊、本地文件三栏。
  - 点「交给 Agent 整理」后，`plugins/intake.ts` 生成一段指令发给 pi。模型没就绪时，指令先放进对话框。
  - 本地入口（2026-11-17 已接入）：选 ZIP / DLL / 文件夹后先调 `plugin-intake-inspect`，按 `outcome` 分三种结果卡：
    - `sdk-ready`：显示名称、ID、加载方式、文件数，「导入…」→ `plugin-intake-import-preview` → 确认框（宿主、目标目录、核验、完整文件清单、一并安装的随包依赖）→ `plugin-intake-import`。同 ID 已安装时，同一链路生成更新计划，显示新旧版本并保留设置和启停。
    - `needs-agent`：列出 `issues`，并用 `plugin-intake-details` 显示识别到的 DLL 接口；「交给 Agent 整理」直接发送后端返回的 `agent.prompt`。
    - `rejected`：列出问题，提示核对发行包，不给导入按钮。
  - `app.importPlugin`（随包功能的「安装」、详情页「导入新版本…」）遇到 `plugin_needs_agent` / `plugin_package_rejected` 时弹问题清单，可一键交给 Agent。详情页更新入口传入当前模组 ID；转交 Agent 的指令继续携带这个目标，完整 SDK 包同时核对目标 ID。
- 详情页：
  - 标题下显示资料出处：开发者提供 / Agent 整理 / 部分由 Agent 补充 / 手动修改；混合资料同时标出手动修改。
  - Agent 整理的页面顶部有一行提示，带「编辑」和「重新整理」按钮。
  - 右侧「来源」卡片：来源链接、接入时版本、来源最新版本（有 `latest.url` 时可点开发布页）、上次检查时间。
    - 远端来源：「让 Agent 检查新版本」让 Agent 用 `dll_source_record` 重新读取并记录；有新版本时变成「让 Agent 看看改了什么」，用 `dll_source_fetch`（`refresh: true`）读发布说明，先不下载。
    - 本地来源：不显示检查时间，提示选新压缩包导入。桌面版在本地来源或有新版本时显示「导入新版本…」，走 `validate-plugin` → `update-plugin`。
  - 「编辑资料」对话框可修改简单字段，保存时调用 `plugin-overlay-save`。
- 功能行按实际资料显示「Agent 整理」「手动修改」和「来源有新版本」标签。

### 前端反馈的同 ID 更新缺口（已修复）

- `plugin-intake-import-preview` 发现 Matcha 同 ID 已安装时，返回 `operation: 'update'`、`previousVersion`、`version` 与原 `enabled`。首次导入返回 `operation: 'install'`、`previousVersion: null`、`enabled: false`。
- `plugin-intake-import` 按预览计划走 `core.updatePlugin` 或 `core.installPlugin`。更新返回实际保留的 `enabled`、`previousDirectory` 与 `operation: 'update'`；配置、启停、独立数据及手动补充资料保留，旧包完整备份。
- Agent 的 `dll_package_import` 与前端 `app.importIntake` 共用这份计划：更新确认显示「从 vX 更新到 vY」、原启停状态和备份说明。本地 ZIP 入口已移除旧的同 ID 绕行，随包目录与详情页维护入口继续兼容 `validate-plugin` → `update-plugin`。
- 更新计划在 Core 文件锁内复核原包身份、版本与启停状态；确认期间有其他更新或开关变化时返回 `plugin_update_stale`，重新预览确认。首次导入继续默认停用，游戏运行时的文件保护沿用原事务。

## 后端已接通的接口

### 本地包检查与 Agent 整理（已就绪，供前端接入）

玩家只选择文件/来源并确认结果。整理过程使用 `<数据目录>/dll-intake/<intakeId>/`；`original/` 保存原始暂存资料，`prepared/` 保存派生候选包，作者原压缩包和文件保持原样。

`plugin-intake-inspect { file }` 静态检查标准 ZIP、DLL 或已有目录，返回：

```ts
{
  intakeId: string;
  outcome: 'sdk-ready' | 'needs-agent' | 'rejected' | 'prepared'; // prepared 由 Agent 整理工具返回
  files: { path: string; bytes: number }[];
  issues: { code: string; message: string; file?: string }[];
  candidateId?: string; preparedDirectory?: string;
  agent: { available: boolean; label: '交给 Agent 整理'; prompt: string };
}
```

- `sdk-ready`：单个 SDK 包、声明、x86 主 DLL/接口导出及声明素材通过检查。允许 ZIP 外包一层目录，作者包内容保持原样。
- `needs-agent`：列出真实缺口，例如 `plugin.dll` 或封面缺失、多个模组混在一起、整体 DLL 需要核对宿主。按钮将 `agent.prompt` 交给已有助手入口；模型未配置时沿用指令暂存方式。
- `rejected`：路径、链接、重复文件、加密或压缩数据损坏等问题。保持原文件与游戏目录原样，先核对发行来源。

原 `validate-plugin { pluginDirectory }` 兼容 SDK 目录，并新增 ZIP；成功仍返回 `manifest`、`verification`、`preparedDirectory`，附带 `intakeId` 和 `candidateId`。需 Agent 时抛出 `plugin_needs_agent`，`error.details` 为上述检查结果。裸 DLL 的旧自动封装入口已转交 Agent。

直接导入可用 `plugin-intake-import-preview { intakeId, candidateId }` 显示目标游戏、宿主及最终文件清单；用户确认后调用 `plugin-intake-import { planId }`。首次导入默认停用；同 ID 更新保留配置与启停。实际写游戏前检查游戏已退出。旧 SDK 目录的 validate → install/update 维护入口继续兼容。

Agent 的包接入工具：

| 工具 | 行为 |
|---|---|
| `dll_package_inspect` | 用 `file` 或 `intakeId` 读取暂存清单、缺失项、README/manifest 节选和静态 DLL 接口 |
| `dll_package_prepare` | 按 `{ source, target }` 清单只复制已检查文件；`sdk` 保留作者 manifest，`library` 保留已有整体加载声明或生成新的接入描述，`l4n` 保留单个子插件原名。普通 DLL 更新可传 `updatePluginId` 绑定已有整体加载模组 |
| `dll_package_import` | 核对候选版本，显示文件及宿主；Matcha 同 ID 已安装时显示新旧版本。用户确认后复用现有安装/更新事务，首次导入默认停用，更新保留配置与启停 |

Agent 可重排已经存在的真实文件、带齐配套 DLL/资源/配置并生成独立 DLL 接入描述。主 DLL 真正缺失时，回来源核对完整发行包；签名清单和 SDK 接口身份沿用作者约定。L4N 多文件包需先核对具体宿主与布局，现有子插件入口接收原名单 DLL。

GitHub/工坊附件确认下载后自动进入同一检查链路，返回 `intake`；后续整理与导入沿用上述工具。图片单独返回暂存路径，可作为补充封面。

补充资料先由 Agent 展示拟补内容和依据；导入成功取得模组 ID 后，再用 `dll_overlay_write` 确认保存。远端导入自动附上实际下载来源，完整作者资料无需再整理。

#### 普通 DLL 更新使用原身份

先用 `dll_inventory` 读取已安装目标，再调用：

```js
dll_package_prepare({
  intakeId: "新包检查返回的 intakeId",
  mode: "library",
  updatePluginId: "清单中已安装的 library 模组 ID",
  mappings: [{ source: "feature.dll", target: "plugin.dll" }]
})
```

后端核对目标的宿主、安装归属、原包版本和所属游戏目录。对于 Agent 生成接入声明的普通 DLL，沿用原 ID 和声明；来源包有作者 manifest 时须一并保留且与目标同 ID。作者声明的模组继续使用完整同 ID 发行包更新。

候选返回 `updatePluginId`，后续 `dll_package_import` 走已有更新事务，保留启停、`config.json`、独立数据和手动资料，旧包完整备份。作者的 ini/cfg 等自带配置按其安装说明核对迁移要求。接入声明的 `0.0.0` 保持原值，真实 Release 或工坊时间在来源记录中保存；确认框附上来源版本变化。同一暂存记录重复生成新接入包时保持其生成 ID。

目标在整理后被更新、移除或切换游戏目录时，候选会报告具体错误并要求重新核对。确认期间的版本、原包身份和启停变化继续由 Core 更新事务复核。

### 1. 快照字段

`PlatformPlugin` 新增两个字段，类型定义见 `src/lib/types.ts`：

```ts
source?: {
  type: 'github' | 'workshop' | 'local';
  url?: string; label?: string;          // label：owner/repo、工坊标题、目录名
  version?: string;                      // 接入时的版本；工坊用 time_updated 的 ISO 时间
  checkedAt?: string;
  latest?: { version?: string; publishedAt?: string; url?: string } | null;
};
provenance?: {
  fields: Partial<Record<'name'|'author'|'summary'|'description'|'tags'|'modes'|'hotkeys'|'cover'|'links', 'developer'|'agent'|'user'>>;
  basis?: string;                        // 例如「GitHub README 与 v1.6.0 Release 说明」
  updatedAt?: string;
};
```

`presentation`、`name`、`author` 直接返回**合并后**的值。合并优先级：

- 用户手动修改（user）最优先；
- 其次是开发者 manifest（developer）；
- 开发者没写的字段，才用 Agent 补充的（agent）。

`provenance.fields` 记录每个字段最终采用了哪一层。

### 2. 补充资料存储

实际保存在 `<Matcha 数据目录>/plugin-overlays/records.json`。以模组 ID 为键，支持 L4N 的不透明 ID；文件锁与原子写入保护并发编辑。封面副本保存在同目录的 `assets/`，作者包保持原样：

```json
{ "version": 1, "plugins": {
  "author.feature": {
    "source": { … }, "publisher": { … }, "basis": "…", "updatedAt": "…",
    "agent": { "summary": "…", "tags": ["…"] },
    "user":  { "summary": "…" }
  }
} }
```

字段长度沿用 `validatePresentation` 和 `src/lib/plugins/page.ts` 的限制：简介 160 字、说明 12000 字、标签 8×24 字、快捷键 8 条。整体 DLL 由后端生成的接入描述注明 Agent 来源；资料登记失败时，查询仍按声明中的 `intake.preparedBy` 保留 Agent 出处，资料可单独重试。后续同 ID 更新提供作者声明时，字段转由开发者层保护；用户手动修改继续优先。

### 3. 命令 `plugin-overlay-save { id, fields }`

- 由界面上的「编辑资料」调用，写入 `user` 层。
- `fields` 结构为 `{ name, author, summary, description, tags, modes, hotkeys: [{keys, label}] }`。
- 空字符串表示清除这个字段的用户修改。
- 保存后通过 `objects_changed` 刷新快照；与原值相同的字段保留原出处。

### 4. pi 平台工具（已注册于 `backend/pi/platform-extension.mjs`）

| 工具 | 读/写 | 作用 |
|---|---|---|
| `dll_inventory` | 只读 | 输入 `{id?}`。与 DLL 页共用 `DesktopService.dllSnapshot`，返回当前游戏和加载器、`plugins`、`availablePlugins`、`l4nPlugins`、`nativeLibraries`、`issues` 与检查时间。资料按 user → developer → agent 合并，附字段出处、已登记发布者和资料登记警告；保留加载阶段与 Windows 错误。查询只读取 DLL 相关范围。 |
| `dll_source_fetch` | 读；下载到暂存区时需要确认 | 输入 `{type, url \| path, refresh?}`。**GitHub** 返回仓库信息、README、Release 说明、附件和图片清单；支持指定 Release/附件链接。**工坊** 返回标题、描述、`preview_url`、`time_updated`、`filename`、`creator`、`file_url`。本地来源返回文件树、manifest、静态 DLL 接口与说明。再次传 `{sourceId, assetId}`，确认后下载到 `<数据目录>/dll-sources/<随机名>/`，二进制附件返回本地检查的 `intake`。 |
| `dll_overlay_write` | 写，需确认 | 输入 `{id, fields, basis, sourceId?}`，补充 `agent` 层；作者已填写的不同值会被拒绝。`sourceId` 绑定真实来源与发布者。来源变更单独提示，确认期间发生编辑则重新预览。 |
| `dll_source_record` | 写 | 输入 `{id, sourceId?}`，复用真实检查结果；省略 `sourceId` 时重新读取已登记来源。只更新 `latest`、`checkedAt`，保留接入版本。兼容 `latest`、`checkedAt` 参数，其中版本须匹配真实结果，时间采用实际检查时间。 |
| 导入 | 已有本地接入工具 | 标准 SDK ZIP 直接校验；其他来源先用 `dll_package_inspect`、`dll_package_prepare` 整理，再由 `dll_package_import` 给用户确认。 |

### 5. Agent 技能说明

内置技能为 `backend/pi/skills/matcha-dll-organizer/SKILL.md`，随 pi 启动加载，并可用受限 `read` 工具读取。入口覆盖已有清单读取、成品附件选择、四种检查结果、三种宿主整理、资料补充、显式绑定普通 DLL 更新、版本解读、加载排障和异常续办。前端添加来源仍使用 `intake.ts` 的简短指令。

导入回执的 `metadataWarning` 表示文件事务已完成、来源资料仍需处理。Agent 使用原 `id` / `pluginId` 单独修复资料；以实际 `sourceId` 确认保存后，DLL 查询清除对应警告。用户取消的步骤按取消收尾，阶段过期或文件变化重新检查后再确认。

### 6. 两个来源的注意点

- **工坊**：不订阅，用 `file_url` 直接下载，做法和 L4N 现有流程一样（`scripts/fetch-native-libraries.mjs`）。订阅会把文件放进 `addons/workshop`，被游戏当作 VPK 挂载。
  - 工坊没有版本号，用 `time_updated` 判断有无更新；
  - 发布者用 `creator` 锁定。
- **GitHub**：公开资料缓存 5 分钟；主动检查更新传 `refresh: true`。下载计划有效期 15 分钟，每次使用单独确认。网络访问复用现有系统/社区加速通道。
  - 用 Release 标签作来源版本；下载按附件 ID 定位。作者公布 `sha256` digest 时核对完整性，缺少 digest 时明确返回 `not-published`；
  - 锁定仓库 ID 与所有者 ID，工坊锁定条目与 `creator`。变化时交给用户确认；
  - 下载及重定向逐跳检查来源域名，文件留在暂存区，实际导入另行确认。

实现入口：`backend/dll-sources.mjs`（来源）、`backend/plugin-overlays.mjs`（资料）、`backend/plugin-assets.mjs`（图片）、`backend/pi/dll-tools.mjs`（Agent 工具）。来源检查按用户请求执行，游戏内加载与设置逻辑沿用现有实现。

## 本次交付状态

2026-11-17 的本轮源码补齐了 `dll_inventory`、普通 DLL 更新目标绑定、详情页更新目标转交，以及扩展后的 DLL skill。定向离线检查使用隔离游戏目录与静态 PE，覆盖合并资料和加载证据读取、普通 DLL 原 ID 更新、旧包及设置保留、目标失效、取消和资料登记失败后的独立修复。本段变更随下次桌面打包带入，下面保留前一次便携包的交付记录。

后端与现有详情页的图片、来源展示、手动编辑保存已在隔离目录联调。工坊实读取得 L4N 条目的来源资料；GitHub 实连触发公共 API 限流，返回 `source_rate_limited`，额度恢复后可由 Agent 重试。GitHub 下载、资料合并与来源版本链路使用隔离响应完成针对性检查。

来源接入后端已随 2026-11-17 合版进入桌面便携包；ZIP 选择、问题清单与 Agent 转交已接入。同 ID 更新修复与确认框适配通过定向检查、页面联调与包内 Node/Agent 工具检查，已生成便携包 `Flare-0.1.0-20261117T171056Z`。自动切换桌面入口受到执行策略拦截，现有快捷方式仍指向上一包；关闭旧 Matcha 后打开新包内的 `Flare.exe` 使用。
