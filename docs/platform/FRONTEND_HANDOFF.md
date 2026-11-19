# 前端接入：Matcha 与 Beacon

现有 Svelte 界面已接入共享 Core 和 Pi CLI。页面布局、Scene、音效与字体保留。底层内部命名 `l4p` / `L4P_*` 保持兼容。

## 实际入口

- `src/lib/api/index.ts` → `bridge.ts` → `backend/desktop/service.mjs`。
- 桌面入口：Tauri `beacon_call` → `backend/desktop/host.mjs`，隐藏 Node 子进程。
- 浏览器开发入口：Vite 同源 POST + SSE adapter，调用同一份 DesktopService。
- Pi：`agent/index.ts` 已使用 `CliPiTransport`，再连接 `backend/pi/transport.mjs`。

业务命令包括 snapshot、select-game、plan-install、apply-install、restore、recover、validate-plugin、install-plugin、set-plugin-enabled、invoke、launch，以及 Pi 的连接、重连、取消、命令与确认回执。

## 页面状态与能力开关

snapshot 返回 game、runtime、dxvk、plugins、profiles、capabilities、issues 和 checkedAt。runtime.connected 和插件 runtimeState 来自管道；enabled 表示下次完整启动使用的配置。DXVK 已初始化来自 factory 观测。

- VPK / A2S capability 已开启；CFG 为 false，导航显示待接入。
- VPK 草稿保存与 addonlist.txt 观测分开；apply-mod-profile 备份并应用，launch 先应用所选 VPK 草稿再启动。资源重叠显示具体路径，玩家可停用一方。CFG 尚未应用。
- 写操作显示确认与执行中状态，收到成功回执后刷新持久状态。
- launch 返回 requested。前端随后观测实际 PID；45 秒仍未发现进程时提示检查 Steam。
- `snapshot.launch` 提供实际启动方式与参数；`set-launch-mode` 单独保存到 `launch.json`。首页与服务器页共用 LaunchMode 控件。确认后传入捕获的 mode：`direct` 直启原游戏 EXE，`development` 保留 Steam `-insecure` 路由。服务器 VAC 标记仅在开发模式限制连接按钮。
- 游戏运行时部署、导入、启停和恢复操作锁定；Core 仍负责最终进程检查。

## 插件动作

插件页按 manifest 显示 ID、版本、API、架构、依赖和运行状态。PluginActions 按 actions.parameters 生成 string / boolean / integer / number / enum 控件。Core 校验范围、默认值与 Unicode 字符数量。结果保留 requestId；写动作和 requiresConfirmation 动作先请求用户确认。

通用插件 config 写入尚未开放；已有插件可声明动作操作配置。Runtime 初始化仍读取 config.json。

## DLL 合集与 Skeeto 源码移植

插件页采用大合集 → 开发者自定义小合集 → 功能 → 功能详情。`presentation.catalog` 定义大合集，`presentation.collections` 声明小合集归属，功能详情显示开发者正文与操作；`availablePlugins` 提供随桌面包附带的功能。实际独立 DLL 为 `skeeto.crosshair` 与 `skeeto.career`；49 项移植进度自动计数。`PluginActions` 消费可选 `flare.report.v1` 结果，`PluginReport` 统一显示分组数值；原 JSON 结果继续有效。用户要求全量拆分，现有整包先保留。详见 [DLL 合集规范](DLL_COLLECTIONS.md) 和 [移植进度](SKEETO_PORT.md)。

## 旧 Skeeto 整包清理协议

`distribution: source-ports` 撤下整包获取和重新启用。现存安装保留停用、卸载、恢复；原接口说明继续用于清理。

### 原阶段 2 的接口记录

后端 API 版本 `capabilities.platformManagementVersion:1` 已交付。接口、确认参数、任务 kind、快照新增字段与启动接法统一维护在 [Skeeto 契约](SKEETO_EXPERIMENT.md#已交付后端与前端接法2026-11-16)。桌面整合版已接通安装 / 启停 / 卸载 / 恢复确认框，以及首页与服务器页的启动模块预览；`platformManagement:true` 已开放，前端同时检查总开关与协议版本。恢复预览使用独立的 `recovery.files` 结构。

受管 Skeeto 的 `launch` / `connect-server` 返回任务 ID；在任务完成的 `status:'requested'` 后观测 PID。其他启动仍沿用原有即时回执。显示计划里的 changed 模块、代理占用、文件动作、warnings 和未核验状态；失败按 error.code 展示重新预览或恢复入口。

## Pi 事件

CliPiTransport 负责从主机封装中提取 pi_event，并把失败回应转换为可显示消息。Chat 按 role 处理消息，用 message_end 校准最终内容；工具状态按原 toolCallId 关联。确认、选择和输入控件独立于工具卡，确认回执成功后更新状态。

get_state / get_messages / get_available_models 用于连接后的初始化。new_session 成功后才清空聊天；取消清空队列与待确认请求。断开保留可见消息并显示重新连接入口。真实工具命名与模型登录方式见 [Pi 接入](PI_CLI.md)。

## 下一步接入位置

### 发布核验状态（2026-11-16）

用户确认本会话只交付接口，`src/` 继续由原前端会话维护。DesktopService snapshot 的插件对象新增 `verification`（当前磁盘核验）和 `runtimeVerification`（进程加载观测），`error` 带具体失败原因。状态、字段含义和推荐文案见 [发布核验手册](RELEASE_VERIFICATION.md#核验状态交给前端分别展示)。现有 Pi 确认框可消费 `plugin_project_check`，无需新增 shell 能力。

请在插件详情分别展示源码/许可、构建重复一致/独立复现、签名/完整性、行为审核和兼容环境；列表显示“本地开发 · 未核验”“开发签名已核验”或“加载核验失败”。保留实际错误及停用入口。当前插件页已接入核验状态徽章、实际错误和启停入口；上述分项证据详情仍待前端后续完善。

VPK 的共享实现位于 `backend/mods/`，DesktopService 暴露 preview-mod、import-mod、apply-mod-profile。A2S 位于 `backend/servers/`，数据契约与命令见 [服务器接入](SERVERS.md)，前端调用 `api/servers.ts`。CFG 后续沿用共享服务路径。继续遵循保存、请求提交和实际生效分别展示的约定。

使用方式与离线联调入口见 [Matcha 使用说明](MATCHA_DESKTOP.md)。
