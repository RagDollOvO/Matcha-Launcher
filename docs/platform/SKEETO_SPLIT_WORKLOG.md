# 全量拆分执行记录

当前目标：直接完成全部拆分、完整接入，再检查并交付。目标保持 45 项独立功能 DLL、1 项 AAC 剔除、3 项平台承接；验收逐项对照原始分类和上游实现，部分实现继续补齐。

已交付基线：桌面 `Flare-0.1.0-20261117T034941Z`，游戏中 10 项 Skeeto 功能与 Source 0.3.0；5 项源码完整、5 项部分。基线 DLL、开关、配置与旧源码保留。后续在工作区完成候选版本，统一接入时重新检查游戏空闲。

## 当前实施顺序

1. 提取公共实体、原生绘制、视线检测、灯光与效果接口；依赖它们移植 HUD、世界提示、夜视、实体外观与输入模块。
2. 补齐已有准星、CFG、画面干扰、本地参数和调试的剩余行为。
3. 提取界面、媒体、缓存、稳定性与加载模块；保留各模块真实来源、资源、恢复流程和独立配置。
4. 对全部 45 项清点源码与资源覆盖、依赖、启停、说明和安装结果，再做针对性检验。游戏启动与退出仍由用户操作；离线检验与游戏实测分别记录。

待定联机范围的功能先实现并保留本地门禁，范围判定独立于源码实现。作者的功能说明随各 DLL 分发；Matcha 的大合集 / 小合集 / 功能结构沿用现有实现。

## 当前工作区

2026-11-17 UTC：开始实体与效果 SDK。读取上游 RecvTable/RecvProp 布局、实体句柄、TraceRay、客户端时钟和 Spotlight 实现；采用真实句柄加地图代次识别实体。游戏目录暂沿用已交付基线。

2026-11-17 UTC：工作区完成 Source 0.4.0 实体、TraceRay/keyed dlight、本地音频三个扩展，以及夜视和无声特感补声两个独立功能 DLL。新增 `feature_plugin.inc` 统一独立配置与状态生命周期；功能逻辑仍分别编译在各自 DLL。候选进度为 7 项 implemented、5 项 partial、33 项待实施，游戏安装仍为原 10 项功能。

### 已取得的针对性证据

- `effects_smoke.exe`：真实 Source 与夜视 DLL；验证 RecvTable/类型/嵌套字段、索引复用与地图代次、Paint 专用射线、原生灯光布局、亮度/色温/半径、天花板、死亡/观察/阵营、关闭/换服/退订恢复。最终候选通过。
- `silent_smoke.exe`：真实 Source 与补声 DLL；验证 MSVC IRecipientFilter 五槽和 EmitSound 全参数、单独 GUID/通道归属、出生与复用、女 Boomer、300/400 距离迟滞、4 秒冷却、幽灵状态、来源切换、关闭与换服清理。通过。
- `backend/tests/dll-collections.test.mjs`：候选发现 12 项 Skeeto 功能、5 个小合集，声明和旧入口行为通过。
- Source 和消费者精确依赖已统一为 0.4.0，相关消费者补丁版本已递增。新增两个目标已加入桌面打包脚本。尚未更新桌面发行包或游戏安装；两项新表单的实际界面查看留在全量候选整合阶段。

### 枪声与原生绘制候选

2026-11-17 UTC：完成 `skeeto.gunshot-feel` 0.1.0；新增 Source Resource API 1，听声辨位与枪声听感使用 `skeeto.audio-processing` 互斥。四种音高、短尾、路径匹配、弹匣检测与换弹抑制来自原作；关闭时清理自己的声音与资源。原作 UI 自动关闭另一项的行为改为先持有者继续工作，另一项保留设置并显示占用原因。后续房间混响通过 `skeeto.gun-reverb` 声明状态，枪声层已保留 0.75 增益联动；实现混响时还需完成与 DSP 的协调，同时允许它与枪声听感共存。

完成 Source Draw / View API 1。Surface 上下文按原作 Start/Finish、root/push/pop/flush 解析；文字、线、矩形、材质与世界投影走原生调用。上游 Paint 位明确为 UI=1 / GAME=2，组合帧带两位；已纠正初稿的位命名与菜单阶段条件。View 提供当前位、菜单可见性和引擎视角，HUD 自行选择 GAME 阶段。

`skeeto.crosshair-tps` 0.1.0 新增四种形状、原作十色、大小/透明度、8192 单位视线射线、投影与原版准星租约。独立设置和场景隐藏均已接入。当前 partial：静态准星 / 自身 HUD 的总隐藏、伸手与换弹动画需要发布资源状态；TPS 弹道修正需提供 100 毫秒有效的实际输入方向。详细交接键在该 DLL 的 SOURCE.md。

最新工作区进度：8 项 implemented、6 项 partial、31 项待实施；实际包中 14 项 Skeeto 功能。游戏和桌面仍保持原已交付基线。两个新目标均已加入桌面构建列表。

- `gunfeel_smoke.exe` 通过真实 Source / 枪声 / DSP DLL 的音高、强度、90/120 毫秒时序、换弹、设置、互斥双向交接与环境恢复。
- `drawing_smoke.exe` 通过原生上下文借用/归还、根节点重新获取、UTF-8、字体、零纹理 ID、缺失材质、投影与阶段门禁；unsupported 变体确认签名不支持时尚未调用绘制入口。已查看 `checks/.artifacts/drawing-20261116T213032/surface.bmp`。位修正后的重复相关检查位于 `drawing-panel-bits-20261116T213542`。
- `tps_crosshair_smoke.exe` 通过真实 Source / TPS DLL 的 View/Trace ABI、MASK_SHOT、本地排除、四形状十色、组合帧、菜单/加载/结算、配置容量、跨模块隐藏、原值恢复。已查看 `checks/.artifacts/tps-crosshair-20261116T213533/four-styles.bmp`。
- `backend/tests/dll-collections.test.mjs` 已更新到 14 项功能、5 个小合集并通过。

### 原生挂件与异常恢复候选

