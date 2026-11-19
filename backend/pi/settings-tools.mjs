import { confirmAction } from './autonomy.mjs';
// 茶茶的体检与设置工具：读启动项 / CFG / 启动器设置；改动先预览，玩家确认后再应用。服务一侧在 settings-host.mjs。
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value });
const check = signal => signal?.throwIfAborted();
const show = v => v === null || v === undefined ? '（无）' : typeof v === 'boolean' ? (v ? '开' : '关') : v === '' ? '（空）' : String(v);
const clip = (text, n = 1600) => text.length > n ? `${text.slice(0, n)}\n……` : text;

const launchSchema = {
  type: 'object', additionalProperties: false, description: '只写要改的启动项，没写的保持原样。',
  properties: {
    display: object({
      mode: { type: 'string', enum: ['default', 'fullscreen', 'windowed', 'noborder'] },
      width: { type: ['integer', 'null'], minimum: 320, maximum: 7680 },
      height: { type: ['integer', 'null'], minimum: 320, maximum: 7680 },
      refreshHz: { type: ['integer', 'null'], minimum: 24, maximum: 1000, description: '只在全屏时生效。' },
    }),
    fpsMax: { type: ['integer', 'null'], minimum: 0, maximum: 1000, description: 'null 不加 +fps_max；0 为不限制。' },
    novid: { type: 'boolean', description: '-novid 跳过开场动画' },
    console: { type: 'boolean', description: '-console 开局打开控制台' },
    lowViolence: { type: 'boolean', description: '-lv 低血腥度' },
    consoleLog: { type: 'boolean', description: '-condebug 控制台输出写入 left4dead2/console.log' },
    highPriority: { type: 'boolean', description: '-high 高优先级' },
    extraArgs: { type: 'string', maxLength: 1000, description: '自定义启动项原文（整段替换），空白分隔；+connect、-insecure、-game 等由启动流程管理，不能写。' },
  },
};

