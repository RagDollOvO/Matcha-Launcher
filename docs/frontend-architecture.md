# Matcha 前端架构

## 当前调用链

```text
Svelte 5 UI
  ├─ api/index.ts → api/bridge.ts
  │   ├─ 桌面：Tauri beacon_call → 隐藏 Node JSONL host
  │   └─ 开发浏览器：同源 Vite adapter
  └─ agent/cli-pi.ts → Pi CLI RPC
             ↓
backend/desktop/service.mjs
  ├─ backend/core.mjs → Steam / 插件部署 / Runtime 管道
  └─ backend/pi/transport.mjs → Pi CLI → 可信平台扩展
```

Matcha 是启动器产品名，Beacon 是 DLL 平台与 SDK 名。内部 `bin/l4p` 路径与 `L4P_*` C ABI 保持兼容。

## 保持一个业务实现

Svelte 负责视图、确认和反馈；Tauri 负责窗口、目录选择与子进程生命周期。Core 继续使用 Node.js 22+，现有文件部署和进程检查实现共用。原生 shim、Runtime 和插件使用 C++ / C ABI。

- `src/lib/api/index.ts`：类型化业务入口。
- `src/lib/api/bridge.ts`：Tauri IPC / 本机同源开发桥接、目录选择和窗口操作。
- `src/lib/stores/app.svelte.ts`：已观测状态、写操作回执、用户确认和轮询。
- `src/lib/agent/cli-pi.ts`：真实 Pi 连接、命令回执与事件转发。
- `src/lib/agent/chat.svelte.ts`：流式内容、最终消息校准、工具结果和独立确认控件。
- `src-tauri/`：Matcha 桌面壳。
- `backend/desktop/`：两种入口共用的能力服务与配置存储。

原有页面布局、Scene 动画、字体和音效保留。`mock/data.ts` 与 `mock-pi.ts` 留作演示参考，实际入口已切换到真实服务。

## 当前页面能力

已接入游戏发现、安装状态、Beacon 首次部署/恢复、DLL 导入/启停、manifest 动作表单与 Pi CLI。VPK 已接入 `backend/mods/`，提供真实扫描、导入、方案应用和资源路径重叠。服务器页通过 `backend/servers/` 接入 A2S、收藏及确认后的连接，详见 [服务器契约](platform/SERVERS.md)。CFG 页面显示待接入。

- 保存方案是本地草稿操作；VPK 方案支持显式应用，主页启动前也应用选中的 VPK 草稿。DLL 和 CFG 仍独立管理。
- 插件启停更新 `enabled.txt`，独立显示配置状态与运行时状态。
- 启动先显示 `requested`，实际 PID 和连接由观测更新。
- DXVK 状态来自入口检查及 Runtime 的 factory 初始化观测。
- 游戏退出由用户负责；页面提供刷新状态。

## Pi 能力与交互

当前工具为 `platform_inspect`、`runtime_status`、`plugin_invoke`、`mod_inventory`、`mod_set_enabled`、`mod_import`。按实际 manifest 调用动作；写动作通过用户确认后进入共享 Core。工具执行后刷新页面。

消息处理覆盖 user / assistant / toolResult、文本与思考流、工具事件、最终完整消息、独立 confirm/select/input/editor 请求、取消、错误和重连。模型名称从 Pi 状态读取；提供已配置模型选择器。登录使用独立 Pi 目录中的交互式 `/login`。

## 运行

```powershell
npm run desktop  # 桌面开发入口，自动复用或启动 Matcha Vite
npm run dev      # 浏览器开发入口 http://localhost:5173
npm run check    # Svelte / TypeScript 检查
```

完整操作流程见 [Matcha 使用说明](platform/MATCHA_DESKTOP.md)。

## Mod 页：已接入的数据契约（2026-11-16）

Mod 页新增图标视图（默认）与列表视图，卡片显示 VPK 缩略图。没有图时前端显示标题首字。缩略图走懒加载，不进 snapshot，避免每次刷新传输上百张图片。

| 位置 | 字段 / 命令 | 说明 |
| --- | --- | --- |
| `Mod` | `hasThumbnail?: boolean` | VPK 内有 `addonimage.jpg`，或同目录有同名 `.jpg`（创意工坊 `workshop/<id>.jpg`）时为 `true` |
| bridge | `mod-thumbnail { id }` → `{ dataUrl: string \| null }` | 返回 `data:image/jpeg;base64,…`。建议缩到 ≤256px；当前实现保留 JPEG 原尺寸，读取上限 8 MiB。CSP 已允许 `img-src data:` |

前端只对 `hasThumbnail === true` 的 Mod 请求，进入视口后再取，最多 4 路并发，并按 `id@updatedAt` 缓存。命令未实现（`unsupported_capability`）时自动停用请求。`addonimage.vtf` 可由后端转换，或返回 `null`。