2026-11-17 UTC：完成 `skeeto.hide-back-items` 0.1.0，四个独立分类保持上游物品 ID 与挂件位含义；默认分类全关。Source 增加 Addon API 1、精确 UpdateAddonModels 签名、RecvProp 0x1880/0x1884 校验和 MinHook 生命周期。游戏显示位仅在一次原生更新期间修改，恢复后库存原值继续保留。范围、其他线程、关停和第三方入口均有处理。

关键依赖已解决：LLVM-MinGW GNU x86 target 对间接调用的 `__try` 生成错误表；用同一 Clang 将极小的无头文件 C 边界单独编译为 MSVC x86 target，已获得实际可用的 `__finally`。最初链接整个 msvcrt-os 会争夺 UCRT 符号，已改为仅导入 `_except_handler3` 的单符号库，主体保持 UCRT。后续视角镜像等同类临时写场景可直接复用 `L4P_NativeFinally`；进入原生调用前结束所有 C++ 锁和有析构副作用的局部对象。

- `addons_smoke.exe normal` 通过真实 Source / 挂件 DLL：所有武器 ID、四类开关、幸存者/感染者/其他阵营、未知/手持/柴油挂件保留、原接收位恢复、控制容量、远程服/断开/重连、其他线程、第三方入口保留。
- 原生 `RaiseException` 和真实不可读页故障均到达外层游戏风格的 SEH handler，Source 的 finally 已先恢复临时 mask，服务在外层处理异常后继续工作。`unsupported` 变体通过内部指令不符拒绝路径。
- 已从分发包内 `source/CMakeLists.txt` 独立构建 Source，产物位于 `checks/.artifacts/source-standalone-20261116T214327`；实际导入表仅从 msvcrt 引入异常分派，其余保持 UCRT。
- 合集发现已更新到 15 项功能、5 个小合集并通过。新目标加入桌面打包脚本；当前 9 项 implemented、6 项 partial、30 项待实施，实际游戏安装仍为已交付的 10 项基线。

### 感染者模型缩放候选

2026-11-17 UTC：完成 `skeeto.model-scale` 0.1.0，保留 WModelScale 的三个原始设置与 0.10–5.00 倍范围。玩家特感用字段 / RecvProxy；AI 特感、Witch 和普通感染者用 BuildTransformations 后骨骼矩阵，保持实体原点和原生骨骼掩码。幸存者 / ViewModel 保留原样。1–64 每帧分类，65–2047 每帧最多扫描 256 个。联机范围仍待定，当前本地服。

Source 0.4.0 新增 Model API 1；实体字段解析同时保留 RecvProp 位置供共享服务使用。按对象 / 句柄序列 / 地图代次持有字段，跟踪最近原生值，关闭和范围退出恢复仍由自己持有的值。Build 和 RecvProxy 各槽都有固定上游的常驻 thunk；第三方入口接管后保留其入口。原生 Build 调用前释放所有 C++ 锁，热路径按对象查找。

- `models_smoke.exe` 通过真实 Source / 模型缩放 DLL 的原生 x86 参数、字段更新、三个骨骼的基矩阵/原点/掩码、特感/普通/Witch 分类、幸存者/ViewModel 排除、高索引分帧、服务器基线、所有权、本地/远端/其他线程、索引换代、换图、关闭/退订、参数边界与小缓冲区。
- 原生头骨骼数 129 时保留原矩阵；第三方 Build / RecvProxy 修改保持原样，旧 thunk 继续转发自己的上游。首次证据目录 `checks/.artifacts/models-20261116T215325`。发现 1 倍类别和排除实体会反复触发全表释放检查后，已把单实体释放改为索引直达，未持有的对象立即返回；Hook 使用集合按实际持有对象一次生成。最终相同关键路径检查通过于 `checks/.artifacts/models-final-20261116T215554`。
- 新 DLL 的源码、SDK 头、许可证、作者说明、配置定义与独立构建入口已随包；已加入桌面打包目标与 Matcha 合集。现有 `backend/tests/dll-collections.test.mjs` 已按 16 项更新并通过。当前 10 项 implemented、6 项 partial、29 项待实施，实际包中 16 项 Skeeto 功能。游戏 / 桌面仍保留交付基线，统一安装与实际 UI / 游戏显示验收继续留在全量阶段。

### 结算与氛围音乐候选

2026-11-17 UTC：完成 `skeeto.endgame-music` 0.1.0，安全屋与最后生还者两套媒体工作线程完整抽取为独立 DLL。16 个设置与曲目列表、试听、停止、重扫、音量步进和提示预览动作接入通用功能页。素材继续使用用户已有 GAME 挂载；每帧枚举 16 项或复制 256 KiB，单曲上限 128 MiB，解码与 waveOut 只由所属工作线程操作。每章一次结算替换、清道夫原声、五种存活条件、PVS 外 PlayerResource、1 秒采样 / 稳定期、自动停止和提示保留。

Source 0.4.0 新增 File API 1 与 Entity API 2，原有扩展布局保持。File API 持有有界只读 GAME 句柄、菜单/加载门禁和队列关闭；Entity API 2 提供 1 / 2 / 4 字节数组及 PVS 外玩家信息。音乐不调用游戏的安装脚本，也不分发原歌曲。

- `files_smoke.exe` 通过于 `checks/.artifacts/files-20261116T215939`：主/次虚表 this、枚举句柄 0、UTF-8、边界、提前 EOF、归属与退订清理。
- `music_smoke.exe` 最终通过于 `checks/.artifacts/music-20261116T221257`：自有静音 PCM 素材、真实 MF 解码和 waveOut、原生声音替换、每章一次、菜单试听 / 清道夫门禁、随机与指定曲目、五种存活条件、PVS 外数组及实体回退、提示、参数 / 动作容量、解码失败和关闭清理。位图 `notice.bmp` 已查看。初稿发现菜单停止误留章节占用、Source 字体标志遗漏原作 0x80；已修正。失败音轨现在显示具体不可用状态，重扫后重试。
- `checks/.artifacts/music-standalone-20261116T221405` 已从包内源码独立构建通过；MF / waveOut 链接依赖随 CMake 声明。
- 桌面构建目标、开发手册、包声明和作者说明已更新。合集发现按 17 项 Skeeto / 5 个小合集通过。当前 11 项 implemented、6 项 partial、28 项功能待实施。实际游戏和桌面保留既有交付基线，统一安装在全量完成后进行。