export function settingsTools(request) {
  return [
    {
      name: 'game_config_inspect', label: '读取启动项与 CFG',
      description: '只读。检查游戏内 Ctrl+F7 设置时，inGameSettings.radar 给出物资雷达 settings.ini 已保存的各项值；config/actions 为空也可读取。返回当前启动方式、两种启动方式的最终启动参数、Steam 库里给 L4D2 填的启动选项（多账号逐个列出）、autoexec.cfg 全文和 Matcha 管理段、cfg 目录顶层文件清单。传 file 可读 cfg 目录里的单个 .cfg/.txt/.rc（64 KiB 以内）。体检、排查启动问题或改启动项前先调用。',
      parameters: object({ file: { type: 'string', minLength: 1, maxLength: 128, description: 'cfg 目录里的文件名，例如 config.cfg、valve.rc、video.txt。' } }),
      async execute(_id, params, signal) { check(signal); return result(await request('settings-config-inspect', params, undefined, signal)); },
    },
    {
      write: true, name: 'game_settings_update', label: '修改启动项与 CFG',
      description: '改 Matcha 的启动项和 autoexec.cfg 里的 Matcha 管理段。launch 只写要改的字段；cvars 按 { 变量: 值 } 改管理段，已有的就地改最后一次赋值、缺的补到末尾、null 删除；extra 整段替换管理段（慎用，优先用 cvars）；cfgEnabled 控制是否把管理段写进游戏。先列出改前改后和最终启动参数，玩家确认后保存；游戏运行中会等下次启动前再写文件。管理段以外的 CFG 和 Steam 启动选项不能用它改。',
      parameters: object({
        launch: launchSchema,
        cvars: { type: 'object', maxProperties: 64, additionalProperties: { type: ['string', 'number', 'null'] }, description: '例如 {"fps_max":"0","cl_glow_survivor_r":"0","mat_monitorgamma":null}。' },
        extra: { type: 'string', maxLength: 16000, description: '整段替换管理段内容，逐行命令。' },
        cfgEnabled: { type: 'boolean', description: 'true 把管理段写进 autoexec.cfg；false 撤掉管理段（内容保留在 Matcha 里）。' },
      }),
      async execute(_id, params, signal, _update, ctx) {
        check(signal);
        const plan = await request('settings-game-preview', params, undefined, signal);
        if (!plan.planId) return result({ applied: false, status: 'unchanged' });
        if (!ctx?.hasUI) throw new Error('修改启动设置需要 Matcha 确认界面。');
        const lines = plan.changes.map(c => `${c.label}：${c.beforeText} → ${c.afterText}`);
        if (plan.cfgChanges.length) lines.push(...plan.cfgChanges.map(c => `CFG ${c.key}：${show(c.before)} → ${c.after === null ? '删除' : c.after}`));
        if (plan.cfgReplaced) lines.push(`CFG 管理段整段替换：${plan.cfgReplaced.beforeLines} 行 → ${plan.cfgReplaced.afterLines} 行`);
        const argv = mode => `${plan.effective.after[mode].join(' ') || '（无）'}`;
        const argsChanged = ['modded', 'clean'].filter(m => plan.effective.before[m].join(' ') !== plan.effective.after[m].join(' '));
        const tail = [
          argsChanged.length ? `改后最终参数：\nL4N 平台启动：${argv('modded')}\n纯净对抗：${argv('clean')}` : '',
          plan.cfgText !== undefined && (plan.cfgReplaced || plan.cfgChanges.length) ? `改后的管理段：\n${clip(plan.cfgText) || '（空）'}` : '',
          plan.autoexec.path ? `${plan.autoexec.enabled ? '保存后写入' : '保存后撤掉'} ${plan.autoexec.path} 里的 Matcha 管理段，段外内容保持原样；第一次改会留 .matcha.bak 备份。` : '保存到 Matcha，选好游戏目录后写入游戏。',
        ].filter(Boolean).join('\n\n');
        const approved = await confirmAction(ctx, '修改启动设置', `${lines.join('\n')}\n\n${tail}`, { signal, risk: 'routine' });
        check(signal);
        if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
        return result(await request('settings-game-apply', { planId: plan.planId }, { approved: true, source: 'user' }, signal));
      },
    },
    {
      write: true, name: 'game_settings_import', label: '导入已有启动项与 CFG',
      description: '把玩家已有的参数导入 Matcha：Steam 库里给 L4D2 填的启动选项拆进 Matcha 启动项（认得的进对应开关，其余原样进自定义启动项，一个不删，Steam 里的原样不动；导入后 L4N 平台启动才带上它们）；autoexec.cfg 里 Matcha 管理段以外的设置整体接管进管理段（先整份备份原文件，之后就能用 game_settings_update 改）。game_config_inspect 返回 importable 时，体检报告里把它列为可以帮忙的第一项。先列出导入清单，玩家确认后才写；游戏运行中不能导入 CFG。',
      parameters: object({
        accountId: { type: 'string', pattern: '^[0-9]+$', description: '多个 Steam 账号填了不同启动选项时指定用哪个（game_config_inspect 的 steamLaunchOptions[].accountId）；不填用最近登录且填了的那个。' },
        launch: { type: 'boolean', description: 'false 不导入 Steam 启动选项。' },
        cfg: { type: 'boolean', description: 'false 不接管 autoexec.cfg。' },
      }),
      async execute(_id, params, signal, _update, ctx) {
        check(signal);
        const plan = await request('settings-import-preview', params, undefined, signal);
        if (!plan.planId) return result({ applied: false, status: 'nothing', launch: plan.launch, cfg: plan.cfg });
        if (!ctx?.hasUI) throw new Error('导入设置需要 Matcha 确认界面。');
        const parts = [];
        if (plan.launch?.changes?.length) {
          parts.push(`Steam 账号 ${plan.launch.accountId} 的启动选项：${plan.launch.text}`);
          parts.push(...plan.launch.changes.map(c => `${c.label}：${c.beforeText} → ${c.afterText}`));
          if (plan.launch.skipped?.length) parts.push(...plan.launch.skipped.map(s => `不导入 ${s.text}：${s.reason}`));
          parts.push(`导入后 L4N 平台启动的参数：${plan.effective.after.modded.join(' ')}`);
        }
        if (plan.cfg?.lines) {
          parts.push(`autoexec.cfg 里 ${plan.cfg.lines} 行设置接管进 Matcha 管理段${plan.cfg.draftLines ? `，Matcha 里没写进游戏的 ${plan.cfg.draftLines} 行草稿接在最后一起生效` : ''}。`);
          if (plan.cfg.kept?.length) parts.push(`引号不成对、留在段外的 ${plan.cfg.kept.length} 行：${plan.cfg.kept.join(' / ')}`);
          parts.push(`原文件整份备份到 ${plan.cfg.backup}`);
          parts.push(`接管后的管理段：\n${clip(plan.cfg.text)}`);
        }
        const approved = await confirmAction(ctx, '导入已有参数到 Matcha', parts.join('\n'), { signal, risk: 'routine' });
        check(signal);
        if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
        return result(await request('settings-import-apply', { planId: plan.planId }, { approved: true, source: 'user' }, signal));
      },
    },
    {
      name: 'launcher_settings_inspect', label: '查看启动器设置',
      description: '只读。返回下载设置、茶茶自己的默认值（思考强度、自动压缩、出错重试）、界面偏好（配色、缩放、动效、声音、对话习惯等，含每项可选值），以及只能玩家自己改的项。改设置前先调用，按返回的键名和可选值填写。',
      parameters: object({}),
      async execute(_id, _params, signal) { check(signal); return result(await request('settings-launcher-inspect', {}, undefined, signal)); },
    },
    {
      write: true, name: 'launcher_settings_update', label: '修改启动器设置',
      description: '改一组启动器设置。section=downloads：maxConcurrent(1–4)、speedLimit(字节/秒，0 不限)；section=pi：defaultThinkingLevel、autoCompaction、autoRetry（下次连接生效）；section=ui：launcher_settings_inspect 返回的界面偏好键。先预览改前改后，玩家确认后应用。API Key、社区加速、游戏目录、托盘与开机自启、清理与迁移不在这里改，请告诉玩家去设置页。',
      parameters: { ...object({
        section: { type: 'string', enum: ['downloads', 'pi', 'ui'] },
        patch: { type: 'object', minProperties: 1, maxProperties: 24, additionalProperties: { type: ['string', 'number', 'boolean'] }, description: '{ 键: 新值 }，只写要改的。' },
      }), required: ['section', 'patch'] },
      async execute(_id, params, signal, _update, ctx) {
        check(signal);
        const plan = await request('settings-launcher-preview', params, undefined, signal);
        if (!plan.planId) return result({ applied: false, status: 'unchanged' });
        if (!ctx?.hasUI) throw new Error('修改设置需要 Matcha 确认界面。');
        const title = { downloads: '修改下载设置', pi: '修改茶茶的默认值', ui: '修改界面偏好' }[params.section];
        const body = plan.changes.map(c => `${c.label}：${show(c.from)} → ${show(c.to)}`).join('\n');
        const note = params.section === 'pi' ? '\n\n下次连接茶茶时生效。' : params.section === 'ui' ? '\n\n只改这台电脑上的界面偏好，可随时在设置页改回。' : '';
        const approved = await confirmAction(ctx, title, body + note, { signal, risk: 'routine' });
        check(signal);
        if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
        return result(await request('settings-launcher-apply', { planId: plan.planId }, { approved: true, source: 'user' }, signal));
      },
    },
  ];
}
