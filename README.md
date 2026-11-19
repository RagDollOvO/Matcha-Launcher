# Matcha · 求生之路 2 启动器

Matcha 是 Windows 上的《Left 4 Dead 2》启动器。用它管理 VPK、切换 Mod 方案、整理服务器，或让内置助手「茶茶」检查启动项、CFG 和模组状态。

**[下载 Matcha 1.0.0 · Windows x64](https://github.com/RagDollOvO/Matcha-Launcher/releases/tag/v1.0.0)**。在 Assets 中选择 Matcha 正式包 ZIP，完整解压后双击 `Matcha.exe`。升级前请先从系统托盘退出旧版。

### 茶茶可以操作哪些文件？

你可以让茶茶读一份安装说明、列出将被覆盖的文件，或者在指定的游戏目录执行安装命令。通用文件和终端工具在执行前显示路径、参数或完整命令，等你确认。读取结果会随对话发送到你选择的模型服务商；请用自己的账号配置服务商。游戏启动和退出由玩家操作。

### 从哪里看起？

| 想做的事 | 入口 |
|---|---|
| 选择游戏目录、设置启动方式 | [桌面端使用说明](docs/platform/MATCHA_DESKTOP.md) |
| 导入 Mod、管理分类和方案 | [Mod 管理](docs/platform/MODS.md) |
| 了解茶茶怎样调用工具、处理确认和取消 | [Pi 接入说明](docs/platform/PI_CLI.md) |
| 查看启动器实现 | [前端](src/) · [本机服务](backend/) · [Tauri 桌面壳](src-tauri/) |

**开发环境：** Windows x64、Node.js（本机工具已在 24.x 验证）、npm、Rust 与 WebView2。安装 JavaScript 依赖分别使用 `npm ci` 和 `npm ci --prefix backend`。桌面打包还需要原生组件及随包资源，具体路径见 [Tauri 资源清单](src-tauri/tauri.conf.json)。

**第三方内容：** 上游代码、字体、声音和随包程序分别保留各自的来源与许可。参见[第三方许可](docs/licenses/)、[声音来源](public/sfx/SOURCES.md)和 [DSH Browser 来源声明](src/lib/browser/dsh/SOURCE.md)。
