# 茶茶体检与设置权限 · 2026-11-18

## 用户的要求

1. 第一次接入、填好 DeepSeek（或别的服务商）Key 连上之后，**建议做一次茶茶体检**：CFG、启动项有没有问题；各宿主适配的 DLL（Matcha SDK 模组、L4N 子插件、整体加载的 DLL、L4N / DXVK 运行环境）有没有问题。
2. **给茶茶更多操作权限**，比如改设置页里的参数。

体检这一轮只读、出报告；要改的列清单，玩家同意后再走各工具的确认。前后端均已实现（用户让 claude 一并做了后端）。

## 入口（前端）

| 位置 | 行为 |
|---|---|
| `src/lib/components/Welcome.svelte` | 引导最后一步：茶茶已连上模型时多一行「进去后让茶茶做个体检」，默认开；主按钮变成「进入并体检」。关掉记为「以后再说」 |
| `src/lib/agent/AgentPanel.svelte` | 空对话第一次出现时显示首见卡片「先给游戏做个体检？」（开始体检 / 以后再说）；之后空白对话的建议里常驻「给游戏做个体检」。别处交过来的长指令默认只露 6 行，可「展开全文」 |
| `src/lib/agent/checkup.svelte.ts` | 拼体检指令。标记存 `localStorage['flare.checkup']`：`done` / `later` |
| `src/lib/stores/settings-sync.svelte.ts` | 收 `settings_changed` 重读对应设置；替茶茶读写界面偏好（`ui_request`） |

体检指令只能在主窗口里拼（要读游戏设置，助手窗口的桥只放行 `pi-*`），助手窗口里点「开始体检」时发 `matcha://to-main { type: 'checkup' }`，主窗口拼好再走原来的 `send`。

指令按后端能力降级：`get_commands` 里有 `skill:matcha-checkup` → 发 `/skill:matcha-checkup 首次接入体检`；否则有 `game_config_inspect` → 让茶茶自己读；都没有（旧后端）→ 把已保存的启动参数和管理段附在指令后面，读不到的标「未检查」。

## 技能 `matcha-checkup`

`backend/pi/skills/matcha-checkup/SKILL.md`，`transport.mjs` 用 `--skill` 显式加载。检查顺序：平台 → 各宿主 DLL 与运行环境 → 启动项（含 Steam 启动选项）→ CFG → VPK 冲突；报告分「需要处理 / 建议留意 / 正常」，看不到的标「未检查」，最后列可以帮忙改的项并等玩家同意。

## 工具（`backend/pi/settings-tools.mjs` ↔ 服务侧 `backend/pi/settings-host.mjs`）

走现有私有 IPC，操作名前缀 `settings-`。写入一律「预览 → `ctx.ui.confirm` → 按 planId 应用」，计划 10 分钟有效；应用前核对设置在预览后没被改过，否则 `settings_plan_stale`。

| 工具 | 读写 | 说明 |
|---|---|---|
| `game_config_inspect { file? }` | 只读 | 当前启动方式与 route、两种方式的最终参数、Steam 库启动选项（`userdata/<账号>/config/localconfig.vdf`，多账号）、autoexec.cfg 全文与 Matcha 管理段、Matcha 草稿（`managedDraft`）、cfg 目录顶层文件；`file` 读单个 .cfg/.txt/.rc（64 KiB）。另带 `inGameSettings.radar`（codex 加的物资雷达已存设置） |
| `game_settings_update { launch?, cvars?, extra?, cfgEnabled? }` | 确认后写 | `launch` 只写要改的字段；`cvars` 改管理段（已有就地改最后一次赋值、缺的补到末尾、`null` 删除）；`extra` 整段替换；`cfgEnabled` 控制是否写进游戏。走与 `game-settings-set` 同一个 `commitGameSettings`（校验、存设置、写管理段、游戏运行中延后） |
| `game_settings_import { accountId?, launch?, cfg? }` | 确认后写 | 把玩家已有的参数导入 Matcha（见下节）。`game_config_inspect` 返回 `importable` 时体检把它列为第一项 |
| `launcher_settings_inspect {}` | 只读 | 下载设置、茶茶默认值、界面偏好（含可选值）、`readOnly` 清单 |
| `launcher_settings_update { section, patch }` | 确认后写 | `downloads`（maxConcurrent 1–4、speedLimit）、`pi`（defaultThinkingLevel / autoCompaction / autoRetry，下次连接生效）、`ui`（界面偏好，经主窗口） |