### 描边样式候选

2026-11-17 UTC：完成 `skeeto.team-glow-style` 0.1.0。31 个设置覆盖八角色预设 / 九色 / 精确自定义色、五组状态 RGB、50–200% 基线相对亮度 / 柔化、常亮和激光红点；四个批量动作保留自定义色草稿。角色身份提取为共享 `survivor_identity.hpp`：显式 4–7 优先、模型名、默认 BOT 精确名字，最后按地图 / BOT 投票解释原始 0–3；先取 16 个队伍槽，再按正用户 ID 去重并保留最佳实体。普通颜色使用 ANY，常亮与激光独立 LOCAL 订阅。激光保留 200 毫秒、128 索引、8 个目标、原版模型 / 未拾取 / NODRAW 识别、存活本地生还者和结算隐藏。

Source 0.4.0 的 Glow API 1 管理槽 239、原生 SetGlowType / 颜色 RecvProxy、句柄与地图代次和逐字段恢复；拆除期清除旧引用。Cvar API 3 增加 `pin_relative`，相对获取前基线，变量对象更替时重取，原 API 1 / 2 保持；Entity 增加明确的两字节 SHORT，模型路径读取原生短索引。

- 既有 Glow SDK 检查位于 `glow-final-20261116T222012` 与 `glow-unsupported-20261116T221929`，本轮沿用有效证据。
- `team_glow_smoke` 通过于 `checks/.artifacts/team-glow-final-20261116T223237`：真实 Source / 功能 DLL、八角色 / BOT 投票 / 去重 / 16 槽、15 通道颜色、相对基线 / 变量更替、LOCAL/ANY 切换 / 写实、两字节字段与相邻输出、激光拾取 / 外部归属 / 高索引 / 容量 / HUD资源 / 结算、参数和停用恢复。夹具曾把同一用户的低优先级倒地实体当成独立队友期待，已修正该输入。合集校验发现新配置 ID 使用大写，已按既有 portable lowercase 约定改为小写连字符；最后一版真实 DLL 与 18 项合集校验均通过。
- SDK 头、源码、许可证、独立 CMake、配置定义与作者说明随包；桌面目标和生成脚本已加入。当前 12 项 implemented、6 项 partial、27 项待实施，候选为 18 项 Skeeto / 5 个小合集。实际游戏与桌面继续保留既有交付基线；统一安装与实际界面验收留在全量完成后。

### 霰弹枪自动换弹候选

2026-11-17 UTC：完成 `skeeto.auto-reload` 0.1.0。总开关与单喷 / 连喷两个独立设置，按原作保留 200–300 毫秒随机间隔和至少 24 毫秒键边沿；单喷等待攻击 / 推击绑定键、武器开火冷却和玩家推击冷却。读取本地脚本容量；缺失时按单喷 8 / 连喷 10 发后备。持有玩家手动按下的换弹键时等待。联机范围待定，当前本地服。

Source 0.4.0 新增 Input API 1 与 Weapon API 1。Input 沿用 Engine013 槽 22、扫描码 / 扩展键 / 五鼠标键映射；按订阅持有捕获键位，LOCAL + 前台游戏 + 菜单关闭才发送。重绑后释放原键位；退订 / shutdown 即时释放，失败保留重试。Weapon 依据精确 getter / parser / clip_size / cdecl 前缀，读取实体 +0x9da 和元数据 +0x160。小型 MSVC-target C 边界新增 `L4P_NativeTry`，元数据原生故障停用查找并走已有后备规则。

- `input_smoke` 通过于 `checks/.artifacts/input-20261116T223609`。私有 Source DLL 的 SendInput / 焦点 / 按键状态导入被宿主替换，覆盖键位、归属、失焦 / 菜单 / 范围、重绑、失败重试和即时关闭。所有输入仅写入内存。
- `reload_smoke normal` 通过于 `checks/.artifacts/reload-20261116T224032`；四种武器 / 两开关、真实脚本容量 / 原版后备、时间节奏、射推门禁、焦点 / 菜单 / 远端 / 加载、动作容量和关闭恢复通过。`reload-unsupported-20261116T224046` 与 `reload-fault-memory-20261116T224047` 验证不支持签名、实际 PAGE_NOACCESS 和停用查找；正常路径另覆盖 RaiseException。
- SDK / 作者说明 / 源码包 / 桌面目标均已更新。当前 13 项 implemented、6 项 partial、26 项待实施，工作区候选为 19 项；19 项 / 5 个小合集的现有发现与声明检查通过。实际游戏与桌面继续保留原 10 项基线，统一安装留在全量完成后。

### 半自动连发候选

2026-11-17 UTC：完成 `skeeto.auto-semiauto` 0.1.0 与 Source Input API 2。独立默认关闭开关、六档 50/90/130/160/200/250 毫秒基数和原跨度、16 毫秒释放窗口、60 毫秒分类与完整句柄变更即时复查。白名单覆盖单/双持手枪、Magnum、四霰弹、四狙击和榴弹，保留猎枪模型修正与未知家族后备；已知医疗/搬运类优先排除。AAC 持续剔除。

Input 2 保留 V1 前缀与绑定按键语义；物理左键监听由 Source 按 LOCAL 订阅共享。消息线程只更新原子状态，Paint 零等待回收，合成事件忽略且始终传递 hook。每次合成 DOWN 重新检查物理持有、前台、菜单和本地服，修复原普通分支松开窗口内补按问题；整个周期持有左键归属，真实长按交回玩家，松手释放自有输入，失败保留归属重试。

