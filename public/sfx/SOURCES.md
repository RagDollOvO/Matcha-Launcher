# 主页音乐与界面音效

右上角声音面板的三个开关使用原创「软木轻敲」采样（`sound-menu/on.wav`、`sound-menu/off.wav`）。常规界面音效沿用 `ui/` 下的采样或合成音。启动游戏的音效不用采样，由 `src/lib/sound/sfx.svelte.ts` 的 `launchChime()` 现场合成（轻声上扬 + 音乐盒琶音），确认启动后才响。主页音乐保持用户提供的《如果你的脑子停下来，就听这首音乐，停下思绪，彻底放松…》前 16 分钟，资源位于 `media/home-relax.mp3`。

## 可选：替换为以前的 CC0 采样

1. 按下面两张表下载素材。Kenney 的两个压缩包下载后先解压；Freesound 的文件名保持原样，不要改，脚本靠开头的编号识别。
2. 在项目根目录运行（不传目录时默认扫描 `~/Downloads`）：

   ```bash
   npm run sfx:import -- "C:\Users\你\Downloads"
   ```

3. 脚本会把文件改名放进 `public/sfx/ui|fx/`，并列出还缺哪些。开发模式刷新后生效；分发桌面版时重新构建。

ogg / mp3 / wav / flac 都能用，不需要转码；缺哪个文件，那一项自动用合成音兜底。
想换成别的素材：放同名文件（如 `ui/click.wav`）覆盖即可。

## 界面（Kenney，CC0）

- UI Audio（50 个）：https://kenney.nl/assets/ui-audio （GitHub 镜像：https://github.com/Calinou/kenney-ui-audio）
- Interface Sounds（100 个）：https://kenney.nl/assets/interface-sounds

| 目标文件 | 建议取自 | 备注 |
|---|---|---|
| ui/hover.ogg | Interface Sounds `tick_001` | 悬停，极短 |
| ui/click.ogg | UI Audio `click3` | 机械按键感 |
| ui/tab.ogg | UI Audio `switch7` | 切页 |
| ui/toggle-on.ogg | Interface Sounds `toggle_001` | |
| ui/toggle-off.ogg | Interface Sounds `toggle_002` | |
| ui/open.ogg | Interface Sounds `open_001` | 菜单/面板展开 |
| ui/close.ogg | Interface Sounds `close_001` | |
| ui/send.ogg | Interface Sounds `drop_002` | 发消息 |
| ui/reply.ogg | Interface Sounds `confirmation_002` | agent 回复完成 |
| ui/approve.ogg | Interface Sounds `confirmation_001` | |
| ui/deny.ogg | Interface Sounds `error_004` | |
| ui/error.ogg | Interface Sounds `error_006` | |
