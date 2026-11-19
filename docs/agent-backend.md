# pi 助手：后端接口与前端接入

> P0–P2 后端已实现。文件接口在 Pi 连接前可用；前端的 missing 分支继续兼容旧后端。
> 前端代码：`src/lib/agent/`（聊天）、`src/lib/pages/Settings.svelte`（设置页）、契约类型在 `src/lib/agent/host.ts` 与 `pi-protocol.ts`。
> 开发预览可加 `?mockpi` 用假 pi 看完整交互（`src/lib/agent/mock-pi.ts`，也是下面各命令返回形状的样例）。

## 接入摘要

- 配置位置沿用 Matcha 独立的 `<dataDir>/pi`，启动 CLI 时设置为 `PI_CODING_AGENT_DIR`；会话位于其 `sessions` 子目录。
- `compact` 的 Pi 等待时间为 300 秒，Tauri 外层为 330 秒；取消请求保持独立处理。
- 密钥、端点和默认设置文件采用 Pi 同协议文件锁与临时文件替换；设置 patch 保留其他字段和嵌套参数。凭据内容在响应与事件中隐藏。
- `pi-models-set` 保存后调用 `pi-reconnect` 更新模型清单。内置目录与自定义模型启动即可加载，本流程使用离线目录。
- `pi-settings-set` 更新启动默认值；当前会话的即时切换继续走 `set_model` / `set_thinking_level`。这两个 RPC 成功后后端补写默认值，思考强度保存 Pi 实际采用的值。
- 自定义端点表单可直接使用 `piHost.models()` / `piHost.saveModels(config)`；设置页现有端点区域仍留给前端实现表单。

最小检查：`node --test backend/pi/backend.test.mjs`。已用独立临时配置验证本机 Pi 1.4.0 的端点发现和重连持久化，未发起付费模型请求。

## Mod 整理技能

内置技能位于 `backend/pi/skills/matcha-mod-organizer/SKILL.md`。`PiTransport` 以 `--skill` 显式加载，保持 `--no-skills` 关闭其他来源的自动发现。用户可以直接说「整理新下载的 Mod，按用途归类」，也可以发 `/skill:matcha-mod-organizer 整理未分类的 Mod`。`get_commands` 返回实际加载的技能清单。

技能按需通过受限 `read` 工具读取随包的 SKILL.md。Mod 名称、目录、简介和工具结果作为待分析资料处理；启用的工具清单继续由 Matcha 固定选择。

- `mod_inventory` 在桌面模式补充当前分类树、收藏、新下载、来源页、当前游戏的方案引用和游戏运行状态。
- `mod_organize { moves: [{ modId, categoryId }] }` 归入已有分类；新分类使用 `{ modId, categoryName, parentId? }`。预览后由用户确认，保存时保留其他分类、层级、收藏、启停状态与方案草稿。
- `mod_delete { modIds }` 列明真实文件、分卷、大小、收藏及受影响方案，批准后移入回收站。
- `mod_trash {}` 查看回收站；`mod_restore { trashIds }` 还原文件、分类与方案草稿；`mod_purge { trashIds }` 单独确认永久删除。

桌面服务通过私有 Node IPC 处理这些请求，沿用同一个 Mod 元数据存储、串行队列和回收事务。执行前对照预览时的分类、目标文件和方案引用；变化时返回 `mod_plan_changed`，取消时撤销排队中的写入。文件操作沿用游戏运行检查和事务恢复。

针对性检查：`node --test backend/pi/mod-skill.test.mjs`（临时合成游戏目录与 VPK）。

### Mod 详情、获取流程和可撤销整理

