# GameMaps 列表、详情与下载接口

前端为 `src/lib/pages/GameMaps.svelte`，客户端类型在 `src/lib/api/gamemaps.ts`（开发预览加 `?mockgm`）。三条命令已在 `backend/desktop/service.mjs` 接入，解析、缓存和下载恢复在 `backend/mods/gamemaps.mjs`；桌面页面读取与文件传输由 `src-tauri/src/gamemaps.rs` 的隐藏 WebView2 承担。

当前源码通过针对性离线检查及 Windows 编译；用户手动打开隔离测试版后，已确认隐藏 WebView2 返回真实地图列表（24 项，第 1 / 77 页），封面、作者、日期与浏览数正常显示。真实详情、搜索和文件下载导入联调仍待完成。现有桌面发行目录保持原版本。

## 站点结构（2026-11-17 用内置浏览器实看）

| 用途 | 地址 |
|---|---|
| 地图列表 | `https://www.gamemaps.com/l4d2/maps?page=N` |
| 地图分类 | `/l4d2/campaign/`、`/l4d2/co-op/`、`/l4d2/survival/`、`/l4d2/versus/`、`/l4d2/scavenge/`、`/l4d2/mutation/`、`/l4d2/mission/`、`/l4d2/other/` |
| Mod 列表 / 分类 | `/l4d2/mods`、`/l4d2/mods/<slug>`（weapons、survivors、infected、sounds、textures、gui-ui、scripts、items、effects、skins、packs…） |
| 排序 | `<select name="sort">`：`recent` / `popular` / `rviews`（Underviewed）；向当前列表地址 **POST** `sort=<值>`，单加 GET 参数会漏掉站点表单行为 |
| 搜索 | `GET /search/l4d2?provider=gamemaps&q=…` |
| 详情 | `/details/<id>` |
| 下载 | 详情页里是表单：`POST /downloads/download`，字段 `ids[]=<id>`、`noqueue=true`、`direct=true`；页面显示「You are downloading as a guest」，游客可下 |
| 工坊版本 | `POST /downloads/outsourced/<id>/steam`（跳转到创意工坊；能解析出工坊 id 就放进 `workshopId`） |

主列表选择器为 `.paged-list .item-list article.list-item-file[data-id]`：标题在 `header .title`，封面在 `.thumbnail img`，类型在 `.type`，作者在 `.byline`，浏览数在 `.views .value`，日期在 `time[datetime]`。`li[data-type="file"] article[data-info]` 属于顶部推荐轮播，解析列表时排除该区域和底部推荐。

详情标题和封面来自 `.title-row h1` / `.title-block > img.thumbnail`；正文为 `section.desc > pre`；作者包括旧版纯文字署名，读取 `.developers .username-val` 和相邻角色；文件名取 `section.details p[title]` 的完整 title，日期取 time 的 datetime。截图限于主媒体区，关联条目取 `section.linked article.shortrow-item` 并保留 L4D2 条目。作者说明按 Instructions 标题所属 section 提取纯文本。

实看样本：`36646` 是 Blood Medal v0.4，`22803` 是 Bloody Pacific，`4746` 是 Minecraft Special Infected。站点部分计数以 K/M 缩写展示，转换后的数值沿用其显示精度；页面未展示喜欢数时字段省略。前端 mock 数据用于布局，条目 ID 与实际标题可有差异。

**访问方式**：本机 Node 普通请求遇到 403；桌面采用隐藏 WebView2，使用独立持久 profile，加载普通页面后读取 DOM。每次顶层请求和表单提交间隔至少 1 秒。详情页有工坊转发表单时，额外提交该表单并捕获 Steam 目标 ID。网页权限与主界面 IPC 隔离。挑战页保持 `gamemaps_blocked` 错误，前端继续提供原页面入口。开发预览的 Node 通道保留普通请求；文件下载使用桌面通道。

本轮浏览器实看：地图列表、详情、排序可正常读取；搜索地址停留在安全验证页，因此真实搜索结果 DOM 仍待校准。

## `gamemaps-browse { section, category, sort, page, q }` → `GmPage`

```ts
interface GmQuery { section: 'maps' | 'mods'; category: string /* '' = 全部，否则上表的 slug */; sort: 'recent' | 'popular' | 'rviews'; page: number; q: string /* 非空时走搜索 */ }
interface GmItem {
  id: string; title: string;
  image: string;            // 站内相对路径即可，前端补 https://www.gamemaps.com
  typeLabel: string;        // 原样
  summary?: string; author?: string; sizeBytes?: number; views?: number; likes?: number; updatedAt?: string;
  url: string;              // https://www.gamemaps.com/details/<id>
}
interface GmPage { items: GmItem[]; page: number; totalPages: number }
```
列表页拿不到的字段（作者、大小等）留空即可，别为了补字段逐个抓详情。缓存 5 分钟，请求间隔 ≥ 1 秒。