- `semiauto_smoke` 最终通过于 `checks/.artifacts/semiauto-final-20261116T225210`。私有 Source 导入替换为自有 hook / SendInput / 消息分发，运行实际消息线程；桌面无鼠标监听和合成输入。覆盖 Input 1/2 ABI、共享监听、多消费者冲突、线程创建失败/重试、injected/负 code 过滤与传递、物理释放/失焦/菜单/远端/加载窗口、六档节奏与硬下限、武器类型/模型/句柄、配置容量和即时关闭。
- 改动共享归属后，现有 `input_smoke` 与 `reload_smoke normal` 针对性复核通过，目录分别为 `input-v2-20261116T225131`、`reload-input-v2-20261116T225132`。
- 桌面目标、独立源码包、开发手册与作者说明已更新。现有合集检查通过：20 项 Skeeto / 5 个小合集。当前 14 项 implemented、6 项 partial、25 项功能待实施；游戏与桌面继续保留已交付基线，全量完成后统一安装。

### 屏幕与音效候选

2026-11-17 UTC：完成 `skeeto.script-cues` 0.1.0。十项子开关、总开关和独立弹壳音量：低血红屏、吃药绿屏、空仓 / 低弹声、弹壳 / 弹匣落地、倒地倾斜、爬梯、焦痕、房间混响。源菜单补充核对发现的 Jockey 起跳提示归 `timing-trainers`，保留情报范围；49 项分类数量保持。完整原生命状态、50 毫秒采样、39/41/72 阈值、临时血衰减、复活 / 闲置 / 回合处理已接入。射击每 8 毫秒，长间隔 250 毫秒重置，完整武器句柄与装填基线保护；15 类弹匣声音表与 12 项队列、弹壳延迟全部保留。

Source Entity API 3 提供明确 moveType 字段 / renderMode+1 后备；File API 2 管理所属插件 assets 的 GAME 尾部挂载，四参数 AddSearchPath 槽 7 / RemoveSearchPath 槽 8，加载期暂停、失败保留重试、关闭清理。原 API 前缀和旧宿主目录条件保持。早期移植使用过 100 段上游预设录音；当前源码及构建已移除这些录音与提取脚本。实际游戏未写入。

房间混响保留九方向 2000 单位射线、256 单位位置单元、2 秒缓存、去两头各两个后的五项均值和四档 .85 音量；`skeeto.gun-reverb` 与 DSP 双向先占用者优先，GunFeel 共存并乘 .75。DSP 候选更新 0.2.2，preset 增加 blockedBy；已有其他 preset 使用保持。

- `cues_smoke` 最终通过 `checks/.artifacts/cues-final-20261116T230726`：真实四个 DLL、包内文件与挂载、生命状态 / RGBA / 衰减 / 菜单帧、枪弹容量 / 双持 / 装填、全部 15 种换弹声、队列上限、爬梯、四房间档 / 缓存、DSP/GunFeel 双向交接、素材缺失、参数 / 关闭 / 加载 / 断开和移除重试。初稿夹具在声音 30 毫秒节流内要求第二声、且在设置爬梯速度前开启选项，造成两项时序误期望；按原行为修正夹具时序后通过，功能代码保持原节奏。
- 红 / 绿实际 SDK 绘制位图已查看，输出 `checks/.artifacts/cues-20261116T230613/red.bmp`、`green.bmp`；原生 RGBA 96/35、500/1000 毫秒淡出有数值断言。位图为自有离线背景上的淡出，游戏场景由用户后续实测。
- 原 `files_smoke` 与 `gunfeel_smoke` 针对性复核通过：`files-v2-20261116T230622`、`gunfeel-reverb-20261116T230726`。
- 随包源码 / 素材、桌面目标、开发手册和作者说明已完成，现有合集检查通过 21 项 Skeeto / 5 个小合集。当前 15 项 implemented、6 项 partial、24 项功能待实施；桌面和游戏沿用既有交付基线。

### 闲置恢复与便利候选

2026-11-17 UTC：完成 `skeeto.idle-restore` 0.1.0，归「个人档案」。五项子开关、八个角色名称和总开关共 14 个字段。保留最后玩家采样、四类闲置状态机：手电 150 毫秒延迟 / 一次切换 / 4 秒确认；朝向 100 毫秒延迟 / 650 毫秒纠偏窗口 / 最多两次 / 鼠标渐变交还；五槽武器最多两次、倒地只切副武器；人称 100 毫秒采样和 2 秒等待。观察到恢复操纵的手电 / 武器后备路径保持。回合、换图、加载与关闭清除旧快照；未知搬运类武器清除缓存，避免误用上一武器槽。

Source 增加 Player API 1 与 Localize API 1。Player 每次操作核对本人、存活生还者、观察和菜单；槽位 / 手电使用有限枚举调用 Engine013 槽 107，原命令标志保持。角度槽 20；人称保留上游 PE 时间戳 / SizeOfImage / 三处前缀、getter(-1) 与无参 setter，原生故障由已建立的 SEH 边界捕获后停用该入口。亮度租约沿用受限 Cvar 本地服规则，远端保留普通恢复与静音。

Localize 保留 VGUI_Localize005::Find 槽 2 的原表及原查找；八角色使用原 token，名字去两类首尾空格、最多 23 UTF-16 单位、控制字符和无效代理对拒绝。不可变文字指针保留到进程结束；token 按订阅先占有者优先，外部 hook 仍持有入口时保持透明前驱。read 返回有效文字的 UTF-8 副本，供后续 HUD 共同使用。原 API 头 / ABI 保持。

