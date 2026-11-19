# L4P 平台核心

CLI、Pi CLI 扩展和桌面壳共用这套本地核心。需要 Node.js 22+，Core 本身使用 Node 内建模块，A2S 模块使用 GameDig 5.3.3（`npm ci --prefix backend`）。当前提供 Windows x86 自有平台的发现、首次部署与恢复、插件安装及启停、Runtime 状态与动作调用，以及直接游戏启动和 Steam 开发启动两种路径。

## 创建计划，再确认安装

从项目根目录运行。将 `$Game` 设为已下载的游戏根目录：

```powershell
$Game = 'D:\SteamLibrary\steamapps\common\Left 4 Dead 2'
node backend/cli.mjs inspect --game-root "$Game"
node backend/cli.mjs plan-install --game-root "$Game" --out install-plan.json
node backend/cli.mjs apply-install --plan install-plan.json --confirm
```

默认分发源为 `native/build-x86/dist`，可用 `--dist DIR` 指定。`--out` 新建纯计划 JSON 文件并保留已有同名文件。应用前重新核对游戏和分发物的文件身份，变化时要求重新生成并确认计划。

安装布局：

```text
<game>/bin/
├─ dxvk_d3d9.dll                    自有 shim，最后一步提交
└─ l4p/
   ├─ l4p_runtime.dll              自有运行时
   ├─ platform-state.json          状态与文件归属账本
   ├─ enabled.txt                  依赖拓扑排序后的启用 ID
   ├─ backend/dxvk.dll             从游戏原有入口复制的 DXVK
   ├─ backups/original_dxvk_d3d9.dll
   └─ plugins/<id>/
      ├─ manifest.json
      ├─ plugin.dll
      └─ config.json               可选，Runtime 初始化时读取
```

先独占创建 `bin/l4p` 并写入在途账本，再复制已验证文件，最后原子替换入口 DLL。原版 EXE 保持原样。游戏或 Bridge 运行时，部署、插件安装、启停和恢复返回 `game_running`。

未知的已有 `bin/l4p` 会返回 `existing_platform`。v0.1 支持首次安装和恢复；升级及恢复后的重新安装需要后续迁移。PE 检查只读取位数及导出表，实际 ABI 协商由 Runtime 完成。

## 恢复与在途操作

```powershell
node backend/cli.mjs restore --game-root "$Game" --confirm
node backend/cli.mjs recover --game-root "$Game" --confirm
```

`restore` 恢复平台拥有的入口，保留整个 `bin/l4p`、插件和个人配置。入口发生外部修改时返回 `external_change`；当前入口仍为自有 shim 时还会复核备份。准备阶段中断、原入口仍完整时，即使备份尚未复制完成也可完成恢复。

`recover` 处理在途安装、可确认归属的 staging、未提交的插件导入和已退出操作进程遗留的锁。目录归属变化、插件被外部启用或入口身份变化时，保留现场并返回 `recovery_required`。

## 插件包与依赖

```powershell
node backend/cli.mjs validate-plugin --plugin-dir '.\my-plugin'
node backend/cli.mjs install-plugin --game-root "$Game" --plugin-dir '.\my-plugin' --confirm
node backend/cli.mjs plugins --game-root "$Game"
node backend/cli.mjs enable-plugin --game-root "$Game" --plugin-id demo.hello --confirm
node backend/cli.mjs disable-plugin --game-root "$Game" --plugin-id demo.hello --confirm
```

导入后默认停用。启用时纳入已安装依赖，检查精确版本并生成有序 `enabled.txt`。停用仍被其他启用插件依赖的组件会返回 `dependency_missing`。DLL 生效时机为下一次完整启动。

清单固定 `schemaVersion:1 / apiVersion:1 / architecture:"x86" / phase:"render-init" / entry:"plugin.dll"`；导出为 `L4P_GetPluginApi`。ID 使用小写字母、数字、点、连字符、下划线，首尾为字母或数字，最长 64 字符，避开 Windows 设备保留名。版本及依赖版本使用精确的 `x.y.z`。

参数支持 `string / boolean / integer / number / enum`，约束键为 `maxLength / minimum / maximum / options`。动作参数拒绝未声明键并补默认值。配置声明包含 `id / label / default / apply`，`apply` 为 `immediate` 或 `next-launch`；通用配置写入 API 留待后续，当前由 Runtime 初始化时读取插件目录的 `config.json`。

## Runtime 状态与动作

对用户已启动并实际加载平台的进程使用：

```powershell
node backend/cli.mjs runtime-status --pid 12345
node backend/cli.mjs invoke --game-root "$Game" --pid 12345 --plugin-id demo.hello --action-id hello --args '{"name":"survivor"}'
```

写动作或 `requiresConfirmation:true` 的动作使用 `--confirm`。Core 校验清单、参数、启用状态和 PID 对应的游戏路径，再访问 `\\.\pipe\l4p.<pid>`。请求上限 64 KiB、响应上限 256 KiB，默认超时 5 秒，并检查响应 ID。

