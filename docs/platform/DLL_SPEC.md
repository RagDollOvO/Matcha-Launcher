# Matcha SDK：DLL 模组开发规范

写给想让自己的 DLL 出现在 Matcha「DLL 模组」页、能被玩家一键启停的作者。按做一个模组的顺序排列：先跑通样例，再写包和 manifest，然后编排桌面展示、接入游戏内设置，最后打包交付。

名字约定：Matcha 是启动器，Matcha SDK 是这套插件接口。为保持兼容，下列历史标识保持原样：C 头文件和符号 `l4p_*.h` / `L4P_*`、游戏目录 `bin/l4p/`、平台服务 ID `flare.game-ui` 与 `beacon.source`、结果格式 `flare.report.v1`。

按需查阅：[manifest](#3-manifest-总览) · [动作与结果](#4-动作与结果) · [桌面展示](#5-桌面展示) · [游戏内菜单示例](#61-注册一个只有开关的页面) · [C ABI](#7-c-abi-与线程模型) · [Source 服务](#8-source-服务参考) · [交付与核验](#9-打包交付与核验) · [本地调试](#10-本地调试)。

## 1. 快速开始

先用现成的「物资雷达」把完整流程走一遍：

1. 在工作区根目录构建样例。首次构建先按[第 10 章](#10-本地调试)配置 Windows x86 工具链：

   ```powershell
   cmake --build native/build-x86 --target flare_game_ui ragdoll_supply_radar
   ```

   两个包都在 `native/build-x86/dist/bin/l4p/plugins/`：`ragdoll.supply-radar/` 是雷达，`flare.game-ui/` 是游戏内设置服务。
2. 退出游戏，在 Matcha 选择已部署 Runtime 的游戏目录。打开「DLL 模组 → 添加 → 本机 DLL / ZIP / 文件夹」，选 **`ragdoll.supply-radar/`**，核对文件清单并确认导入。缺少设置服务时，确认框会列出可「一并安装」的随附依赖；若未列出，先单独导入 `flare.game-ui/`。
3. 打开雷达开关，保持 Steam 登录，回到首页用「L4N 平台启动」进游戏，按 Ctrl + F7 选「物资雷达」。
4. 回到 Matcha 点功能卡片，看看 `presentation.page` 写出来的详情页长什么样。

做自己的模组，建议从最小源码 `native/examples/demo.hello/` 复制起步。换成自己的包 ID、显示名和作者，让 DLL 返回的 `id`、`version` 与 manifest 一致，再按第 10 章加构建目标。雷达的 manifest 可单独参考：用自己的 `catalog.id` 和 `collections` 编排展示。以后只改本地开发包的 `presentation`，更新包里的 manifest 后重新导入同一 ID 即可；已签名包要重新生成发布清单并签名（§9.2）。

## 2. 包结构与命名

一个功能对应一个包。包就是一个目录（或把这个目录打成 ZIP）：

```text
yourname.hello-hud/
  manifest.json        必需，身份、能力和展示
  plugin.dll           必需，固定这个文件名
  cover.png            可选，功能封面
  media/…              可选，详情页图片，使用包内相对路径
  assets/              可选，游戏素材（sound/、materials/ …），见第 8 章 File API 2
  LICENSE              许可证文本；GPL 移植或走开发发布核验时必需
  SOURCE.md、source/   移植 GPL 源码时必需：对应源码、改动说明、构建方法
```

**ID 规则**：1–64 个 ASCII 字符，首尾为小写英文字母或数字，中间还可用 `.`、`_`、`-`。第一个点之前的整段（没有点就取整个 ID）须避开 `con`、`prn`、`aux`、`nul`、`com1`–`com9`、`lpt1`–`lpt9`，例如 `con.hud` 也会被拒绝。插件 ID、依赖 ID、动作 ID、参数名、配置字段 ID 和各级合集 ID 都遵循这条规则。

安装目录为 `bin/l4p/plugins/<id>/`；目录名、manifest 的 `id` 和 DLL 描述符的 `id` 三者一致。保留已发布的 ID 才能更新原模组。

**命名空间**：用你自己的前缀，例如 `yourname.hello-hud`。约定将 `flare.`、`beacon.`、`skeeto.` 留给平台服务和既有功能。桌面普通合集会过滤 `beacon.`、`skeeto.` 开头的 ID，以及精确 ID `demo.hello`；从示例起步时记得改名。

**只做依赖的包**（例如给别的功能提供服务）在 manifest 写 `"loadRole": "dependency"`。桌面不给它单独开关；使用者启用时它跟着启用，最后一个使用者停用后一起撤下。

## 3. manifest 总览

完整样例：`native/plugins/ragdoll.supply-radar/manifest.json`。「桌面」含导入包时做静态校验的 Core，「Runtime」是游戏里的加载器。标准 SDK 包按以下契约交付：

| 字段 | 必填 | 读取方 | 说明 | 详见 |
|---|---|---|---|---|
| `schemaVersion` | 是 | 两者 | 数字 `1` | — |
| `id` | 是 | 两者 | 稳定 ID | §2 |
| `name` | 是 | 两者 | 非空白显示名；Runtime 限 256 个 UTF-8 字节，排除内嵌 NUL | — |
| `author` | 建议 | 桌面 | 作者显示名；省略时桌面读取 `developer.author` | — |
| `version` | 是 | 两者 | 字符串 `"1.2.3"`：三段非负十进制整数，仅 `0` 本身可用零开头；与 DLL 返回值逐字一致 | §7 |
| `apiVersion` | 是 | 两者 | 数字 `1`，宿主与插件的 C ABI 版本 | §7 |
| `architecture` | 是 | 两者 | `"x86"`，入口 DLL 也须为 Windows x86 | — |
| `phase` | 是 | 两者 | `"render-init"` | §7 |
| `entry` | 是 | 两者 | `"plugin.dll"`，位于包根目录 | — |
| `dependencies` | 是 | 两者 | 例如 `[{ "id": "flare.game-ui", "version": "0.1.0" }]`。只填其他包，ID 唯一，版本精确匹配；无依赖写 `[]` | §6、§8 |
| `config` | 是 | 两者 | 配置字段声明；无配置项写 `[]` | §4 |
| `actions` | 是 | 两者 | 可调用动作；无动作写 `[]` | §4 |
| `loadRole` | 否 | 桌面 | `"dependency"` 表示只做依赖 | §2 |
| `loadKind` | 否 | 两者 | SDK 包默认 `"sdk"`。`"library"` 用于整体加载已有 DLL，`config` / `actions` 均为 `[]` | §9.1 |
| `launchScope` | 否 | Core | 旧包兼容字段，只接受 `"insecure"`；实际启动参数由玩家选择的启动方式决定，新 SDK 包通常省略 | — |
| `developer` | 开发发布核验时必填 | 发布工具、桌面 | 作者、用途、来源、许可、兼容性与能力声明 | §9.2 |
| `presentation` | 建议 | 桌面 | 列表、合集、详情页的全部展示内容 | §5 |

`presentation` 里的字段：

| 字段 | 说明 | 详见 |
|---|---|---|
| `schema` | 固定 `1` | — |
| `summary` | 一句话简介，用于卡片和标题区，最多 160 字 | §5.1 |
| `description` | 完整说明，最多 12,000 字；没写 `page` 时就显示它 | §5.4 |
| `cover` | 功能封面路径 | §5.2 |
| `tags` | 标签，最多 8 个，每个最多 24 字 | §5.1 |
| `catalog` / `collections` | 所属大合集和小合集 | §5.1 |
| `hero` | 详情页头图版式、强调色、一句话标语 | §5.3 |
| `modes` | 适用模式 | §5.3 |
| `hotkeys` | 快捷键，显示在「怎么用」卡片 | §5.3 |
| `page` | 详情页内容块 | §5.4 |
| `links` | 相关链接，详情页末尾自动生成链接块 | §5.4 |
| `collection` | 旧版单层合集，仍可用；新包请用 `catalog` + `collections` | §5.1 |

## 4. 动作与结果

动作让桌面详情页和 Matcha 的助手（Agent）能调用你的 DLL：读状态、改设置、执行一次性操作。界面和助手用同一套动作声明。

### 4.1 声明动作

```json
{
  "id": "hello",
  "label": "打个招呼",
  "description": "返回一条来自实际 DLL 的问候语",
  "effect": "read",
  "requiresConfirmation": false,
  "parameters": {
    "name": { "type": "string", "default": "survivor", "maxLength": 80 }
  }
}
```

- `effect`：`read` 只读，`write` 会改变状态。
- `requiresConfirmation`：为 `true`，或 `effect` 为 `write` 时，调用前桌面会弹确认框，助手调用也要玩家确认。
- 动作 `id` 在本包内唯一，并与 DLL 实现的动作名一致。`label` 是非空白显示名（最多 256 个 UTF-8 字节，无内嵌 NUL），`description` 是字符串。`parameters` 是「参数名 → 字段声明」对象；零参数写 `{}`。

| 字段类型 | 可接受的 JSON 值与约束 |
|---|---|
| `string` | 字符串。可选 `maxLength` 为非负安全整数，按 Unicode 码点计数（例如 `🍵` 占 1）；Runtime 拒绝内嵌 NUL。 |
| `boolean` | `true` 或 `false`。 |
| `integer` / `number` | Core 接受安全整数 / 有限数值；`minimum`、`maximum` 为含端点的有限数值，下限须小于或等于上限。数字使用 JSON 数字类型。 |
| `enum` | `options` 是非空、无重复的字符串数组；传入其中一个原值。 |

`required` 取布尔值；`default`（如有）须通过同一字段的类型和取值检查。调用时先拒绝未声明的键；缺值先补 `default`，仍缺且 `required: true` 才报错，其余可选键保持缺省。Core 在发送前校验，Runtime 在调用 `invoke` 前再校验一遍。

桌面按声明自动生成控件：文本框、开关、数字框、下拉框。你不用写任何界面代码。

### 4.2 配置字段

`config` 数组每项都要有唯一 `id`、非空白 `label`、`type`、合法的 `default` 和 `apply`（`immediate` 立即生效 / `next-launch` 下次启动生效）。取值规则同 §4.1。Runtime 把包目录里的可选 `config.json` 与默认值合并，再以 `host->config_json` 交给 `init`。桌面优先显示已保存值并用 `label` 命名控件；保存与应用由模组实现，结果中分清已保存值与当前运行值。

新功能建议把设置放在游戏里（第 6 章），桌面只放说明和启停。

### 4.3 返回结果

动作返回 UTF-8 JSON。结果里写清楚实际改变了什么、是否已保存、是否下次启动才生效。如果只完成了一部分，说明哪些完成了、哪些失败了，桌面会原样展示，由玩家决定下一步。

**报表格式**：结果带上 `"format": "flare.report.v1"`，桌面会把它显示成概览加分组数值，不再显示原始 JSON。

```json
{
  "format": "flare.report.v1",
  "title": "生涯档案",
  "summary": "已读取当前玩家的累计统计。",
  "refreshedAt": "2026-11-16T12:00:00Z",
  "sections": [{
    "title": "概览",
    "layout": "metrics",
    "items": [
      { "label": "游玩时间", "value": 7200, "format": "duration" },
      { "label": "感染者击杀", "value": 42000, "format": "number" },
      { "label": "分享急救包", "value": null }
    ]
  }]
}
```

| 位置 | 字段 | 限制 |
|---|---|---|
| 报表 | `title` / `summary` | 160 字 / 1,000 字 |
| 报表 | `refreshedAt` | 可选，带时区的 ISO 时间 |
| 报表 | `sections` | 最多 12 组 |
| 分组 | `title`、`layout` | `layout` 为 `metrics`（数字卡片）或 `list`（列表） |
| 分组 | `note`、`collapsed` | 备注最多 1,000 字；`collapsed: true` 默认折叠 |
| 分组 | `items` | 每组最多 128 项 |
| 项 | `label` | 最多 160 字 |
| 项 | `value` | 数字、最多 256 字的文字，或 `null`（显示 `—`）；`0` 正常显示 |
| 项 | `format` | 只用于数字：`number`（默认）、`duration`（非负整数秒）、`percent`（75 显示为 75%） |
| 项 | `unit` / `key` | 单位最多 40 字；`key` 最多 240 字，悬停时显示统计来源 |

任何一处不合格，桌面就退回显示原始 JSON。示例：`native/plugins/skeeto.career/`。

## 5. 桌面展示

展示内容写在可选的 `manifest.presentation` 里。提供这个对象时写上 `"schema": 1`；其余按需填写，省略的部分使用桌面默认样式。

### 5.1 列表与合集

DLL 模组页分三层：**大合集 → 小合集 → 功能**。开关在功能这一层，合集只负责组织。

```json
"catalog": {
  "id": "ragdoll",
  "title": "RagDoll 自制模组",
  "author": "RagDoll",
  "summary": "自主制作的独立功能，按需加载。",
  "description": "大合集的完整介绍（可选）。",
  "cover": "catalog.png"
},
"collections": [{
  "id": "ragdoll.hud",
  "title": "战役 HUD",
  "author": "RagDoll",
  "summary": "为本地战役提供物资、距离和方向信息。",
  "cover": "hud.png"
}]
```

- **新建小合集**：在同一个 `catalog.id` 下写一个新的小合集 ID。导入后桌面自动生成合集页面。
- **加入已有小合集**：用相同的 `catalog.id` 和小合集 `id`。
- `catalog` 和 `collections` 成对声明；每个合集填写 `id`、`title`、`author`、`summary`，同一功能内的小合集 ID 唯一。
- **同时放进多个小合集**：`collections` 可写 1–16 项。功能只有一份，安装、配置和开关状态共享，合集总数按 ID 去重。
- **合集信息以第一份声明为准**（按功能 ID 排序），所以同一合集的所有成员请写一致的标题和介绍，改介绍时一起改。
- 小合集 ID 只在所属大合集内归组，建议也带作者前缀。
- 标题和作者最多 80 字，`summary` 最多 160 字。
- 没写 `catalog` 的包进「本机导入」。只写旧版 `collection` 的包照常显示，归入该合集的「全部功能」。

### 5.2 封面

大合集、小合集、功能各有一张封面，都可省略，省略时桌面生成排版封面。

- 路径写包内相对路径，例如 `cover.png`、`media/hero.jpg`。
- 支持 PNG、JPEG、WebP、GIF，单张最多 4 MiB，宽 960px 以上显示较清楚。
- 显示比例：功能列表里是 44px 方形缩略图；详情页 `split` 和合集页头图为 16:10，`banner` 为 21:9，`poster` 为 3:4 竖图。图片铺满后居中裁切，主体放在画面中间最稳妥。

### 5.3 详情页头部

```json
"hero": { "layout": "split", "image": "media/hero.jpg", "accent": "#d4b86a", "tagline": "一眼看清附近的补给" },
"modes": ["coop", "realism", "survival"],
"hotkeys": [{ "keys": "Ctrl+F8", "label": "切换发光" }]
```

| 字段 | 说明 |
|---|---|
| `hero.layout` | `split`（默认，文字左、图右）、`banner`（通栏头图，标题压在图上）、`poster`（竖版封面）、`minimal`（只有文字） |
| `hero.image` | 头图；不写就用 `cover` |
| `hero.accent` | 强调色 `#rrggbb`，只作用于你自己的详情页。在黑底上对比度不足 4.5:1 的颜色会被忽略 |
| `hero.tagline` | 标题下的一句话，最多 60 字 |
| `modes` | 适用模式：`coop` 战役、`realism` 写实、`survival` 生还者、`versus` 对抗、`scavenge` 清道夫 |
| `hotkeys` | 最多 8 个；`keys` 用 `+` 连接，最多 4 个键、40 个字符；`label` 最多 80 字 |

`modes`、`hotkeys` 和「游戏内设置」三项合成详情页的「怎么用」卡片。依赖 `flare.game-ui` 的功能会自动显示「Ctrl F7 → 功能名」，列表卡片上也会标出。

### 5.4 详情页内容块 `page`

`page` 是一个数组，按顺序排列内容块，最多 40 块。不写 `page` 时，详情页显示 `description`。写了 `links` 而 `page` 里没有链接块时，末尾自动加一个「相关链接」。

| `type` | 字段 | 说明 |
|---|---|---|
| `heading` | `text`（80 字）、`eyebrow`（40 字，可选） | 小节标题，`eyebrow` 是标题上方的小字 |
| `text` | `text`（12,000 字） | 正文，支持 §5.5 的轻量格式 |
| `image` | `src`、`caption`、`aspect`、`wide` | 单图；`aspect` 默认 `auto`，`wide: true` 通栏 |
| `gallery` | `items: [{ src, caption }]`、`columns`、`aspect`、`title` | 截图墙；`columns` 为 2 / 3 / 4（默认 3），`aspect` 默认 `16:9`。点击放大，方向键翻页 |
| `compare` | `before: { src, label }`、`after: { src, label }`、`caption`、`aspect` | 拖动对比前后效果；`label` 默认「之前 / 之后」，最多 24 字 |
| `hotkeys` | `items: [{ keys, label }]`、`title` | 按键表；`keys` 最多 4 个键 |
| `steps` | `items: [{ title, text, image }]`、`title` | 步骤；`title` 80 字，`text` 2,000 字，`image` 可选。也可以直接写字符串 |
| `callout` | `tone`、`title`、`text`（2,000 字） | 提示框；`tone` 为 `info`（默认）、`tip`、`warning` |
| `specs` | `rows: [{ label, value }]`、`title` | 参数表；`label` 40 字，`value` 200 字。也可以写成 `["标签", "值"]` |
| `changelog` | `items: [{ version, date, notes: [] }]`、`title` | 更新记录；默认显示最近 3 个版本，每条 note 400 字 |
| `links` | `items: [{ label, url, note }]`、`title` | 链接，在 Matcha 内置浏览器打开 |
| `credits` | `items: [{ name, role }]`、`title` | 致谢；也可以直接写名字字符串 |
| `video` | `url`、`title`、`poster`、`note` | 视频卡片，点击后在内置浏览器打开；`poster` 是包内图片 |
| `divider` | — | 分隔线 |

通用限制：每个列表最多 24 项；块的 `title` 最多 80 字；`caption`、`note` 最多 200 字。`aspect` 可选 `16:9`、`4:3`、`1:1`、`21:9`、`3:2`、`9:16`、`auto`。

### 5.5 正文格式

`description`、`text` 块支持以下写法，其余按原文显示：

- 空行分段，`#` 开头为小标题
- `-` 无序列表、`1.` 有序列表
- `**粗体**`、`` `代码` ``、`[文字](https://…)`
- 正文里出现 `Ctrl + F7`、`Shift`、`Enter`、`F1`–`F12` 等按键时，自动显示成键帽

### 5.6 安全规则

- 图片只读包内相对路径：不以 `/` 开头，不含 `\`、`..`、盘符或协议，扩展名为 png / jpg / jpeg / webp / gif，路径最长 240 字符。桌面只读取 manifest 里声明过的图片路径。
- 链接和视频使用无用户名、无密码的 `https` 地址，最长 400 字符。
- 所有文字按纯文本显示，HTML 和脚本一律原样显示，不会执行。
- 导入时会校验 `presentation.schema`、简介、说明、封面、标签和合集声明；按问题清单修正后再导入。详情页渲染时遇到无效的 `page` 块或字段会跳过，其余有效内容照常显示。

### 5.7 资料不全时

通过 GitHub、创意工坊或普通 DLL 接入的功能，由 Agent 补齐简单字段：名称、作者、简介、说明、标签、适用模式、快捷键、来源链接、封面。补充的内容单独保存，详情页会标注来源，作者的 manifest 保持原样。`presentation.page` 写完整的包会原样使用，Agent 不做改写。

## 6. 游戏内设置（flare.game-ui）

新功能的设置建议放在游戏里：玩家按 Ctrl + F7 打开统一菜单，选中你的功能就能调。

接入方式：

1. 在 `dependencies` 声明 `{ "id": "flare.game-ui", "version": "0.1.0" }`。启用你的功能时，设置服务会作为依赖一起启用。
2. 协商 `native/include/l4p_game_ui.h` 的 API 1（`L4P_GetGameUiApi`），在 `init` 里注册模块。
3. 二选一：
   - **用默认控件**：提供页面和行，行类型有开关、数值、档位和操作。玩家打开页面或改值时才生成页面快照，配置由你自己读写。
   - **做自定义交互**：只注册入口，或从默认菜单交给你自己的编辑器。你负责提交、撤销，以及关闭时收回自己的输入和效果。物资雷达的「位置编辑」就是这种做法。
4. 只有模组需要自己绘制 HUD 或编辑器时才提供 `frame`。它在主 Paint 阶段运行（局内 GAME，菜单 UI）；本帧需要绘制时调用 `begin_draw()`，成功后再绘制。标准菜单关闭后跳过自身排版和绘制，鼠标消息直通游戏。

### 6.1 注册一个只有开关的页面

把下面的 C++17 代码和 [§7 的导出函数](#7-c-abi-与线程模型)放进同一个 `plugin.cpp`。manifest 用 `id: "yourname.hello-hud"`、`version: "0.1.0"`，声明上面的设置服务依赖，`config` 和 `actions` 都填 `[]`。选中「示例 HUD」就能切换一行设置；示例值只在本次会话、菜单回调内使用。

```cpp
#include "l4p_game_ui.h"
#include <windows.h>
#include <filesystem>

static L4P_GameUiApiV1 ui{L4P_GAME_UI_VERSION, sizeof(ui)};
static uint32_t menu_token{};
static int32_t show_hud = 1;

static uint32_t L4P_CALL page(void*, uint32_t id, L4P_GameMenuPageV1* out) {
    if (id != 0 || !out) return L4P_BAD_ARGUMENT;
    *out = {};
    out->count = 1;
    out->rows[0] = {L4P_MENU_TOGGLE, 1, 0, show_hud, 0, 1, 1, L"显示 HUD", L""};
    return L4P_OK;
}
static uint32_t L4P_CALL change(void*, uint32_t row, int32_t value) {
    if (row != 1 || (value != 0 && value != 1)) return L4P_BAD_ARGUMENT;
    show_hud = value;
    return L4P_OK;
}
static uint32_t L4P_CALL init(const L4P_HostApiV1* host) {
    if (!host || host->api_version != L4P_API_VERSION ||
        host->struct_size != sizeof(*host) || !host->plugin_directory) return L4P_BAD_ARGUMENT;
    try {
        auto packages = std::filesystem::u8path(host->plugin_directory).parent_path();
        auto dll = GetModuleHandleW((packages / L"flare.game-ui" / L"plugin.dll").c_str());
        auto get = dll ? reinterpret_cast<L4P_GetGameUiApiFn>(
            GetProcAddress(dll, "L4P_GetGameUiApi")) : nullptr;
        if (!get) return L4P_ERROR;
        auto rc = get(L4P_GAME_UI_VERSION, &ui);
        if (rc != L4P_OK) return rc;
        L4P_GameUiModuleV1 m{sizeof(m), "yourname.hello-hud", L"示例 HUD", nullptr,
                             nullptr, nullptr, page, change, nullptr};
        return ui.register_module(&m, &menu_token);
    } catch (...) { return L4P_ERROR; }
}
static void L4P_CALL shutdown() {
    if (menu_token) { ui.unregister_module(menu_token); menu_token = 0; }
}
```

服务复制模块 ID 和标题；回调函数及 `context` 保持有效直到注销。关停时由模组主动收尾输入、效果和待保存数据：`unregister_module` 关闭菜单时会跳过 `visibility` 回调。

### 6.2 从打开页面到交还输入

- **打开**：Ctrl + F7 先显示模块列表。选中标准模块时，先通知 `visibility(context, 1)`（如有），再请求 `page(context, 0, &out)`。填标题、说明和最多 48 行；标题留空则沿用模块名。页面标题和行文字使用 `wchar_t`。
- **导航与改值**：`LINK` 行的 `id` 是目标页号；其余行的 `id` 是传给 `change` 的行号。`TOGGLE`、`RANGE`、`CHOICE` 需要 `minimum < maximum`、`step >= 1` 和范围内的 `value`；`ACTION` 执行一次操作。导航或 `change(context, row_id, value)` 返回 `L4P_OK` 后重新取页面快照，绘制时复用快照。
- **关闭或接管**：离开标准模块页、关菜单或失去焦点时会通知 `visibility(context, 0)`。从标准页进入自己的编辑器，令 `change` 返回 `L4P_MENU_CLOSE`；纯自定义入口则留空 `page`，玩家选中时直接收到 `change(context, 0, 0)`。
- **输入**：标准菜单优先处理导航键；菜单关闭时，自定义 `input` 可接收按键并以非零返回值认领该次按下，服务配对处理抬键。窗口失焦时收回编辑状态。上述回调运行在游戏窗口 / Paint 线程。

完整的设置读写和自定义编辑器见 `native/plugins/ragdoll.supply-radar/radar/flare_session.h`。只想预览菜单时，可用 `native/tests/game_ui_preview.cpp`（编译命令在文件头）；调试雷达接入可构建 `radar_runtime_smoke`、`radar_settings_smoke`，再运行 `node checks/radar-light.mjs`。

## 7. C ABI 与线程模型

**入口与身份。** 以 `native/include/l4p_plugin.h` 编译 Windows x86 DLL：C ABI、`L4P_CALL`（`__cdecl`）、8 字节 packing。导出精确的无修饰名称 `L4P_GetPluginApi`。宿主调用前已填好版本和结构大小；先检查二者，再一次性交回身份和函数表：

```cpp
// §6 的示例只提供游戏内菜单，manifest 中 actions 为 []。
static uint32_t L4P_CALL invoke(const char*, const char*, char*, uint32_t, uint32_t*) {
    return L4P_BAD_ARGUMENT;
}

extern "C" L4P_EXPORT uint32_t L4P_CALL
L4P_GetPluginApi(uint32_t version, L4P_PluginApiV1* out) {
    if (version != L4P_API_VERSION) return L4P_UNSUPPORTED_VERSION;
    if (!out || out->api_version != version || out->struct_size != sizeof(*out))
        return L4P_BAD_ARGUMENT;
    *out = {version, sizeof(*out), "yourname.hello-hud", "0.1.0", init, invoke, shutdown};
    return L4P_OK;
}
```

`id` 和 `version` 使用与 manifest 完全相同的 UTF-8 常量。`init`、`invoke` 都要提供，即使 `actions: []`；空动作实现可直接返回 `L4P_BAD_ARGUMENT`。`shutdown` 可填 `nullptr`。保留最小 `DllMain`，把服务协商、线程和日志留给 `init`。

| 时机 | 调用线程与模组的职责 |
|---|---|
| `init(host)` | 首次成功创建图形工厂后，在该工厂调用线程执行一次（`render-init`）。核对 `host->api_version`、`struct_size`；复制以后要用的 `plugin_directory`、`config_json`。`host` 结构及其文本只在本次调用内借用；`log` 与 `context` 可保存到显式关停或进程结束。 |
| `invoke(action_id, parameters_json, output_json, capacity, output_size)` | 控制线程串行调用。读取已校验的 JSON 参数对象；私有配置可在此保存。需要操作游戏对象时，发布一份设置副本或将请求加入有界队列，由 Source 帧回调在适用对局消费。给桌面的结果应区分「已保存 / 已排队」和「帧上已应用」。 |
| `shutdown()` | 受控宿主在停止控制线程工作后、`DllMain` 外显式调用。先停止接收工作、注销回调或退订，再释放回调使用的数据。正常编辑时就保存持久设置：进程结束可能跳过此回调。DLL 随进程驻留，启停在下次完整启动生效。 |

**返回一条完整 JSON。** 输入和输出缓冲只在当次调用内借用；两侧各自管理内存，C++ 异常在 DLL 内处理。宿主一次提供 256 KiB 输出空间。先准备结果并计算 `UTF-8 字节数 + 1`（结尾 NUL），写入 `*output_size`；确认容量足够后再写文件或改变状态，最终复制包含 NUL 的完整 JSON。容量不足返回 `L4P_BUFFER_TOO_SMALL`，宿主只调用一次。非零返回码走 `plugin_error`，需要展示部分成功的明细时，用成功返回的 JSON 记录每项结果。

主 ABI 的返回码：`L4P_OK`（0，成功）、`L4P_ERROR`（1，执行失败）、`L4P_BAD_ARGUMENT`（2，参数或结构有误）、`L4P_BUFFER_TOO_SMALL`（3）、`L4P_UNSUPPORTED_VERSION`（4）。宿主日志级别 0–3 依次为 debug、info、warning、error。可对照 `native/examples/demo.hello/plugin.cpp` 的 `hello` 实现。

主 ABI v1 提供初始化、日志和动作。需要游戏帧和原生事件时使用第 8 章的 Source 订阅；Device 创建、Present、Reset 属于不同的图形时机，v1 未提供这些回调。

## 8. Source 服务参考

需要游戏帧、实体或挂载素材时，在 `dependencies` 加入 `{ "id": "beacon.source", "version": "0.4.0" }`。工作区的 `beacon_source` 目标构建这份服务包，版本见 `native/plugins/beacon.source/manifest.json`。只需要 Ctrl + F7 设置菜单的模组单独依赖 §6 的服务即可。

先安装精确版本的依赖。Runtime 按 `bin/l4p/enabled.txt` 的顺序加载，依赖在使用者之前。在 `init` 里按同级包的完整路径取得已加载的 `beacon.source/plugin.dll`，再用 `GetProcAddress` 取下表中的导出。

**先协商，再订阅。** 包版本用来匹配依赖；每张函数表有自己的 API 版本。按所需版本初始化结构，填入**该版完整结构**的大小，再把头文件要求的前缀指针传给导出。例如 `L4P_SourceApiV2 api{{2, sizeof(api)}};` 配 `get(2, &api.base)`。检查返回码后用 `subscribe` 注册唯一 ID、范围、事件名和回调，保存自己的令牌。状态/快照输出结构带 `struct_size` 的，也要先填 `sizeof`。

**选范围。** `allowed(frame, scope)` 首先要求已连接、已进局、加载结束。`L4P_SOURCE_ANY` 接受任意这样的对局；`L4P_SOURCE_LOCAL` 还要求本地回环服务器；`L4P_SOURCE_COOP` 当前接受 `coop`、`realism`、`survival`。帧回调在断线、换图和离开范围时仍会收到快照，便于收回效果；局内工作先检查 `allowed`，事件按所订范围过滤。菜单绘制、文件读取等明确支持菜单的接口见各表。

**按令牌收尾。** 下文的 Paint 指 Source 派发的帧回调。控制线程可读快照副本；游戏操作交给规定的回调。释放函数有的在控制线程只标记待清理，有的立即执行，见各表。关停时注销订阅，等在途回调结束后再销毁 `context`；只释放自己持有的效果、输入和句柄。遇到占用冲突保留玩家设置，报告当前持有者或失败原因。

按用途查：[帧与共享状态](#81-帧与共享状态) · [实体与玩家操作](#82-实体与玩家操作) · [绘制与模型](#83-绘制与模型) · [声音与素材](#84-声音与素材) · [死亡与命中反馈](#85-死亡与命中反馈)。头文件位于 `native/include/`，示例源码位于 `native/plugins/<模组 ID>/`。

### 8.1 帧与共享状态

#### Source：订阅帧和事件

| 头文件 · 可协商版本 | `l4p_source.h` · v1、v2 · `L4P_GetSourceApi` |
|---|---|
| 订阅范围 | ANY / LOCAL / COOP。事件名以逗号分隔，最多 32 个；只订阅帧时传空字符串。 |
| 调用线程 | `init` 或控制线程订阅；帧在 Paint，事件在原生事件线程。控制线程可 `snapshot`；事件指针只在当次事件回调内借用。 |
| 主要函数 | v1：`subscribe` / `unsubscribe`、`snapshot` / `allowed`、`event_int` / `event_float`。在游戏回调中用 `command` 提交普通命令；`exec_cfg` 接受经模组核对的相对 `.cfg` 文件名。v2：`event_text` 把事件文字复制为 UTF-8。 |
| 示例模组 | `skeeto.config-override` 在帧上执行 CFG；`skeeto.hit-feedback` 在事件内复制武器名。 |

#### Cvar：临时改值或保留 CFG 恢复点

| 头文件 · 可协商版本 | `l4p_cvar.h` · v1、v2、v3、v4 · `L4P_GetCvarApi` |
|---|---|
| 订阅范围 | 租约与恢复点按对局范围；调整受限变量要求 LOCAL。`sv_rollangle`、`sv_rollspeed` 有客户端视觉例外。同名变量由一个订阅持有。 |
| 调用线程 | Paint / 事件回调中读值、设值、捕获基线。控制线程可请求释放，恢复在游戏线程完成；`restore_checkpoints` 返回 `L4P_ERROR` 表示仍有待恢复项。 |
| 主要函数 | v1 `read` / `pin` / `release`（空名称释放自己的全部租约）；v2 `pin_locked` 保持设定值；v3 `pin_relative` 按首次基线乘 0–10；v4 `checkpoint` 记值后允许继续变化，`restore_checkpoints` 恢复，`forget_checkpoints` 丢弃恢复点并保留现值。恢复点和 pin 共用名称归属。 |
| 示例模组 | `skeeto.audio-positional` 用 v2；`skeeto.team-glow-style` 用 v3；`skeeto.config-override` 用 v4。 |

#### Resource：协调互斥效果

| 头文件 · 可协商版本 | `l4p_resource.h` · v1 · `L4P_GetResourceApi` |
|---|---|
| 订阅范围 | ANY / LOCAL / COOP，当前对局须在范围内。先取得名称的一方继续使用。 |
| 调用线程 | 在 Paint 申请；控制线程可查归属或请求释放，排队的释放在下一 Paint 生效。 |
| 主要函数 | `claim(token, name)` 返回 `L4P_RESOURCE_CONFLICT` 时暂缓效果；`owner(name, out)` 写入持有者 ID（65 字节缓冲区，空串表示空闲）。先还原游戏状态，再 `release` 名称。 |
| 示例模组 | `skeeto.gunshot-feel` 与 `skeeto.audio-positional` 共用 `skeeto.audio-processing`。 |

### 8.2 实体与玩家操作

#### Entity：按身份读取实体

| 头文件 · 可协商版本 | `l4p_entity.h` · v1、v2、v3 · `L4P_GetEntityApi` |
|---|---|
| 订阅范围 | 只读函数不收令牌；在订阅适用的对局内取值。引用含 `index`、完整 `handle` 和地图 `epoch`。 |
| 调用线程 | Paint / 事件回调。索引复用或换图后重新取引用；字段缺失、类型错误或引用失效时，读取保留原输出。 |
| 主要函数 | v1 `reference` / `from_handle` / `for_user`、`describe` / `read`、`eye` / `model_name` 等。按原生字段宽度选 `BYTE`（生命状态等）、`SHORT`（模型索引）、`INT`、`FLOAT`、`VECTOR`。v2 `read_index` 读整型数组，`player_info` 可读可见范围外的玩家资料；v3 `move_type` 读移动类型。 |
| 示例模组 | `skeeto.endgame-music` 读队伍和玩家资料；`skeeto.script-cues` 读移动类型。 |

#### Player：恢复本机玩家的视角和操作

| 头文件 · 可协商版本 | `l4p_player.h` · v1 · `L4P_GetPlayerApi` |
|---|---|
| 订阅范围 | 有效的局内订阅；本机正操纵自己的存活生还者、观察模式为 0。写入还要求游戏菜单关闭。 |
| 调用线程 | 在 Paint 读写；控制线程可用 `camera_status` 查询人称接口的适配状态。 |
| 主要函数 | `set_angles` 用角度；`camera_mode` / `set_camera_mode` 读取 / 切换人称。`action` 仅接收槽位 1–5 或 `L4P_PLAYER_FLASHLIGHT`，由服务器处理最终动作。 |
| 示例模组 | `skeeto.idle-restore` 收到自己的接管事件后恢复玩家状态。 |

#### Weapon：查脚本弹匣容量

| 头文件 · 可协商版本 | `l4p_weapon.h` · v1 · `L4P_GetWeaponApi` |
|---|---|
| 订阅范围 | LOCAL，本地武器实体引用。 |
| 调用线程 | `clip_capacity` 在 Paint；`status` 可在控制线程读取。 |
| 主要函数 | `clip_capacity(token, &ref, &value)` 返回脚本容量 1–65535。元数据缺失保留原输出；双持倍率和后备值由消费者决定。`status` 区分等待、就绪、版本不支持和原生故障。 |
| 示例模组 | `skeeto.auto-reload`。 |

#### Input：读取绑定、按下并释放

| 头文件 · 可协商版本 | `l4p_input.h` · v1、v2 · `L4P_GetInputApi` |
|---|---|
| 订阅范围 | 按下和监听要求 LOCAL；发送按下还要求游戏前台、游戏菜单关闭。同一键由一个订阅持有。 |
| 调用线程 | 状态、绑定、按下和鼠标边沿在 Paint；控制线程 `release` 立即尝试释放，`watch_mouse(token, 0)` 还可关闭监听。失焦、开菜单或离开范围在下一 Paint 清理。 |
| 主要函数 | v1 `snapshot` / `binding`、`press` / `release`，按当前 `+reload`、`+attack`、`+attack2` 绑定操作；`HELD` 表示玩家已按住，`CONFLICT` 表示其他订阅持有。释放使用取得时的键位。v2 `watch_mouse` / `mouse_state` / `mouse_edge` 管理物理左键和所属松开窗口；`NOT_HELD` 时结束周期。 |
| 示例模组 | `skeeto.auto-reload`（绑定）；`skeeto.auto-semiauto`（v2 鼠标边沿）。 |

### 8.3 绘制与模型

#### View：选择 HUD 或菜单的绘制阶段

| 头文件 · 可协商版本 | `l4p_view.h` · v1 · `L4P_GetViewApi` |
|---|---|
| 订阅范围 | 只读，无令牌；进入已连接、非加载的对局后可取得视角。 |
| 调用线程 | 只在 Paint 取当前阶段的快照。 |
| 主要函数 | `snapshot(&view)` 返回 `paint_mode`、`game_ui` 和 `angles_valid`。HUD 检查 `L4P_PAINT_GAME` 位（2），菜单检查 `L4P_PAINT_UI` 位（1）；组合阶段两位可同时出现。确认 `angles_valid` 后使用 `angles`。 |
| 示例模组 | `skeeto.crosshair-tps`。 |

#### Draw：在原生 Surface 绘制

| 头文件 · 可协商版本 | `l4p_draw.h` · v1 · `L4P_GetDrawApi` |
|---|---|
| 订阅范围 | ANY 可绘制菜单；LOCAL / COOP 按对局范围。局内 HUD 用 `allowed` 决定何时显示。 |
| 调用线程 | 在 UI / GAME Paint 回调绘制；用 View 选阶段。Source 管理绘制上下文。 |
| 主要函数 | `screen`、`project`、`rect` / `line`、`font` / `measure` / `text`、`texture_file` / `texture`、`status`。字体与材质按请求缓存；按返回码判断成功，ID 为 0 也可能有效。材质名如 `vgui/example/icon`。 |
| 示例模组 | `skeeto.crosshair-tps` 把世界坐标投影为屏幕准星。绘制夹具见 `native/tests/drawing_smoke.cpp`；字体抗锯齿（`0x10`）、阴影（`0x80`）、描边（`0x200`）可合用 `0x290`。 |

#### Effects：射线与有时限的灯光

| 头文件 · 可协商版本 | `l4p_effects.h` · v1 · `L4P_GetEffectsApi` |
|---|---|
| 订阅范围 | ANY / LOCAL / COOP，在适用对局内使用自己的令牌。 |
| 调用线程 | `trace`、`light` 在 Paint；控制线程请求 `drop_light` 后由游戏线程熄灭。 |
| 主要函数 | `trace` 可只检测世界或跳过一个已核对的实体；`light` 在本订阅的 0–15 槽发布灯光，寿命 0.01–1 秒，持续照明须刷新。`drop_light`、退订和离开范围清理所属灯光。 |
| 示例模组 | `skeeto.night-vision`。 |

#### Glow：按实体管理描边

| 头文件 · 可协商版本 | `l4p_glow.h` · v1 · `L4P_GetGlowApi` |
|---|---|
| 订阅范围 | 普通生还者颜色可用 ANY，写实模式保留原色；`force_alpha` 和 `outline` 要求 LOCAL。 |
| 调用线程 | Paint 写入；控制线程 `release` 排队。离开范围时按字段归还仍由本订阅持有的值。 |
| 主要函数 | `survivor_colour` 用 `0x00BBGGRR`，`-1` 保留原色。`outline` 对原描边类型为 0 的实体申请 type-3 描边，距离 1–32767。`release(token, nullptr)` 释放自己的全部描边；`status` 查占用或适配结果。 |
| 示例模组 | `skeeto.team-glow-style` 分别用 ANY / LOCAL 订阅管理两类效果。 |

#### Addon：按类别隐藏角色挂件

| 头文件 · 可协商版本 | `l4p_addons.h` · v1 · `L4P_GetAddonApi` |
|---|---|
| 订阅范围 | ANY / LOCAL / COOP，过滤器按帧更新适用范围。 |
| 调用线程 | 在 Paint 注册；原生挂件更新时在游戏线程运行过滤器。回调只读私有设置，避免 I/O、阻塞和 SDK 重入。 |
| 主要函数 | `set_filter` 的回调接收队伍、原挂件位和五个武器 ID，返回要保留的位；服务将其与原值相交。`clear_filter` / 退订等待回调结束，后续原生更新恢复显示；`status` 查状态。 |
| 示例模组 | `skeeto.hide-back-items`。 |

#### Model：缩放本地服实体模型

| 头文件 · 可协商版本 | `l4p_model.h` · v1 · `L4P_GetModelApi` |
|---|---|
| 订阅范围 | LOCAL，使用当前地图的完整实体引用。 |
| 调用线程 | Paint 应用；控制线程 `release` 排队至下一 Paint。 |
| 主要函数 | `scale` 取 0.1–5，传 1 释放。`L4P_MODEL_FIELD` 调整模型比例字段，`L4P_MODEL_BONES` 按骨骼缩放，碰撞保持原样。`release` 可指定实体或传空释放全部；服务保留外部新值，`status` 报告冲突。 |
| 示例模组 | `skeeto.model-scale`。 |

#### Viewmodel：调整第一人称持枪模型

| 头文件 · 可协商版本 | `l4p_viewmodel.h` · v1 · `L4P_GetViewmodelApi` |
|---|---|
| 订阅范围 | 局内视觉效果可用 ANY；两槽姿态归一个订阅持有。 |
| 调用线程 | `snapshot` / `set` 在 Paint；控制线程可查 `status` 或用 `release` 请求恢复。 |
| 主要函数 | `snapshot` 复制两槽的模型路径、实体引用、checksum 和 `binding_id`；`set` 一次提交两槽及各自刚读的 ID。空槽 ID 为 0、比例填 1；ID 过期先重新取快照。位移和旋转原点各轴 ±100，旋转 ±180°，比例 0.1–5，镜像 0 / 1。 |
| 示例模组 | `skeeto.viewmodel` 按模型身份选姿态。两槽共用脚本且镜像选择相反时，仅暂停镜像；`status` 分别报告姿态、镜像和比例状态。 |

#### Localize：覆盖游戏文字

| 头文件 · 可协商版本 | `l4p_localize.h` · v1 · `L4P_GetLocalizeApi` |
|---|---|
| 订阅范围 | ANY 可用于菜单，LOCAL / COOP 遵循对局范围。每个文字键由首个订阅持有。 |
| 调用线程 | Paint 中 `set` / `read`；控制线程可 `clear` 或读 `status`。 |
| 主要函数 | `set(token, key, utf8)` 保存覆盖；`clear(token, nullptr)` 清除自己的全部覆盖。上限 256 个活跃键、4096 种文字、单条 256 个 UTF-16 单位。`read` 复制当前有效文字为 UTF-8；短缓冲区只回报所需大小（含 NUL）。 |
| 示例模组 | `skeeto.idle-restore` 设置 BOT 角色名。 |

### 8.4 声音与素材

#### Sound：调整正在开始播放的声音

| 头文件 · 可协商版本 | `l4p_sound.h` · v1 · `L4P_GetSoundApi` |
|---|---|
| 订阅范围 | 过滤器要求 ANY，菜单声音也会进入回调。 |
| 调用线程 | 可从帧回调安装过滤器，过滤本身在引擎发声线程运行。只读已发布的设置；保持无分配、无阻塞，避免调用其他 SDK 函数。 |
| 主要函数 | `set_filter` 注册回调：音名只在回调内借用，返回本次播放的音量。`clear_filter` 或退订等待在途回调结束；`status` 提供入口状态和处理计数。 |
| 示例模组 | `skeeto.volume-mixer` 分类调整音量。 |

#### Audio：播放并停止自己的声音

| 头文件 · 可协商版本 | `l4p_audio.h` · v1 · `L4P_GetAudioApi` |
|---|---|
| 订阅范围 | ANY / LOCAL / COOP，当前对局须在范围内。 |
| 调用线程 | `prepare` / `emit` 在 Paint 或事件回调；控制线程 `stop_all` 把停止请求排到游戏线程。 |
| 主要函数 | `prepare` 预缓存已挂载的相对音频路径；`emit` 使用本订阅 0–7 槽并返回 GUID，空间音效提供实体引用和位置。`stop_all(token)`、范围退出或退订只停止本模块的声音。 |
| 示例模组 | `skeeto.silent-si-fix`。 |

#### File：读取 GAME 挂载、添加包内素材

| 头文件 · 可协商版本 | `l4p_file.h` · v1、v2、v3 · `L4P_GetFileApi` |
|---|---|
| 订阅范围 | 只读 GAME 中的 VPK 和已挂载目录。ANY 也可在菜单读取；LOCAL / COOP 遵循对局范围。挂载自己的 `assets/` 时，订阅 ID 使用包 ID。 |
| 调用线程 | 在非加载期的 Paint 读、枚举、挂载；控制线程可请求 `close`、`find_close` 或卸载，交由游戏线程清理。解码线程使用已复制的素材。 |
| 主要函数 | v1 `open` 指定大小上限（1 字节–1 GiB），`read` 每次最多 256 KiB；`find_open` / `find_next` 枚举，结束后 `find_close`。UTF-8 相对路径用 `/`，通配符在最后一段。v2 `mount_assets` 把包内素材挂到 GAME 搜索尾部，已有替换优先；`unmount_assets` 移除该挂载。v3 `path_revision` 值改变时重新发现素材，仅比较是否相等。 |
| 示例模组 | `skeeto.endgame-music` 读取挂载文件，`skeeto.script-cues` 支持挂载可选声音目录，`skeeto.hit-feedback` 刷新素材目录。 |

### 8.5 死亡与命中反馈

#### Corpse：临时隐藏死亡对象

| 头文件 · 可协商版本 | `l4p_corpse.h` · v1 · `L4P_GetCorpseApi` |
|---|---|
| 订阅范围 | LOCAL。先从事件确认死亡，目标限普感、Witch 或布偶，排除玩家槽。 |
| 调用线程 | Paint 中隐藏或清理布偶；控制线程 `release` 排队。 |
| 主要函数 | `hide(token, &ref)` 只持有 NODRAW 位、渲染模式和颜色；`release` 恢复指定引用或本订阅全部目标（空引用），保留外部改动。`destroy_ragdolls` 清理现有布偶，调用节奏由消费者控制。 |
| 示例模组 | `skeeto.combat-declutter`。隐藏和消散分别按 `skeeto.corpse.common` / `skeeto.corpse.special` 协调类别归属。 |

#### Dissolve：给已确认的死亡目标播放消散

| 头文件 · 可协商版本 | `l4p_dissolve.h` · v1 · `L4P_GetDissolveApi` |
|---|---|
| 订阅范围 | 局内视觉效果可用 ANY。保存死亡事件对应的完整实体引用；玩家目标同时保存 userid 和 `player_life` 的生命代次。 |
| 调用线程 | Paint / 事件回调可查生命代次；`start`、`busy`、`destroy_ragdolls` 在 Paint。控制线程可 `release` 或查 `status`。 |
| 主要函数 | `start` 接受 COMMON / SPECIAL 类别、类型 0–3、时长 200–2000 毫秒；最多 6 个活跃效果，其中普感最多 3 个。`release` 可按类或全部释放；等 `status` 对应类别的 retained 归零，再归还共享资源。 |
| 示例模组 | `skeeto.corpse-dissolve`。 |

#### Particle：预载并发送粒子

| 头文件 · 可协商版本 | `l4p_particle.h` · v1 · `L4P_GetParticleApi` |
|---|---|
| 订阅范围 | 粒子调用遵循所属订阅的对局范围；启动清单由一个订阅独占。 |
| 调用线程 | 地图就绪后在 Paint 预载、查询、发送。需要随包粒子清单时，在初始化拿到令牌后注册；追加清单发生在引擎构建清单的线程。 |
| 主要函数 | `precache` / `exists` / `dispatch`，每个订阅每秒最多发送 32 次。`boot_manifests(token, prefix, limit)` 追加 `particles/<prefix>*.txt`，上限 1–48；`release_manifests` 停止后续追加，已注册的库留到进程结束。`status` 查清单和发送状态。 |
| 示例模组 | `skeeto.hit-feedback` 在地图就绪时预载所选样式。 |

#### Feedback：读取血量下降与全屏叠图

| 头文件 · 可协商版本 | `l4p_feedback.h` · v1 · `L4P_GetFeedbackApi` |
|---|---|
| 订阅范围 | 血量与叠图要求有效的局内订阅；`addon_loading` 对 ANY 也支持菜单，在非加载期查询。 |
| 调用线程 | 在 Paint 开启观察、取队列、设置叠图或查询工坊状态；控制线程可请求 `release`。 |
| 主要函数 | `watch_health` / `next_health` 读取最多 32 条血量下降记录，`available=0` 表示读完；超过 400 毫秒、复活或实体更换时丢弃旧项，由模组判断命中归因。`overlay` 独占全屏材质，空串清除；`release` 结束观察并清除所属叠图。`addon_loading` 返回的状态值 0 为完成、1 为加载中。 |
| 示例模组 | `skeeto.hit-feedback`。 |

## 9. 打包、交付与核验

### 9.1 交付一个可直接导入的包

**推荐一个功能发一个 ZIP。** 压缩已构建的包目录：`manifest.json` 与 x86 `plugin.dll` 同级，带齐 manifest 引用的封面、详情页图片及实际需要的素材和许可证。安装账本 `.l4p-package.json` 留在玩家的安装目录。ZIP 可在外面包一层目录；依赖按所声明的精确版本另外提供。开发时也可直接选同样布局的文件夹。

玩家在「添加 → 本机 DLL / ZIP / 文件夹」选择文件，Matcha 先在暂存区静态检查单包结构、manifest、DLL 位数、SDK 导出和声明过的素材。标准包直接进入预览，列出宿主、目标目录、文件清单和可一并安装的随附依赖。玩家确认后才安装，首次导入默认停用。

- **普通 DLL、混包或缺文件**：按问题清单「交给 Agent 整理」。Agent 从已有文件识别 SDK、整体 DLL 或 L4N 子插件的宿主与布局，在暂存区生成候选包；主 DLL 或签名材料确实缺失时，回到作者来源取完整发行包。原包保留，候选清单仍交玩家确认。资料补充见 §5.7。
- **同 ID 更新**：重新选择完整新包并确认新旧版本。更新检验已保存的 `config.json` 是否仍符合新声明，保留兼容配置、启停状态、包外独立数据和手动补充资料；旧包整体备份，回执的 `previousDirectory` 指向备份。包内自有 ini/cfg 的迁移方法由作者说明。玩家退出游戏后再导入或更新。

#### 让本地 ZIP 也收到新版提醒

在 SDK 的 `manifest.json` 里加入：

```json
"developer": {
  "updates": { "type": "github-release", "repo": "作者/仓库", "asset": "matcha-x86-*.zip" }
}
```

将示例中的仓库替换为实际 GitHub `owner/name`。用稳定 Release 标签 `v1.2.3` 或 `1.2.3`，包内版本与标签一致，模组 ID 保持不变。附件名支持 `*`；省略 `asset` 时用 `*.zip`。一个 Release 中应恰好有一个匹配的成品包。公开源码的 `developer.source.url` 指向 GitHub 仓库时也能识别来源。已由玩家确认登记的远端来源优先。

导入时登记来源。Matcha 后台每日检查发布元数据，DLL 页的「检查更新」可立即刷新；获取 ZIP 和写入游戏目录分别确认。发布者可在 GitHub **成品附件的 label** 写 `matcha-signer:<64 位证书 SHA-256>` 或 `matcha-signer:unsigned`，帮助玩家在下载前看到换签或撤签提醒。没有说明时先显示「没法确认」；下载后以本机对实际发行包的核验为准。换签，或原来有签名而新版未签名，会保留旧版并提示交给茶茶。

### 9.2 让发布包可核验

普通本地 SDK 包可直接开发和导入，状态为 `unverified`。要交付带开发签名的包，从 `native/examples/demo.hello/manifest.json` 的 `developer` 对象开始填写：

| 工程声明 | 作者填写 |
|---|---|
| `author`、`purpose`、`license` | 作者、具体用途、SPDX 标识或许可证名称，附许可证全文。 |
| `source` | `visibility` 取 `public` / `private` / `closed`；公开源码提供 HTTPS `url`，`commit` 填完整提交（40 或 64 位小写十六进制）。本地私有快照可填 `null` 并保留检查提示。 |
| `modes`、`gameBuilds` | 分别列适用模式与实测游戏版本；尚未实测用 `untested`。 |
| `capabilities` | `filesystem`、`network`、`externalPrograms`、`hooks`、`memoryModification` 五个数组逐项说明用途与范围，无该能力填 `[]`。 |
| `prohibited` | `credentialTheft`、`hiddenDownloadExecution`、`crossProcessInjection`、`antiCheatBypass`、`unfairAdvantage` 五项均显式填 `false`。 |

1. **本地检查工程。** 在工作区根目录运行 `node backend/cli.mjs check-project --plugin-dir native/examples/demo.hello`，把目录换成自己的源码。检查读取 `manifest.json` 和 `plugin.cpp`，按规则号和位置修正 `error`。`ready-for-build` 表示可以进入固定构建，敏感能力仍交维护者核对实现。
2. **固定输入并比对两份 DLL。** 维护者在断网 Windows Sandbox 以只读源码、SDK 和固定 x86 工具链构建两次。宿主逐字节比较产物，生成 `build-evidence.json` 与列出交付文件大小、SHA-256 的 `release.json`。同一环境两次一致记为 `repeated-byte-identical`；此时 `independentReproduction` 为 `not-run`，`behaviorReview.status` 为 `pending`。当前固定配方支持单个 `plugin.cpp` 的示例型工程；多源文件、额外依赖或素材需先纳入对应配方与交付清单。
3. **开发签名。** 对 `release.json` 原始字节生成 CMS 分离签名 `release.p7s`，二者随包交付；另行提供并确认开发证书指纹，信任策略由使用方保存在包外。签名后改动 manifest、DLL 或素材须重新生成清单与签名。
4. **加载前核验。** Core 安装时核验包并在账本绑定发布摘要；启动预检和 Runtime 映射 DLL 前再检查清单、文件完整性、签名、证书有效期与撤销状态。失败项保留具体错误，DLL 停在映射前。磁盘和本次进程的显示见 §9.3；Sandbox、签名与验签命令见[维护者操作手册](RELEASE_VERIFICATION.md)。

**GPL 移植随包交付对应源码。** 放入上游许可证全文、与本版 DLL 对应的源码、依赖及其许可、改动说明和可用的构建方法。约定用 `SOURCE.md` 记录上游来源、版本或提交及移植差异，用 `source/` 存放源码和构建入口；签名发布时这些文件也要列入清单。可对照 `native/plugins/skeeto.crosshair/` 及其构建出的包。

### 9.3 在桌面上看到的状态

**安全检查**覆盖包中的 DLL：查看导入表、字符串、区段和签名结果，并按规则版本和文件 SHA-256 缓存。出现拦截项时，桌面与茶茶的导入都会停止；需留意的能力会列在确认框中。详情页可重新筛查。闭源或私有源码包通过签名核验且没有拦截或需留意项时标为「闭源 · 未发现问题」。

「已核验」还要求公开固定提交、本地独立复现及维护者审核。负责审核的人在包外信任策略的 `reviewedReleases` 中登记具体的 `releaseSha256`、`commit`、`independentlyReproduced: true` 和 `maintainerReviewed: true`；摘要及提交须与本次通过签名核验的包一致。未登记时保持「未核验」。

**导入检查**（「添加 → 本机 DLL / ZIP / 文件夹」后）：

| 界面提示 | 含义 |
|---|---|
| 标准 Matcha SDK 包，可以直接导入 | 显示名称、ID、加载方式和文件数；确认文件清单后导入，默认停用。已安装同 ID 时按钮变为「更新…」 |
| 这是一个普通 DLL / 不是标准 SDK 包，交给 Agent 整理 | 列出缺少的文件和问题，交给 Agent 核对宿主、整理候选包，再确认导入 |
| 没法导入这个包 | 列出具体问题和对应文件；原文件和游戏目录保持原样 |

**核验状态**（功能列表和详情页）：

| 状态 | 显示 |
|---|---|
| `unverified` | 本地开发 · 未核验 |
| `verified-development` | 开发签名已核验 |
| `rejected` | 加载核验失败，附实际错误，保留停用入口 |

开关表示**下次完整启动**的选择，退出游戏后调整。「本次已加载」来自游戏里 Runtime 的实际观测。`verification` 显示当前磁盘核验结果，`runtimeVerification` 显示本次进程加载时的核验结果。

## 10. 本地调试

### 10.1 配置工作区并构建自己的 DLL

在项目根目录打开 PowerShell。已配置好的 `native/build-x86` 可直接构建目标。首次配置使用 CMake 3.22+、Ninja 和工作区的 LLVM-MinGW 工具链；选 `i686` 编译器生成游戏需要的 32 位 DLL：

```powershell
$tool = (Resolve-Path '.tools/llvm-mingw-20261104-ucrt-x86_64/bin').Path
$env:PATH = "$tool;$env:PATH"
cmake -S native -B native/build-x86 -G Ninja `
  "-DCMAKE_C_COMPILER=$tool/i686-w64-mingw32-clang.exe" `
  "-DCMAKE_CXX_COMPILER=$tool/i686-w64-mingw32-clang++.exe" `
  -DCMAKE_BUILD_TYPE=Release -DL4P_BUILD_OFFLINE_FIXTURES=ON
```

雷达和设置服务用[第 1 章](#1-快速开始)的两个目标。添加自己的目标时，例如把 demo 源码复制到 `native/examples/yourname.hello-hud/`，同步更新 manifest、DLL 身份及动作实现，在 `native/CMakeLists.txt` 的 `demo_hello` 目标旁加：

```cmake
set(hud_pkg "${DIST}/bin/l4p/plugins/yourname.hello-hud")
add_library(hello_hud SHARED examples/yourname.hello-hud/plugin.cpp)
l4p_target(hello_hud)
set_target_properties(hello_hud PROPERTIES PREFIX "" OUTPUT_NAME "plugin"
  RUNTIME_OUTPUT_DIRECTORY "${hud_pkg}" ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/hello_hud")
configure_file(examples/yourname.hello-hud/manifest.json "${hud_pkg}/manifest.json" COPYONLY)
```

运行 `cmake --build native/build-x86 --target hello_hud`，把声明的素材一并放入产物目录。先静态检查 `node backend/cli.mjs validate-plugin --plugin-dir native/build-x86/dist/bin/l4p/plugins/yourname.hello-hud`，再按 §9.1 打包。

### 10.2 用离线宿主看一次完整调用

先用 `demo.hello` 验证宿主、插件和动作能接通。这个定向用例在工作区建立合成目录，以自有 fake DXVK 和 `l4p_smoke.exe` 调用真实的 x86 Runtime 和 demo DLL：

```powershell
cmake --build native/build-x86 --target dxvk_d3d9 l4p_runtime demo_hello fake_dxvk bad_abi l4p_smoke
ctest --test-dir native/build-x86 -R '^l4p_offline_chain$' --output-on-failure
```

主场景中，`plugins[]` 应有 `id: "demo.hello"`、`version: "0.1.0"`、`state: "initialized"`；`hello` 收到 `name: "survivor"` 后返回 `"Hello, survivor!"`。同一场景里的 `bad.id` / `bad.abi` 是刻意放入的拒绝样例。

要停在现场查看状态，用刚生成的 `main` 目录启动离线宿主：

```powershell
$stage = Get-ChildItem native/build-x86 -Directory -Filter 'smoke-*-main' |
  Sort-Object Name -Descending | Select-Object -First 1
& .\native\build-x86\fixtures\l4p_smoke.exe "$($stage.FullName)\bin\dxvk_d3d9.dll" serve
```

宿主打印 PID、管道名和状态 JSON。保持该窗口打开，在项目根目录的另一终端查询状态，向**这个离线宿主**发送只读的 `hello`：

```powershell
$fixturePid = Read-Host '离线宿主打印的 PID'
node backend/cli.mjs runtime-status --pid $fixturePid
node --input-type=module -e "
  import { runtimeRequest } from './backend/core.mjs';
  const reply = await runtimeRequest(Number(process.argv[1]), {
    type: 'invoke', pluginId: 'demo.hello', actionId: 'hello', params: {name: 'survivor'}
  });
  console.log(reply.result);
" $fixturePid
```

回到宿主窗口按 Enter 即显式关停。要调自己的只读动作，在合成目录的副本中放入自己的包和精确版本的依赖，将 ID 按依赖在前的顺序写入副本的 `bin/l4p/enabled.txt`。对副本运行 `serve`，把上面的 PID、插件 ID、动作 ID 和参数换成对应值即可。

**按失败阶段找原因。** 在合成目录的 `bin/l4p/logs/runtime-<pid>.jsonl` 按 `pluginId` 找初始化和动作记录，例如 `Action completed: hello`。同目录的 `shim-<pid>.log` 记录图形入口与后端选择。状态中的 `stage`、`error` / `errorCode` 会区分依赖版本、发布核验、DLL 加载、ABI 身份和初始化失败；若有 `nativeError`，同时查看 Windows 错误码。

离线接通的证据是**身份与版本正确、状态为 `initialized`、声明的动作返回 DLL 的实际结果**。真实 GPU / 渲染后端、游戏窗口输入、Source 原生接口、HUD 画面和实际对局模式要在对应游戏版本另行确认。由玩家退出游戏后安装或更新，再手动启动，在所声明的模式里检查效果与退出后的恢复。

---

## 附：样例包

| 样例 | 看点 |
|---|---|
| `native/examples/demo.hello/` | 最小 ABI 和一个读动作 |
| `native/plugins/ragdoll.supply-radar/` | 完整 `presentation.page`、游戏内设置、自定义编辑器 |
| `native/plugins/skeeto.career/` | `flare.report.v1` 报表 |
| `native/plugins/skeeto.config-override/` | 依赖 `beacon.source`、Cvar 恢复点 |
| `native/plugins/skeeto.crosshair/` | 合集归属与配置动作 |
