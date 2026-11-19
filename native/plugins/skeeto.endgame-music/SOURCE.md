# 结算与氛围音乐

Skeeto 2.2.19 / `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，GPL-3.0。

- `skeeto_proxy.cpp`：SafeMusicSampleMatches / SafeMusicRequestChapter / SafeMusicPaintPump、LastMusicShouldPlay / LastMusicRoster / LastMusicPaintPump / LastMusicNoticePaint。
- `skeeto_background.cpp`：OpenAudioReader / ScalePcm16 / ReleaseAudioBlocks、SafeMusic 与 LastMusic 两套原生媒体工作线程。独立编译在 media.cpp，仅提取本功能代码。
- 新 assets.inc 用 Source File API 的 GAME 只读流与枚举替换单体内部文件助手；每帧扫描 16 项或提取 256 KiB，单音轨上限 128 MiB。
- Entity API 2 读取 PlayerResource 数组和玩家信息；实体路径在资源缺失时保留。Source Sound API 识别两条原生 safe 音样，准备就绪后才静音原声并播放本功能音轨。
- 配置页、曲目表、试听 / 停止 / 重扫、音量步进与提示预览由 Flare 通用动作展示。通知全局隐藏预留 `skeeto.hud.hide-all`，待 HUD 发布。
- 通知位置提供相对顶部居中与绝对坐标选项；保留用户选择的锚点，窗口尺寸变化后相对坐标继续生效。字号和边距沿用原作 50–200% 比例，原生字体标志为 0x290。
- 素材文件由用户现有挂载包提供，随包保留源码、SDK 头、许可证与 CMake。`music_smoke` 使用自有静音 PCM 素材，在真实 x86 DLL、Media Foundation 解码器和 waveOut 上通过了结算替换、每章一次、清道夫/菜单门禁、五类存活条件、PVS 外资源数组、提示绘制、配置和关闭清理；位图已查看。工作区候选的游戏表现待实测。
