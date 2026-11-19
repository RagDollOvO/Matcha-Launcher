# L4D2 Platform：自有原生模组平台

本项目把第三方 DLL 的加载、接口、配置描述和操作入口统一起来。开发者交付遵循 SDK 的插件包；桌面界面和 Pi CLI 使用同一套平台能力。

内部标识沿用 `l4p`。自有加载器负责普通 DLL 与 SDK 模组；L4N 由整包适配器切换官方入口。渲染由游戏管理；运行时通过 L4N 子插件接口加载，具体文件、版本和启停契约见 [DLL 与 L4N 整包](NATIVE_LIBRARIES.md)。后文保留早期加载链和历史验证记录。

## 默认启动与可选的 Runtime 加载路径

```text
Matcha 自有启动端（L4N 平台启动）
  └─ 选定目录/left4dead2.exe -steam -novid（原版或已启用的 L4N 入口）
      └─ 显式添加 -vulkan 且游戏选择 DXVK 入口时：
          └─ bin/dxvk_d3d9.dll（自有 shim）
              ├─ bin/l4p/backend/dxvk.dll 或 Windows 系统 D3D9
              └─ bin/l4p/l4p_runtime.dll
                  └─ enabled.txt → plugins/<id>/plugin.dll
```

L4N 总开关管理其 EXE、核心 DLL 与着色器入口。DXVK 开关独立选择 Matcha shim 的下游后端。游戏加载 `bin/dxvk_d3d9.dll` 时，shim 转发 D3D9 导出并启动自有 Runtime；实际加载结果由运行时状态确认。

首次安装把原来的图形入口同时保存为恢复副本和选用的后端副本。组件适配器可按预览更新随包 DXVK，恢复账本保留原入口。安装计划会检查 PE 位数、必要导出、目标目录和当前运行状态。

桌面提供“L4N 平台启动”和“纯净对抗”。前者要求 Steam 保持登录，直接以选定游戏目录为工作目录拉起 EXE，基础参数为 `-steam -novid`，使用游戏默认安全模式。窗口、帧率等参数由游戏设置合并；自定义启动项里显式填写的 `-vulkan` 会保留。连接服务器时在末尾附加经校验的 `+connect 域名:端口`。旧桌面 `direct` / `development` 配置在读取时迁移为 `modded`。

Core / CLI 为旧调用保留 `direct` / `development`，省略 mode 时使用开发模式 `Steam -applaunch 550 -insecure`。普通模组启动可显式选择 `--mode modded`。`backend/launch-argv.mjs` 统一定义基础参数，`backend/launch.mjs` 生成各入口的最终命令。

两种桌面方式均在用户确认后执行；纯净对抗保留原版目录与附加内容检查。普通路线兼容旧 manifest 的 `launchScope` 元数据，按实际参数处理服务器连接。第三方 DLL 联机需遵守服务器规则。部署、恢复、插件启停均在游戏退出后执行；运行中的游戏由用户自行管理。关闭 Matcha 保留独立游戏进程。

### 本机 L4N 对照记录（2026-11-16）

只读检查 `E:\L4D2_Archive\旧版求生`：随包 `left4dead2 no-insecure.bat` 执行 `start left4dead2.exe -steam -novid`；`readme_l4n.txt` 顶部版本为 2.50.3，说明启动来源决定启动参数，并提示内存补丁风险。EXE 字符串含 `left4neko.dll`、`launcher.dll`、`LauncherMain`；PE 导入含 LoadLibraryExA/GetProcAddress。这些证据确定了自有入口与模块加载思路，内部完整控制流尚待进一步分析。

Matcha 使用自行编写的直启和 Beacon SDK/Runtime；现阶段复用已在该用户游戏中验证的 DXVK shim 装载点，保持原游戏 EXE。新增直启的离线检查验证命令、路径、Steam/进程前提和错误传播；DLL 与目标服务器同会话的实际联机验收由用户手动启动后进行。

## 首版初始化发生在 render-init

shim 的 `DllMain` 保持最小工作量。后端、Runtime 和插件在正常图形工厂调用中初始化；成功取得后端 D3D9 对象之后记录 factory-ready。