- `idle_smoke` 通过 `checks/.artifacts/idle-final-20261116T233215`：真实 Source / 功能 DLL、精确原生 CInput 调用、四种恢复、次数和时间 / 鼠标退出、网络延迟 / 观察后备、五类武器 / 倒地、手电声音和亮度归还、14 字段 / 小缓冲区、八角色中文 / emoji、名称指针与归属、第三方 hook、菜单 / 远端 / 加载和关闭。最终本地化 read 将调用容量限定为已计算字节数；最终候选通过 `idle-complete-20261116T233820`，已有中文位图证据继续适用。新增实际持有亮度租约和名称时的 DLL shutdown 覆盖后，`idle-delivery-20261116T234015` 通过：立即透传声音 / 文字，下一 Paint 恢复参数和自有入口。
- `idle-unsupported-20261116T233250` 验证错误原生前缀保留输出并显示待适配；`idle-fault-memory-20261116T233250` 验证真实 PAGE_NOACCESS 故障和当前进程停用。正常夹具另覆盖 RaiseException。所有 native 地址 / 字节修改仅发生在私有 fixture client.dll；桌面和游戏无输入。
- 实际 Localize → Surface 中文位图 `idle-final-20261116T233215/bot-names.bmp` 已查看，八个角色标签与中文完整清晰。该图为自有离线面板。
- 原 `source_smoke` 针对性复核通过 `source-idle-20261116T233650`。新增 manifest 首次将 apply 写成 live，既有声明检查指出有效值为 immediate / next-launch，已修正为 immediate；22 项 Skeeto / 5 个小合集发现通过。编译初稿的 const 函数指针转换和离线 DLL 导入库同名已修复。
- 桌面构建目标、独立源码包、SDK 手册、作者说明和原个人合集说明已更新。当前 16 项 implemented、6 项 partial、23 项功能待实施；22 项工作区候选，实际游戏 / 桌面保留已交付基线，全量完成后统一安装。

### 已读取的后续依赖

- 后续 HUD 的 BOT 显示名通过 Localize API 1.read 取得当前有效 token 文字，八角色映射见 `skeeto.idle-restore/plugin.cpp`；只用于 bot 分支，人类名字继续读网络玩家信息。上游对应 `skeeto_hud.cpp` 1293 / 7696。
- `team-glow-style` 已完成；后续 HUD 可复用 `survivor_identity.hpp` 的身份与去重规则，并通过 `skeeto.hud.hide-world` / `skeeto.hud.pause-sampling` 提供跨模块隐藏状态。
- 命中反馈有 16 项菜单动作，涉及粒子平台、两类 JSON 素材、连杀、命中与友伤；主逻辑依赖原生粒子调用和素材恢复。需要与粒子服务完整接入，保留血肉音效、Boss 触发和素材上限。
- `campaign-progress` 依赖导航路程求解：`skeeto_navigation.cpp` 397–435 的 Progress API，519 附近调度；proxy 53008 绘制。适合与 `minimap-nav` 一起建立共享导航服务后接入，避免改成简化距离百分比。
- `fast-load` 实际为约 70 KB 的 `skeeto_fast_load.h`，依赖 staticprop_groups、vpk_experiments、texture_warmup，包含加载期线程与多种原生租约。应按完整控制器接入，保留精确 ABI 校验与恢复；本轮只读，尚未修改此模块。

### 下一段可直接继续

- `config-override` 已在下一段补齐并通过真实 x86 检查，详见下方。后续继续剩余 4 项 partial 与 23 项新功能；优先按真实源码依赖组织，功能范围保持原菜单和分类。

- 原生绘制与视角 SDK 已可供 HUD、命中反馈和游戏 UI 消费。上游 Surface 在 proxy 18378–18590 和 18694/18740/19962/20110/20168；公共头为 l4p_draw.h / l4p_view.h。
- 本地音频与包内 GAME 素材挂载 SDK 已由 script-cues 实际消费。后续命中反馈 / HUD 可复用 File API 2 的 assets/ 包目录；当前枪声、房间混响和 DSP 的共享关系已有双向验证，保持这些命名资源约定。
- 当前音频 SDK 只在对局范围内发声；菜单氛围音乐接入时应为菜单用途明确增加适用环境。
- 静态准星补齐时注意：原作 `skeeto_host.h` 是十色表，现有已交付静态 DLL 采用另一个六色表。旧设置的 color 数字有实际颜色语义，升级时保留旧解释或显式迁移；TPS 已采用原作十色。现有静态插件无 Source 依赖，补齐时同时处理依赖与旧配置兼容。
- 实体复制继续使用 ReadProcessMemory(GetCurrentProcess())，保留 PAGE_GUARD；原生调用 finally 使用上述已验证的 MSVC-target C 边界。原错误最小复现在 `.tools/seh-call-probe.cpp`，可用桥接最小复现在 `.tools/seh-bridge-probe.c` / `.tools/seh-bridge-host.cpp`；正式实现及构建规则随 Source 分发。

全量完成后再统一安装、更新桌面并交付。实际游戏由用户启动/退出，安装前重新确认进程空闲；所有离线夹具只运行自有宿主。

### CFG 预设与可选恢复补齐

2026-11-17 UTC：`skeeto.config-override` 0.2.0 完成 CfgOv 全链路。16 套松散预设、大小写无关排序 / 选择 / 前后轮换、64 KiB / 64 行 / 每行 239 字节预览；保留旧任意合法相对 CFG 与原生完整 exec。三个配置字段和八个动作，旧两字段配置 / configure 继续可用。最多 96 项首次数值基线，同章叠加、新章节先恢复、关闭自动执行 / 退出时归还，主动关闭恢复则保留当前值。别名 / 嵌套 exec / 同行后续命令沿用原解释器和原作追踪范围。

Source 0.4.0 增加 Cvar API 4：checkpoint / restore_checkpoints / forget_checkpoints。恢复点只记基线，与普通租约共享名称独占；精确原生身份防止还原到新变量。受限基线 LOCAL，原变量标志保留；恢复失败保留基线重试，消费者等待完成后再提交章节 CFG。原 API 1–3 保持。

- `cfg_smoke` 最终通过 `checks/.artifacts/cfg-delivery-20261117T000812`，覆盖 API 协商、捕获不写值、同名冲突、原生身份更换、控制线程队列、范围 / 失败重试、所有预设动作、中文 BOM / CRLF 原文预览、16 / 64 / 96 上限、路径重解析与执行前复查、完整 exec、旧配置、开关 / 退订恢复。自有引擎 command sink 和 Cvar setter 记录实际 DLL 调用；游戏目录保持原状。
- 旧 `source_smoke` 已通过 `checks/.artifacts/cfg-legacy-20261116T235602`，原文件选择 / 自动 / 手动合同保持。最后检查沿用同一候选，补齐工作记录和作者说明。
- SOURCE、manifest、SDK 手册与逐项进度已更新：17 项 implemented、5 项 partial、23 项功能待实施；候选 DLL 仍为 22 项。统一安装与桌面更新留在全量完成后。

