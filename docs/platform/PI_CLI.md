# Pi CLI 接入

平台以独立子进程运行 Pi CLI，通过 stdin/stdout 上的 JSONL RPC 连接助手界面。当前适配依据本机 **Pi 1.4.0** 文档与真实启动结果。

## 入口与配置

- `backend/pi/transport.mjs`：Node 调用方使用的 `PiTransport`。
- `backend/pi/host.mjs`：供 Tauri/Rust 父进程调用的 JSONL 外壳。
- `backend/pi/platform-extension.mjs`：显式加载的可信平台扩展。

`nodePath`、`piEntry`、`configDir`、`gameRoot` 使用绝对路径。`cwd` 默认是 `configDir/workspace`，`sessionDir` 默认是 `configDir/sessions`。启动端为每个选定游戏目录创建对应 transport；切换游戏目录时结束旧 transport 后创建新实例。

下面使用一个离线 fixture 游戏目录举例；正式接入由用户选择游戏目录：

```json
{
  "nodePath": "C:/Users/Administrator/AppData/Local/Programs/nodejs/node.exe",
  "piEntry": "C:/Users/Administrator/AppData/Local/Programs/nodejs/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
  "configDir": "C:/Users/Administrator/AppData/Local/L4P/pi",
  "gameRoot": "D:/L4P-fixtures/game"
}
```

可选项：`cwd`、`sessionDir`、`session`（已保存会话的绝对路径）、`ephemeral`（内存会话）、`requestTimeoutMs`（默认 15000）、`shutdownTimeoutMs`（默认 5000）。`session` 和 `ephemeral` 互斥；恢复会话路径需位于配置的 `sessionDir` 内。

运行时单独设置 `PI_CODING_AGENT_DIR` 与 `PI_CODING_AGENT_SESSION_DIR`。CLI 显式加载平台与本机工具扩展，以及 Mod、DLL、服务器和体检四份内置技能；启用工具由 `platformToolCatalog` 提供。自动发现和自动网络刷新保持关闭；用户发起对话时仍按配置调用模型。

需要核对安装说明、解压整包或编辑指定文件时，茶茶可以使用 `local_ls/find/grep/read/write/edit`（每个名称均以 `local_` 开头），以及 `local_powershell`（Windows）和 `local_bash`。终端接受完整命令和可选绝对工作目录。每次本机调用先在茶茶窗口展示工作目录与参数并请求确认，结果随对话交给所选模型。游戏或 Bridge 运行期间可读文件，终端命令和游戏文件写入等退出后执行。`read` 仍专供随包技能。

模型和登录信息由这个独立 Pi 配置目录管理。在相同 `PI_CODING_AGENT_DIR` 下启动交互式 `pi`，使用 `/login` 登录、`/model` 选择模型；也可使用提供方环境变量。Matcha 助手面板显示实际配置目录和重新连接入口。凭据通过 Pi 的认证机制配置，配置 JSON 只包含运行路径与会话选项。

## 玩家记忆

玩家说「记住：新下载的 Mod 先给我看分类预览」时，Pi 可用 `player_memory_edit` 自行保存这条长期偏好。更正时传旧条目与新条目，忘记时传旧条目和空的新条目。`player_memory_read` 返回当前条目。原条目与磁盘不一致时，重新读取再编辑。

第一次进入会话时，扩展在当前 `configDir` 里用随包模板创建 `MEMORY.md`，已有文件沿用。每行以 `- ` 开头的是一条偏好，玩家也能用文本编辑器修改。每次模型请求前，Pi 读取最新版并把条目作为参考资料带入上下文；新建、恢复会话或重开应用都使用同一份文件。记忆随对话发送给所选模型，适合存放分类和命名等长期约定。游戏检测结果取实时清单，密钥由原有认证配置管理。

## Node 调用

先订阅事件，再启动和发出请求：

