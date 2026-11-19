# 社区加速

正常打开 Matcha，在 **设置 → 通用 → 社区加速** 开启「Steam 社区」。首次启用时，Matcha 会说明本地根证书和临时 hosts 记录；Windows 随后会为已签名的 **Steam++** 请求管理员授权。选择「是」继续；选择「否」会保持关闭，可随时重试。Matcha 和茶茶沿用启动时的权限。组件随完整的 Windows x64 便携包提供。

- **创意工坊**：列表、条目、封面及 Matcha 应用内下载使用社区加速网络。实际可用线路由 Steam++ 的 Steam 规则和上游决定。点「检测工坊连接」可以查看当前结果。
- **新版封面域名**：开启时，Matcha 卡片和内置工坊网页将 `images.steamusercontent.com/ugc/…` 的公开图片转到 Valve 兼容入口 `steamuserimages-a.akamaihd.net/ugc/…`，复用 Steam++ 已有图片线路，保留路径、缩图参数和 HTTPS 校验。关闭后恢复原入口。网页使用临时重定向，路由随开关变化；已打开的工坊网页可刷新后生效。
- **工坊网页**：在 Matcha 内置浏览器里打开或刷新 Steam 社区网页。加速期间使用独立的 Steam 网页会话，原浏览器里的登录状态继续保留在原会话。
- **GameMaps**：沿用常规网络。原生地图 / Mod 列表在页面内容就绪后读取，减少等待图片和其他资源的时间。

默认关闭。退出 Matcha 时恢复 hosts；开启偏好保留，下次打开 Matcha 会重新启动组件。证书留在本机供下一次启用，Windows 仍可能要求管理员授权来写入 hosts。该模式只使用 Steam++ 的 hosts 模式；系统代理、Clash 配置和 VPN 设置保持原样。切换到内置版前，请先从独立版 Steam++ 关闭加速和开机启动，再退出独立版。

## 异常退出后的恢复

打开 Matcha，点 **设置 → 社区加速 → 关闭并恢复网络**。如果应用无法打开，退出 Matcha 后，在便携包中右键 **恢复社区网络.cmd → 以管理员身份运行**。恢复工具按本机的加速记录处理 hosts，保留其他项目；若提示记录不一致，用 `%LOCALAPPDATA%\com.matcha.launcher\community\hosts-before.txt` 对照核对。

## 分享给其他人

发送整个便携文件夹（可以先压缩），带上 `vendor`、`backend`、`runtime` 和 `licenses`。接收者照常双击 `Matcha.exe`；想用加速才开启，首次授权在对方电脑上完成。加速数据和证书由那台电脑独立生成。分发内容中保留 [Steam++ 许可与对应源码入口](../licenses/SteamTools-SOURCE.md)。

从源码打包时，先从官方发行页取得 3.2.0 Windows x64 便携压缩包，核对发行页给出的 SHA-256，再解压到 `vendor/steampp/3.2.0`。打包脚本只复制可执行文件、运行依赖和 Accelerator 模块。