## `gamemaps-detail { id }` → `GmDetail`

```ts
interface GmDetail extends GmItem {
  authors: { name: string; role: string }[];   // role 原样（Author / Co-author）
  description: string;                          // 纯文本，保留换行
  instructions?: string;                        // INSTRUCTIONS，前端醒目显示
  tags: string[];
  screenshots: string[];
  file?: { name: string; sizeBytes: number; date: string /* ISO 日期 */; version?: string };
  workshopId?: string;
  linked: GmItem[];
}
```

## `gamemaps-download { id }`（需要用户确认的写操作，前端带 approved）→ `{ taskId }`

建一个后台任务，和创意工坊下载走同一套任务事件：

- `ModTask`：`kind: 'download'`，**`source: 'gamemaps'`、`sourceId: <id>`**（前端已在 `types.ts` 加了这两个可选字段，用来在卡片上显示进度），`title` 用条目标题，`unit: 'bytes'`，`cancelable: true`。
- 下载完成后：
  - `.vpk` 直接导入；`.zip` 解出其中的 VPK（分卷 `_dir.vpk` 连同数据分卷一起）导入；`.7z` / `.rar` 如果没有解压能力，就放到下载目录并让任务 `failed`，错误信息写「需要手动解压后导入」并附路径。
  - 导入规则和工坊下载一致：进「新下载」，默认加入当前启动方案（下次启动生效）。
  - 导入的 Mod 写 `origin = { pageUrl: 'https://www.gamemaps.com/details/<id>', title, downloadId }`，前端用 `pageUrl` 判断「已在库中」。
  - 任务 `done` 时带 `modId`（第一个导入的），前端「下载」页的「查看」会跳过去。
- 游戏运行中照常下载；只有导入那一步要等游戏退出时，按现有导入的规则处理。

### 文件保留与重试

- 原始文件位于 `<Matcha 数据目录>/gamemaps/downloads/<taskId>/<请求 ID>/`；`receipt.json` 记录完成下载、解包结果和已导入文件。
- 隐藏 WebView2 沿用原站表单和跳转，分块读取文件响应，与工坊共享实时字节限额。暂停释放任务名额，并清理本次传输的 `payload.part`；继续时仍用原任务 ID，从头获取未完成的文件。详见[下载页后端契约](downloads-handoff.md)。
- 游戏运行时完成下载和解包，然后以 `game_running` 提示退出游戏后重试。重试复用已下载文件，已完成的部分导入按记录核对后继续。
- ZIP 复用内置浏览器导入的路径、链接、重复文件名、分卷和大小检查；上限 4096 项、VPK 解压总大小 8 GiB。取消下载或解包保留已落盘内容。
- RAR / 7z 返回 `archive_format`，说明手动解压后导入并附原文件路径；下载页可打开保留文件所在目录。同名游戏文件沿用现有导入冲突提示。
- 工坊任务继续携带 `workshopId`；GameMaps 任务独立使用 `source` / `sourceId`，相同数字 ID 互不占用。

## 图片

解析图片地址时优先读取 `data-src`，其次读取 `src`；缺地址时返回空值。前端直连 `www.gamemaps.com`，以地图图标区分等待、无图和加载失败，列表、详情及关联内容共用同一组件。

## 本轮检查与联调入口

- `node --test backend/tests/gamemaps.test.mjs`：主列表排除轮播、详情字段、POST 排序与缓存限频、ZIP 分卷导入、默认停用、来源及新下载标记、游戏运行后续传导入、RAR 保留和取消，4 项通过。
- `node --test backend/tests/browser-downloads.test.mjs`：共享 ZIP 导入入口及路径拒绝检查通过。
- `npm run check`：0 错误、0 警告；`cargo check --offline` / `cargo build --offline` 通过。
- 隔离联调入口：`checks/.artifacts/gamemaps-desktop/open-preview.cmd`，另有桌面 `Flare-GameMaps-测试.lnk`。使用独立数据目录及不可执行 PE 模拟游戏文件。预览服务为 `http://localhost:5173`，自身数据放在 `gamemaps-desktop/vite-data`，桌面子进程使用 `gamemaps-desktop/data`。自动启动曾被执行策略拦截，现由用户手动打开并完成真实地图列表显示确认。下一步是实际详情、搜索和小 VPK 下载导入；主桌面快捷方式保持既有发行版。

### 加速与页面读取

Steam++ 用于 Steam 创意工坊和社区资源；GameMaps 沿用常规网络。隐藏 WebView2 以 DOM 中的列表、详情或提示就绪作为读取条件，避免为可见列表继续等待图片和广告。排序仍使用原站表单并等待新文档，保留原有缓存、限频和站点错误提示。见 [社区加速](platform/COMMUNITY_ACCELERATION.md)。
