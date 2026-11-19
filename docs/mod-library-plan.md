# Mod 库功能规划（前端方案 + 后端契约）

2026-11-16 · claude（前端）

需求来源（用户原话整理）：收藏；解析 Steam 创意工坊链接下载 Mod，下载的 Mod 不直接进入任何方案；一键解包到桌面；试听枪声；删除；移动到其他方案或合集。

## 0. 给 codex 的后端清单（按优先级）

前端状态（2026-11-16，claude 提供）：P0 / P1 / P2 前端全部接入，`npm run check` 0 错误 0 警告，`vite build` 通过，可以打包。接入细节见文末 §6。

后端状态（2026-11-16，codex）：P0 / P1 / P2 已落到源码，共用桌面 / Vite 的 `DesktopService`。P2 的类型化入口已加入 `src/lib/api/index.ts`，任务、声音、工坊类型在 `src/lib/types.ts`。P1 / P2 的页面控件和任务托盘交由前端接入；桌面发布包仍沿用原版本，下一次打包会自动构建声音解码器。

**P0：前后端已接通契约**

| 项 | 契约 | 前端现状 |
| --- | --- | --- |
| 收藏 | snapshot `modMeta` + `save-mod-meta`（§3.1） | 后端已实现；旧本机暂存由现有前端自动迁移 |
| 缩略图 | `Mod.hasThumbnail` + `mod-thumbnail`（见 [frontend-architecture.md](frontend-architecture.md)「Mod 页：已接入的数据契约」） | 后端已实现；没有图时显示标题首字 |

**P0：不用新增接口，但请保持现有行为**

- `save-categories` 继续原样存取整个分类数组：前端已经在分类上加了 `parentId`（嵌套分类），后端不能丢掉这个字段。
- Mod 的 `id` 要保持稳定（现在是 addons 下的相对路径）：前端导入后会对比导入前后的 id，把新 Mod 放进当前分类；收藏、方案、分类也都按 id 关联。
- Tauri 窗口的 `dragDropEnabled` 保持默认 `true`：拖入 VPK 依赖 `onDragDropEvent` 拿完整路径。前端「Mod 拖到分类」用的是指针拖拽，不需要关掉它。
- CSP：图片只允许 `data:` / `blob:`，音频只允许 `blob:`。新接口返回的图片用 data URL，音频返回 base64，由前端转成 Blob。

**P1：回收站（用户已定方案，§3.6）**

`preview-delete-mods`、`delete-mods`、snapshot `trash`、`restore-mods`、`purge-trash` 已实现。回收目录为所选游戏的 `left4dead2/.matcha-trash/<trashId>/`，与库同盘，扫描跳过回收目录。前端接下来加：删除确认、「撤销」toast、侧栏「回收站」视图。

**P2：后端已实现，前端按 §3.3–3.5 接入**

- 解包到桌面：`extract-mod`、`reveal-path`（§3.4）
- 试听：`Mod.soundCount`、`mod-sounds`、`mod-sound`；MS / IMA ADPCM 已转 PCM（§3.5）
- 创意工坊：官方 API 解析 + 官方 CDN 下载，采用 B 独立库；下载后进入「新下载」，方案关系保持空。
- 任务：`task-list`、`task-cancel`、`task-retry`、snapshot `tasks` 和 `task_progress` 事件。

接口命名、字段、错误码都可以按后端习惯调整，改了告诉 claude，前端跟着改。

## 1. 概念：库 ≠ 方案

| 概念 | 是什么 | 现状 |
| --- | --- | --- |
| 库 | Matcha 认识的全部 VPK | 已有（扫描 addons + Matcha 独立库） |
| 分类 / 合集 | 库的整理方式，可嵌套，一个 Mod 只在一个分类里 | 已有（`parentId`） |
| 方案 | 一张启用清单，引用库里的 Mod；一个 Mod 可在多个方案里 | 已有 |
| 收藏 | 跨分类、跨方案的星标 | **新增** |
| 新下载 | 下载完成、还没整理的 Mod；在所有方案里都是停用 | **新增** |