SDK v1 提供：

- 插件接口协商、初始化、结构化日志；
- 按声明调用动作、读取 Runtime 状态；
- 当前用户范围的本地控制管道；
- 受控宿主的显式关闭入口。

`render-init` 是当前真实的初始化阶段。早期引擎事件、Device/Present/Reset 事件和热卸载各自需要后续运行时实现及版本化契约。插件以游戏会话为生命周期，退出阶段交给系统回收已映射模块；插件应在正常操作中及时保存持久数据。

## 数据流与写入所有权

```text
Svelte 前端（另一会话维护）
  ↕ 桌面壳桥接 / JSONL
backend/core.mjs（平台业务核心）
  ├─ 安装计划、备份账本、插件校验、依赖排序、Steam 启动请求
  ├─ 本地命名管道 ↔ Runtime ↔ 插件 C ABI
  └─ Pi CLI 的可信平台扩展也调用同一核心
```

第一阶段交付独立 CLI 与 JSONL 服务，供现有前端接入。桌面壳采用 Tauri 方向，Svelte 工程继续复用。业务逻辑集中在一个核心中，桌面壳负责进程和消息桥接。Pi CLI 按需启动，使用独立会话目录。

文件所有者：

| 区域 | 所有者与用途 |
|---|---|
| `src/`、根前端配置 | 现有前端会话 |
| `native/` | 自有 shim、Runtime、SDK、示例、离线宿主 |
| `backend/` | 平台核心与 CLI；`pi/` 为 Pi 接入 |
| `docs/platform/` | 平台标准、接入手册与交付记录 |

## 控制协议与确认

Runtime 管道名为 `\\.\pipe\l4p.<pid>`。使用 UTF-8、LF 分隔的 JSON，请求上限 64 KiB、响应上限 256 KiB。管道限本机当前 Windows 用户，动作串行执行。

```json
{"id":"r1","type":"status"}
{"id":"r2","type":"invoke","pluginId":"demo.hello","actionId":"hello","params":{"name":"survivor"}}
```

回应包含原请求 `id`：

```json
{"id":"r2","ok":true,"result":{"message":"Hello, survivor!"}}
{"id":"r2","ok":false,"error":{"code":"confirmation_required","message":"..."}}
```

`effect: write` 或 `requiresConfirmation: true` 的动作需要确认回执。CLI 的显式确认参数、UI 的确认操作、Pi 扩展收到的 `ctx.ui.confirm()` 结果，由可信调用代码转换为 `confirmation: { approved: true, source: "user" }`。模型的工具参数只包含业务参数。Runtime 再次检查声明、参数与回执。

这里的调用端和 DLL 都属于用户信任的本机程序。加载原生插件意味着授予其游戏进程中的执行权限，安装前需要展示作者、来源与文件清单。

## 验证与继续条件

离线宿主使用自有 fake D3D9 后端，验证导出转发、Runtime 初始化、插件动作和错误路径。实际 DXVK 的 GPU 初始化、Steam 启动衔接和 L4D2 内加载，需要用户准备 Steam 原版安装并明确确认启动实测后检查。

当前新增 [发布核验纵向链路](RELEASE_VERIFICATION.md)：`backend/releases.mjs` 调用原生只读核验器，Runtime 使用同一 `release_gate.hpp` 在插件映射前核验 CMS 签名、外部信任指纹、完整文件清单及精确发布版本。自有 demo 已完成隔离构建与离线安装/加载，真实游戏联机验收仍由用户安排。后续按真实模组需要演进版本化事件与渲染线程调度。

## 依据

- [L4D2 Bridge 对游戏 DLL 装载路径的实现说明](https://github.com/yeyunyyds/L4D2_Dxvk_32to64_Bridge/blob/main/docs/ARCHITECTURE.md)
- [DXVK 2.6.1 D3D9 导出表](https://github.com/doitsujin/dxvk/blob/v2.6.1/src/d3d9/d3d9.def)
- [Windows DLL 初始化约定](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-best-practices)
- [Pi CLI 集成协议](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli-integration.md)