后端优先读取同目录同名 `.jpg`，再读取包内 `addonimage.jpg`（支持预载字节、VPK v1/v2 和分卷）。缺图、超出上限或非 JPEG 返回 `null`；仅有 VTF 时 `hasThumbnail` 为 `false`。`updatedAt` 纳入分卷和旁置图片时间，刷新后可使图片缓存失效。

收藏通过 snapshot `modMeta` 和 `save-mod-meta` 持久化到现有设置。回收站后端和前端接入清单见 [Mod 库规划](mod-library-plan.md) §3.6。

### P2 后端就绪：前端接入入口

`api.extractMod` / `revealPath`、`modSounds` / `modSound`、`workshopResolve` / `workshopDownload`、`taskList` / `taskCancel` / `taskRetry` 已提供类型化入口，完整契约见 [Mod 库规划](mod-library-plan.md) §3.3–3.5。任务托盘初始化读取 `task-list`，随后合并 `task_progress`；错误显示 `error.message`。

独立库 Mod 的 `storage` 为 `library`，ID 使用 `library:workshop:<id>`，`source` 仍为 `workshop`。所有动作传 Mod ID，由后端定位文件。前端通过 `modMeta.inbox` 展示「新下载」，通过 `enabled` 显示实际启停；`deployed` 表示受管副本已发布到 addons。现有本地与 Steam 订阅项继续使用原相对路径 ID。

### 内置创意工坊（2026-11-16）

左侧 `workshop` 路由由 `pages/Workshop.svelte` 承载，支持关键词、分类、四种排序、作品 / 合集、翻页和独立详情。`WorkshopThumb` 按可见区域以四路并发取 data URL，复用 `TaskTray` 和原有 `WorkshopDialog`；下载完成进入原有「新下载」。

- `workshop-browse { search, sort, tag, kind, page }` → `{ items, page, totalPages, total, workshopUrl }`。`sort` 为 `trend / mostrecent / lastupdated / totaluniquesubscribers`，`kind` 为 `item / collection`，每页 30 项、最多 1000 页。浏览可在尚未选择游戏时使用；下载沿用游戏目录要求。
- `workshop-detail { id }` → `WorkshopItem`，补充纯文本 `description`、`tags`、`hasPreview` 和合集 `children`。列表额外有公开作者名 `authorName`、`subscriptions`。文本经 Svelte 转义显示。
- `workshop-preview { id }` → `{ dataUrl }`，只接受条目 ID，从已取得的官方元数据定位图片。JPEG / PNG / GIF / WebP 来源单图最多 12 MiB、16 百万像素，`sharp` 生成最大 640×480 的静态 JPEG（GIF 取首帧）；前后端缓存各限制为 24 MiB 的 data URL 文本。远程脚本和 HTML 保持隔离。
- `workshop-open { id? }` 使用系统浏览器打开固定的 Steam 官方条目 / L4D2 工坊入口。
- 下载任务的公开视图补充 `workshopId`，页面据此展示正在下载，防止重复点击；原任务持久化格式保持兼容。