「下载的 Mod 不直接进入方案」由「新下载」承接：下载完只出现在库和「新下载」里。用户做了任一整理动作（加入某方案、移到分类、收藏，或点「标记已整理」）后，它就离开「新下载」。

侧栏在「分类」上方加一组「库」智能入口：`收藏`（数量）、`新下载`（未读角标）。

## 2. 统一的 Mod 动作

右键菜单、悬停「⋯」、多选批量栏、详情面板共用一份动作表。每个动作都带「是否可用 / 不可用原因」，这样四个入口的表现完全一致。

- 在当前方案启用 / 停用
- 收藏 / 取消收藏（F）
- 加入方案 ▸：每个方案一个勾选框，多选时显示三态；末尾是「新方案…」。「移动到其他方案」= 勾上 B、取消 A，不另做一个“移动”语义。
- 移到分类 ▸：最外层 + 分类树
- 试听枪声（空格），只有含 `sound/` 的 Mod 才显示
- 解包到桌面
- 在资源管理器中显示
- 复制创意工坊链接
- 删除…（红色，单独一组）

拖拽目标同步扩展：拖到侧栏「方案」= 加入该方案；拖到「收藏」= 收藏；拖到分类 = 移动（已有）。

## 3. 各功能的前端做法与后端契约

### 3.1 收藏（2026-11-16 前后端已实现）

- 卡片悬停时右上角显示 ☆，收藏后常显 ★；列表视图加一列星标；详情面板标题旁放星标按钮。
- 侧栏「收藏」打开一个平铺视图（跨分类），顶部放「用收藏新建方案」。
- 契约：snapshot 增加 `modMeta: Record<modId, { favorite?: boolean; inbox?: boolean }>`；新增命令 `save-mod-meta { patch: Record<modId, ModMeta | null> }`，按 id 合并保存，值为 `null` 表示删除这个 id 的记录（和 `assignments` 的存法一样）。
- 已提供的 id 用本次对象替换整条记录，省略字段会清除旧值；未提供的 id 保留。回执为 `{ status: 'saved' }`，旧 `settings.json` 自动补上空 `modMeta`，与方案、分类一起持久化。
- **过渡方案**：snapshot 里没有 `modMeta` 时，前端先把收藏存在本机（localStorage `flare.modMeta.pending`）。后端接入后，前端第一次读到 `modMeta` 会把本机暂存的标记合并上去，然后清掉本机记录。

### 3.2 移到其他方案（2026-11-16 前端已完成，用现有 `save-profile`）

不需要新接口。可以对非当前编辑的方案调用 `save-profile`。

### 3.3 创意工坊下载 + 新下载（后端已实现）

