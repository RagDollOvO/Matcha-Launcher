# 设置页：交给后端补的接口 · 2026-11-17

设置页这次重排后，新增了「游戏目录」「启动器」「数据与重置」「关于」四节，外观里加了界面缩放和减弱动效。前端已经按下面的契约接好：命令不存在时，桌面服务默认返回 `unsupported_capability`，界面会在那一行显示「即将支持」，不会报错。后端补上对应命令后，不需要再改前端。

前端入口：`src/lib/api/launcher.ts`（命令封装）、`src/lib/stores/app-info.svelte.ts`、`src/lib/settings/{LauncherBehavior,DataReset,About,Appearance}.svelte`、`src/lib/theme/display.svelte.ts`。

## 一、桌面服务命令

都走现有的 `call(command, params)`。只有 `cache-clear` 带用户确认信封（`approved: true`），其余都是普通调用。

| 命令 | 参数 | 返回 | 用在 |
|---|---|---|---|
| `app-info` | `{}` | `AppInfo` | 关于的版本号；数据与重置里的「数据目录」「日志」两行 |
| `cache-status` | `{}` | `{ items: CacheItem[], totalBytes: number }` | 数据与重置 › 缓存 |
| `cache-clear` | `{ ids: string[] }` + 确认 | `{ cleared: string[], freedBytes: number }` | 同上，「清理…」按钮 |
| `launcher-behavior-get` | `{}` | `LauncherBehavior` | 启动器 › 关闭按钮、开机启动 |
| `launcher-behavior-set` | `Partial<LauncherBehavior>` | 保存后的完整 `LauncherBehavior` | 同上 |
| `update-check` | `{}` | `UpdateInfo` | 关于 › 检查更新 |

```ts
interface AppInfo {
  version: string;        // 与 tauri.conf.json / package.json 一致
  dataDir: string;        // DesktopService.dataDir
  logsDir?: string;       // 没有单独日志目录就省略，前端不显示那一行
  piConfigDir?: string;   // DesktopService.piConfigDir；前端优先用助手已报的 configDir
}
interface CacheItem {
  id: string;             // 稳定标识，原样传回 cache-clear
  label: string;          // 给玩家看的名字，例如「Mod 封面」「工坊预览图」「DLL 整理暂存」
  bytes: number;
  detail?: string;        // 一句说明，可省略
}
interface LauncherBehavior {
  closeToTray: boolean;   // 点关闭时缩到托盘而不是退出
  autostart: boolean;     // 登录 Windows 时启动，启动后留在托盘
}
interface UpdateInfo {
  current: string; latest: string; hasUpdate: boolean;
  url?: string;           // 发布页，前端用内置浏览器打开
  notes?: string;         // 纯文本发布说明，前端按原换行显示
  publishedAt?: string;   // ISO 8601
  checkedAt: string;
}
```

### 缓存的范围

只算**删了能自己再生成或再下载**的东西。建议的 `id`：

- `mod-thumbnails`：`backend/mods/thumbnails.mjs` 生成的 Mod 封面
- `workshop-preview`：工坊预览图、列表封面缓存
- `discover-images`：B站、GameMaps 的封面缓存
- `dll-intake`：`<dataDir>/dll-intake/` 里**已经导入完或已过期**的暂存
- `dll-sources`：`<dataDir>/dll-sources/` 里已经导入完的下载暂存

**不能算进来**：已导入的 Mod、Matcha 回收站、方案与设置、`tasks.json`、`download-settings.json`、助手会话与配置、正在进行中的任务用到的文件、Steam++ 证书。

`cache-clear` 对正在使用的条目跳过即可，`cleared` 只列真正清掉的 `id`。清完前端会重新调一次 `cache-status`。

### 检查更新

更新源由你们定（GitHub Release 或别的发布页）。只做「检查并告诉玩家」，不自动下载、不替换文件；`url` 指向发布页，玩家自己去下。网络走现有的系统 / 社区加速通道。

## 二、桌面壳（src-tauri）

### 1. 权限

前端已经在调用，但现在的 capability 没放行：

| 文件 | 加上 | 用途 |
|---|---|---|
| `capabilities/main.json` | `core:webview:allow-set-webview-zoom` | 外观 › 界面缩放 |
| `capabilities/agent.json` | `core:webview:allow-set-webview-zoom` | 助手窗口跟着主窗口缩放 |
| `capabilities/main.json` | `core:window:allow-unminimize` | 启动器 › 启动游戏后「最小化」：游戏退出时把窗口叫回前台 |

没放行时：缩放那一行显示「即将支持」；叫回前台退而求其次用 `show()` + `setFocus()`，在最小化状态下可能叫不回来。

### 2. 缩到托盘、开机启动（`launcher-behavior-*` 背后）

- **托盘**：`closeToTray` 打开时，主窗口的 `CloseRequested` 改成隐藏窗口，托盘菜单至少有「显示 Matcha」「退出」，单击托盘图标显示主窗口。前端标题栏的关闭按钮仍调用 `getCurrentWindow().close()`，在那之前会先销毁助手窗口（`src/lib/api/bridge.ts` 的 `windowAction('close')`），这部分不用改。
- 缩到托盘期间下载、社区加速、Pi 进程都照常运行；真正「退出」时沿用现有的清理流程。
- **开机启动**：可以用 `tauri-plugin-autostart`。建议开机启动时带一个参数，让窗口直接留在托盘、不弹出来。
- 两个开关保存在桌面服务的设置里，`launcher-behavior-get` 读的是实际生效的状态（例如注册表里的启动项被用户删掉了，就返回 `false`）。

## 三、请顺带在桌面版里确认一件事

「数据与重置 › 界面偏好 › 导出」用的是网页里最普通的做法：生成一个 Blob，用 `<a download>` 下载成 `matcha-界面偏好-YYYYMMDD.json`。浏览器预览里没问题；**请在桌面版里点一下确认 WebView2 会正常弹出保存或者存进下载文件夹**。如果被拦了，加一个 `prefs-export-save { suggestedName, content }`，由壳弹保存对话框并写文件，前端再换过去。导入用的是 `<input type="file">`，和导入壁纸是同一种方式，已经能用。
