# 静态窗口准星 0.1.0

上游：[regoists/Skeeto](https://github.com/regoists/Skeeto)，2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，GPL-3.0。原作者与贡献者的版权归原权利人。

2026-11-16 Flare 移植：`drawing.inc` 保留 `src/skeeto/core/skeeto_proxy.cpp` 的 `XhairTune`、20 组工厂预设、`XhairScaleF` 至 `XhairDrawAll` 的绘制代码；配置改为本线程状态。颜色表精简为 6 色。`plugin.cpp` 新增 Beacon ABI、窗口线程、前台窗口检查和配置保存。

窗口仅在当前进程的 `Valve001` 窗口拥有前台焦点时显示。33 ms 观察一次窗口状态，窗口位置或设置变化时重绘；失焦即隐藏。独立 UI 线程释放窗口和 GDI+ 资源。未增加 Source Hook、游戏内存写入或输入生成。

范围：静态几何准星。动态散布、贴图、第三人称与游戏状态识别仍在移植清单。游戏构建与独占全屏兼容性待实测。模块默认停用，开关在下次完整启动时生效。

## 随包源码与构建

本目录的 `source/` 包含本版本完整源文件、SDK 头、nlohmann/json 头及独立 CMakeLists。使用 CMake 3.22+ 与 Windows x86 C++17 工具链：

```powershell
cmake -S source -B build -A Win32
cmake --build build --config Release
```

LLVM-MinGW 使用 Ninja 并显式指定 i686 编译器。链接 Windows 系统库 `gdiplus`、`gdi32`、`user32`。构建步骤只产生本地 DLL。许可证见 `LICENSE`；nlohmann/json 的 MIT 许可位于其头文件开头。

仓库内构建入口为 `native/CMakeLists.txt` 的 `skeeto_crosshair`。源代码修改与对应 DLL 应一起发布。Flare 移植版本的源码随包交付；上游提交仅标识原始绘制来源。

合集封面 `catalog.png` 使用同一上游提交的 `LOGO.png`，版权归原作者与贡献者，随本包按上游 GPL-3.0 许可提供。
