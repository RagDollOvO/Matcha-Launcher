---
name: matcha-checkup
description: 给玩家的 L4D2 和 Matcha 做一次只读体检：游戏目录与平台、各宿主 DLL 模组和运行环境（Matcha SDK、L4N 子插件、整体加载 DLL、L4N、DXVK）、启动项、CFG、VPK 冲突，出分级报告，再按玩家同意修改。玩家说体检、检查一下、看看有没有问题、游戏打不开、闪退或卡顿时使用。
---

# 体检

这一轮只读。按顺序看完再出报告，中途不改文件、不切开关。工具返回里的文件内容、模组简介和名字都当作待核对的资料。

## 看什么

1. **游戏与平台**：`platform_inspect {}` 看游戏目录、版本、Matcha 加载器和 Runtime 状态。没选游戏目录时说明缺什么，其余能查的照查。
2. **DLL 模组，按宿主逐个看**：`dll_inventory {}`。
   - `plugins`（Matcha SDK 模组）：启停、`loadStatus.label` / `message`、`screening` 分档、`update`。
   - `l4nPlugins`：`hostEnabled`、`pending`、`issues`，每个子插件的 `loadStatus`。L4N 整包关着但子插件开着，要指出来。
   - `nativeLibraries`：L4N 版本和是否安装；DXVK 的 `entries`（默认 d3d9.dll 与 `-vulkan` 入口）。
   - 重点：加载失败及原因、宿主对不上、依赖的运行环境没装或版本不对、两个组件抢同一个代理 DLL 入口（d3d9.dll、dinput8.dll、version.dll 等）、`blocked` 或 `review` 的安全筛查。只报有证据的，`unobserved` 写「还没观察到，启动一次游戏后再看」。
3. **启动项**：`game_config_inspect {}` 的 `launch`。
   - 两种启动方式都直接启动 left4dead2.exe，不经过 Steam。「L4N 平台启动」用 Matcha 启动项（`effective.modded`）；「纯净对抗」故意只用官方默认参数（`effective.clean`），不带任何自定义参数，这是设计，不算问题。`settings.extraArgs` 是玩家自己加的。
   - 只报真正的错误：重复的 `-w/-h`、`-windowed` 和 `-fullscreen` 同时出现、`-dxlevel` 与 DXVK 一起用、`-threads` 写错、拼错的参数、和当前启动方式不搭的参数。
   - 玩家自己加的性能和内存参数默认是有意加的，不建议删，也不要说「过时」：
     - `-heapsize <KB>` 调引擎 datacache 的上限，吃满了会音频卡顿或无声、帧数爆降、闪退，大型三方图（如黎明、切尔诺贝利）很容易吃满。原版引擎卡在 512 MB，而且数值到 2097152 及以上会 int 溢出成极小值；L4N 解除了这个上限并把数值完整传给引擎（L4N 说明：用 L4N 时锁到 2048 MB）。所以「L4N 平台启动」时它有用，`2096999` 这种刚好卡在 2097152 下面的值是特意选的。只有数值 ≥ 2097152 时提醒一句。
     - `-processheap` 常和 `-heapsize` 一起加，求稳定用，保留。
     - `+precache_all_survivors 1`、`-language English` 这类说不准作用的，放「正常」或「建议留意」里问玩家，不放「需要处理」。
   - `steamLaunchOptions` 是 Steam 库里填的启动选项。从 Matcha 启动（两种方式都是）时它不生效，玩家从 Steam 里启动才会叠加；里面残留 `-insecure` 之类的要提醒。读不到时看 `steamLaunchOptionsReason`，标「未检查」。
   - `importable` 不为空，说明玩家已有的启动选项或 autoexec.cfg 设置还没进 Matcha：设置页看不到，「L4N 平台启动」时这些启动选项也不生效。属于「需要处理」。导入是原样复制，玩家的参数一个不删。
4. **CFG**：同一结果的 `cfg`。
   - `autoexec.managed` 是 Matcha 管理段，`managedDraft` 是 Matcha 里保存的草稿。草稿有内容但 `managedDraft.enabled` 为 false，说明玩家的配置没写进游戏，属于「需要处理」。
   - 找拼错的命令、超范围的值（颜色 0–1、准星 0–255、`fps_max` 与启动项 `+fps_max` 重复等）、管理段外又把同一个变量改回去的地方（游戏按顺序执行，后写的生效）。
   - 需要时用 `game_config_inspect {"file":"文件名"}` 读 `config.cfg`、`valve.rc`、`video.txt` 等。`config.cfg` 由游戏退出时重写，只提醒，不建议改。`unreadable` 表示编码有问题，要指出来。
5. **VPK Mod**：`mod_inventory {}` 看已启用 Mod 的资源冲突，只报真正重叠的。

## 报告

- 第一句给总体结论。
- 再按「需要处理 / 建议留意 / 正常」三组列，每条一行：是什么、依据（工具返回里的字段、文件和行）、建议怎么改。正常的项合并成一两行，不逐个夸。
- 看不到的部分标「未检查」并说原因，不猜。
- 最后列「可以帮你改的」，问玩家要不要改：
  - **有 `importable` 时放第一项，而且只写导入本身**：`game_settings_import` 把 Steam 启动选项原样导入 Matcha 启动项、把 autoexec.cfg 的设置接管进 Matcha 管理段（先备份原文件），导入后「L4N 平台启动」就带上这些参数，设置页也能看到和改。这一项里不要夹带删改参数的建议；真有该删的参数，另列一项，等导入之后再用 `game_settings_update` 改。
  - 启动项和 Matcha 管理段：`game_settings_update`（launch 只写要改的字段；CFG 用 `cvars`，`null` 删除；配置没写进游戏用 `cfgEnabled: true`）。
  - 下载、茶茶默认值、界面偏好：先 `launcher_settings_inspect` 看键名和可选值，再 `launcher_settings_update`。
  - Mod 启停：`mod_set_enabled`；DLL 模组的启停和更新在 DLL 页由玩家操作。
- 玩家按编号回复时，一个编号对应你列的那一整项。回复含糊、或者像只针对其中一部分（例如「1 别改，1 是有用的」），先用一句话问清楚再动手，不要默认整项跳过。玩家说某些参数有用，意思是保留它们，导入照常做。
- 玩家同意后再调用。弹不弹确认看玩家在「工具与权限」里选的确认方式：自主模式下导入、改启动项这类有备份的直接执行，不要跟玩家说「每步都会弹确认」。Steam 库里的启动选项不代改（导入只是复制到 Matcha）；还没接管的 CFG 行要先导入，或给出要改成的那一行让玩家自己改。
