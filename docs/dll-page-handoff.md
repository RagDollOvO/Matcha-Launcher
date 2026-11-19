# DLL 功能详情页：前后端接入

作者编排头图、快捷键和内容块时，查 [DLL 模组开发规范 §5 桌面展示](platform/DLL_SPEC.md#5-桌面展示)。前端由 `src/lib/plugins/page.ts` 清洗、`DllPage.svelte` 渲染；示例为 `native/plugins/ragdoll.supply-radar/manifest.json`。

## 图片读取接口（后端已接通）

`plugin-asset { id, path }` 已接入，返回值与 `plugin-cover` 相同，为 `{ dataUrl }`。封面、头图、内容块图片共用 `backend/plugin-assets.mjs`，已安装包优先于随包内容。文件缺失返回 `{ dataUrl: null }`，前端沿用占位显示。

`backend/desktop/service.mjs` 的读取规则：

1. 找插件，已安装优先，随包其次。
2. **只允许 manifest 里声明过的路径**：`presentation.cover`、`hero.image`，以及 `page` 里所有 `src`、`poster`、`image`、`before.src`、`after.src`。
3. 用 `platformPath` 逐级检查路径。
4. 按文件头识别 PNG、JPEG、WebP、GIF，单张上限 4 MiB。
5. 未声明的路径返回 `asset_not_declared`。

Agent 补充封面复制到 Matcha 数据目录，通过该模组专属的 `@overlay/…` 引用读取，沿用声明检查、格式和大小限制。作者的 manifest 与 `presentation.page` 保留原样。

可选：在 `validatePresentation` 里校验 `hero`、`modes`、`hotkeys`、`page` 的类型与长度。规则以 `src/lib/plugins/page.ts` 为准；前端已按同样规则清洗，所以后端这里只是额外一层防护。

## 游戏内设置（flare.game-ui）本次改动

- `menu.hpp` 的 `Presentation` 重写为左侧抽屉，配色使用 Matcha 的黑底、细线、暗红强调。开关、滑条、选项、按键提示都按行类型绘制。
- 菜单关闭时没有任何开销。打开时，只在翻页或分辨率变化时重新排版和测量文字；稳定帧每行只画几个图元，不分配内存，也不格式化字符串。
- `vgui.hpp` 支持三个字号槽位和透明度。`plugin.cpp` 用 QPC 时钟驱动 120 ms 的打开动画。
- ABI（`l4p_game_ui.h`）不变。`radar_settings_smoke.cpp` 的 Preview 已改成新的 `font(slot, tall, bold)` 接口。
- 离线预览工具：`native/tests/game_ui_preview.cpp`，编译命令写在文件头。
