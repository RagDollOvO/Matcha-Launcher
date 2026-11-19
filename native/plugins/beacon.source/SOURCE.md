# Source 游戏接口服务 0.4.0

依据 Skeeto 2.2.19，提交 `7a18b4988d089fdf6cc7e857560cf82a9609a32c`，GPL-3.0。来源 `src/skeeto/core/skeeto_proxy.cpp`：`Hooked_EnginePaint`、`EnsureListeners`、`EvInt/EvFloat`、`EngInGame/EngConnected`、`ReadMpGamemode` 与 `EngClientCmdUnrestricted`。原版权归 regoists/Skeeto 贡献者。

Flare 新增独立 Beacon API 1 服务和 `L4P_GetSourceApi` 扩展。VEngineVGui001 槽 14 提供游戏线程帧；原 Paint 始终原样调用。事件使用原生 GAMEEVENTSMANAGER002 的 AddListener / RemoveListener，监听器手工提供 MSVC 三槽 ABI，兼容当前 x86 LLVM-MinGW 构建。

每项独立功能订阅自己的回调，退订等待当前回调结束。快照按值复制，功能动作通过自己的待执行状态交给回调。服务保持进程驻留；显式 shutdown 后现有 Hook 与监听器透传或空操作，避免引擎保存的回调悬空。后续重新 init 恢复派发。服务器模式未知时，受限事件保持停用；当前本地识别为实际通道 IsLoopback，Steam 本地大厅识别待补充。

`command` 提交普通 ClientCmd。`exec_cfg` 仅接受经过限定的相对 CFG 文件名，使用原作确认的 ClientCmd_Unrestricted 槽 107，避免普通 ClientCmd 丢弃 exec。游戏配置正文仍由原生解释器处理。全程同进程；外部进程注入、网络下载和自更新均无实现。

0.2.0 增加 `L4P_GetCvarApi`，保留原 Source API 1 布局。`cvars.inc` 依据原作 `CvarReadPair` 与 `DspLockWriteVal`，使用 L4D2 parent +0x1c / 数值 +0x2c 和 IConVar 子对象 +0x18、setter 槽 2。每个参数按订阅令牌独占，保留基线、关闭和离开环境后恢复。受限参数仅接受本地订阅，sv_rollangle/sv_rollspeed 允许原作的客户端视觉路径；setter 的范围保持，拒绝设置时返回失败。显式 shutdown 后剩余租约在下一 Paint 恢复。

0.3.0 增加 Cvar API 2 的 `pin_locked`，沿用 API 1 租约前缀。针对所持有的 IConVar 浮点 setter 即时钳制，按对象身份隔离共享虚表中的其他参数；关闭和离开范围时恢复。API 1 的协商与布局保持原样。后台线程写入使用最近的连接快照，游戏线程写入即时刷新环境。

0.4.0 增加 Cvar API 3 的 `pin_relative`，使用已捕获基线乘以 0–10 倍。变量对象更替时重取新基线，重复应用保持原倍数；原有 API 1 / 2 布局、门禁与恢复规则保持。`team_glow_smoke` 验证相对值、身份更替、普通 / 受限参数、范围交接和恢复。

Cvar API 4 增加数值恢复点：checkpoint 仅捕获首次基线和原生身份，与普通参数租约共享名称归属。restore_checkpoints 返回完成 / 待恢复；控制线程排队，失败保留基线并在 Paint 重试。forget_checkpoints 保留当前值，普通租约保持；范围退出 / 退订恢复。CFG 消费者负责行首参数提取和章节顺序，服务保留原生解释器。`cfg_smoke` 已通过 API 1 / 3 / 4 协商、同名冲突、身份更换、范围、失败重试和完整消费者检查。

`l4p_sound.h` 提供独立 Sound API 1：`set_filter`、`clear_filter`、`status`。`sound.inc` 移植原作 `InstallSoundStartVolumeHook` 的精确 x86 签名、EDI 声音参数（Sfx +0x0c、volume +0x28）和 `SfxObjectName` 调用约定。过滤器覆盖进入 S_StartSound 的声音，包含服务器发来的语音、感染者和循环音；按订阅令牌统一顺序处理一次。签名缺失、多匹配或入口所有权变化有独立状态。全部过滤器关闭后立即透传，下一 Paint 还原入口；进程寿命内保留跳板。

