# Steam 玩家卡

主页从本机 Steam 读取昵称、缓存头像和登录状态。首次打开主页时读取一次；点头像立即刷新。没有头像时显示昵称首字，没有本机账号时显示登录提示。

`steam-profile {}` 由桌面和开发预览共用的能力服务处理。返回 `{ profile: null }`，或 `{ profile: { steamId, personaName, avatar, online? } }`。头像是 PNG / JPEG data URL 或 null，登录用的 AccountName 留在本机。

`backend/steam-profile.mjs` 在 Steam 注册目录和所选游戏对应的库目录中查找 `config/loginusers.vdf`。Steam 运行时优先选 ActiveUser 对应的账号，其次按 MostRecent 和 Timestamp 选择。头像来自同一根目录的 `config/avatarcache`。online 表示客户端正在运行并登录该账号；状态未能读取时仅显示账号资料。