```js
import { PiTransport } from './backend/pi/transport.mjs';

const pi = new PiTransport(config);
pi.on('event', event => sendToFrontend({ type: 'pi_event', event }));
pi.on('diagnostic', diagnostic => appendDiagnostic(diagnostic.text));
pi.on('fault', fault => showFailure(fault));
pi.on('exit', exit => showProcessState(exit));

const state = await pi.start();
await pi.prompt('查看已安装插件及其依赖');
// 用户点击确认框后：
await pi.answerUi(dialogId, { confirmed: true });
// 用户点击“停止”：
await pi.cancel();
// 退出助手或应用：
await pi.close();
```

`request(type, params)` 返回 Pi 命令回应中的 `data`。`prompt` 的回应表示已接收、排队或处理；界面用 `message_update` 拼接文字，用 `message_end` 替换完整消息，用 `agent_settled` 表示这一轮已稳定结束。模型失败与中止从事件流中的消息状态显示。

运行期间提交新消息时，传入 `pi.prompt(text, { streamingBehavior: 'steer' })` 或 `'followUp'`。会话可用 `get_state`、`get_messages`、`new_session`、`set_session_name`、`switch_session` 管理；`get_available_models` 与 `set_model` 对接模型选择器。

`record` 事件包含所有原始 Pi 记录，`event` 仅转发非命令回应。工具事件保留原始字段供界面呈现。`cancel()` 顺序执行清空待处理消息、取消等待中的对话框、终止当前工作。`close()` 先以 stdin EOF 请求正常退出，超过截止时间只结束该实例拥有的 Pi 子进程。

## Tauri / Rust 调用

用隐藏子进程启动以下固定入口，配置路径作为单独 argv 参数传入：

```text
node.exe D:\Launcher\backend\pi\host.mjs <绝对配置文件路径>
```

父进程持续读取 stdout，一行一个 JSON 对象；stderr 是单独的诊断流。JSONL 仅按 LF 切分，保留 JSON 字符串内的 Unicode 分隔符。

主机启动完成：

```json
{"type":"ready","state":{"sessionId":"...","isStreaming":false}}
```

前端动作经 Rust 转为以下主机命令，`id` 用于关联回应：

```json
{"id":"ui-1","type":"command","command":"prompt","params":{"message":"检查插件状态"}}
{"id":"ui-2","type":"ui_response","dialogId":"pi-dialog-id","answer":{"confirmed":true}}
{"id":"ui-3","type":"cancel"}
{"id":"ui-4","type":"close"}
```

主机输出：

```json
{"type":"response","id":"ui-1","success":true,"data":{"disposition":"started"}}
{"type":"pi_event","event":{"type":"extension_ui_request","id":"pi-dialog-id","method":"confirm","title":"执行插件动作","message":"目标和参数"}}
{"type":"pi_event","event":{"type":"agent_settled"}}
{"type":"pi_exit","code":0,"signal":null,"expected":true}
```

错误回应的 `error` 包含 `code` 和 `message`。异常进程退出会同时产生 `pi_exit`，主机以非零状态结束；界面保留已经收到的内容并提供重连入口。重连时使用最近 `get_state` 返回的 `sessionFile` 创建新实例。

`extension_ui_request` 中的 `confirm/select/input/editor` 显示交互控件，用户实际操作后回传 `ui_response`。取消用 `{"cancelled":true}`；选择或输入用 `{"value":"..."}`。`notify/setStatus` 等事件按通知或状态呈现。

## 业务工具与确认回执