### 减少画面干扰补齐

2026-11-17 UTC：`skeeto.combat-declutter` 0.2.0 补齐原作完整 NoCorpse 路径。zombie_death.victim 精确确认，Paint 消费；玩家槽位 1–64 与玩家类保持。64 项 FIFO、2.5 秒追踪、四次 50 毫秒布偶清理、三个短期 90 毫秒尾部探测，沿用 hi-48..hi 的实际 49 个索引范围；新发现布偶补充短期探测，闲时无扫描。原五字段 / 五项 Cvar / 两个动作保持，同类普通布偶可随剩余开关继续追踪，感染者布偶按类别处理。

Source 0.4.0 增加 Corpse API 1，公共头 l4p_corpse.h、实现 corpses.inc。LOCAL + Paint 门禁，RecvTable 三字段 / NODRAW32 / RenderNone10，原点保持。完整句柄、对象 / 网络类与 epoch 防止实体复用写错；逐位 / 字段归属恢复，跟踪原生更新。暂时不可读身份保留恢复租约，readonly / guard 页保持，恢复失败下一 Paint 重试。事件 / 帧处理前刷新实体代次，Source shutdown 用仍持有的原引用归还。原生 cl_destroy_ragdolls 清理的现存客户端布偶由后续游戏事件重新生成。

- `corpses_smoke` 通过 `checks/.artifacts/corpses-delivery-20261117T002451`：真实功能 / Source DLL、字段 / 原生变动 / 其他位、身份 / 类型、玩家保护、只读失败和 guard 页保留恢复、LOCAL、死亡事件、有限脉冲 / 扫描、类别资源占用 / 交还、64 项 FIFO、旧设置、容量、回合 / 加载 / 退订 / 服务关闭。全部写入与命令发生于私有夹具。
- 最终前一次运行在 config.json.pending 替换时返回保存失败，旧 config 保持；随后带动作 / 参数 / 返回码 / Win32 错误诊断的运行完成所有配置路径。新增服务关闭断言最初复用了已退订回调，已改为真实新订阅，最终通过。业务保存继续沿用现有原子写入助手，失败返回给调用端。
- 补充同地址 / 同句柄的新地图代次断言后，`corpses-epoch-20261117T002741` 通过；新地图值保持，旧恢复点丢弃，功能与 Source 候选未变化。
- 原 `presets_smoke` 通过 `checks/.artifacts/presets-corpses-20261117T002452`，六个旧参数消费者的参数表、独立关闭、恢复与小缓冲区合同保持。
- `skeeto.corpse.common` / `skeeto.corpse.special` 已由本模块实际占用；后续 corpse-dissolve 消费相同分类资源，保留原互斥。共享清理命令作用于现存客户端布偶，粒子模块接入时继续核对跨类别效果。
- 生成器增加 customImplementation 保留手写插件 / SOURCE / 独立 CMake，能力声明按本功能完整记录；其余 preset 路径保持。包内源码 / SDK / 配置助手、手册与进度已同步：18 项 implemented、4 项 partial、23 项待实施，22 项候选。游戏与桌面安装维持既有基线。

### 持枪视角与镜像：原生 SDK 正在接入

2026-11-17 UTC：已完整读取 viewmodel 的纯数学 / v2 profile 格式（proxy 65–345）、20 项菜单动作（26513–26723）、Calc / 绑定 / 镜像 / 骨骼缩放 / GamePump（56851–57373）及 IO。此项仍为 queued，当前实现和离线证据尚待完成，18 / 4 / 23 计数保持。

已写入 `l4p_viewmodel.h` API 1、`viewmodels.inc` 与 `viewmodel_mirror.inc`，Source 可编译。纯数学与 v2 parser / formatter 原样提取到 `plugins/shared/viewmodel_profile.hpp`。SDK 两槽快照提供复制模型路径 / MDL checksum / 完整实体引用和绑定代次，set 原子提交两槽姿态；Calc222 原上游先执行，原生 SetOrigin / SetAngles 精确签名与 RTTI 校验。Build175 完成矩阵后按参与骨骼质心缩放，并按 GetView(-1) 摄像机平面反射；镜像脚本 0x859 culling 字段与原生 build 临时原值配合，native finally 归还。两个槽共享脚本且镜像状态相反时暂停镜像，缩放保持。缩放字段捕获原生基线，按关闭 / 范围 / 身份处理。

当前编译仅证明代码可构建；SDK 仍需自有原生夹具消费与故障 / 归属检查。Source 原功能未部署到游戏。下一步保持本线：完成独立 `skeeto.viewmodel` 消费者，再补实际 x86 原生姿态、骨骼 / 剔除、两槽冲突、关闭恢复、接口不符和故障路径证据；视觉效果用自有模型/离线位图观察，游戏实测另行。

已确认的消费者设计与约束：
- 原配置为 active=false、global mirror=false、per-model=false、move step .1（.001–5）、angle step 1（.01–15）、编辑槽 0 / 1。姿态 position / pivot 每轴 ±100、rotation ±180、scale .1–5；精调为步长十分之一，scale 普通 .05 / 精调 .005；位置 / 旋转 / 全部重置和步长轮换均需保留。
- profiles 使用原 `left4dead2/skeeto/viewmodel/profiles.ini` v2，按规范化模型路径 + MDL checksum，256 项 / 256 KiB；Necola `_nclN` 归并，后出现的记录覆盖，旧 profile 缺 scale 默认为 1。原 profile 无效时保留原文件并阻止保存，显式 reload 恢复。profile 内容与 SDK 状态通过纯文本报表显示。
- 模块普通设置写本 DLL config.json；用户模型 profile 在原游戏用户数据位置独立保留，平台更新不会替换该位置。初始化只读，确认编辑后原子写入；控制线程 IO，Paint 只取已发布副本。旧源码与未选择的 profile 保留。
- Matcha 标准动作覆盖原 20 项功能，直接设置轴 / 步长、精调、重置、编辑槽、全局 / 逐模型镜像与重读；避免在后台监听编辑按键。镜像模式与单模型 mirror 内容分别明确控制，单次动作持久化一个文件，防止双文件部分提交。
- 原生 Build 常在 Source Paint 回调外发生：镜像武器句柄读取使用原生完整 serial 校验，避免调用要求 callbackThread 的实体公共读接口。当前实现已修正这一点。原生数据读取继续保留 guard 页，所有实际写入仅同进程。