```js
inspectGame(gameRoot)
listPlugins(gameRoot)
runtimeRequest(pid, { type: 'status' })
invokePlugin({ gameRoot, pid, pluginId, actionId, args, confirmation })
```

管道调用成功返回 `{id,ok:true,result}`；失败抛出 `PlatformError`，包含 `code/message/details?`。确认值为 `{approved:true,source:'user'}`，由本机 UI、CLI 或 Pi 的用户确认交互产生，属于本机可信调用约定。具有副作用的调用失败后，由用户决定后续操作。

## Steam 发现与显式启动

```powershell
node backend/cli.mjs discover
node backend/cli.mjs discover --steam-root 'C:\Program Files (x86)\Steam'
node backend/cli.mjs launch --game-root "$Game" --mode modded --confirm
```

发现过程只读注册表、Steam 库索引和 `appmanifest_550.acf`。普通模组启动使用 `--mode modded`（L4N 平台启动），以选定游戏根目录为 cwd，直接运行该目录的 EXE，基础参数为 `-steam -novid`，使用游戏默认安全模式；需 Steam 已运行并登录。旧 `--mode direct` 使用相同的直启参数。CLI 省略 mode 时保留开发模式：先复核 AppID 550 的目标目录，再向 Steam 提交 `-applaunch 550 -insecure`。`--connect 域名:端口` 可用于这些路径。

Core `launch({ gameRoot, steamExe?, mode?, connect?, confirmation })` 返回 `status:"requested"`、实际参数、route 与 vacMode；直启还返回创建的 PID。实际持续运行、Runtime 初始化与服务器接入各自观测。启动函数使用独立进程及 argv 数组，错误直接返回，关闭 Matcha 保留游戏。直启使用 `game-default` 描述请求的安全模式。

## JSONL 服务与 Pi

运行 `node backend/cli.mjs serve`，stdin 每行一个请求，stdout 每行一个回执，操作串行处理：

```json
{"id":"inspect-1","command":"inspect","params":{"gameRoot":"D:\\Games\\Left 4 Dead 2"}}
```

成功回执为 `{id,ok:true,result}`，失败为 `{id,ok:false,error:{code,message,details?}}`。命令名与 CLI 相同；`apply-install` 使用 `params.plan`，确认信息放在请求顶层 `confirmation`。服务单条消息上限 1 MiB。

`backend/l4p.cmd` 为 Windows 入口，可设置 `L4P_NODE` 指向指定 `node.exe`。Pi 扩展及 transport 位于 `backend/pi/`，共用以上 Core exports。

## DLL 合集与旧平台安装账本

`availablePlugins` 返回随包独立 DLL；`plugins` 返回已安装 DLL。`presentation.catalog` / `collections` 由 Core 校验，形成大合集 → 小合集 → 功能层级；旧 `presentation.collection` 继续有效。`plugin-cover` 按层级读取包内声明封面。参见 [DLL 合集规范](../docs/platform/DLL_COLLECTIONS.md)。Skeeto 已转为源码拆分，整包适配 `distribution:source-ports` 只继续提供检测、停用、卸载和恢复。以下为旧整包协议记录。

Skeeto 的桌面快照位于 `platforms[]`，作者说明通过 `platform-doc { id, path }` 读取。对应 CLI：

```powershell
node backend/cli.mjs platforms --game-root "$Game"
node backend/cli.mjs platform-doc --game-root "$Game" --id skeeto --path 'Skeeto/README.txt'
```

适配描述位于 `backend/platforms/skeeto.json`，49 模块分类使用 `docs/platform/skeeto-modules.json`；下载、预览确认、安装账本、启停卸载、恢复和启动模块规则已接入 DesktopService。完整命令、任务事件、计划有效期及前端接法见 [Skeeto 实验契约](../docs/platform/SKEETO_EXPERIMENT.md#已交付后端与前端接法2026-11-16)。当前 `platformManagementVersion:1`、`platformManagement:true`；桌面确认流程与任务状态已接入。

受管安装的 Manifest 和说明从 Matcha 缓存读取。CLI / Pi 的共享启动入口先检查受管模块规则；需要设置变更时，由桌面预览确认。未接管平台的原入口保持原有使用方式。

## 验证范围

`node --test backend/tests/core.test.mjs` 使用临时合成 PE 与 mock pipe，覆盖部署恢复、外部改动与运行态拒绝、中断恢复、插件依赖及参数、管道错误路径和 Steam manifest 发现。

`checks/native-core.mjs` 使用自有 `l4p_smoke.exe` 离线宿主及项目内 fixture，已验证真实 x86 DLL 的安装、命名管道、示例动作与恢复。真实 L4D2 的 Steam 启动、DXVK 图形呈现和游戏内稳定性，等待游戏就绪后由用户授权实测。
