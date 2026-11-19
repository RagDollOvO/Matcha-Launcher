# 启动方式收成两种：交接给后端

> 2026-11-17 用户定案。前端与后端已对齐：启用 DLL、雷达或 L4N 时均不追加 `-insecure`。

## 用户的决定

- 桌面只保留两种启动方式：**纯净对抗** 和 **L4N 平台启动**（原「模组游玩」改名）。
- **L4N 平台启动不带 `-insecure`**，使用游戏默认安全模式，连接流程按实际参数处理。
- Matcha 只是启动器，**不按 DLL 拦截启动**。DLL 由 agent 核对。
- 「模组直启」「开发模式」不再出现在桌面。

之前讨论过的「shim 没有 Matcha 标记就不加载插件」属于拦截，**不做**。

## 原版 L4N 的依据

已静态核对 `vendor/l4n/2.58.0/` 原包：

- `left4dead2 no-insecure.bat` 执行 `start left4dead2.exe -steam -novid`。
- EXE 选择 `left4neko.dll` 并调用 `LauncherMain`；`-hide_neko` 切到原 `launcher.dll`。
- L4N SDK 的 DLL 位于 `bin/neko/plugins/`，通过 `GetL4NPluginInstance` 接收回调。自己的 Matcha DLL 保持 `bin/l4p` 加载链。
- `readme_l4n.txt` 将 `-insecure` 作为玩家可选启动项，并提示内存补丁与联机使用风险。

## 后端已落实

1. **实际命令与预览**：`modded` 的基础参数为 `['-steam', '-novid']`，`vacMode: 'game-default'`，名称「L4N 平台启动」。`backend/launch.mjs` 与游戏设置的 `effective.modded` 使用同一生成器。L4N 和 DXVK 开关独立；`-vulkan` 只作为用户显式选择的自定义启动项。已有方案草稿保留。
2. **旧桌面配置迁移**：`launch.json` 中的 `direct` / `development` 读取后迁移并保存成 `modded`；桌面接收到旧模式请求时也统一映射，涵盖启动、连接和模式保存。Core / CLI 保留原有模式，省略 mode 时按开发模式向 Steam 提交 `-applaunch 550 -insecure`；普通 CLI 启动显式使用 `--mode modded`。
3. **普通启动条件**：移除 L4N 入口和旧 `launchScope: "insecure"` 触发的 insecure 要求。旧 manifest 字段继续兼容读取；DLL 开关保持实际启动参数不变。服务器连接检查跟随 `vacMode`，L4N 平台启动沿用正常连接流程。
4. **物资雷达**：Matcha 版升至 1.5.9，移除 `IsWorkshopSession()` 与对应初始化门槛，manifest 移除 `launchScope`。本地地图和适用游戏模式检查保留。
5. **文档**：`LIGHTWEIGHT_MODS.md`、`NATIVE_LIBRARIES.md`、`ARCHITECTURE.md` 与雷达随包说明已同步。

## 保留不动

- **纯净对抗的启动前检查**（`backend/clean-launch.mjs`）：这是「纯净」本身的定义，不算按 DLL 拦截。如果用户也要求去掉，再另行处理。
- **`requireReleaseRuntime`**：这是 runtime 版本兼容检查，不是策略拦截。

## 前端已改的（供核对）

- `src/lib/launch-modes.ts`：两种方式的名字，旧模式显示为 L4N 平台启动。
- `LaunchMode.svelte`、`GameSettings.svelte`：只显示两种方式。
- `app.svelte.ts`
  - 删除前端的 `checkLaunchMode()` 拦截
  - 确认框标题使用前端的名字
  - 说明文字按这次实际参数里有没有 `-insecure` 来写
- VAC 服务器「只复制连接命令」的逻辑跟随后端的 `vacMode`；L4N 平台启动返回 `game-default`，沿用启动并连接流程。

确认框、游戏设置预览和最终启动命令使用同一份后端参数。