### 持枪视角与镜像：独立消费者完成

2026-11-17 UTC：`skeeto.viewmodel` 0.1.0 完成六项普通设置和十项标准动作，覆盖原 20 个菜单条目。包括两个模型槽、九个姿态轴、比例、原步长 / 精调、三种重置、全局 / 逐模型镜像、原配置重读。原 v2 路径和 256 项容量保持；初始化只读，控制线程独立序列暂存 / 原子替换，Paint 使用不可变已发布副本。外部文件变化阻止覆盖并要求显式重读；错误原稿和未选择模型保留。

- 真实 `viewmodel_smoke` 通过 `checks/.artifacts/viewmodel-unique-stage-20261117T010508`：原生 Calc222 / Build175 / setters / GetView(-1)、位置 / 旋转原点、骨骼质心缩放 / 反射 / mask、共享脚本冲突、字段最新基线 / 暂时只读恢复、MDL checksum / 地图变化、第三方入口 / 常驻透明前驱、外部线程、配置动作与磁盘失败、256 项往返和独立关闭。全部调用和写入发生在自有宿主目录。
- `viewmodel-unsupported-20261117T005611`、`viewmodel-fault-mirror-20261117T005611` 验证签名失配和元数据实际 PAGE_NOACCESS；`viewmodel-final-fault-setter-20261117T010145`、`viewmodel-final-fault-camera-20261117T010145` 验证原生 setter / 相机故障。后者确认当前渲染调用内即归还镜像剔除标记。`viewmodel-bonefault-20261117T010541` 验证超界骨骼头同帧恢复。正常路径中的原生 Build 故障经独立外层 SEH catcher 捕获，内部 finally 先归还镜像值。
- 同模型头重新载入不同 checksum 时，初稿只验证指针，已补 checksum 绑定校验。Paint 在所有模型服务前更新实体代次；新地图同地址保留新值。相应 fixture 的重连明确生成新地图原生比例，匹配实际对象换代。原 `models_smoke` 复核通过 `models-viewmodel-20261117T010610`。
- 初稿步长轮换用 float 保存 0.01，下一次 configure 校验为略小于下限；已使用 double 常量保留声明数值。快速连续保存出现 Windows 5，旧文件保留；暂存名原先仅使用毫秒时钟，已加入控制线程独立递增序号，并报告具体文件阶段和 Win32 错误。新候选通过完整消费者检查；拒绝写入和失败结果继续原样返回。
- `viewmodel-epoch-20261117T010121/viewmodel-bones.bmp` 已查看：原生矩阵输出中的骨骼 0 / 2 反射并加倍，mask 排除的骨骼 1 保持原值；该画面为自有骨骼标尺。后续消费者保存命名调整与矩阵候选无关，图像证据继续适用。
- 合集发现 / 声明检查通过，23 项 Skeeto / 5 个小合集，新增功能位于 visuals。SOURCE、manifest、SDK 开发手册、打包目标和随包源码已更新。现有 19 项 implemented、4 项 partial、22 项待实施（含 Necola 范围待定），实际游戏安装仍为原 10 项。

下一步继续尸体消散的 C_EntityDissolve 原生服务与独立消费者；命中反馈的通用粒子接口按其真实依赖另行接入，其余 HUD、导航与系统模块保持全量目标。最终统一安装、桌面界面查看和游戏兼容仍按原完整验收执行。


### 下一项已读的源码位置

尸体消散在 proxy 63225–649xx，以原生 C_EntityDissolve 对象实现。已读 63225–63549 的常量 / 状态 / 原生解析和 27040 的五项菜单；后续必须继续完整读取 DissApply、Restore / Hide、事件队列、目标选择和 Pump，再决定 SDK 与消费者分界。

- 五项设置：特感 / Tank、普感 / Witch、类型 0–3（默认 2）、时长 200–2000 ms（默认 550、步长 50）、兼容清理布偶（默认关）。两个类别开关默认关。
- 原生入口由 DissolveEffect 特征和多处精确指令共同验证，分解 alloc(0x680) / ctor / parent / origin / delete-manager / flags / setEffect；另解 SetModelPointer 和 ModelInfo004 / 006 的 FindOrLoadModel 槽 41。ctor 中解析 C_EntityDissolve 虚表与 think 子对象虚表；原始 RTTI 全模块逐字节扫描已停用，应保持冷路径有界。
- Active 上限 6、其中 CI 3，pending16；CI 最小创建间隔 175 ms，SI 排队生命 700 ms；player userid + spawn epoch 保护复活。已有 Corpse API 1 为 LOCAL 的普通隐藏服务，消散原范围为 ANY；应新增专用原生服务以保持两个现有合同。与减少画面干扰共用 `skeeto.corpse.common` / `.special` 资源；兼容清理会影响所有现存 ragdoll，需按原作核对跨类别生命周期。
- 上游参考文件保持只读。尚未创建消散 SDK 或消费者，分类仍 queued。

### 尸体消散：原生服务与独立消费者完成

2026-11-17 UTC：`skeeto.corpse-dissolve` 0.1.0 完成原五项设置与独立总开关，归入 visuals。原死亡事件路径、16 项队列、16 / 32 / 50 ms 延迟、700 / 900 / 1200 ms 寿命、每时钟 / 100 ms 窗口最多一个效果、普感 175 ms 间隔、6 / 3 活跃上限保持。普感仅选精确死亡身份、40 ms 射线 / 12 项命中缓存与 96 单位锚点或 128 单位有类型布偶；保留 192 索引与 SI / Witch 尾部 65 索引 / 16 候选预算。源码中未被调用的额外全局隐藏 / 脉冲函数沿用其未启用状态。