CFG 直接赋值的读写规则只有一份：`backend/cfg-text.mjs`，页面的 `cfg-snippets.ts` 也从这里引入。管理段以外的 CFG 和 Steam 启动选项只读，但可以整体导入。

## 导入已有参数（`backend/game-settings-import.mjs`）

2026-11-18 用户反馈：首次体检后，Steam 库里的启动选项和 autoexec.cfg 里自己写的设置都没进 Matcha。Matcha 直接启动 exe，Steam 启动选项不生效；CFG 页只显示管理段，看不到这些设置。

- **Steam 启动选项** → Matcha 启动项。`-novid -console -lv -condebug -high`、窗口模式、成对的 `-w/-h`、全屏时的 `-refresh`、`+fps_max` 进对应字段；其余整组进自定义启动项（同名参数用导入的值，Matcha 已有的其他参数保留）。`-steam` 略过；`+connect -insecure -game` 等和带空格引号、分号的组不导入并说明原因。多个账号时默认用 `config/loginusers.vdf` 里最近登录且填了的那个。Steam 里的原文不动。
- **autoexec.cfg** → 管理段。按原顺序把段外的行搬进管理段，原管理段的位置换成 Matcha 当前的管理段内容；还没写进游戏的草稿接在最后。引号不成对的行留在段外。UTF-8 读不了时按 GBK 读，写回统一 UTF-8。应用前整份备份到 `autoexec.cfg.matcha-import-<本地时间>.bak`；游戏运行中拒绝；预览后文件或设置被改过报 `settings_plan_stale`，原文件不动。
- 入口：设置 › 启动项顶部的提示卡（`src/lib/settings/ImportExisting.svelte`，可「暂不」，内容变了会再出现），桥接命令 `game-settings-import-preview` / `game-settings-import-apply`；茶茶走 `settings-import-preview` / `settings-import-apply`。导入后发 `settings_changed { scopes: ['game-settings'], source: 'import' }`。
- 测试：`node --test backend/game-settings-import.test.mjs`。
- 2026-11-19 用户反馈：体检把「导入」和「顺手去掉 `-heapsize -processheap`」写在同一项里，用户回「1 别改，1 是有用的，我启用 L4N 平台了」（意思是保留参数），茶茶却把整项导入跳过了。技能已改：导入单独一项、不夹带删参数；`-heapsize` 在 L4N 平台启动下有用（L4N 解除 512 MB 上限，见 `vendor/l4n/*/readme_l4n.txt` 的 datacache 一节），不再称「过时」；`-processheap` 保留；回复含糊时先问清楚。两种启动方式都不经过 Steam，Matcha 启动项只用于 L4N 平台启动，纯净对抗不带自定义参数。

autoexec.cfg 的分段标记从 2026-11-18 起写 `// >>> Matcha（…）` / `// <<< Matcha`，读取时旧的 `Flare` 标记照样认，下次写入时换成新的。

## 确认方式：自主 / 每次都问（2026-11-19）

用户要求：「除非必要的再问我，否则后面装大型包要一直点确定」。起因是装 Skeeto 整包时，codex 的本机工具（`local-extension.mjs`）连读文件、搜索都要确认，一次安装点了约 20 次。

