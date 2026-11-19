// 茶茶的确认方式（设置 › 工具与权限）：
//   auto = 自主（默认）：只读、能撤销、留了备份的操作直接做；删了找不回、执行第三方程序、联网下载、
//          动系统设置、安全检查有疑点的，照常弹确认。
//   full = 完全访问：常规操作、已授权的本机文档和 Matcha 登记直接处理。
//   ask  = 每次都问：所有改动都先弹确认（以前的做法）。
// 设置存在 pi 配置目录的 matcha-permissions.json，扩展每次确认前现读，改了马上生效、不用重连。
import fs from 'node:fs';
import path from 'node:path';

export const CONFIRM_MODES = ['auto', 'ask', 'full'];
export const DEFAULT_MODE = 'auto';
const FILE = 'matcha-permissions.json';

const file = dir => path.join(dir, FILE);
export function readPermissions(dir = process.env.PI_CODING_AGENT_DIR) {
  // 不知道配置目录就读不到玩家的选择，按最保守的来；桌面版启动茶茶时总会给这个目录
  if (!dir) return { mode: 'ask' };
  try {
    const mode = JSON.parse(fs.readFileSync(file(dir), 'utf8')).mode;
    return { mode: CONFIRM_MODES.includes(mode) ? mode : DEFAULT_MODE };
  } catch { return { mode: DEFAULT_MODE }; }
}
export async function savePermissions(dir, patch) {
  const mode = patch?.mode;
  if (!CONFIRM_MODES.includes(mode)) throw Object.assign(new Error('未知确认方式。'), { code: 'invalid_argument' });
  await fs.promises.mkdir(dir, { recursive: true });
  const temp = `${file(dir)}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, JSON.stringify({ mode }, null, 2));
  await fs.promises.rename(temp, file(dir));
  return { mode };
}

/**
 * 统一的确认入口。risk：'routine' 只读/可撤销/有备份；'ask' 必须问玩家。
 * 自主模式下 routine 直接放行（返回 true），其余照常 ctx.ui.confirm。
 */
export async function confirmAction(ctx, title, message, { signal, risk = 'ask' } = {}) {
  const { mode } = readPermissions();
  if ((risk === 'routine' && mode !== 'ask') || (risk === 'managed' && mode === 'full')) return true;
  return ctx.ui.confirm(title, message, { signal });
}

// ---------------- 本机命令的风险判断 ----------------
// 只做保守的排除法：命中任何一条就要问。判断不了的也问，宁可多问一次。
// 语句开头：行首、; | { ( = && || 之后。短别名只在这里算数，免得把 Start-Sleep、yyyy-MM-dd 当成命令
const AT = String.raw`(?:^|[;|{(\n=]|&&|\|\|)\s*`;
const head = names => new RegExp(AT + String.raw`(?:${names})(?:\.exe)?(?=\s|$|[;|)}])`, 'im');
const ALWAYS = [
  // 执行别的程序或脚本：作者的安装脚本、exe、bat 都算第三方代码
  [/(?<![&>])&(?![&\d])/, '执行脚本或程序'],
  [new RegExp(AT + String.raw`\.\s+['"$\w\\/]`, 'm'), '执行脚本或程序'],
  [new RegExp(AT + String.raw`['"]?\.{0,2}[\\/]?(?:[a-z]:)?[^\s;|'"]*\.(?:exe|bat|cmd|ps1|vbs|js|msi|com|scr|sh)['"]?(?=\s|$|[;|)}])`, 'im'), '执行脚本或程序'],
  [new RegExp(AT + String.raw`\.{1,2}[\\/]`, 'm'), '执行脚本或程序'],
  [/\b(?:powershell(?:\.exe)?|pwsh|wscript|cscript|mshta|rundll32|regsvr32|msiexec|start-process|invoke-expression|invoke-command|start-job|invoke-item|add-type)\b|\bcmd(?:\.exe)?\s+\/[ck]\b|\[scriptblock\]|\.invoke\s*\(|\s-enc(?:odedcommand)?\s/i, '执行脚本或程序'],
  [head('iex|icm|saps|start|ii|sh|bash|zsh|eval|exec|source|nohup|xargs|sudo|runas'), '执行脚本或程序'],
  // 删除或清空
  [/\b(?:remove-item|clear-content|clear-item|clear-recyclebin|remove-itemproperty)\b|::\s*delete\s*\(/i, '删除文件'],
  [head('ri|rm|del|erase|rd|rmdir|clc|shred|unlink|truncate'), '删除文件'],
  // 系统、注册表、服务、安全设置、进程
  [/\b(?:set-itemproperty|new-itemproperty|set-executionpolicy|register-scheduledtask|new-scheduledtask|new-service|set-service|stop-service|restart-service|format-volume|add-mppreference|set-mppreference|remove-mppreference|stop-process|restart-computer|stop-computer|new-psdrive|set-acl)\b/i, '改系统设置或进程'],
  [head('reg|regedit|schtasks|netsh|bcdedit|takeown|icacls|cacls|attrib|cipher|vssadmin|wmic|diskpart|kill|taskkill|pkill|shutdown|reboot|logoff|setx|mklink|chmod|chown|mkfs|dd'), '改系统设置或进程'],
  [/\bhk(?:lm|cu|cr|u|cc):|hkey_|registry::|\[environment\]::setenvironmentvariable|-itemtype\s+['"]?(?:symboliclink|junction|hardlink)|-verb\s+['"]?runas|\bsc(?:\.exe)?\s+(?:create|config|delete|start|stop)\b/i, '改系统设置或进程'],
  // 联网
  [/\b(?:invoke-webrequest|invoke-restmethod|start-bitstransfer|bitsadmin|certutil)\b|net\.webclient|downloadstring|downloadfile|system\.net\.(?:http|sockets)/i, '联网下载或上传'],
  [head('iwr|irm|curl|wget|ftp|scp|ssh'), '联网下载或上传'],
];
// 写入动词 + 系统目录才算危险；只读查看 Steam、Program Files 很常见，直接放行
const WRITES = /\b(?:set-content|add-content|out-file|new-item|ni|copy-item|cpi|copy|cp|move-item|mi|move|mv|rename-item|rni|ren|expand-archive|compress-archive|tee-object|tee)\b|>>?|::\s*(?:write|append|copy|move|create)/i;
const SYSTEM_PATHS = /[a-z]:[\\/](?:windows|program files|programdata)\b|\\system32\b|\$env:(?:windir|systemroot|programfiles|programdata|commonprogramfiles)|%(?:windir|systemroot|programfiles|programdata)%|\/(?:etc|usr|bin|sbin|boot|sys|proc)\//i;

export function shellRisk(command) {
  const text = String(command ?? '');
  if (!text.trim()) return { risk: 'ask', reason: '空命令' };
  for (const [pattern, reason] of ALWAYS) if (pattern.test(text)) return { risk: 'ask', reason };
  if (WRITES.test(text) && SYSTEM_PATHS.test(text)) return { risk: 'ask', reason: '写入系统目录' };
  return { risk: 'routine', reason: '' };
}

// ---------------- 本机文件的风险判断 ----------------
// 读：只有登录凭据、密钥这类敏感位置要问。写：只在游戏目录、下载目录和茶茶工作目录里直接写。
const SENSITIVE = /[\\/]\.(?:ssh|gnupg|aws|azure|docker|kube)[\\/]|[\\/](?:login data|cookies|web data|local state|key[34]\.db|logins\.json|cert[89]\.db)$|[\\/]microsoft[\\/](?:credentials|protect|vault)[\\/]|\.(?:pem|key|pfx|p12|kdbx)$|(?:^|[\\/])\.env(?:\.[^\\/]*)?$|[\\/]pi[\\/]auth\.json$/i;
const inside = (file, root) => {
  if (!root) return false;
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
export function fileRisk(file, { write = false, gameRoot = process.env.L4P_GAME_ROOT, workspace = process.cwd(), home = process.env.USERPROFILE } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return { risk: 'ask', reason: '路径不完整' };
  if (SENSITIVE.test(file)) return { risk: 'ask', reason: '敏感文件' };
  if (!write) return { risk: 'routine', reason: '' };
  const roots = [gameRoot, workspace, home && path.join(home, 'Downloads')];
  if (roots.some(r => inside(file, r))) return { risk: 'routine', reason: '' };
  if (home && /\.(?:txt|csv|md)$/i.test(file) && ['Desktop','Documents'].some(d => inside(file,path.join(home,d))))
    return { risk:'managed', reason:'写入玩家文档' };
  return { risk:'ask', reason:'写到游戏和下载目录以外' };
}
