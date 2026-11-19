# DSH Browser 接入检查点 · 2026-11-16

用户按 Escape 停止 Computer Use；本轮结束界面操作，保留当前验证窗口和服务。

## 当前实现
- 上游 Nono-neko/dsh-browser 0.4.1，revision 3b30aa740ece9cc2057cb9c81bf1e5df5f1bef3e。
- 复用 src/lib/browser/dsh 的 store/persist/url，Svelte 页面 Browser.svelte 与 Rust browser.rs 承载原生 WebView2。授权、许可证、来源说明已加入。
- 独立 profile、标签页、收藏、网页下载记录、VPK/ZIP 选择导入、来源持久化与 Mod 详情链接。
- API browser-archive/browser-import；ZIP 使用固定 yauzl 3.4.0。游戏运行检查复用 ModManager。
- 备份：checks/.artifacts/before-dsh-browser。

## 已有证据
- npm run check: 0 errors/warnings（最新两处小改动后待按需检查）。
- 针对性 browser-downloads.test.mjs 通过：直接 VPK、ZIP 选择/分卷、默认停用、新下载和来源、同名保留、路径越界拒绝。
- 原生窗口只完成主页检查；浏览器点击时用户按 Escape 中断，B站/爱发电/原生下载的界面检查待用户允许后继续。

## 重要构建发现
通过 cargo rustc --release 直接构建时必须启用 --features custom-protocol；首个内部候选的主页实测仍指向 localhost:5173。release/Flare-0.1.0-20261116T151039Z 是内部验证候选，勿交付。release/latest.json 已恢复前一版本 20261116T145108Z。
当前构建正在 session 86828 执行：npm run build; cargo rustc --manifest-path src-tauri/Cargo.toml --features custom-protocol --release -j1 -- -C opt-level=1 -C codegen-units=256。
需读取构建结果（另有 BrowserState downloads 分支潜在借用生命周期编译错误，若出现则将锁克隆先赋局部变量后返回），修复任何编译失败；完成时打包正式候选并确认离线启动 URI 是 tauri/app origin。

## 保留的运行现场
- Flare 验证进程记录 checks/.artifacts/browser-desktop-process.json，PID 41404，路径为内部候选 151039Z。
- 隔离目录 checks/.artifacts/browser-desktop-KiOpNZ/data，伪游戏在同级 game，真实游戏未改动。
- checks/browser-desktop-fixture.mjs 服务 http://127.0.0.1:5177，PTY session 67281；回车可结束它。当前 fixture 元信息 browser-desktop-current.json。
- CUA 使用 node_repl 的 sky；用户 Escape 后本轮禁止继续 CUA。后续须获得用户恢复意图。

## 下一步
用户允许继续后：处理构建；针对性检查界面原生 child bounds、标签/路由切换隐藏、下载/VPK/ZIP导入及权限隔离夹具；实际 B站视频和爱发电页面。登录/购买留用户操作。持久化恢复也在独立数据目录验证。
注意 native close(home) 仍会关闭下载所属视图，可改为保留进行中下载的原生视图或用户提示。当前 sync 已保留关闭标签后的进行中下载视图。
完成后更新正式包/文档与最小交付。游戏保持用户掌控。
