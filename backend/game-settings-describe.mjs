// 启动项字段的中文名和取值说明：茶茶改设置的预览、确认框和「导入已有参数」共用。
export const LAUNCH_FIELDS = {
  'display.mode': '窗口模式', 'display.width': '分辨率宽', 'display.height': '分辨率高', 'display.refreshHz': '刷新率',
  fpsMax: '帧率上限', novid: '跳过开场动画', console: '开局打开控制台', lowViolence: '低血腥度',
  consoleLog: '控制台输出写入 console.log', highPriority: '高优先级', extraArgs: '自定义启动项', 'autoexec.enabled': '写入 autoexec.cfg 管理段',
};
const MODE_NAMES = { default: '默认', fullscreen: '全屏', windowed: '窗口', noborder: '无边框' };

const get = (v, field) => field.split('.').reduce((o, k) => o?.[k], v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function describe(field, value) {
  if (value === null || value === undefined) return field === 'fpsMax' ? '不加' : '自动';
  if (typeof value === 'boolean') return value ? '开' : '关';
  if (field === 'display.mode') return MODE_NAMES[value] ?? value;
  if (field === 'fpsMax' && value === 0) return '不限制';
  if (value === '') return '（空）';
  return String(value);
}

/** 改前 → 改后，只列变了的字段 */
export function launchChanges(before, next) {
  return Object.keys(LAUNCH_FIELDS).map(field => ({ field, label: LAUNCH_FIELDS[field], before: get(before, field), after: get(next, field) }))
    .filter(c => !same(c.before, c.after)).map(c => ({ ...c, beforeText: describe(c.field, c.before), afterText: describe(c.field, c.after) }));
}
