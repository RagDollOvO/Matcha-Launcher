# 游戏设置：后端接口与启动接入

主页的「启动设置」打开「启动项」和「游戏配置」。启动项提供跳过片头、控制台、低血腥度、锁帧和自定义参数；「更多启动项」保留显示、刷新率、日志和完整参数预览。恢复默认启动项会保留 CFG。

## 游戏配置：直接改值，保存即写入

- 「画面」可选择队友、已重生特感、灵魂态特感、近处和远处物品的轮廓配色，或静态准星；「网络」是帧率与网络信息。每项都是可编辑控件（数字框、开关、下拉）。颜色项的色块就是取色器，支持 `EyeDropper` 的环境另有「取色」从屏幕吸色；轮廓按 0–1、准星按 0–255 换算。
- 改任一项即改 CFG 文本（`applySnippet`）：已有的直接赋值就地改值，保留注释、绑键和换行；缺的命令按界面显示值整组补到末尾。CFG 原文也可直接编辑。
- 不再有「写入游戏」开关和「加入 CFG」按钮：CFG 有内容时前端置 `autoexec.enabled = true`，清空时置 `false`（后端撤掉 Matcha 标记段）。旧版存了草稿但 `enabled: false` 的用户，页面底部显示「写入游戏」，点一下才写入，不在加载时自动改。
- L4N 启动和连接服务器的基础参数为 `-steam -novid`；L4N 与 DXVK 开关分别保存，`-vulkan` 仅在用户填入自定义启动项时传入。纯净对抗使用原版启动参数；已写入游戏目录的 CFG 由游戏自身加载。游戏运行时保存偏好，待下次 L4N 启动前应用挂起的写入。
- 设置改动 400ms 自动保存，写请求串行处理；`app.launch()` / `app.connectServer()` 先 `await gameSettings.flush()`。保存失败会显示字段错误并停在启动前，草稿保留供修正和重试。确认框直接取保存回执中的参数。

## `game-settings-get` → `GameSettingsReply`
## `game-settings-set (GameSettings)` → `GameSettingsReply`

整份替换（前端每次发完整对象）。存在 `<dataDir>/settings.json` 的 `gameSettings` 字段，全局一份；其他方案和设置字段保留。未选择游戏时也可保存，选定游戏后的下一次保存或启动会应用 autoexec。

```ts
interface GameSettings {
  display: { mode: 'default' | 'fullscreen' | 'windowed' | 'noborder'; width: number | null; height: number | null; refreshHz: number | null };
  fpsMax: number | null;      // null = 不加；0 = 不限制
  novid: boolean;             // -novid
  console: boolean;           // -console
  lowViolence?: boolean;      // -lv，旧配置省略时为 false
  consoleLog: boolean;        // -condebug
  highPriority: boolean;      // -high
  extraArgs: string;          // 用户自定义追加参数（原文）
  autoexec: { enabled: boolean; values: Record<string, string>; extra: string };
}
interface GameSettingsReply extends GameSettings {
  effective: Record<'modded' | 'clean' | 'direct' | 'development', string[]>;
  autoexecPath?: string;                                  // 实际写入的 autoexec.cfg 绝对路径
}
```

### 启动参数合并（`backend/launch.mjs` 的 `launchSpec`）

`launchSpec(mode, connect?, settings?)` 从 `baseLaunchArgv(mode)` 取模式基础参数。`modded` / `direct` 默认为 `-steam -novid`；`development` 的基础参数为 `-insecure`。有设置时，在基础参数之后合并设置和自定义参数，按参数组去重，同名项取自定义值。`clean` 始终使用 `-steam -novid`。各模式都将可选的 `+connect` 和目标地址放在末尾。

