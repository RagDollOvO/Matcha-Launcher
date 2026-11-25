# 添加与探测 L4D2 服务器

第一次添加时，直接在“服务器”页上方粘贴 `connect dxnya.nekoidc.top:20080` 或 `域名:端口`。已有服务器时，先点右上角“添加服务器”展开表单，再点“添加”。省略端口时使用 27015。点击星标保存收藏，首页展示收藏服务器。

页面支持名称/地图/地址搜索、模式筛选、隐藏满员、单项或全部刷新。进入页面时查询一次，可勾选每 30 秒刷新；离开页面后停止该轮询。首页每 30 秒查询收藏项。卡片顶部的地图横幅显示地图和已知战役的章节，下方显示玩家座位格、延迟和连接操作。超时与失败显示原因，人数和延迟显示 `—`。人数与上限使用服务器 A2S 报告值，Bot 单独标注，延迟为 UDP 查询往返时间。

点卡片里的玩家预览，可展开 A2S_PLAYER 返回的完整名单和连接时长，含协议返回的 Bot。空名称显示“正在连接…”。服务器关闭名单或名单超时时，卡片照常显示人数、地图和延迟。

左栏支持自建合集、拖动排序和未分组顺序，数据保存在后端 `servers.json`。首次接入会自动提交本机待保存布局，收到保存回执后清理本机副本。换电脑时将入口数据目录中的 `servers.json` 一并复制过去。

## 好友在玩

Steam 登录后，点窗口右上角、茶茶左边的好友图标。名单里每位好友占一行，昵称下方显示服务器或游戏状态。点有箭头的好友可展开地图、人数和延迟。点「加入」沿用当前启动方式并先确认，点星标才保存服务器。游戏已运行时可以复制连接命令。在大厅或主菜单的好友仍可显示，取决于 Steam 对当前账号可见的状态。

主窗口就绪时读取好友人数，窗口可见时每 30 秒刷新；点开「好友在玩」才查询服务器详情。好友昵称、游戏状态和大厅资料仅在内存中使用。

## 让 Agent 归类、维护和删除

点顶栏茶茶图标（或按 Ctrl+K），在对话里说明要处理的服务器和希望调整的合集。可以用服务器名称、地址、收藏状态或合集名缩小范围；请先看茶茶列出的条目，再确认变更。

类别可自由命名，例如“战役”“对抗”“死门”。可以对茶茶说：

- “把收藏里的三台死门服放进死门合集，其他分组保持原样。”
- “把对抗合集排到最前面，保留成员顺序。”
- “删除死门合集，服务器留在未分组。”

自定义类别与服务器探测到的玩法分别保存。备注、收藏、端口和类别变更都会先展示清单，由用户确认后保存；重复地址沿用原资料。删除类别默认将成员放回未分组；明确要求“删除类别和里面的服务器”时，另以对应标题确认成员的移除。只移除几台服务器时按所选 ID 操作。

Agent 预览后，服务器资料或类别有新修改时会要求重新预览。页面分类草稿发生冲突时继续保存在本机，显示“重试分类草稿”和“采用已保存分类”；确认选择后再提交草稿或采用后端布局，取消会保留草稿。

## 查询与连接端口

地址栏填写 A2S 查询地址。通常与游戏连接端口相同；不同的服务器可在“更多选项”填写连接端口。默认优先采用 A2S_INFO 的 EDF 游戏端口，再使用查询端口。服务器名称可用本地备注替代。

“启动连接”会先确认用户意图，再查询服务器，并按页面选择的启动方式运行游戏。**L4N 平台启动**沿用当前配置和 VPK 方案，默认参数为 `-steam -novid +connect 域名:端口`；自定义启动项加在 `+connect` 前。**纯净对抗**使用 Steam 原版目录、默认 D3D9 路径和 `-steam -novid +connect 域名:端口`。实际参数显示在确认框中。密码由游戏内提示处理。收到启动回执后显示“等待游戏响应”；实际进入服务器的结果由游戏窗口呈现。

VAC 标记沿用服务器报告。在自定义启动项填写 `-insecure` 后，VAC 服务器提供“复制命令”。要直接启动并连接 VAC 服务器，请移除此参数，或选择「纯净对抗」。已有游戏运行时同样提供复制命令，Matcha 保持现有游戏进程。Agent 的连接工具刷新地址并给出端口依据、当前方案和连接命令，启动操作继续由用户在页面确认。

## 数据与接口