- `mod_inspect { modId, offset?, limit?, prefix?, resource? }` 分页列完整包内资源，按需读取不超过 64 KiB 的文本配置/脚本。路径来自已选 Mod 的 VPK 索引。
- `mod_compare { a, b, offset?, limit?, prefix?, expectedVersion? }` 对同路径游戏资源逐字节核实，返回 `same/different`、各自独有资源与 nextOffset。翻页带 sourceVersion；部分页的 sameGameResources 为 null。作者介绍与封面按返回的 ignored 清单排除。
- `mod_mark { modIds, favorite?, sorted? }` 保留未指定的标记。收藏移出新下载；放回新下载时显式取消收藏。
- `mod_rename` 按当前游戏和 Mod ID 保存显示名；每个 items 条目可传完整 name、前缀 prefix，或传 name: null 恢复当前来源标题。支持批量预览和整理撤销。
- `mod_category` 维护已有分类：`rename` 用 name，`move` 用 parentId，`merge/delete` 可用 targetId 指定接收分类。删除分类会预览 Mod 与子分类去向，保留实际文件。
- `mod_profile_members { profileId, modIds, action: 'add'|'remove' }` 修改已有方案的 Mod 草稿，保留备注、DLL 选择与启动项。游戏当前启停状态继续沿用原值。
- `mod_source` 识别工坊/GameMaps 链接或 source/id；`mod_search` 使用已有来源搜索；`mod_download { items }` 预览、确认后进入现有任务队列。`mod_tasks { taskIds?, waitMs? }` 可等待最多 30 秒；`mod_task_control` 取消或重试。完成时用真实 modId/imported 继续归类与方案收纳。
- `mod_browser_downloads` 列出已完成的 VPK/ZIP，可按 downloadId 预览包内选择；`mod_browser_import` 沿用网页下载导入并保留来源。`mod_extract` 使用现有可取消解包任务与独立输出目录。
- `mod_history` / `mod_undo` 提供最近 100 次归类、标记、分类与方案成员调整的前后记录和撤销。记录与元数据一同原子保存在 Matcha 的 settings.json，重启后有效；仅恢复本次涉及的实体，检查后续修改、分类引用和 Mod 存在状态。原方案的自动推导/已初始化状态一并还原。

网络与任务等候使用各来源自己的队列，留出桌面元数据队列供下载完成提交；写入前继续检查用户确认、预览状态、游戏目录和取消信号。直接启停和本地 VPK 导入接口沿用既有含义。

针对性检查：`node --test backend/pi/mod-p1p2.test.mjs`。样本覆盖真实字节差异、分卷/不同 preload、跨重启撤销、层级合并、工坊和 GameMaps 下载到归类/方案收纳、网页 ZIP、解包与任务重试/取消。

## P0 · pi RPC 命令（`backend/pi/transport.mjs` 的 `COMMANDS`）

以下命令已放行：

| 命令 | 前端用途 | 备注 |
|---|---|---|
| `set_thinking_level` | 输入框「思考强度」、设置页 | 参数 `{ level }` |
| `get_available_thinking_levels` | 连接后探测可选强度 | 拒绝时整组控件置灰 |
| `compact` | `/compact`、用量弹层「压缩上下文」 | 调用 Pi 原生模型摘要，等待 5 分钟 |
| `set_auto_compaction` | 设置页「自动压缩」 | `{ enabled }` |
| `set_auto_retry` | 设置页「出错自动重试」 | `{ enabled }`；`abort_retry` 一并放行 |

已放行、前端已经在用：`prompt`（含 `images`）、`steer`、`follow_up`、`clear_queue`、`abort`、`get_state`、`get_messages`、`get_session_stats`、`get_available_models`、`set_model`、`new_session`、`set_session_name`、`switch_session`。

分叉相关的 `get_fork_messages`、`fork`、`clone` 也已放行。`export_html` 留待导出路径选择功能接入。

## P0 · 会话列表（pi RPC 没有列会话的命令）

### `pi-sessions` → `{ sessions: PiSessionInfo[] }`
流式扫描 `sessionDir` 下的 JSONL：解析头部、首条用户消息和 `session_info`，计数 message 记录。名称取最后一次更名，messageCount 包括文件内各分支的 message 记录；updatedAt 使用文件修改时间。消息正文和图片跳过 JSON 解码。

```ts
interface PiSessionInfo {
  path: string;          // 绝对路径，必须在 sessionDir 内（switch_session 要用）
  id: string;
  name?: string;         // set_session_name 写入的名字
  firstMessage?: string; // 第一条用户消息，截 80 字
  messageCount: number;
  createdAt: string;     // ISO
  updatedAt: string;     // ISO，前端按它倒序
  current?: boolean;     // 是不是当前打开的会话
}
```

### `pi-session-delete { path }` → `{ status: 'deleted' }`
删除前前端弹确认；后端移入 `sessions/.trash/<时间>-<随机ID>-<原文件名>`，原 JSONL 可移回恢复。当前会话返回 `session_current`；越界或链接路径返回 `SESSION_SCOPE`。会话切换与删除共用生命周期队列。

## P1 · 服务商与密钥（替代「去终端 /login」）

### `pi-auth-status` → `{ providers: PiProvider[] }`
列出常用的 anthropic / openai / google / deepseek / openrouter / github-copilot / google-gemini-cli / radius，并合并 `auth.json`、`models.json` 中的其他服务商及凭据状态。

