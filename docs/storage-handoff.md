# 存储位置与空间：交接单（claude → codex，2026-11-18）

用户反馈：C 盘空间紧张，**下载和缓存不要放在 C 盘**；同时同意下面几处「同一份东西存两份」的整理。前端（设置 › 存储）已按本契约接好，命令未实现时显示「即将支持」，不报错。

**交付状态：P0、P1 已接入。** WebView2 使用选择性清理；浏览器、GameMaps 和茶茶导入共用受管下载路径。部分导入、外部改动的文件和回收站保留。玩家入口见[存储位置](platform/MATCHA_DESKTOP.md#下载放在哪个盘)。

## 改动前的位置与问题

| 内容 | 位置 | 问题 |
| --- | --- | --- |
| 网页下载 | `<dataDir>/browser/downloads/<id>/` | dataDir 在 C 盘；导入后压缩包一直保留，「清空历史」只删记录 |
| GameMaps 下载 | `<dataDir>/gamemaps/downloads/<task>/` | 同上 |
| 内置浏览器 profile | `<dataDir>/browser/profile`、`steam-profile`（`src-tauri/src/browser.rs:91`） | WebView2 缓存会越长越大，在 C 盘 |
| 组件 / DLL 缓存 | `native-libraries`、`platforms/cache`、`dll-sources`、`dll-intake` | 在 C 盘，体积中等 |
| 独立库 | `left4dead2/.matcha-library/workshop/<id>/mod.vpk` | 已在游戏盘 ✓ |
| 启用的独立库副本 | `addons/matcha_ws_<id>.vpk`（`backend/mods/library.mjs:78` `copyFile`） | **完整复制一份**，启用的工坊 Mod 占两倍空间 |
| 回收站 | `left4dead2/.matcha-trash/` | 不自动清空（按 11-16 定的方案，保持） |

## P0 · 不多占空间（改动小、收益最大）

1. **独立库部署改硬链接。** `.matcha-library` 和 `addons` 都在 `left4dead2/` 下，必然同盘。`deploy()` 改为 `fs.link(source, target)`，遇到 `EXDEV` / `EPERM` 再退回复制。`deployment.stamp` 的同名检查要按硬链接重新确认（源和目标是同一个文件）。已有的复制副本：下次应用方案时，内容一致就换成硬链接；也可以在 `storage-clean` 里做（见 `relink-deployed`）。
2. **导入成功后删除下载的压缩包。** 网页 / GameMaps 下载导入成功后删掉压缩包，下载记录保留（来源、文件名、「已清理」状态），用户想要时能重新下载。由设置 `deleteArchivesAfterImport` 控制，默认 `true`。没导入成功、或只是普通文件下载的，不动。

## P1 · 下载与缓存位置

用户可以选一个「下载与缓存位置」。下列内容放到这个位置下面，C 盘只留设置、任务记录、日志、茶茶的配置这类小文件：

- `downloads/browser/<id>/`（原 `browser/downloads`）
- `downloads/gamemaps/<task>/`
- `cache/`：`native-libraries`、`platforms/cache`、`dll-sources`、`dll-intake`

**默认位置**：游戏所在盘不是系统盘时，默认 `<游戏根目录>\left4dead2\.matcha-data\`（和 `.matcha-library` 同盘，导入时可以直接 rename / 硬链接，不再复制）。游戏也在 C 盘、或还没选游戏时，沿用现在的 dataDir。旧的下载不自动搬，由用户在设置里点「搬过去」。

### `storage-get` → `StorageStatus`

```ts
interface StorageStatus {
  location: {
    path: string;            // 当前「下载与缓存位置」
    custom: boolean;         // 用户自己选过
    volume: Volume;
    /** 旧位置里还留着的字节数（换过位置、或从旧版本升级）；有值时前端显示「搬过去」 */
    pendingBytes?: number;
    pendingPath?: string;
  };
  /** 推荐位置，前端做一键选择。至少给出「游戏所在盘」那一项（游戏盘是系统盘时可以不给） */
  suggestions: { path: string; label: string; volume: Volume }[];
  /** 游戏库所在盘（独立库、回收站、addons） */
  gameVolume?: Volume;
  usage: StorageUsage[];
  deleteArchivesAfterImport: boolean;
  /** 搬家进行中 / 失败；没有搬家时缺省 */
  move?: { from: string; to: string; doneBytes: number; totalBytes: number; state: 'moving' | 'failed'; error?: string };
  scannedAt: string;         // ISO；扫描可以缓存 ≤10 秒
}
interface Volume { root: string; label?: string; system: boolean; freeBytes: number; totalBytes: number }
interface StorageUsage {
  id: 'library' | 'deployed' | 'trash' | 'downloads' | 'browser-cache' | 'components' | 'app-data';
  bytes: number;
  where: 'game' | 'storage' | 'appdata';   // 在游戏盘 / 下载位置 / C 盘配置目录
  path?: string;                            // 「打开」用
  mode?: 'link' | 'copy';                   // 只有 deployed：硬链接不额外占空间
  reclaimableBytes?: number;                // downloads：已导入的压缩包；browser-cache：不含登录信息的缓存；deployed(copy)：可换成硬链接省下的
}
```

`deployed` 为硬链接时，`bytes` 填 0（不额外占空间），前端显示「硬链接，不额外占空间」。

### `storage-set { deleteArchivesAfterImport?: boolean }` → `StorageStatus`

### `storage-move { path }` → `{ status: 'started' }`（需要用户确认，前端以 approved 调用）

- 校验：绝对路径、可写、不在系统目录（`C:\Windows`、`Program Files` 等）、不是当前位置的子目录。传当前位置本身时，只把 `pendingPath` 里剩下的搬过来。
- 下载、导入、解包进行中返回 `storage_busy`；内置浏览器的下载也算。
- 同盘 rename，跨盘「复制 → 校验大小 → 删除源」，中断可续。进度写进 `storage-get` 的 `move`，变化时发 `storage_changed` 事件（前端收到就重新 `storage-get`，没有事件时搬家期间每秒轮询）。
- 浏览器 profile 由 Rust 侧持有，WebView2 运行中不能搬：记下新位置，**下次启动时**再用。`downloads.json` 里的路径同步更新。

### `storage-clean-preview { kinds }` → `{ items: { kind, label, bytes, files: number }[], totalBytes }`
### `storage-clean { kinds }` → `{ freedBytes }`（需要用户确认）

`kinds` 取值：

- `imported-downloads`：已经导入成功的压缩包（记录保留）。
- `browser-cache`：内置浏览器的磁盘缓存，**保留 Cookie 和登录**（WebView2 `ClearBrowsingDataAsync`，只清 DiskCache / CacheStorage / ServiceWorkers 等）。
- `relink-deployed`：把已有的复制副本换成硬链接。游戏运行中返回 `game_running`。

清空回收站继续用现有的 `purge-trash 'all'`。

## P2

- `app-info` 里的 `dataDir` 说明改成「设置和记录」；新增 `storageDir`，数据与重置那一节一起显示。
- 首次启动的欢迎引导以后可以加一步「下载放哪个盘」，等 P1 好了再说。

## 前端已做

- `src/lib/api/storage.ts`：上面几条命令的类型化入口；`unsupported_capability` 时视为「待接入」。
- `src/lib/settings/Storage.svelte`：设置 › 存储。位置（含系统盘提醒、推荐位置、搬家进度）、占用条形图和逐项清理、「导入后删除压缩包」开关。后端没接上时，回收站一行仍用 snapshot 的 `trash` 显示真实大小，并能清空。
- 封面缓存加了上限：大于 80 KB 的封面在前端缩到 320px，内存里最多留 400 张或 32 MB（`src/lib/stores/thumbs.svelte.ts`）。后端仍可按原交接单缩到 ≤256px。