- 前端的列表、收藏和布局草稿在 `src/lib/stores/servers.svelte.ts`。页面命令从 `backend/servers/commands.mjs` 进入 `ServerManager`；茶茶的变更由 `organize.mjs` 规划，提交走同一个 manager 写入队列。查询独立排队。
- 协议：GameDig **5.3.3**（MIT）的 Valve A2S；AppID 校验为 550，IPv4/DNS，challenge、Source 分包与 BZip2 由库处理。模式取 `mp_gamemode` 或已知服务器标签，未知项保留“未知/自定义”。
- 查询超时：UDP 1.5 秒，总尝试 5 秒，单次尝试；最多 6 路并发，同一保存条目合并在途查询。常规列表仅查询已保存地址；好友名单查询 Steam 当前报告的公网服务器。
- `servers.json` 与 `settings.json` 分离，位于该入口的数据目录。桌面默认 `%LOCALAPPDATA%\com.matcha.launcher`。持久化地址、备注、连接端口、收藏和合集布局；探测缓存与玩家名单重启后重新获取。
- `list-servers` → `Server[]`
- `server-state` → `{ servers, serverLayout }`，轻量读取同一份服务器和布局。
- `add-server { address, label?, gamePort? }` → 完整列表
- `update-server { id, label, gamePort }` → 完整列表；保留 ID、收藏、合集位置与探测缓存，连接端口支持 `null` 恢复自动选择
- `save-server-layout { layout: { groups: { id, name, serverIds[] }[], loose: string[] }, expected? }` → `{ status: 'saved' }`；每个服务器 ID 最多出现一次。新页面用 `expected` 在实际写入时复核布局和成员，冲突返回 `server_layout_stale`；已有省略该参数的调用继续沿用原保存方式。
- `remove-server { id }` / `favorite-server { id, favorite }` → 完整列表
- `query-servers { ids? }` → 查询完成后的完整列表；省略 ids 查询全部
- `connect-server { id, profileId, mode }` + 用户确认 → `requested`；当前页面使用 `modded` / `clean`，旧 `direct` / `development` 调用保留兼容。
- `set-launch-mode { mode }` → 启动配置；`snapshot.launch` 返回当前模式及实际参数。确认框捕获并提交 mode，避免等待确认时选项变化导致启动路线改变。
- `snapshot.servers` 读取缓存，`snapshot.serverLayout` 返回持久化布局；`capabilities.servers = true`。列表或布局变更后发出 `servers_changed` 事件。移除服务器时同步清理布局引用。

### Pi 工具

随包技能：`backend/pi/skills/matcha-server-organizer/SKILL.md`。工具在平台扩展注册，由 `server-host.mjs` 连接同一 ServerManager：

| 工具 | 用途 |
|---|---|
| `server_inventory` | 读取缓存清单、类别、收藏、当前游戏和启动方式；可按 ID、类别和收藏筛选 |
| `server_query` | 探测指定已保存 ID，复用 6 路并发和在途查询 |
| `server_add` | 批量预览规范化地址、去重与逐项错误，确认后添加 |
| `server_update` | 按提供的字段修改备注、收藏和连接端口 |
| `server_organize` | 用真实服务器 ID 移入已有或自定义类别，可指定类别内位置 |
| `server_category` | 新建、重命名、排序和删除类别；删除默认保留成员 |
| `server_remove` | 确认名称、地址、收藏和类别影响后移除所选服务器 |
| `server_connection` | 刷新单项并返回连接命令、端口依据及用户下一步 |

写工具的预览保存 15 分钟，确认后在 manager 写入队列内复核持久化资料和布局；A2S 缓存刷新独立进行。取消后保留当前列表；添加回执分别列 `added`、`skipped` 和 `errors`。资料管理可在游戏运行期间使用，游戏文件和启动参数保持原样。

离线针对性检查：`node --test backend/tests/servers.test.mjs`，覆盖真实本地 UDP challenge/乱序分包、可选名单与规则、查询失败、收藏与布局持久化、原位编辑及在途查询、旧文件兼容、VAC 路由以及捕获 Steam 参数。夹具使用合成游戏目录和替代启动函数。

茶茶链路检查：`node --test backend/pi/server-skill.test.mjs`。页面交接逻辑和分类草稿冲突用 `node checks/server-agent-ui.mjs` 的独立浏览器夹具检查，桥接资料保存在内存。当前页面收起了交接按钮，日常从茶茶对话发起。

协议实现参考：[GameDig](https://github.com/gamedig/node-gamedig)、[Valve 协议实现](https://github.com/gamedig/node-gamedig/blob/v5.3.3/protocols/valve.js)。