- 设置在 设置 › 工具与权限 › 确认方式，存到 pi 配置目录的 `matcha-permissions.json`（`{ "mode": "auto" | "ask" }`）。服务命令 `pi-permissions-get` / `pi-permissions-set`。默认 `auto`。扩展每次确认前现读，改了马上生效，不用重连。读不到配置目录（没有 `PI_CODING_AGENT_DIR`，比如单测直接调工具）时按 `ask`。
- 统一入口 `backend/pi/autonomy.mjs` 的 `confirmAction(ctx, title, message, { signal, risk })`：`risk: 'routine'` 在自主模式下直接放行，`'ask'` 照常弹确认。各工具按自己的风险传 risk：
  - 直接做：Mod 整理、分类、收藏、方案成员、撤销、下载、任务控制、导入网页下载、解包、启停、导入 VPK、移入回收站、还原；DLL 来源下载到暂存区、保存整理资料、首次导入（导入后保持停用）、更新停用中的模组；服务器添加、修改、整理；启动项、CFG、导入已有参数、启动器设置；读 SDK 工程。
  - 照样问：永久删除回收条目、移除服务器或删类别、执行插件动作（`plugin_invoke` 没走 confirmAction，始终问）、安全检查有 review 项的 DLL、更新已启用的 DLL（新代码下次启动就运行）。
  - 本机工具：读文件、搜索、列目录直接做，除非是 `.ssh`、浏览器登录数据、凭据库、`pi/auth.json` 这类敏感位置；写文件只在游戏目录、下载目录和茶茶工作目录里直接做；PowerShell / Bash 用 `shellRisk()` 排除法判断，命中执行脚本或程序（`&`、`.\x`、`*.exe/.bat/.ps1`、`powershell -File`、`Start-Process`、`iex`…）、删除、联网、注册表、服务、进程、往系统目录写，就问。拿 Skeeto 那次的 19 个本机操作实测：只有 2 次运行作者的 `Maintain.ps1` 要问。
- 茶茶不能改自己的确认方式（`READ_ONLY_SETTINGS` 里写了）。
- 测试：`node --test backend/pi/autonomy.test.mjs`。

**不开放给茶茶**（`readOnly` 里告诉它让玩家自己改）：服务商密钥、社区加速（装根证书）、切换游戏目录、关闭到托盘与开机自启（由桌面壳实现）、缓存清理 / 数据重置 / 存储迁移、壁纸和字体文件。

## 界面偏好往返

界面偏好只存在前端 localStorage，由主窗口代办：

```ts
// 服务 → beacon-event（只有主窗口 App.svelte 处理）
{ type: 'ui_request'; requestId: string; action: 'prefs-get' | 'prefs-set'; patch?: Record<string, string | number | boolean>; dryRun?: boolean }
// 主窗口 → 桥接命令 ui-response（不进服务的串行队列）
{ requestId; ok: true; value } | { requestId; ok: false; error: { code, message, details? } }
```

- `prefs-get` → `{ prefs: UiPref[] }`；`prefs-set` → `{ applied, changes: { key, label, from, to }[], prefs }`。`UiPref = { key, label, group, value, options?, range?, note? }`，`options` 已去掉当前不可选的值。
- 整批校验，一项不合法整批不改。错误码 `ui_prefs_unknown`、`ui_prefs_invalid`、`ui_request_unknown`；服务等 5 秒无回执报 `ui_unavailable`。
- 键名（改名要两边同步）：`look` `wallpaperPreset` `wallpaperMode` `wallpaperTone` `veil` `wallpaperCarousel` `carouselInterval` `carouselShuffle` `carouselFollow` `zoom` `reduceMotion` `font` `soundMuted` `soundVolume` `soundUi` `soundAmbient` `busySend` `thinking` `replySound` `autoTitle` `showUsage` `enterSends` `agentWindow` `afterLaunch` `likePrompt` `systemNotify`。`zoom` 只在桌面壳放行缩放时出现；轮播的四项只在玩家加过轮播图、且没在用动态壁纸时出现。

## `settings_changed` 事件

`{ type: 'settings_changed', scopes: ('game-settings' | 'download-settings' | 'pi-settings')[], source: 'agent' }`，只在茶茶改设置后发。前端：`game-settings` → `gameSettings.load()`（有未保存改动时跳过）；`download-settings` → `downloads.loadLimits()`；`pi-settings` → 设置页对话默认值重读。

## 检查

- `node --test backend/pi/settings-skill.test.mjs`：CFG 规则、只读检查不改文件、取消不落盘、确认后只改管理段、预览后被改过报 stale、非法参数、下载设置、界面偏好往返、技能与工具注册。
- `npm run check`。
- 浏览器预览 `?mockpi&welcome` 看引导最后一步和首见卡片。

## 还没覆盖

- 真实模型下跑一遍完整体检（需要玩家的 DeepSeek Key，没在这里发起付费请求）。
- 桌面版（Tauri）里的 `ui_request` 往返只在浏览器预览和单测里验证过。
- DLL「入口冲突」目前靠茶茶从 `dll_inventory` 的文件清单里判断，没有专门字段。