| 工具 | 模型参数 | Core / 宿主调用 |
|---|---|---|
| `platform_inspect` | 空对象 | `inspectGame(gameRoot)`、`listPlugins(gameRoot)` |
| `runtime_status` | `pid` | `runtimeRequest(pid, { type: 'status' })` |
| `dll_inventory` | 可选 `id` | `DesktopService.dllInventory`，与 DLL 页共用合并资料及加载状态读取 |
| `dll_source_fetch` | `type`、`url` / `path`；下载用 `sourceId`、`assetId` | 来源检查；确认后暂存下载，二进制进入 DLL intake |
| `dll_package_inspect` | `file` / `intakeId` | 静态读取暂存包和 DLL 接口 |
| `dll_package_prepare` | `intakeId`、`mode`、`mappings`；普通 DLL 更新用 `updatePluginId` | 暂存整理；显式绑定已安装普通 DLL 的原 ID 和游戏目录 |
| `dll_package_import` | `intakeId`、`candidateId` | 预览并确认安装或更新，复用已有事务 |
| `dll_overlay_write` | `id`、`fields`、`basis`、可选 `sourceId` | 确认后独立保存 Agent 资料及来源 |
| `dll_source_record` | `id`、可选 `sourceId` | 记录真实来源最新版本和检查时间 |
| `server_inventory` | 可选 `serverIds`、`groupId`、`favorite` | 同一 ServerManager 的缓存、类别和当前启动上下文 |
| `server_query` | `serverIds` | 有界探测队列，返回所选条目的实际状态 |
| `server_add` | `items` | 预览地址规范化、重复及错误，确认后批量添加 |
| `server_update` | `updates` | 按提供字段确认修改备注、收藏和连接端口 |
| `server_organize` | `moves` | 确认后移入已有或自定义类别，保留其他顺序 |
| `server_category` | `action` 及相应类别参数 | 新建、重命名、排序、删除类别；默认保留成员 |
| `server_remove` | `serverIds` | 列明地址、收藏、类别影响后确认移除 |
| `server_connection` | `serverId` | 只读刷新连接命令和端口依据，启动由用户在页面确认 |
| `plugin_invoke` | `pid`、`pluginId`、`actionId`、`args` | `invokePlugin(...)` |
| `mod_inventory` | 空对象 | `ModManager.scan(gameRoot)` |
| `mod_set_enabled` | `modIds`、`enabled` | `ModManager.setEnabled(...)` |
| `mod_import` | `file` | `ModManager.preview(...)`、`import(...)` |
| `plugin_project_check` | `directory` | 可信 UI 确认范围后，本地读取 manifest.json/plugin.cpp，返回固定接入规则及风险线索位置 |

`gameRoot` 在进程启动时绑定。`plugin_invoke` 先调用 `ctx.ui.confirm` 显示游戏目录、PID、插件、动作与完整参数。扩展收到用户批准并确认调用仍有效后，才构造 `confirmation: { approved: true, source: 'user' }` 交给 Core。模型工具 Schema 只接受表中参数。

Core 负责 manifest、依赖、动作参数与实际运行时校验；原生运行时负责动作分发。取消确认会返回 `applied: false`。Mod 写工具同样经过用户确认，备份 addonlist.txt 并检查游戏进程；游戏启停与 DLL 部署由各自的用户操作入口负责。

Pi 命令层提供会话、模型、对话与取消的固定清单；原始 shell 执行命令会返回 `COMMAND_SCOPE`。Pi 进程及其扩展按当前用户权限运行，扩展代码由平台随版本交付。

## 本轮针对性检查

```text
node D:\Launcher\backend\pi\smoke.mjs
```

该脚本使用假的 Pi 子进程，覆盖启动隔离、分块 UTF-8 JSONL、请求 ID 关联、UI 取消、shell 命令拒绝、正常 EOF、异常退出和取消插件调用。临时 fixture 位于系统临时目录。

已另外用本机 Pi 1.4.0 完成真实 `get_state` 启动握手：返回空闲会话，stderr 为空，以退出码 0 正常关闭。上述检查使用离线 fixture，模型计费调用和游戏运行验证留给各自的实际使用步骤。

`platform_inspect` 已实际消费共享 Core 的离线 fixture，返回 x86 游戏信息、`restored` 部署状态及 `demo.hello` 插件清单；这一步只读取 fixture 文件。

本地依据：Pi 安装目录下的 `docs/rpc.md`、`docs/rpc-commands.md`、`docs/rpc-extension-ui.md`、`docs/cli.md`、`docs/environment-variables.md`。