```ts
interface PiProvider {
  id: string;            // auth.json / models.json 里的 provider id
  name: string;          // 显示名
  configured: boolean;
  source?: 'auth' | 'env' | 'oauth';  // 凭据来自 auth.json 的密钥 / 环境变量 / 订阅登录
  kind: 'api_key' | 'oauth' | 'both'; // oauth-only 的前端只提示去终端 /login
  keyHint?: string;      // 末 4 位，绝不回传完整密钥
}
```

### `pi-auth-set { provider, apiKey }` → `{ status }`
返回 `{ status: 'saved' }`，写进配置目录（`PI_CODING_AGENT_DIR`）的 `auth.json`。响应只带状态，状态查询最多显示密钥末 4 位。前端保存后调用 `pi-reconnect` 刷新可用模型；首次填入密钥时同样适用。

### `pi-auth-remove { provider }` → `{ status }`
返回 `{ status: 'removed' }`，只移除 `auth.json` 里该 provider 的条目。环境变量继续生效。

## P1 · 自定义端点（中转 / 本地模型）

### `pi-models-get` / `pi-models-set`
GET 返回 Pi 原生 JSON 对象，缺省为 `{ providers: {} }`；SET 参数和返回值都使用该对象，保存语义为完整替换。表单先 GET，再修改目标 provider 并 SET，保留其他 provider 和未知字段。

```ts
const current = await piHost.models();
if (current.ok) {
  current.value.providers.local = {
    baseUrl: 'http://localhost:1234/v1',
    api: 'openai-completions',
    apiKey: 'local-placeholder',
    models: [{ id: 'my-model', contextWindow: 32768, maxTokens: 4096 }],
  };
  await piHost.saveModels(current.value);
}
// 随后调用 pi-reconnect。
```

字面量 apiKey 自动存入 `auth.json` 的同名 provider 条目，`models.json` 通过 provider ID 使用该凭据。`$ENV` / `${ENV}` 引用沿用 Pi 原生语义。旧文件里的密钥、命令型密钥和 headers 以 `__FLARE_REDACTED__` 返回；SET 原样带回标记时保留原值。端点的模型 ID、上下文长度和 URL 在写入前校验。

## P2 · 默认值（pi 的 settings.json）

### `pi-settings-get` → `PiAgentSettings` / `pi-settings-set (patch)` → `PiAgentSettings`
```ts
interface PiAgentSettings {
  defaultProvider?: string; defaultModel?: string;
  defaultThinkingLevel?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
  autoCompaction?: boolean; autoRetry?: boolean;
  enabledModels?: string[];   // 模型列表里显示哪些
}
```
SET 参数直接使用 patch 字段。`autoCompaction` 映射到 `compaction.enabled`，`autoRetry` 映射到 `retry.enabled`；其他字段按原名保存。Pi 1.4.0 的模型 / 思考 RPC 仅写会话，后端现已补上成功后的默认值保存，重启和重连沿用上次选择。

## P2 · 工具清单

### `pi-tools` → `{ tools: { name, label, description, write, enabled }[] }`
从 `platform-extension.mjs` 的同一份工具定义生成，`--tools` 使用同源名称。`write` 表示工具有写入能力。玩家记忆工具只维护 Pi 自己的 Markdown；游戏文件、方案、插件等修改沿用各工具的确认流程。

## 桥接行为

1. **图片输入**：`prompt` 带 `images`（base64，单张 ≤ 5 MB，最多 4 张）。HTTP 和桌面 JSONL 请求上限均为 32 MiB，覆盖 4 张图片的 base64 膨胀；Pi 返回记录上限同步为 32 MiB。Tauri invoke 无额外的小请求体限制。
2. **事件透传**：前端已处理 `queue_update`、`thinking_level_changed`、`session_info_changed`、`compaction_start/end`、`auto_retry_start/end`、`message_update.usage`。现在 `pi_event` 是全量转发，保持即可。
3. **`pi-cancel`**：现在会 `clear_queue` + 取消所有确认框 + `abort`。前端的「停止」走这个，「清空排队」单独走 `clear_queue`，没问题。
4. **错误码**：未放行的 RPC 使用 `COMMAND_SCOPE`，未实现的桥接命令使用 `unknown_command`；前端靠这两个码显示「待接入」。文件类接口与 `pi-tools` 在连接前可用，在线 RPC 在断开时返回 `pi_disconnected`。无效配置返回 `pi_config_invalid` 并保留原文件。
