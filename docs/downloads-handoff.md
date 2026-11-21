# 下载页后端契约 · 2026-11-17

以下命令已接入桌面服务和 Vite 开发桥。主界面沿用 `call(command, params)`，五条新命令都使用普通调用。前端负责按钮、设置控件，以及系统通知的 npm 包和发送时机。

| 命令 | 参数 | 返回 |
|---|---|---|
| `task-pause` | `{ taskId: string }` | `ModTask` |
| `task-resume` | `{ taskId: string }` | `ModTask`（原 ID） |
| `download-settings-get` | `{}` | `{ maxConcurrent: number, speedLimit: number }` |
| `download-settings-set` | `{ maxConcurrent?: number, speedLimit?: number }` | 保存后的完整设置，形状同上 |
| `task-remove` | `{ taskIds: string[] }` | `{ removed: string[] }` |

## 暂停保留进度，继续回到队尾

- 收到 `pausable: true` 就可显示「暂停」。工坊、GameMaps 下载和本地解包在排队或运行时支持暂停；校验、最终提交、已结束的任务返回 `false`。「全部暂停」只提交当时可暂停的行；若任务刚进入下一阶段，按最新事件更新（`task_not_pausable`）。
- `state === 'paused'` 就显示「继续」。暂停保留 `done / total`、释放并发名额，后面的任务顺延。重开应用仍保持暂停，也可直接用原有 `task-cancel` 取消。
- `resumable` 表示**能从已收字节续传**。本版返回 `false`：已传了一部分的下载提示「继续会重新下载」，解包提示「继续会重新解包」。继续复用原任务 ID 和游戏目录，进度归零、回到队尾，有空位就开始。GameMaps 已有完整文件和导入凭据时仍会复用。
- `task-list`、快照 `tasks`、`task_progress` 都返回同一组字段。暂停期间保留进度条，把该任务移出测速 / ETA 统计即可。原有 `task-retry` 仍用于失败、取消的任务，使用原来的用户确认信封，返回 `{ taskId }`。

## 两个设置的作用范围

- **并发**：`maxConcurrent` 为 1–4 的整数，默认 2。后台 Mod 任务共用名额，包含解包。调大立即补位；调小时已开工的任务照常完成，运行数低于新上限后再补位。
- **限速**：`speedLimit` 为非负安全整数，单位 **B/s**，默认 0 表示不限。这个额度由工坊和 GameMaps 的文件传输**合计共享**。保存后，正在传输的文件立即使用新额度。例：1 MiB/s 写 `1048576`。
- 设置独立保存在应用数据目录的 `download-settings.json`。可以只改一个字段；越界、小数或未知字段返回 `invalid_argument`，原值保留。内置浏览器标签页里由网页发起的 `BrowserDownload` 走独立的 WebView2 下载列表。

## 发现里的网页下载

同一个下载页按网页记录 `id` 调用 `browser_call` 的 `download-pause`、`download-resume`、`download-cancel`。WebView2 回报状态后再更新按钮：`paused` 为用户暂停，`waiting` 为可恢复或可能自动重试的传输中断；`canResume` 决定是否提供「继续」。网站可能要求从头传输。关闭来源标签后仍可操作这笔下载；退出 Matcha 后，未结束的网页下载在下次启动时记为 `interrupted`，可从来源页重新下载。

## 删除记录与历史保留

`task-remove` 只处理 `done / failed / canceled`。未结束和未知 ID 跳过，重复 ID 只处理一次；前端按回执 `removed` 从任务列表移除。磁盘上的已下载文件、已导入 Mod、解包目录及来源凭据全部保留。「收进历史」继续用本机归档标记；真正删除时才调用此命令。网页记录使用独立的 `BrowserDownload.id`。

旧版每次新增任务会把总记录数裁到约 100 条。本版的 `tasks.json` **保留到用户主动删除**，重启保留，没有条数和天数淘汰。升级沿用旧文件中仍存在的记录。「当前」的 7 天仅影响前端展示。

## 历史时间：按结束时间分月

- **ModTask**：新增 `finishedAt?: string`。成功、失败、取消时写入，此次结束后保持固定；重试会清空，直至本次尝试结束。旧的终态记录用原 `updatedAt` 补齐。意外退出后首次恢复的未完成任务以恢复时间记为 `failed / task_interrupted`；暂停任务继续保持 `paused`。
- **BrowserDownload**：`startedAt?: string`、`finishedAt?: string` 随 `browser-event` 的 `download` 和 `browser_call` 的 `downloads` 动作返回。开始时写前者，成功、失败或取消时写后者。重启发现中断时，记录首次发现时间并保存。旧的已结束网页记录可以缺少两者。
- 时间均为 UTC ISO 8601 字符串。按用户本地月份分组：任务取 `finishedAt ?? updatedAt`，网页取 `finishedAt ?? startedAt`；网页两者均缺时保留「没有记录时间」。

## 系统通知：点击屏幕弹窗回到下载页

Rust 已注册 `tauri-plugin-notification` 2.8.1，`notification:default` 仅授予 `main`。前端添加 `@tauri-apps/plugin-notification`，按原约定，在主窗口失焦或最小化时将工坊完成 / 下载失败合并发送。取得通知权限后使用：

```ts
sendNotification({ title, body, extra: { route: 'downloads' } });
```

标记为 `downloads` 的通知被点击时，Rust 显示主窗口、解除最小化并请求焦点，现有事件桥将主界面切到下载页。Windows 仅在弹窗仍显示于屏幕时上报点击；进入通知中心后按普通通知处理。[插件点击行为](https://v2.tauri.app/reference/javascript/notification/#onaction)

Windows 系统通知按安装版验收；项目目前默认产出便携目录，保留已有应用内提示。开发模式下系统可能显示 PowerShell 名称和图标。[Tauri 平台说明](https://v2.tauri.app/plugin/notification/#supported-platforms)

## 前端已有功能（接入前）

- `src/lib/components/Toasts.svelte`：提示条改成 M3 snackbar，成功 / 错误图标、下载完成带 Mod 封面、多个按钮、悬停暂停倒计时、弹性进出场。
- `src/lib/stores/app.svelte.ts`：新增 `app.notify()`（`toast()` 保持兼容）；`perform()` 的成功 / 失败提示带图标；创意工坊下载完成的提示带「加入方案」「查看」，失败的提示带「重试」。
- `src/lib/stores/downloads.svelte.ts`：网页下载完成 / 失败 / 中断的提示。
- `src/lib/pages/Downloads.svelte`：已完成的 Mod 一键「加入方案」、「在创意工坊查看」、「全部取消」、已结束按天分组、标题区显示今天下了几个、任务完成时那一行飞到「已结束」、换成壁纸主色。
- `src/lib/motion.ts`：「飞入下载」的缩略图不再写死深色。
- `src/lib/stores/downloads.svelte.ts` + `Downloads.svelte`：「当前 / 历史」两个视图。「×」和「全部收进历史」只是从「当前」拿走（本机 `flare.tasks.archived`、`flare.downloads.web-archived`），历史里的「删除记录」才真正不显示。Mod 已被删掉的记录显示「已删除」和「重新下载」（走现有的 `workshop-download`）。