入口安装与恢复使用随包 MinHook 1.3.4，负责完整指令搬移和其他线程 IP 调整。汇编桥接保留寄存器、标志与浮点/SSE 状态。音频回调只使用独立声音锁，过滤器按 SDK 线程约定处理借用数据；退订等待当前回调退出。

0.4.0 的 `l4p_entity.h` 提供实体句柄序列与地图代次、RecvTable 字段读取、玩家信息、用户 ID 映射、模型名、客户端时钟与眼睛坐标。布局依据原作 `EntGet`、`GetRefEHandle`、`FindOffset`、`EngClientCurTime`、`TeamHudModelNameInner`。引用和字段值按值返回；字节、整数、浮点与向量分别声明。缺失、类型不匹配或引用过期时保留调用者原输出。读取发生在 Source 回调中，字段通过 ReadProcessMemory 的当前进程句柄复制；不可读页返回缺失，保留已有 PAGE_GUARD。该行为已用真实不可读页和 guard 页核对。

`l4p_effects.h` 提供 Paint 阶段 TraceRay 与 keyed dlight，布局和天花板检测依据原作 `SpotlightVision`。共享服务分配每个订阅的独立灯光 key，按 TTL 刷新；关闭、退订、离开环境后只熄灭所属灯光。原生灯光指针在调用结束后立即放弃，换图按代次重新分配。

