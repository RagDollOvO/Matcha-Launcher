import { confirmAction, readPermissions } from './autonomy.mjs';
// 自主模式：下载到暂存区、保存资料直接做；导入 DLL 时安全检查有疑点、或更新的是已启用的模组（新代码下次启动就会运行）才问。首次导入保持停用。
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const text = description => ({ type: 'string', minLength: 1, description });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value });
const check = signal => signal?.throwIfAborted();
const fields = object({ name: { type: 'string' }, author: { type: 'string' }, summary: { type: 'string' }, description: { type: 'string' },
  tags: { type: 'array', maxItems: 8, items: { type: 'string' } }, modes: { type: 'array', maxItems: 8, items: { type: 'string' } },
  hotkeys: { type: 'array', maxItems: 8, items: { ...object({ keys: text('按键。'), label: text('功能。') }), required: ['keys', 'label'] } },
  cover: { type: 'string', description: '包内相对图片路径，或来源/包检查返回的暂存图片完整路径。' },
  links: { type: 'array', maxItems: 8, items: { ...object({ label: text('链接名称。'), url: text('HTTPS 地址。'), note: { type: 'string' } }), required: ['label', 'url'] } },
});

export function dllTools(request) {
  return [{
    name: 'dll_pack_check', label: '检查本地 DLL 入口',
    description: '整包安装、维护前比较发行包与当前目录，列出缺失及占用的文件。Skeeto 只传 id；其他平台填作者资料，用发行包原件的 SHA-256 标识关键文件。返回 planId 可交给 dll_pack_record。',
    parameters: { ...object({ id: text('稳定的平台 ID，如 skeeto'), name: text('名称'), source: text('作者发行链接或本机来源'),
      launch: text('作者规定的启动方式'), maintenance: text('作者的维护、卸载入口'), enable: text('作者提供的启用方式，与 disable 成对填写'), disable: text('作者提供的停用方式'),
      switching:{...object({kind:{type:'string',enum:['park-entry','ini-flag']},path:text('作者独占的 addons VDF 入口，或 left4dead2/<平台ID> 下的独立 INI。'),key:text('INI 总启停键名，须有作者说明且唯一'),on:{type:'integer',enum:[0,1]}}),required:['kind','path']},
      files: { type: 'array', minItems: 1, maxItems: 24, items: { ...object({ path: text('相对游戏根目录的路径'), role: { type: 'string', enum: ['entry','module','asset'] },
        sha256: text('暂存发行包原件的 SHA-256') }), required: ['path','role','sha256'] } } }), required: ['id'] },
    async execute(_id, pack, signal) { return result(await request('dll-pack-preview', { pack }, undefined, signal)); },
  },{
    name:'dll_pack_uninstall',label:'完整卸载平台',write:true,
    description:'从当前游戏卸载已接入的 DLL 平台。预览已核实的文件和专属配置；玩家确认后清理游戏文件、平台更新包及 Matcha 登记。遇到冲突先核对。完成后卡片自动移除。',
    parameters:{...object({id:text('平台 ID。')}),required:['id']},
    async execute(_id,{id},signal,_u,ctx){
      const p=await request('dll-pack-remove-preview',{id},undefined,signal);
      if(p.blocked.length)return result({status:'blocked',blocked:p.blocked,retained:p.retained});
      if(!p.registered&&!p.files.length&&!p.folders.length&&!p.packages.length&&!p.legacyFiles.length)return result({status:'absent',retained:p.retained});
      const rows=[...p.files.map(f=>f.path+' · '+f.reason),...p.legacyFiles.map(f=>f.path+' · '+(f.action==='replace'?'恢复原文件':'安装账本：'+f.action)),...p.packages.flatMap(m=>m.files.map(f=>m.id+' · '+f)),...p.folders.map(f=>f+'/ · 清空后移除')];
      for(const key of p.addonKeys)rows.push('addonlist.txt · 移除条目 '+key);
      if(!ctx.hasUI)throw new Error('完整卸载需要玩家确认清单。');
      if(await ctx.ui.confirm('完整卸载 '+p.name,'游戏：'+p.root+'\n\n'+(rows.join('\n')||'游戏内未检出所属文件')+
        (p.retained.length?'\n\n保留：'+p.retained.join('、'):'')+'\n\n清单中的文件和自定义配置将永久移除，随后清除本游戏的平台登记。',{signal})!==true)return result({applied:false,reason:'已取消'});
      check(signal);return result(await request('dll-pack-remove',{planId:p.planId},{approved:true,source:'user'},signal));
    },
  },{
    name: 'dll_pack_record', label: '登记本地 DLL', write: true,
    description: '复核并保存来源、启动方式、关键文件和最近验证状态。安装完成后先重新 dll_pack_check；仅写入 Matcha 的记录。',
    parameters: { ...object({ planId: text('本次现场检查返回的 planId') }), required: ['planId'] },
    async execute(_id, params, signal, _u, ctx) {
      if (!ctx.hasUI) throw new Error('请在茶茶窗口中确认登记。');
      const {root,row,newSwitch} = await request('dll-pack-review', params, undefined, signal);
      const bySetting = !newSwitch && readPermissions().mode === 'full';
      if (!bySetting && await ctx.ui.confirm('登记本地 DLL · ' + row.name, root + '\n来源：' + row.source + '\n启动：' + row.launch + '\n维护：' + row.maintenance + '\n' +
        row.files.map(f => f.path + '  [' + f.state + ']').join('\n') + (newSwitch?'\n允许卡片与茶茶以后切换：'+row.switching.path+(row.switching.kind==='ini-flag'?' · '+row.switching.key+'（启用='+row.switching.on+'）':' · 暂存/还原这个入口'):'')+'\n这次登记保留游戏文件原位。', {signal}) !== true) return result({ applied:false });
      check(signal); return result(await request('dll-pack-save', params, {approved:true,source:bySetting?'full-access':'user'}, signal));
    },
  },{
    write:true,name:'dll_pack_set_enabled',label:'切换已登记的 DLL',description:'玩家明确要求启用或停用时使用，与页面开关共用执行器；仅操作已验证的入口或作者总开关。返回实际状态。',
    parameters:{...object({id:text('本地 DLL 的记录 ID'),enabled:{type:'boolean'}}),required:['id','enabled']},
    async execute(_id,params,signal,_u,ctx){
      const ask=readPermissions().mode==='ask';
      if(!ctx.hasUI || (ask && await ctx.ui.confirm((params.enabled?'启用 ':'停用 ')+params.id,'按已登记方式切换，下次启动生效。',{signal})!==true))return result({applied:false});
      check(signal);return result(await request('dll-pack-set-enabled',params,{approved:true,source:ask?'user':'permissions'},signal));
    },
  },{
    name: 'dll_inventory', label: '查看 DLL 模组与加载状态',
    description: '只读查询当前游戏的 Matcha 和 L4N 模组、随包未安装项、合并后的展示资料、字段出处、来源与发布者、依赖、启停和当前加载诊断。与 DLL 页共用读取链路。整理已有资料、更新或排障前先读取 matcha-dll-organizer 技能并查询此清单。',
    parameters: object({ id: text('可选，清单或详情页给出的模组 ID；省略时读取全部 DLL 模组。') }),
    async execute(_id, params, signal) { check(signal); return result(await request('dll-inventory', params, undefined, signal)); },
  }, {
    write: true, name: 'dll_source_fetch', label: '读取 DLL 来源',
    description: '读取公开 GitHub 仓库/Release、L4D2 工坊条目或用户提供的本地来源。先返回 README、发布说明、附件与图片清单。下载时再次提供 sourceId 和 assetId，用户确认后只保存到 Matcha 暂存区；保留发布者身份，下载时核对来源公布的校验值。',
    parameters: object({ type: { type: 'string', enum: ['github', 'workshop', 'local'] }, url: text('来源页面 HTTPS 地址。'), path: text('本地来源绝对路径。'),
      sourceId: text('已检查来源 sourceId。'), assetId: text('来源检查返回的附件或图片 ID；提供时执行确认下载。'), refresh: { type: 'boolean' } }),
    async execute(_id, params, signal, _update, ctx) {
      check(signal);
      if (!params.assetId) return result(await request('dll-source-fetch', params, undefined, signal));
      const plan = await request('dll-source-download-preview', params, undefined, signal);
      if (!ctx.hasUI) throw new Error('下载来源文件需要 Matcha 确认界面。');
      const approved = await confirmAction(ctx, '下载 DLL 来源文件到暂存区', `${plan.source.label ?? plan.source.url}\n发布者：${JSON.stringify(plan.publisher)}\n\n${plan.asset.name}\n大小：${plan.asset.size === null ? '按上限读取' : `${plan.asset.size} 字节`}\n${plan.asset.url}\n\n只写暂存区，导入游戏另行确认。`, { signal, risk: 'routine' });
      check(signal);
      return approved === true ? result(await request('dll-source-download', { planId: plan.planId }, { approved: true, source: 'user' }, signal))
        : result({ applied: false, reason: '用户取消了下载' });
    },
  }, {
    write: true, name: 'dll_overlay_write', label: '保存 Agent 整理资料',
    description: '只补名称、作者、简介、说明、标签、模式、快捷键、封面和链接。填写依据，保留作者已有字段和页面；用户确认后独立保存，手动修改优先。sourceId 取自真实来源检查；来源或发布者改变时会单独提示。',
    parameters: { ...object({ id: text('模组 ID。'), fields, basis: text('所依据的 README、发行说明等资料。'), sourceId: text('可选的来源检查 sourceId。'),
      source: { type: 'object', description: '可选来源记录 {type,url,label,version}；优先使用 sourceId。', additionalProperties: true } }), required: ['id', 'fields', 'basis'] },
    async execute(_id, params, signal, _update, ctx) {
      check(signal); const plan = await request('dll-overlay-preview', params, undefined, signal);
      if (!ctx.hasUI) throw new Error('保存整理资料需要 Matcha 确认界面。');
      const changed = plan.changes.map(c => `${c.field}：${JSON.stringify(c.before) ?? '空'} → ${JSON.stringify(c.after)}`).join('\n');
      const source = plan.sourceChanged ? `\n\n来源变更：${plan.previousSource?.url ?? '本地'} → ${plan.source?.url ?? '本地'}\n发布者：${JSON.stringify(plan.previousPublisher)} → ${JSON.stringify(plan.publisher)}` : '';
      const approved = await confirmAction(ctx, '保存 Agent 整理资料', `${plan.name}\n依据：${plan.basis ?? ''}\n\n${changed}${source}\n\n资料保存在 Matcha，作者包与游戏配置保持原样。`, { signal, risk: 'routine' });
      check(signal);
      return approved === true ? result(await request('dll-overlay-write', { planId: plan.planId }, { approved: true, source: 'user' }, signal))
        : result({ applied: false, reason: '用户取消了操作' });
    },
  }, {
    write: true, name: 'dll_source_record', label: '记录 DLL 来源版本',
    description: '记录实际来源检查的最新版本和时间，保留接入时版本；核对仓库/工坊发布者。此操作只更新来源资料，DLL 文件与启停状态保持原样。',
    parameters: { ...object({ id: text('模组 ID。'), sourceId: text('dll_source_fetch 返回的 sourceId，建议提供以复用检查。'),
      latest: { type: ['object', 'null'], additionalProperties: true }, checkedAt: { type: 'string' } }), required: ['id'] },
    async execute(_id, params, signal) { check(signal); return result(await request('dll-source-record', params, undefined, signal)); },
  }, {
    name:'dll_screen', label:'静态筛查 DLL', description:'检查已安装模组或导入暂存记录的 DLL 能力和签名，二选一提供 pluginId 或 intakeId。只读，不执行文件。',
    parameters:object({pluginId:text('已安装模组 ID'),intakeId:text('导入记录 ID')}),
    async execute(_id,params,signal){check(signal);return result(await request('dll-screen',params,undefined,signal));},
  }, {
    name: 'dll_package_inspect', label: '检查 DLL 来源包',
    description: '静态读取本地 ZIP、DLL 或目录。返回文件清单、DLL 接口、说明节选及解压后的 originalDirectory。查脚本和完整说明时直接用 local_read 或 local_grep 读这个目录，无需再用终端解压。',
    parameters: object({ file: text('用户指定或已下载来源的绝对路径；与 intakeId 二选一。'), intakeId: text('先前检查返回的 intakeId。') }),
    async execute(_id, params, signal) { check(signal); return result(await request('dll-inspect', params, undefined, signal)); },
  }, {
    write: true, name: 'dll_package_prepare', label: '在暂存区整理 DLL',
    description: '只复制已检查的暂存文件并按清单排布；sdk 保留作者 manifest，library 为独立 DLL 生成或保留整体加载声明，l4n 保留子插件原名。更新已有普通 DLL 时用 updatePluginId 显式绑定清单中的目标，保留原 ID。先依据作者资料确认加载方式；此工具只写暂存区，游戏文件在导入确认后更新。',
    parameters: { ...object({ intakeId: text('检查返回的 intakeId。'), mode: { type: 'string', enum: ['sdk', 'library', 'l4n'] },
      mappings: { type: 'array', minItems: 1, maxItems: 4096, items: { ...object({ source: text('检查清单中的相对路径。'), target: text('整理包相对路径。SDK/独立 DLL 主入口为 plugin.dll；L4N 保持 DLL 原文件名。') }), required: ['source', 'target'] } },
      name: text('首次生成整体 DLL 包时，根据来源填写名称。'), summary: text('首次生成整体 DLL 包时，根据来源填写 160 字内简介。'),
      updatePluginId: text('更新已有普通 DLL 时指定 dll_inventory 返回的已安装 library 模组 ID；后端核对归属并保留身份。SDK 包沿用作者 ID。'),
    }), required: ['intakeId', 'mode', 'mappings'] },
    async execute(_id, params, signal) { check(signal); return result(await request('dll-prepare', params, undefined, signal)); },
  }, {
    write: true, name: 'dll_package_import', label: '确认导入 DLL 整理结果',
    description: '核对最终暂存包并显示宿主、游戏目录与完整文件清单。同 ID 已安装时显示新旧版本并更新，保留配置、启停状态和旧包备份；首次导入默认停用。用户确认、游戏退出后执行，沿用作者身份与签名核验。',
    parameters: { ...object({ intakeId: text('检查或整理返回的 intakeId。'), candidateId: text('最新候选包 candidateId。') }), required: ['intakeId', 'candidateId'] },
    async execute(_id, params, signal, _update, ctx) {
      check(signal);
      const plan = await request('dll-import-preview', params, undefined, signal);
      if (!ctx.hasUI) throw new Error('导入 DLL 需要 Matcha 确认界面。');
      const s=plan.screening;
      if(s?.tier==='blocked')return result({applied:false,screening:s});
      const safety=s?'\n安全检查 v'+s.rulesVersion+'：'+(s.findings.filter(f=>f.severity==='review').map(f=>f.file+' · '+f.title).join('；')||'静态检查未发现问题'):'';
      const updating = plan.operation === 'update';
      const effect = updating ? `从 v${plan.previousVersion} 更新到 v${plan.version}。保留配置和启停状态（${plan.enabled ? '启用' : '停用'}），旧包完整备份。下次完整启动生效。`
        : '首次导入后保持停用，设置与启停在游戏内外按原方式使用。';
      const sourceVersion = plan.sourceVersion ? `\n来源版本：${updating ? `${plan.previousSourceVersion ?? '未记录'} → ` : ''}${plan.sourceVersion}` : '';
      const approved = await confirmAction(ctx, updating ? '更新 DLL 模组' : '导入 DLL 模组', `${plan.name}\nID：${plan.pluginId}\n宿主：${plan.host}\n目标游戏：${plan.gameRoot}${sourceVersion}\n\n${plan.files.map(f => `${f.path} (${f.bytes} 字节)`).join('\n')}\n\n${effect}${safety}`, { signal, risk: s && !s.findings?.some(f => f.severity === 'review') && !(updating && plan.enabled) ? 'routine' : 'ask' });
      check(signal);
      if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
      return result(await request('dll-import', { planId: plan.planId }, { approved: true, source: 'user' }, signal));
    },
  }];
}