浏览源为 [Steam L4D2 公开列表](https://steamcommunity.com/workshop/browse/?appid=550)中的 `valve-ssr-data` / `workshop_browse` 数据，适配集中在 `backend/mods/workshop-browse.mjs`。结构变化返回明确错误；缓存保留 10 页、有效期两分钟，每次读取重新计算入库状态。网络模块复用现有环境代理或启用中的 Windows 手动系统代理，30 秒重新读取一次系统代理，采用固定版本 `undici`；配置始终由用户管理。

### DSH 内置浏览器（2026-11-16）

`pages/Browser.svelte` 使用 DSH Browser 0.4.1 的 `TabsStore`、持久化和 URL helpers；源码与修改说明在 `src/lib/browser/dsh/SOURCE.md`，Apache-2.0 许可证随包提供。标签按游戏目录保存，最多 10 个，按首次激活创建原生视图。

`src-tauri/src/browser.rs` 通过 Tauri `unstable` multi-webview API 提供原生 WebView2 carrier，替换上游 Puppeteer DOM-copy/iframe。`browser_call` 仅接受 `main` webview；`beacon_call` 允许主视图的业务命令及本地 `agent` 视图的 Pi 命令。两个本地视图各自按标签绑定权限，见[助手窗口接入](agent-window-handoff.md)。远程页面的导航限 HTTP(S)，Matcha IPC / asset origins 保留。浏览器事件定向发给主视图，远程页与业务桥分离。切换路由、打开下载页或确认框时隐藏原生视图，恢复后保留页面状态。

下载事件将文件接收到独立的 `browser/downloads/<id>/`，保留网页来源、文件名和完成状态。重启将进行中的记录展示为中断；文件保持原样。用户确认后 `browser-import` 复用 ModManager 的进程检查、同名保护和备份，导入后加入当前启动方案；ZIP 通过固定版本 yauzl 流式读取，筛选 VPK、检查路径/数量/大小，所选目录 VPK 的分卷一并提取。来源在 settings.modOrigins 中按 Mod ID 保存，独立于 favorite/inbox，snapshot 作为 `Mod.origin` 提供。

`BEACON_DATA_DIR` 可为离线桌面夹具指定独立的数据目录，Node 服务和网页 profile/下载记录共用该路径。生产默认继续使用 app_local_data_dir。

### 拖入导入

- 桌面版用 Tauri `onDragDropEvent` 拿到完整路径，走现有 `preview-mod` / `import-mod`。多个文件只确认一次，然后逐个导入；分卷的 `_000.vpk` 等数据文件会被忽略，只认 `_dir.vpk`。
- Tauri 在 Windows 上默认拦截 HTML5 拖拽，所以「Mod 拖到类别」改成了指针拖拽，不依赖 `dragDropEnabled`。
- 浏览器预览拿不到文件路径，拖入后会提示改用路径粘贴。

### 分类合集（嵌套分类）

- `Category.parentId?: string`：上级分类，缺省表示在最外层。`save-categories` 原样存取整个数组，后端无需改动。
- 内置的 `cat-none`（未分类）在前端视为最外层，不显示成文件夹；没分类的 Mod 直接放在最外层。
- 删除分类只删这个“文件夹”，里面的 Mod 和子分类挪到上一级。移动分类时不能移进它自己或它的子孙。
- 图标和列表两种视图都先显示子分类，再显示当前层的 Mod。搜索或按状态筛选时，平铺当前分类及其子分类里的全部匹配项。

## 服务器页：卡片网格与合集（2026-11-16，已接入）

服务器页改为卡片网格。左侧栏有「全部 / 收藏 / 自建合集 / 未分组」；全部和收藏视图按合集分段显示。卡片编号是服务器在所在合集里的序号。支持拖动排序、拖到其他合集或收藏，也支持 Ctrl / Shift 多选后批量移动、收藏、刷新、复制和移除。地址栏支持多行粘贴，也可以用 `host:27015-27022` 一次添加最多 32 个端口。

合集保存、原位编辑备注 / 连接端口和 A2S_PLAYER 名单已接入共享后端；旧服务继续使用前端降级路径。

| 位置 | 字段 / 命令 | 说明 | 未接入时前端行为 |
| --- | --- | --- | --- |
| snapshot | `serverLayout?: ServerLayout` | `{ groups: { id, name, serverIds[] }[], loose: string[] }`。一台服务器最多占一个位置；`loose` 是未分组的手动顺序。随服务器列表原子写入 `servers.json`；旧文件默认返回空布局 | 存在本机 `localStorage['flare.serverLayout.pending']`；首次收到后端布局时推送待保存副本，收到成功回执后清理 |
| bridge | `save-server-layout { layout }` → `{ status: 'saved' }` | 整份覆盖保存，保留合集和服务器顺序、空合集；校验结构及 ID 唯一性。`remove-server` 同时从合集和 `loose` 清理该 id | 同上 |
| bridge | `update-server { id, label, gamePort }` → `Server[]` | 改备注 / 连接端口，保留 id、收藏与探测缓存 | 收到 `unsupported_capability` 时退回「移除 → 同地址重新添加 → 恢复收藏和合集位置」 |
| `Server` | `playerList?: { name, seconds, score }[] \| null` | A2S_PLAYER 原始名单，含协议返回的 Bot（GameDig `requestPlayers: true`、`requestPlayersRequired: false`）。名字为空表示正在连接；空服返回 `[]`，暂无可用名单返回 `null`。时长单位为秒 | 卡片显示座位格（玩家数 / 上限） |

本机迁移包含纯未分组排序；布局保存按提交顺序执行，待保存副本在成功回执前保留。失败时保留当前布局并在下次 snapshot 重试；重新打开页面时也会提交待保存副本。

查询中（`status: 'querying'`）保留上次探测缓存，前端继续显示上次在线结果。编辑备注保留原始探测名称，清空备注后恢复显示；修改或清空连接端口立即按当前配置 / 缓存的 EDF 端口计算连接地址，在途查询完成后同样采用最新配置。

名单查询超时仍可返回在线状态、人数与地图；名单及探测结果保存在内存中，重启后刷新获取。合集存储位置随入口数据目录，换电脑时一并复制 `servers.json`，桌面默认位于 `%LOCALAPPDATA%\com.matcha.launcher`。
