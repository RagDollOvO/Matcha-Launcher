# 新 Mod 默认启用：变更记录

2026-11-19，用户要求「加新 mod 进去默认打开」，并让 claude 连后端一起改。这份记录给 codex 同步用。

## 规则

Mod 的「开」= 在启动方案的 `modIds` 里；启动时 `applyModProfile` 才写 addonlist 和部署独立库。新 Mod 现在进来就加进 `activeProfileId` 的方案：

- 文件和 addonlist 不动，导入时仍登记为停用，下次启动应用方案时才打开。
- 「新下载」(`modMeta.inbox`) 标记保留。
- 只加扫描里存在、没有解析错误、不是 `platform-package` 的 ID。
- 方案的 `modsGameRoot` 属于别的游戏目录时不改。
- 尽力而为：加不进方案不会让导入失败。
- DLL 模组 / L4N 子插件导入仍默认停用，没改。

## 后端改动（`backend/desktop/service.mjs`）

- `enableNewMods(gameRoot, ids)` 返回本次请求中已在启动方案启用的 ID。首次导入和手动同名替换均启用，重复导入只保留一个条目。调用方都在服务队列里。
- 接入点：
  - `import-mod`：返回值多了 `enabled`、`applies: 'next-launch'`、`profileId`。
  - `browser-import`
  - `pack` 任务
  - GameMaps 下载任务
  - 工坊下载任务：库里已有这个条目时（更新）不动玩家的开关。
- `save-profile`：只把**这次新加进方案**的 ID 移出「新下载」（和保存前的 `modIds` 比对）。原来是方案里所有 Mod 一起清。之前未初始化的方案保持旧行为。

## 茶茶

- `mod_import`：在 Matcha 里改走 `modRequest('import')` → `mod-acquire.mjs` 的新 `import` 操作 → `service.dispatch('import-mod')`，所以同样默认启用。脱离 Matcha 单独跑时仍直接用 ModManager，默认停用，确认文案会写明。
- `mod_download`、`mod_browser_import` 本来就走服务，只改了描述和确认文案。
- `matcha-mod-organizer` 技能：只要求下载时，不再说「保留默认停用」。

## 前端

- 前端不再自己存方案，只刷新快照；提示和确认文案改成「默认启用，下次启动生效」。
- 下载完成的通知去掉了「加入方案」按钮。

## 测试

- 新增 `mods.test.mjs`「desktop new Mods…」，覆盖本地导入、茶茶导入、inbox 只清新加入的、其他游戏目录的方案不动。
- `browser-downloads.test.mjs` 和 `mod-library-p2.test.mjs` 里原来断言「下载后方案为空」的地方，已改成新行为。
- 下面 3 项在关掉新逻辑后照样失败，是这次之前就有的，没动：
  - `service.test.mjs`：runtimeState
  - `pi/backend.test.mjs`：offline config
  - `pi/mod-p1p2.test.mjs`：网页 ZIP 导入后压缩包不在了
