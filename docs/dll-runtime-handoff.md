# DLL 后端：L4N 子插件开关与加载状态

2026-11-17，本页记录用户确认的第 1、4 项。前端及卸载/版本回退由 Claude 继续。第 2 项的本地检查与 Agent 接口见[来源接入交接](dll-source-handoff.md)，模组作者见 [Matcha SDK：DLL 模组开发规范](platform/DLL_SPEC.md)。

## 前端接入接口（已就绪）

- 普通 Matcha 模组保留 `snapshot.plugins`，增加 `host: 'flare'` 和 `loadStatus`。
- 随包未安装项同样提供 `loadStatus`。
- `snapshot.l4nPlugins` 为独立对象：`{ hostEnabled, pending, plugins, issues }`。子插件由 L4N 执行。
- 子插件保留原 DLL 文件名，停用文件存于游戏根目录 `.matcha-l4n-plugins/disabled/`，位于 L4N 扫描目录之外。个人配置保持原位。

`loadStatus` 将当前游戏证据与下次启动选择分开：

```ts
{
  state: 'available' | 'disabled' | 'pending' | 'loaded' | 'initialized' |
         'failed' | 'unobserved' | 'host-disabled';
  label: string;
  host: 'flare' | 'l4n';
  nextLaunchEnabled: boolean;
  observed: boolean;
  mapped: boolean | null;
  initialized: boolean | null;
  pendingChange: boolean;
  applies: 'next-launch';
  code?: string; message?: string; detail?: string; stage?: string; nativeError?: number;
  nextLaunchError?: { code: string; message: string };
}
```

展示优先读取 `loadStatus.label`。普通 DLL 与 L4N 子插件使用“已装载”；Matcha SDK 完成宿主初始化后使用“初始化完成”。`null` 表示当前证据尚未确定该项；L4N 的内部插件初始化结果仍由 L4N 提供。

`loadStatus.message` 提供可读原因，`detail` 保留原始诊断。常见 Windows DLL 失败码转成中文原因；旧字段 `error` 继续保留。子插件 `id` 是文件名派生的稳定、不透明标识，按原样传回命令；版本当前为 `null`，导入时全程静态检查。

## L4N 子插件命令

| 命令 | 参数 | 返回/行为 |
|---|---|---|
| `l4n-plugins-list` | 无 | 轻量读取子插件列表 |
| `l4n-plugin-preview` | `{ operation: 'import', file }` | 静态核对 x86 / L4N 导出，预览后默认停用导入 |
| `l4n-plugin-preview` | `{ operation: 'set-enabled', pluginId, enabled }` | 预览整个 DLL 开关 |
| `l4n-plugin-apply` | `{ planId }` + 用户确认 | 执行已预览的文件切换 |
| `l4n-plugin-recover` | 用户确认 | 恢复该目录未完成的子插件操作 |

游戏运行时仅查询状态；文件切换在退出游戏后执行。所有开关保持启动参数原样。

## 加载器与交付

新 Runtime 在现有 status 请求时观察本进程的 L4N 模块，空闲帧没有新增扫描。旧 Runtime 保留既有功能，加载状态回退为已知证据或“待确认”。新增观察能力通过 `L4P_RuntimeModuleStatusV1` 标记，运行环境将提示更新加载器。

观察使用 [Windows 模块快照](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/nf-tlhelp32-createtoolhelp32snapshot)；枚举失败时保留“待确认”，返回 Windows 错误码。

后端源码与原生包 `native/build-x86/dist/bin/l4p/l4p_runtime.dll` 已就绪，资源清单已包含新增后端文件。定向检查覆盖独立开关、配置保留、预览失效、游戏运行门禁、中断恢复和真实 x86 宿主的加载状态；L4N 观察使用自有假 DLL，完整过程在隔离目录完成。

前端按本页命令与字段接入后合版发布，再由用户手动启动游戏确认实际加载。当前桌面正式入口保留上次稳定版。
