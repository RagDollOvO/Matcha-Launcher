# 助手独立窗口：桌面接入

桌面版点顶栏「助手」或按 **Ctrl+K**，助手窗口会贴在主窗口右边；屏幕右侧空间不足时贴着工作区右缘。点助手的收起按钮可隐藏窗口，再次打开会保留当前对话和输入框草稿。浏览器预览沿用原来的分栏。

## 窗口由主界面管理

- `src/lib/agent/window.svelte.ts` 用固定标签 `agent` 查找或创建 `WebviewWindow`，父窗口为 `main`。`src/main.ts` 在 `index.html?view=agent` 挂载 `AgentWindow.svelte`。
- `src-tauri/capabilities/main.json` 放行 `core:webview:allow-create-webview-window`，以及窗口的 `set-position`、`set-size`、`show`、`hide`、`set-focus` 和 `destroy`。权限绑定本地主视图标签，内置浏览器的网页沿用原有隔离。
- 窗口初始宽度为 420 个逻辑像素，可手动调至 340–560。贴边由 `src-tauri/src/agent_window.rs` 处理：主窗口移动时只定位，调整大小时按客户区尺寸对齐高度；助手自身的移动、缩放事件不触发跟随。
- `src-tauri/capabilities/agent.json` 给助手视图收发事件、拖动和隐藏自身的权限。Rust 的 `beacon_call` 接受该视图的 `pi-*` 命令；启动器的其余业务操作和 `browser_call` 仍由主视图发起。
- 在助手窗口按 **Alt+F4** 也会收起助手。主窗口销毁时，壳清理随附窗口；应用退出时统一结束它持有的桌面服务和 Pi 进程。

## 两个窗口共用一个 Pi 会话

- **桌面服务持有 Pi 子进程**。主窗口启动时接入，供设置页和「交给 Agent」使用；助手窗口首次加载时接入同一个服务。两边都通过 `beacon-event` 接收流式消息。
- `backend/desktop/service.mjs` 把 `pi-connect` 放入同一条生命周期队列。首次连接启动 Pi；已有进程时只调用 `get_state`，返回当前会话。打开、隐藏或再次显示助手沿用这次会话。设置里的「重新连接」单独走 `pi-reconnect`。
- 针对性检查：`node --test --test-name-pattern="main and agent attach" backend/pi/backend.test.mjs`。两个并发连接和一次后续连接共用同一个进程、会话 ID 和会话文件。

## 独立窗口不可用时

建窗口失败时，前端会在控制台打一条警告，然后自动退回到主窗口里左右分栏显示助手，不影响其它功能。浏览器预览（5173）里始终是分栏，因为浏览器开不了系统窗口。

## 两个窗口之间的消息

两个窗口通过 Tauri 事件 `matcha://to-agent` 和 `matcha://to-main` 互发消息，内容如下：

- **主窗口发给助手窗口**：`send`（「交给 Agent」的指令）、`route`（当前页面）、`focus`（聚焦输入框）、`ping`（确认就绪）、`sync`（再次打开时读取当前模型）。
- **助手窗口发给主窗口**：`ready`（准备好了）、`hidden`（自己收起了）、`browse`（用内置浏览器打开链接）、`settings`（打开设置页的某一节）、`toast`（弹提示）。