| 设置 | 参数 |
|---|---|
| `display.mode` fullscreen / windowed / noborder | `-fullscreen` / `-windowed` / `-windowed -noborder` |
| `display.width` + `height`（两者都有才加） | `-w W -h H` |
| `display.refreshHz`（24–1000 的整数或 null） | 显式全屏时使用 `-refresh Hz`；切换窗口或无边框时保留选择，下次切回全屏可复用 |
| `novid` | 开启时添加 `-novid`；显式关闭时移除模式基础参数中的 `-novid` |
| `lowViolence` | `-lv`，使用游戏的低血腥度模式 |
| `console` / `highPriority` | `-console` / `-high` |
| `consoleLog` | `-condebug`；游戏将控制台输出写入 `left4dead2/console.log` |
| `fpsMax !== null` | `+fps_max N` |
| `extraArgs` | 按空白拆分后追加 |

校验：`extraArgs` 中的连接目标、模式和游戏路径由启动流程管理（`+connect`、`-insecure`、`-secure`、`-game`、`-defaultgamedir`、`-applaunch`）；拦截引号、换行、控制字符和分号。宽高为 320–7680 整数或 null；fpsMax 为 0–1000 整数或 null。无效参数返回 `game_settings_invalid`，`details.field` 和 message 带字段名。

旧配置、旧调用可省略 `refreshHz` 和 `consoleLog`，分别按 null 和 false 处理。刷新率和日志参数对应 [Steam 的启动项说明](https://help.steampowered.com/en/faqs/view/7D01-D2DD-D75E-2955)。草稿预览和实际启动共用 `backend/launch-argv.mjs` 合并同名组（含 `-freq` / `-refresh`）。快照、设置回执与启动确认均使用最终参数；服务器连接目标始终在末尾。

### autoexec.cfg

`enabled: true` 时在 `<游戏目录>/left4dead2/cfg/autoexec.cfg` 里维护一段：

```
// >>> Matcha（启动器管理这一段，其他内容保持原样）
// 队友轮廓
cl_glow_survivor_r 0
cl_glow_survivor_g 1
cl_glow_survivor_b 0
// <<< Matcha
```

- 替换整个 Matcha 标记段，段外按字节保留（包括 BOM、原有换行和旧编码字节）；文件不存在就新建。首次改变已有文件时创建同目录 `autoexec.cfg.matcha.bak`（改名前叫 `.flare.bak`，启动时自动改名接上），后续自动保存保留这份备份。
- 原文末尾缺少换行时，Matcha 标记附带 `[separator-added]`，关闭管理时一起撤回补入的分隔换行。标记缺失、重复或倒置会报错并保留原文件。UTF-16 / 含空字符文件会提示先转换编码。
- `values` 里空串项跳过；key 使用 `[a-z_0-9]+`，值写成 `"…"` 并校验引号和控制字符。`extra` 支持逐行自定义命令并校验双引号配对，`//` 注释内的引号保持原样。
- `enabled: false` 时删掉这段标记（不动其他内容）。
- 写入时机：保存时立即写（游戏没运行时）；游戏运行中保存只记录设置，下次启动前再写。文件发布前再次检查进程、路径链接和外部编辑，采用文件锁及临时文件替换。
- 设置先持久化，再应用文件。文件应用失败时回执错误的 `details.saved: true` 表示设置已存储，页面保留错误与草稿；重试或下一次启动前会再次应用，文件写入成功后才继续启动。
- 命令编辑器在 `src/lib/settings/GameCfg.svelte`，可选片段及其合并规则在 `src/lib/settings/cfg-snippets.ts`。

### 能力标记

快照 `capabilities.config` 已置为 `true`，前端通过新命令是否存在判断可用性。

## 离线检查

- `node --test backend/tests/game-settings.test.mjs backend/tests/launch.test.mjs`：参数和字段校验、原文与备份保留、运行中延期、三条启动路径、原 Core 调用兼容；启动器均替换为内存记录。
- `node checks/game-settings-store.mjs`：并发保存顺序、失败重试、旧偏好与手写 CFG 共存、重复插入保留原值、旧自定义启动开关。
- `npm run check`：前端类型检查。