`l4p_audio.h` 提供资源预缓存、本地空间声和本地非空间声，沿用原作 `EngEmitLocalSpatialVoice` 的 IEngineSoundClient003 和显式 MSVC 五槽接收者 ABI。声音仅发给当前本地玩家，按订阅分配独立通道组；停用、退订和离开范围按 GUID 清理自己的声音。GUID 查询、播放状态和停止槽 14–16 对照 [Valve L4D2 IEngineSound 声明](https://raw.githubusercontent.com/alliedmodders/hl2sdk/l4d2/public/engine/IEngineSound.h)。接收者、音色、位置、衰减、音高、通道和独立清理已由原生 x86 夹具核对。

`l4p_draw.h` 提供原生 Surface031 绘制，沿用上游 `SurfDrawing*` 的精确 Start/Finish 签名、共享 flag 和 root/push/pop/flush ABI。只在 UI / GAME panel Paint 执行；借用上下文仅 flush，自己创建的上下文成对 pop/end。字体和材质按输入缓存，原生材质通过 VFileSystem018 的 IBaseFileSystem::FileExists 检查。真实 x86 夹具通过上下文归属、根节点变化、文字和纹理参数、投影、菜单门禁及不支持签名拒绝；已查看自有离线位图输出。

`l4p_view.h` 返回绘制阶段（UI=1，GAME=2）、IEngineVGui 槽 2 的游戏菜单可见性和 VEngineClient013 槽 19 的视角。调用和字段依据上游 `EngGameUiVisible` / `EngGetViewAngles`；第三人称准星夹具覆盖实际 x86 参数、组合帧和门禁。

`l4p_resource.h` 提供按订阅持有的命名互斥资源，控制线程释放与退订在下一 Paint 清理，环境退出自动释放。枪声听感和 DSP 听声辨位通过该接口保留互斥规则与独立保存设置。

`l4p_addons.h` 提供原生角色挂件位过滤。来源 `ClientUxBackItemsPump` 的 UpdateAddonModels 精确入口与 0x1880/0x1884 字段；MinHook 负责调用入口，独立 DLL 只接收复制后的阵营、显示位和五个武器 ID。过滤值仅用于一次原生更新，随后恢复接收值；原生异常继续传播，临时值由 `native_seh.c` 的 finally 恢复。真实 x86 夹具已覆盖普通返回、RaiseException、PAGE_NOACCESS 引发的原生异常、分类、线程/范围门禁、第三方入口与关闭恢复。

LLVM-MinGW x86 的 GNU target 无法正确生成该间接调用的 SEH 表，因此仅将无头文件 C 边界编译为 MSVC x86 target，导入系统 msvcrt 的 `_except_handler3`。单符号导入库避免引入旧 CRT 的其他实现，Source 主体保留 UCRT。包内独立 CMake 已实际构建通过。

`l4p_model.h` 提供本地服 Model API 1，依据原作 `WModelScale`、`HookedModelScaleProxy` 和 `Hooked_WModelBuild`。玩家感染者使用 m_flModelScale / RecvProxy，AI 模型使用 BuildTransformations 槽 175、头部 0x9c 骨骼数、0x2c 标志与对象 0x6c0 矩阵指针；按原生 mask 仅缩放匹配骨骼，绕各实体原点计算。对象索引、句柄序列和地图代次共同识别归属；基线跟踪原生更新，外部修改保留。入口 CAS 恢复，常驻每槽 thunk 保留自身上游，第三方接管时退出效果。热路径按对象查找，原生调用前释放所有 C++ 锁。`models_smoke` 已核对真实 x86 DLL 的字段、骨骼、原点/掩码、分类、复用、范围/线程、地图、恢复、入口冲突和配置。

Entity API 2 保留 V1 前缀，新增 PlayerResource 整数数组和独立于 PVS 的玩家信息读取。数组根据真实 RecvTable 的 1 / 2 / 4 字节偏移解析；两字节值保留符号。`music_smoke` 覆盖三种步长、索引边界和无可见实体的玩家。

字段读取补充明确的 `L4P_FIELD_SHORT`，精确复制两个字节；模型路径也按原生短索引解析。队友描边夹具在模型索引后放置非零邻接字段，核对模型路径和输出边界。

`l4p_file.h` 提供 Paint 阶段的只读 GAME 文件 / 枚举，依据上游 `skeeto_filesystem.h`：VFileSystem018 主虚表 FindFirstEx 32、FindNext 29、FindIsDirectory 30、FindClose 31，IBaseFileSystem 子对象 +4 的 Read 0、Open 2、Close 3、Size 6。文件大小由调用方限定，读取每次最多 256 KiB；句柄按订阅持有，关闭可排队，加载期间暂停访问。`files_smoke` 已验证两套 this 指针、UTF-8、枚举句柄 0、读写范围、提前 EOF、菜单/加载和退订清理；音乐消费者另验证真实素材提取与解码。

File API 2 挂载所属插件的 assets：同级包目录由主订阅 ID 定位，拒绝路径型 ID 和重解析目录；VFileSystem018 主虚表 AddSearchPath 槽 7 的四参数 ABI（path、GAME、TAIL=1、flags=0）与 RemoveSearchPath 槽 8 来自同一上游头。原有素材优先，加载期暂停挂载变更，移除失败保留重试。Host 未提供包目录时，原 File API 1 仍保持可用。Entity API 3 的 move_type 依据 ScriptExtrasResolve，封装三种命名字段与 renderMode 后一字节，保留旧 ABI。`cues_smoke` 已消费真实包内素材、原生四参数调用、移动类型后备、缺失输出、挂载失败重试与离开对局清理；`files_smoke` 复核原文件读取合约。

`l4p_glow.h` 的 Glow API 1 提供生还者原生颜色回调与本地服 type-3 描边。来源 `Hooked_SurvivorGetGlowColor` 的槽 239，以及 `CampaignOutlineAcquire/Restore` 的 SetGlowType / 颜色 RecvProxy 精确签名。按对象和完整句柄持有，第三方虚表接管时保留常驻透传 thunk；常亮和新增穿墙描边要求 LOCAL。颜色 RecvProxy 同步归一化 RGB 缓存，各字段只恢复仍由自己持有的值。加载/断开/换图清除旧描边引用，沿用原作对拆除期 glow manager 的处理。真实 x86 夹具已通过原生 ABI、门禁、复用、字段归属、第三方入口、退订与服务关闭；签名不符保留原值。队友描边功能 DLL 已通过八角色、状态色、相对基线与激光描边的完整离线消费检查。

`l4p_input.h` 提供本地服的绑定按键边沿，依据 `EngLookupBinding` 槽 22、`HoldSemiResolveReloadInput` 和 `HoldSemiMakeRelease`。扫描码、扩展键与五个鼠标按钮保持原作映射；只有前台游戏 / 菜单关闭时接受按下，释放使用捕获键位并按订阅持有。退订和 shutdown 即时释放，失败保留归属重试。`input_smoke` 与 `reload_smoke` 在自有宿主中替换私有 Source DLL 的输入导入，全部输入写入内存记录。

Input API 2 增加可信物理左键监听与所属松开 / 按下周期。依据 `HoldSemiMouseProc` 的 injected 过滤，采用[独立消息线程](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc)，回调只更新原子值并始终传递事件。线程按实际 LOCAL 订阅创建 / 结束，Paint 只以零等待回收。每次合成 DOWN 重新检查真实持有、前台、菜单和本地服，松开后释放所持有输入；物理长按时交还控制。与 API 1 的按键归属共享，整个松开窗口保持互斥。`semiauto_smoke` 私有替换安装 / 撤销 hook 和消息分发，运行真实工作线程，桌面保持原状；覆盖六档节奏、安装 / 输入失败、窗口中物理松手 / 失焦、多人归属和完整关闭。原 Input API 1 与自动换弹路径已针对性复核。

`l4p_weapon.h` 提供 `WeaponCapacityResolve` / `WeaponClipCapacity` 的本地脚本容量读取。精确 getter 和 parser 签名共同确认实体 +0x9da 句柄与元数据 +0x160；校验 `clip_size` 字符串及 cdecl 函数前缀，读取 1–65535 容量。新增 MSVC-target C `L4P_NativeTry` 捕获该元数据调用的原生异常，停用本进程原生查找；消费者沿用自己的原版容量后备。真实 RaiseException / PAGE_NOACCESS、不支持签名和正常脚本容量均通过离线检查。

`l4p_player.h` 提供 Player API 1，依据 IdleViewRestore / IdlePersonRestore / IdleWepRestore / IdleFlashlight。角度使用 Engine013 槽 20，普通玩家动作使用槽 107 的枚举命令。所有写操作核对 Paint、订阅、当前本人、存活生还者、观察与菜单；人称保留客户端 PE 时间戳 0x6a440ecf / SizeOfImage 0x963000 和 getter / first / third 的三处前缀，getter(-1)、无参数 setter 与指针单元封装在服务内。L4P_NativeTry 捕获原生故障并停用当前进程该入口，其他 SDK 继续。

`l4p_localize.h` 提供 Localize API 1，依据 BotNameRuntime 的 VGUI_Localize005::Find 槽 2。订阅拥有 token，覆盖文字先复制校验，原生本地化表保留；不可变字符串按进程存活，保护面板保存的返回指针。恢复只处理自己仍占用的入口，其他 hook 在前时保留透明前驱。ANY 名称可用于菜单，受限订阅离开范围自动透传。read 在 Paint 返回有效原生文字的 UTF-8 副本，供独立 HUD 消费相同 BOT 名称。

`idle_smoke` 已验证真实两个 DLL、Player 本人门禁、原生角度 / 命令 / CInput ABI、完整四种闲置恢复状态机、亮度租约、手电声音、八角色名称 / UTF-16 / 指针生命周期、第三方入口和关闭。另核对不匹配指令和实际 RaiseException / PAGE_NOACCESS；本地化 → Surface 中文位图已查看。实际游戏由用户另行实测。

`l4p_corpse.h` 提供 Corpse API 1，依据 ClientUxHideEntHard / ClientUxNoCorpseDestroyPump。LOCAL 订阅在 Paint 隐藏经消费者死亡事件确认的 CI / Witch / 布偶，明确排除玩家槽位与玩家类。服务通过 RecvTable 定位 m_fEffects / m_nRenderMode / m_clrRender，持有 NODRAW 位、模式和颜色，保留最新原生基线；恢复时逐字段核对归属。完整句柄、对象、网络类与地图代次保护实体复用；读写受当前进程可访问页约束，guard 页保持，暂时不可读与失败恢复留待重试。类型化 destroy_ragdolls 仅提交固定的原生命令，调度由消费者负责。`corpses_smoke` 已通过真实两个 DLL 的字段 / 归属 / 范围 / 队列与完整退订、Source shutdown；原 presets_smoke 已复核既有参数消费者。

`l4p_viewmodel.h` 提供 ANY 范围的 Viewmodel API 1，源于原作 ViewModelBind / Calc / Mirror / Scale。snapshot 复制两个模型槽的路径、MDL checksum、完整引用与绑定代次；set 在 Paint 发布两槽姿态。Calc222 原生完成后叠加位置 / 旋转 / 旋转原点；Build175 完成后按 mask 绕骨骼质心缩放并按 GetView(-1) 的相机平面反射。镜像脚本 +0x859 在原生 build 内暂回原值，native finally 在普通返回 / SEH 展开时归还镜像值。元数据 / 相机异常或骨骼数据失效时同帧归还所属剔除标记，失败恢复继续排队。

完整模型头、checksum、对象 / 句柄与地图代次共同确认绑定；同头部内容更换也重新绑定。缩放字段保留最新原生值，关闭与退订恢复。两个模型共用武器脚本且镜像状态相反时暂停镜像，比例调整继续。原生调用期间释放 C++ 锁；第三方接管虚表后保留透明前驱。`viewmodel_smoke` 已消费真实 Source / 功能 DLL，覆盖姿态 / 旋转原点、缩放 / 镜像、两槽 / mask、共享身份冲突、暂时只读恢复、MDL / 地图更替、实际原生异常、第三方入口和完整用户配置；骨骼标尺位图已查看。

`l4p_dissolve.h` 提供 ANY 的 Dissolve API 1，源于 ClientUxDissolve / DissApply。精确匹配创建函数体、原生分配 / 构造 / 模型 / 父对象 / 原点 / 删除管理器 / 字段 setter，保留 C_EntityDissolve 0x680 对象及原时序；原生 Think / Draw 留给引擎。完整实体身份与 userid / 出生代次防止恢复到新对象。玩家和普感保持 NODRAW，玩家保持 FL_DISSOLVING；Witch / 布偶的隐藏保留有界恢复点直到关闭或身份失效。已有原生效果及 Corpse API 逐实体租约优先，分类资源由消费者管理。

`dissolve_smoke` 已消费真实 Source / 功能 DLL 与原生 x86 夹具：创建参数、类型 / 时长、父对象 / 绝对原点、生命周期 / 归属、复活、暂时只读 / guard、分类资源与全部五项设置、队列 / 射线缓存 / 布偶后备 / 限流。构造、初始化、效果 setter 和原生回收异常分别核对；签名不符保持游戏对象，原生故障停止创建，清理失败继续排队。已完成构造而初始化失败的对象由原生管理器回收；构造本身异常记录有界孤立分配并停止该后端。原 `corpses_smoke` 已复核类别与旧参数路径。

File API 3 使用 VFileSystem018 主虚表 GetSearchPath 槽 13，返回含 VPK 搜索路径的变化标识。原 File API 1 / 2 保持。`files_smoke` 已消费新接口与抽取的 Skeeto 样式解析器：挂载变化、样式读取、连杀轮换、优先级与关闭保留选择通过。

`l4p_particle.h` / `particles.inc` 提供 Particle API 1，直接沿用原作 DispatchParticleEffect / PrecacheParticleSystem / FindParticleSystem 和清单解析入口。初始化工作线程仅安装清单 hook，原生清单调用先执行上游、再在同一线程按前缀追加；发送与预载留在 Paint。MinHook 管理指令搬移，关闭保留透明入口和原始调用。`particles_smoke` 的最小 x86 路径通过 SDK 加载、清单追加、预载 / 查找 / 世界坐标发送和独立停用。当前为原始清单入口，Necola 前置 hook 的链式接入随其模块完成。

Source API 2 增加 GAMEEVENT GetString 槽 9 的复制文字。`l4p_feedback.h` / `feedback.inc` 提供玩家 m_iHealth RecvProxy 观察和 32 项 / 400 毫秒队列；原回调先完成写入，队列保留时间与完整身份，血量回升和出生事件更新代次。独立订阅关闭后恢复自己持有的入口。全屏叠图独占 r_screenoverlay，并在清除后恢复所属标志；GameUI 原加载完成位只读采样供素材恢复。`feedback_smoke` 通过实际消费者的击杀 / 接收血量、叠图清除、关闭与保存路径。

完整源码、SDK 头、JSON 头、MinHook 源码及其许可证、独立 CMake 位于 `source/`。使用 Windows x86 LLVM-MinGW / MSVC、C/C++17 和 CMake 3.22+；仓库构建目标 `beacon_source`。游戏实测待单独执行。许可证见 LICENSE；nlohmann/json 的 MIT 许可证在其头文件中，MinHook 的 BSD 许可证位于 `source/minhook/LICENSE.txt`。