Source 0.4.0 新增 Dissolve API 1（l4p_dissolve.h / dissolve.inc）。真实游戏 client.dll 只读检查确认合并函数体签名唯一、原生 flags 字段 0xf0 / effect handle 0x5f8；接口实际调用和写入全部发生在自有 x86 夹具。保留原 C_EntityDissolve 构造、初始化、ModelInfo41、父对象 / onData、绝对原点、类型 / 全部淡入淡出字段 / 火花时刻；引擎自行 Think / Draw。玩家完整引用与生命代次保护快复活。关闭、范围退出与退订回收所属效果，逐位保留外部改动，已有原生效果优先，临时只读 / guard 等待恢复。

- `checks/.artifacts/dissolve-full-20261117T014106` 通过真实 Source / 消费者 DLL 的正常原生 ABI、全部设置、创建节奏、命中锚点 / 布偶后备、16 / 6 / 3 容量、玩家复活、完整句柄、原生外部效果、只读 / FX guard、类别恢复点保留、跨模块全局清理协调、回合和完整关闭。
- `dissolve-unsupported-20261117T014133` 与 `dissolve-2-20261117T014133` / `dissolve-7-20261117T014133` 核对接口不符、初始化实际异常和返回 false。完整构造后的初始化失败正确回收；构造异常记录一次孤立分配并停用该后端。
- 后续修正单次失败重复计数后，`dissolve-fault-1-20261117T014337` / `dissolve-fault-4-20261117T014337` / `dissolve-fault-5-20261117T014337` 分别通过构造、效果 setter 和原生回收异常；每个失败操作只记一次，回收失败保留原生对象并在恢复可调用后完成清理。正常路径未变，继续沿用上面的完整消费者证据。
- `corpses-dissolve-20261117T014133` 复核原 NoCorpse 完整路径。必要相邻修正：消散运行期间暂停 NoCorpse 全局 maxcount / destroy 脉冲，独立类别限额继续；all 选项同时申请两类资源。SDK 逐实体拒绝隐藏 / 消散重叠租约。配置、分类与旧单独使用保持。
- 新包包含完整源码、公共 SDK、配置助手、许可证、独立 CMake；仓库 / 桌面构建目标和作者说明同步。合集发现与声明检查通过（backend/tests/dll-collections.test.mjs），24 个功能 / 5 个小合集。候选数变为 24，20 项 implemented / 4 项 partial / 21 项功能待实施（含 Necola 范围待定）。游戏安装保持此前 10 项，未写游戏目录，实际消散画面待实测。

下一步继续命中反馈 / HUD 的完整源码与共享粒子依赖；剩余 partial、导航、加载与稳定性模块仍需完成。全量完成后统一安装、桌面查看与最终兼容验收。

### 推进方式调整：按批次完成，简化验证

用户要求验证简单一些。后续优先直接抽取和复用原实现，按共同依赖成批接入。每批只做编译、核心加载 / 独立启停和配置保留检查；已有有效证据继续复用，遇到实际报错再定位对应路径。当前没有正在运行的验证任务。命中反馈仍为 queued，已读原菜单、粒子 / 清单入口与素材目录接口；下一步直接抽取 skeeto_style 实现并接 SDK，继续全量拆分、统一安装和桌面接入。

### 命中反馈：直接抽取样式与粒子 SDK

2026-11-17 UTC：原 `skeeto_style.cpp/h` 的目录、JSON 解析、四通道、连杀 / 优先级、命名效果、声音池与逐项工坊恢复已抽取为 `native/plugins/shared/style_catalog.cpp/.hpp`。`style_files.hpp` 将原文件调用接到 File API 3；SDK 提供 GAME 挂载变化标识，原作搜索路径稳定采样继续复用。新增 `skeeto_style` 静态构建目标，供命中反馈及后续素材功能共用。

Source 增加 Particle API 1（`l4p_particle.h` / `particles.inc`）：原作精确签名、预载 / 查找 / 发送、32 次 / 秒限流和启动清单追加；独立工作线程只安装入口，PCF 追加保持在引擎原清单线程，退订后透传。当前原始入口可用，Necola 前置清单 hook 链仍随其待定模块完成。

按简化要求，仅运行必要编译和正常关键路径：`styles-20261117T021011` 通过原 files_smoke 加素材解析 / 选择保留；`particles-20261117T021517` 通过实际 x86 SDK 加载、清单 / 原生调用与关闭。首次文件命令的 fixture 目录参数已纠正；粒子夹具补齐原函数的 list 参数后通过。没有开展故障矩阵或全套回归。

下一步直接消费上述代码完成命中 / 击杀 / 连杀 / 特殊击杀 / 友伤 / Boss 与叠图状态，再接独立配置、合集说明。命中反馈仍为 queued，完成数保持 20，候选功能 DLL 24；全量拆分、统一安装与桌面更新继续，游戏目录未改。

### 命中反馈：独立 DLL 接入

2026-11-17 UTC：`skeeto.hit-feedback` 完成 20 项配置 / 4 个动作，进入 visuals；原 16 菜单动作对应的四素材通道、声音 / 图像、连杀、特感来源、特殊击杀、命中模式、Boss 门禁、友伤、血肉音效、粒子启动和素材恢复已接入。原样式解析直接复用；事件文字通过 Source API 2，原生血量队列 / 全屏叠图 / 工坊完成状态通过 Feedback API 1。粒子预载与既有 Particle API 1 共用。

只做正常关键路径：`feedback-20261117T023653` 通过真实 x86 Source / 功能 DLL 的目录、击杀与血量命中叠图、关闭清理和配置保留；原粒子与样式证据继续有效。合集检查发现动作缺少 description，补齐后通过（25 个功能 DLL / 5 个小合集）。源码、独立构建、许可证、打包目标、SDK 文档与逐项状态已同步。未启动游戏或写游戏目录。

当前 21 implemented / 4 partial / 20 queued-or-decision；全量仍为 45 个功能 DLL。下一批继续 HUD / 菜单与剩余 partial，并保留最终统一安装、桌面实际界面和用户启动游戏阶段。