2026-11-16：新增左侧独立「创意工坊」页面，已接入公开列表搜索、分类、热门 / 最新等排序、翻页、作品详情和合集选择，复用本节下载入库流程。浏览契约与网络适配见 [前端架构：内置创意工坊](frontend-architecture.md#内置创意工坊2026-11-16)。

前端：

- 工具条的「导入 VPK」改为「添加 ▾」：本地文件… / 创意工坊链接…
- 在 Mod 页按 Ctrl+V 时，如果剪贴板里是工坊链接，直接打开下载对话框并预填。
- 对话框里可以粘贴多行。前端先用正则解析出 ID（`[?&]id=(\d+)`、纯数字），后端再补全元数据。合集会展开成子项并带勾选框；已在库中的项默认不勾。底部写明「放进『新下载』，不加入任何方案」。
- 下载进度进统一的「任务托盘」（Mod 页底部，可折叠）。下载、解包、大文件导入共用这个托盘：每行显示标题、进度、速度，以及取消 / 重试。
- 完成后弹 toast「3 个 Mod 已下载 · 去整理」，「新下载」角标 +3。

契约：

```ts
// 解析：ids 来自前端正则
'workshop-resolve' { ids: string[] } → {
  items: { id: string; kind: 'item' | 'collection'; appId: number; title: string; author: string;
           sizeBytes: number; preview: string | null /* data URL；CSP 只允许 data:/blob: */;
           updatedAt: string; children?: string[]; inLibrary: boolean;
           downloadable: boolean; reason?: string; error?: string; workshopUrl: string }[]
}
'workshop-download' { ids: string[] } → { taskIds: string[] } // 用户确认后的具体条目 ID
'task-list' {} → ModTask[]
'task-pause' { taskId } → ModTask
'task-resume' { taskId } → ModTask
'task-remove' { taskIds: string[] } → { removed: string[] }
'task-cancel' { taskId } → ModTask
'task-retry' { taskId } → { taskId } // 用户明确重试，复用 taskId
// 事件（复用现有 beacon-event 通道）
{ type: 'task_progress', taskId, kind: 'download' | 'extract', gameRoot, title,
  state: 'queued' | 'running' | 'paused' | 'verifying' | 'done' | 'failed' | 'canceled',
  done: number, total: number | null, unit: 'bytes' | 'files', cancelable: boolean,
  pausable: boolean, resumable: boolean, createdAt: string, updatedAt: string, finishedAt?: string, bytesPerSecond?: number,
  error?: { code: string; message: string }, modId?: string, dir?: string, fileCount?: number }
```

**独立库存放与启用（B，已采用）**

- 文件位于所选游戏的 `left4dead2/.matcha-library/workshop/<id>/mod.vpk`，`item.json` 保存来源与部署记录。新 ID 为 `library:workshop:<id>`；原有 addons 相对路径 ID 原样保留。
- `Mod.storage` 为 `addons` / `library`；`source` 继续为 `local` / `workshop`。`file` 为对应存放位置的可读相对路径，前端操作一律传 `id`，由后端统一定位。
- 下载完成写入 `modMeta.inbox = true`，`enabled = false`，首次方案也跳过独立库。保存包含该 Mod 的方案、移动分类、收藏后清除 `inbox`；「标记已整理」可保存 `inbox: false`。
- 应用方案时发布独立副本 `addons/matcha_ws_<id>.vpk`，停用时撤回该副本。源 VPK 留在独立库。扫描合并受管副本，列表里保留一个 Mod；同名或外部修改的文件返回 `deployment_conflict`，先保留现场再由用户处理。
- 现有 Steam 订阅项继续原流程；解析按已知 `workshopId` 去重。缩略图、声音、解包、资源重叠、回收站均支持独立库。

**渠道与限制**

- 使用 [Steam 官方详情 / 合集 API](https://partner.steamgames.com/doc/webapi/ISteamRemoteStorage)。`author` 暂为 creator Steam ID；下载后优先显示 VPK 的作者信息。`preview` 为有大小限制的 JPEG / PNG data URL，缺省为 `null`。
- 下载只接受 API 返回、通过白名单核验的 HTTPS Steam CDN 地址，逐次校验跳转；首版接收完整单文件 VPK。无官方直链、私密、已删除、其他游戏的项返回 `downloadable: false` 和 `reason`，前端可显示「在 Steam 查看」。SteamCMD 为后续候选。
- 每次解析 1–100 个 ID，合集递归去重并限制在 1000 项；每批下载 1–32 项，后台默认并发 2，可设为 1–4；单文件上限 8 GiB。完整下载后校验 VPK 结构、资源 CRC 与源文件身份，再发布入库。
- 产品按个人本地使用设计，保留工坊来源；登录凭据由 Steam 管理。公开发布下载功能前，维护者需核对适用的 [Web API 条款](https://steamcommunity.com/dev/apiterms) 和 [订阅协议](https://store.steampowered.com/subscriber_agreement/)，补齐产品的数据使用说明。

**任务接入**

- 页面初始化 / 重连先读 `task-list` 或 snapshot `tasks`，再按 `taskId` 合并事件。`total: null` 显示不定进度；`verifying` 单独显示校验阶段，字节进度可从头计数。
- 托盘显示 `error.message`；`cancelable: false` 时隐藏取消按钮，最终提交完成后显示结果。下载完成还会发 `objects_changed`，前端刷新库和收藏标记。
- 任务记录持久化到 Matcha 数据目录的 `tasks.json`，保留至主动删除。暂停状态跨重启保留；退出会取消排队和运行中可取消的任务，意外中断在重启后显示 `failed / task_interrupted`。继续或重试复用原 `taskId`，排到队尾。设置与历史时间见[下载页后端契约](downloads-handoff.md)。
- 每个任务固定创建时的游戏目录；解包还固定源文件版本。换游戏目录后，任务继续处理原目录。长耗时工作独立于普通命令队列，提交入库时使用现有写锁。
- `workshop-download`、`extract-mod`、`task-retry` 沿用用户确认信封。开发浏览器也调用同一后端。现有本地 `import-mod` 继续使用原有同步回执。

### 3.4 一键解包到桌面（后端已实现）

- 菜单「解包到桌面」：单个直接执行，多个按「每个一个子文件夹」处理。进度进任务托盘。完成后弹 toast，附带「打开文件夹」按钮。
- 目标默认是 `桌面\<标题>\`，同名时自动加 ` (2)`。
- 契约：`extract-mod { id, target?: string }` → `{ taskId }`。`target` 为已存在的绝对路径**父目录**，省略时使用系统实际桌面位置，兼容重定向桌面。完成事件带最终 `dir`。
- `reveal-path { path }` → `{ status: 'opened' }`：目录直接打开，文件在资源管理器中选中。
- 支持 v1/v2、预载和分卷；流式写入独立临时目录，校验源文件版本后发布。Windows 保留名、路径穿越、同名文件冲突会返回错误；同名输出目录自动递增。单次包内总量上限 32 GiB。
- 解包和试听只读源文件；运行期间修改源 Mod 返回 `mod_busy`。游戏运行时仍可解包到独立目录。

### 3.5 试听枪声（后端已实现）

- 详情面板新增「声音」段落：按目录分组列出声音文件，每行有 ▶ 和时长；同一时间只播放一个，空格停止。
- 卡片悬停时，含 `sound/weapons` 的 Mod 在右下角显示 ▶，播放「最像开火声」的那个文件（文件名含 fire / shot / single / gunfire）。
- 路径重叠面板里，同一路径的声音可以「本项 / 对方」对比试听，帮用户决定留哪个。
- 契约：snapshot 的 `Mod` 增加 `soundCount?: number`；`mod-sounds { id }` → `{ path, bytes, durationMs? }[]`；`mod-sound { id, path }` → `{ mime, base64, durationMs? }`。列表只索引 `sound/` 下的 WAV / MP3，WAV 时长在取音频时返回，前端转 Blob 播放并在停播 / 换声时释放 URL。
- PCM WAV / MP3 直接返回；MS-ADPCM、IMA ADPCM 由独立的 `flare_audio.exe` 转为 16-bit PCM WAV，保持原始采样率、声道和音量。使用固定版本的 [dr_wav](https://github.com/mackron/dr_libs)（MIT-0），来源记录在 `native/vendor/dr_wav/SOURCE.txt`。
- 单项输入上限 32 MiB，解码输出上限 64 MiB；WAV 预览支持双声道以内、5 分钟以内。解码有超时，结果按源版本与资源路径缓存。
- 开发环境先运行 `npm run audio:build`。`npm run desktop:build` 会自动构建辅助程序，打包脚本一并携带程序和依赖来源说明。

### 3.6 删除 → Matcha 回收站（2026-11-16 用户已定）

用户决定：删除时先移到 **Matcha 自己的回收目录**，在回收站里由用户自己选择是否永久删除。

前端：

- 菜单「删除…」（红色）→ 确认框，列出会移走的文件（`.vpk`、分卷、同名 `.jpg`）、总大小，并说明「会从 N 个方案中移除」。支持多选，游戏运行中禁用。
- 删除完成后弹 toast：「已移到回收站 · 撤销」。撤销 = 还原。
- 侧栏「库」里增加「回收站」入口，显示数量。打开后用列表显示：名称、原位置（分类）、原所在方案、大小、删除时间。
  - 每行：「还原」「永久删除」。
  - 多选：批量还原 / 批量永久删除。
  - 顶部：「清空回收站」。
  - 永久删除和清空都要二次确认，确认框写明「无法撤销」，并列出文件和总大小。
- 还原时尽量放回原分类；方案关系按删除时记下的列表恢复（前端在确认框里说明）。
- 回收站里的 Mod 不参与扫描、冲突和方案应用。
- **创意工坊订阅项**（`addons/workshop/`）删除前单独提示：删了 Steam 会重新下载，请先在 Steam 取消订阅（附「复制工坊链接」）。

契约（2026-11-16 后端已实现）：

```ts
'preview-delete-mods' { ids: string[] } // 只读，供删除确认框使用
  → { mods: TrashEntry[]; sizeBytes: number }
  // 预览里的 trashId 仅用于预览；删除回执返回实际生成的 trashId。
'delete-mods' { ids: string[] }  // 用户确认后，移到 Matcha 回收目录
  → { trashed: { trashId: string; modId: string; files: string[] }[] }
// snapshot 增加
trash: TrashEntry[]
type TrashEntry = {
  trashId: string; modId: string; title: string; file: string; sizeMB: number; sizeBytes: number;
  deletedAt: string; categoryId: string; profileIds: string[]; workshopId?: string;
  files: { file: string; size: number }[]; // addons 相对路径，或 .matcha-library/... 路径；大小为字节
  state: 'moving' | 'trashed' | 'restoring' | 'purging';
}
'restore-mods' { trashIds: string[] } → { restored: string[]; conflicts: { trashId: string; reason: string }[] }
  // 原位置已有同名文件时不覆盖，返回冲突让前端提示
'purge-trash' { trashIds: string[] | 'all' }  // 需要用户确认；永久删除，不可恢复
  → { purged: string[] } // trashId 列表
```

前端接入要点：

- 三个写命令沿用 bridge 的确认信封 `{ approved: true, source: 'user' }`，通过确认框后调用 `call(command, params, true)`；还原「撤销」按钮属于明确的用户操作。后端每次检查游戏进程，运行中返回 `game_running`。
- 删除会移走索引、匹配的全部 `_NNN.vpk` 分卷和同名 `.jpg`，保存分类、收藏和原方案 ID；同步清理当前游戏的方案关系。其他游戏目录的方案保持原样。原 `addonlist.txt` 条目保留。
- 独立库条目先撤回受管部署副本，再把源 VPK 和 `item.json` 移入回收站；还原回独立库，保留原 ID 和方案选择，等用户应用时再次部署。
- 还原恢复仍存在的分类和方案关系；原分类已删除时放到 `cat-none`。文件恢复后在游戏配置中设为停用，恢复的方案选择会在使用该方案启动或手动应用后写入游戏配置。
- `restored` 返回 Mod ID。发生同名冲突时整项保留在回收站，其他无冲突条目继续处理。列表同时给出文件名、总大小和 `workshopId`，供前端做永久删除二次确认与 Steam 订阅提醒。
- 正常回收条目为 `trashed`。写入中断时记录保留：`moving` / `restoring` 显示「待还原」，调用 `restore-mods` 继续；`purging` 显示「待完成删除」，再次调用 `purge-trash` 继续。待恢复期间，导入、应用和新删除返回 `trash_recovery_required`。
- 操作失败后重新读取 snapshot：批量还原 / 永久删除中已完成的条目会保留结果，尚未完成的条目保留记录。`confirmation_required` 表示缺少确认，`mod_missing` 表示源条目已移除，`file_changed` 表示文件在操作中变化。

离线检查：Mod 相关夹具覆盖收藏重载、嵌套分类、内嵌/分卷 JPEG、回收与还原、同名冲突、游戏运行拦截、写入失败及中断恢复。检查使用临时游戏目录；真实游戏实测留给用户启动后确认。

## 4. 前端实施顺序

1. ✅ 统一动作表 + 右键菜单 + 批量栏改造（纯前端）
2. ✅ 加入 / 移出其他方案、拖到侧栏方案（纯前端）
3. ✅ 收藏 + 侧栏「库」入口（前端完成；`modMeta` 后端存储已接入）
4. ✅ 任务托盘（snapshot `tasks` + `task_progress`，按 `taskId` 合并）
5. ✅ 删除 / 回收站
6. ✅ 声音试听（单播放器，换声 / 停播时释放 Blob URL）
7. ✅ 解包到桌面（完成 toast 带「打开文件夹」，用事件里的 `dir`）
8. ✅ 创意工坊下载 + 新下载（按 `downloadable` 勾选，显示 `reason`）

交付检查：相关离线夹具覆盖分卷解包、实际辅助程序 ADPCM 解码、下载取消 / 重试 / CRC 错误、零方案关联、部署冲突及回收还原；Svelte 类型检查和 Tauri `cargo check` 通过。另从官方 CDN 完整下载公开样本 `892919910` 到临时夹具，21,782,106 字节，16 个资源校验通过，入库后停用且方案列表为空。真实游戏、插件和已有发布包保持原状态。

## 5. 待用户确认

- ~~「收藏方案」的意思~~ → 已定：给 Mod 打星标的收藏（2026-11-16）。
- ~~删除去哪~~ → 已定：Matcha 回收目录 + 回收站里手动永久删除（2026-11-16）。

## 6. 前端接入记录（2026-11-16，claude）

后端契约按 §3 原样使用，没有改字段名，也没有新的后端需求。

| 功能 | 入口 | 文件 |
| --- | --- | --- |
| 回收站 | 右键 / 批量栏 / 详情的「删除…」、Del 键；侧栏「库 › 回收站」 | `components/TrashView.svelte`，`stores/app.svelte.ts` 的 `deleteMods` / `restoreTrash` / `purgeTrash` |
| 任务托盘 | Mod 页底部，可折叠，有新任务时自动展开 | `components/TaskTray.svelte`，store 的 `tasks` / `onTask` |
| 创意工坊下载 | 工具条「添加 ▾ › 创意工坊链接…」；在 Mod 页按 Ctrl+V 粘贴工坊链接 | `components/WorkshopDialog.svelte`，`workshop.ts`（解析 ID） |
| 新下载 | 侧栏「库 › 新下载」，带数量角标；卡片上的「新」标记 | `Mods.svelte`，store 的 `isInbox` / `markSorted` |
| 试听 | 含 `sound/weapons` 的卡片悬停显示 ▶；详情「声音」分组列表；重叠面板里「本项 / 对方」对比；空格 / Esc 停止 | `stores/player.svelte.ts`，`components/SoundList.svelte` |
| 解包到桌面 / 在资源管理器中显示 | 右键菜单、详情操作区 | store 的 `extractMods` / `reveal` |

前端行为说明：

- 删除确认框列出要移走的文件（`.vpk`、分卷、`.jpg`）、总大小、会从哪些方案移除；`addons/workshop/` 下的订阅项会附上工坊链接，提示先在 Steam 取消订阅。删除后的 toast 带「撤销」，点击即调用 `restore-mods`。
- 永久删除、清空回收站都要二次确认，确认框写明「无法撤销」，并列出文件名和总大小。`moving` / `restoring` 状态的条目只能还原，`purging` 状态的条目只能继续永久删除。
- toast 现在可以带一个按钮（`app.toast(text, { label, run }, ms)`），确认框可以自定义按钮文字（`app.confirm(title, message, ok)`）。
- 收藏、移到分类时，前端先在本地清掉 `inbox`，和后端规则一致；加入方案后由下一次快照同步。
- 一批下载陆续完成时，合成一条提示「N 个 Mod 已下载 · 去整理」。失败的任务会弹出 `error.message`。
- 后端没有「删除任务记录」的接口，托盘里的「清除已结束」只在本机隐藏（localStorage `flare.tasks.hidden`）。如果以后想跨设备同步，可以加一个 `task-dismiss`，不急。

验证：用页面内的假后端在浏览器预览中走通了删除 → 撤销、批量删除（分卷 + 方案关系）、回收站还原（草稿提示）、还原冲突、永久删除和清空的确认文字、试听选中开火声、解包进度和「打开文件夹」、Ctrl+V 解析合集（已在库、不可下载、失败条目）、下载进度 / 取消 / 重试、新下载的进出。测前测后 `settings.json` 的 md5 一致。真实 Steam 下载、真实 VPK 解包和 ADPCM 试听没有在桌面版里实测，留给打包后确认。
