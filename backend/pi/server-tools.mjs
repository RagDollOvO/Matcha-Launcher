import { confirmAction } from './autonomy.mjs';
const object = properties => ({ type: 'object', properties, additionalProperties: false });
const text = description => ({ type: 'string', minLength: 1, description });
const ids = description => ({ type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: text(description) });
const rows = properties => ({ type: 'array', minItems: 1, maxItems: 100, items: properties });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], details: value });
const check = signal => signal?.throwIfAborted();
const value = v => v === null ? '自动' : typeof v === 'boolean' ? v ? '是' : '否' : String(v || '空');
const titles = { add: '添加服务器', update: '修改服务器资料', organize: '整理服务器分类', category: '维护服务器类别', remove: '移除服务器' };

export function serverTools(request) {
  const read = (name, label, description, operation, parameters) => ({ name, label, description, parameters,
    async execute(_id, params, signal) { check(signal); return result(await request(operation, params, undefined, signal)); } });
  const write = (name, action, description, parameters) => ({ name, label: titles[action], write: true, description, parameters,
    async execute(_id, params, signal, _update, ctx) {
      check(signal);
      const plan = await request('server-preview', { action, params }, undefined, signal);
      if (!plan.changes.length) return result({ applied: false, status: 'unchanged', skipped: plan.skipped, errors: plan.errors });
      if (!ctx.hasUI) throw new Error('服务器整理需要 Matcha 确认界面。');
      const title = action === 'category' && params.action === 'delete'
        ? params.removeServers ? '删除类别和其中的服务器' : '删除服务器类别' : titles[action];
      const changes = plan.changes.map(c => `${c.subject}\n${value(c.before)} → ${value(c.after)}`).join('\n\n');
      const errors = plan.errors.length ? `\n\n本批保留待处理：\n${plan.errors.map(e => `${e.address}：${e.message}`).join('\n')}` : '';
      const skipped = plan.skipped.length ? `\n\n已有地址保持原样：${plan.skipped.map(s => s.addr).join('、')}` : '';
      const approved = await confirmAction(ctx, title, `${changes}${skipped}${errors}\n\n保存到 Matcha 服务器列表，游戏和启动参数保持原样。`, { signal, risk: action === 'remove' || (action === 'category' && params.action === 'delete') ? 'ask' : 'routine' });
      check(signal);
      if (approved !== true) return result({ applied: false, reason: '用户取消了操作' });
      return result(await request('server-apply', { planId: plan.planId }, { approved: true, source: 'user' }, signal));
    } });
  return [
    read('server_inventory', '查看服务器与自定义类别', '读取已保存服务器、备注、收藏、类别与顺序、缓存探测及当前启动方式。可按类别、所选 ID、收藏筛选。服务器工作前先读取 matcha-server-organizer 技能。',
      'server-inventory', object({ serverIds: ids('真实服务器 ID。'), groupId: text('类别 ID；loose 表示未分组。'), favorite: { type: 'boolean' } })),
    read('server_query', '探测所选服务器', '探测指定已保存服务器的实时人数、Bot、延迟、地图、模式、VAC、密码及玩家名单；按实际状态与时间报告。复用页面的并发与在途查询。',
      'server-query', { ...object({ serverIds: ids('清单返回的真实服务器 ID。') }), required: ['serverIds'] }),
    write('server_add', 'add', '批量规范化并预览添加查询地址；支持 connect、steam://connect 和域名/IP。重复地址保留原备注、收藏和类别。用户确认后保存，逐项返回成功、跳过与错误。',
      { ...object({ items: rows({ ...object({ address: text('单个用户提供的查询地址。'), label: { type: 'string', maxLength: 80 },
        gamePort: { type: ['integer', 'null'], minimum: 1, maximum: 65535, description: '独立游戏连接端口；null 使用自动选择。' }, groupId: text('可选已有类别 ID；默认未分组。') }), required: ['address'] }) }), required: ['items'] }),
    write('server_update', 'update', '预览并确认修改备注、收藏和连接端口。每项只修改提供的字段，保留 ID、查询地址、类别顺序及其他资料。',
      { ...object({ updates: rows({ ...object({ id: text('服务器 ID。'), label: { type: 'string', maxLength: 80 }, favorite: { type: 'boolean' },
        gamePort: { type: ['integer', 'null'], minimum: 1, maximum: 65535 } }), required: ['id'] }) }), required: ['updates'] }),
    write('server_organize', 'organize', '把服务器移入已有或自定义类别（页面称合集），例如战役、对抗、死门。每项使用 groupId 或 groupName；loose 为未分组。可指定从 0 开始的位置。保留收藏、备注和探测资料，先确认再保存。',
      { ...object({ moves: rows({ ...object({ serverId: text('服务器 ID。'), groupId: text('已有类别 ID，或 loose。'),
        groupName: { ...text('新建或复用的自定义类别名称。'), maxLength: 40 }, index: { type: 'integer', minimum: 0 } }), required: ['serverId'] }) }), required: ['moves'] }),
    write('server_category', 'category', '新建、重命名、排序或删除自定义类别。删除默认保留服务器并移回未分组；用户明确要求连服务器一起移除时才传 removeServers: true，由独立确认标题列明影响。',
      { ...object({ action: { type: 'string', enum: ['create', 'rename', 'delete', 'reorder'] }, id: text('已有类别 ID。'),
        name: { ...text('类别名称，例如战役、对抗、死门。'), maxLength: 40 }, serverIds: ids('新建类别时可一并收纳的服务器 ID。'),
        groupIds: ids('全部自定义类别 ID，按希望的顺序排列。'), removeServers: { type: 'boolean', description: '删除类别时同时移除其中服务器，默认 false。' } }), required: ['action'] }),
    write('server_remove', 'remove', '按真实 ID 从 Matcha 列表移除服务器，预览名称、地址、收藏和类别影响，由用户确认。查询超时的条目按用户选择处理。',
      { ...object({ serverIds: ids('选中的服务器 ID。') }), required: ['serverIds'] }),
    read('server_connection', '查看服务器连接指引', '刷新一个已保存服务器，返回实际连接命令、端口依据、当前启动方式与方案。游戏运行时提供控制台命令，启动连接由用户在服务器页确认。',
      'server-connection', { ...object({ serverId: text('清单返回的服务器 ID。') }), required: ['serverId'] }),
  ];
}
