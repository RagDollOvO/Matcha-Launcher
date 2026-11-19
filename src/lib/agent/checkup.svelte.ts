// 体检：第一次给茶茶接上模型后，让它把游戏目录、启动项、CFG、各宿主的 DLL 模组和 VPK 冲突过一遍，只读出报告。
// 能力按后端实际情况走（交接见 docs/agent-checkup-handoff.md）：
// - 加载了 matcha-checkup 技能 → 发 /skill:matcha-checkup，检查顺序和报告格式由技能决定；
// - 有 game_config_inspect 工具 → 指令里让茶茶自己读启动项、Steam 启动选项和 cfg 目录；
// - 都没有 → 把 Matcha 已保存的启动参数和管理段 CFG 附在指令里，读不到的部分让茶茶标「未检查」。
// 拼指令要读游戏设置，只能在主窗口里做（助手窗口的桥只放行 pi-* 命令）；助手窗口里点按钮时转给主窗口。
import { agent } from './index';
import { piHost } from './host';
import { isAgentView, sendToMain } from './window.svelte';
import { app } from '../stores/app.svelte';
import { gameSettings } from '../stores/game-settings.svelte';
import { modeLabel } from '../launch-modes';

const KEY = 'flare.checkup';
/** done：做过一次；later：玩家点了「以后再说」。两种都不再主动弹首见卡片 */
type Mark = '' | 'done' | 'later';
const read = (): Mark => { try { const v = localStorage.getItem(KEY); return v === 'done' || v === 'later' ? v : ''; } catch { return ''; } };

export const checkup = $state<{ mark: Mark; starting: boolean }>({ mark: read(), starting: false });

function mark(v: Exclude<Mark, ''>) {
  checkup.mark = v;
  try { localStorage.setItem(KEY, v); } catch { /* 读不到存储时只在本次有效 */ }
}
export const laterCheckup = () => mark('later');

// 两个窗口共用 localStorage：主窗口开始体检后，助手窗口的首见卡片跟着收起
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) checkup.mark = read(); });

const CFG_LIMIT = 6000;
const SKILL = 'matcha-checkup';

/** 后端提供了什么：技能和工具都查不到时按最小能力走 */
async function probe(): Promise<{ skill: boolean; configTool: boolean }> {
  const [tools, commands] = await Promise.all([
    piHost.tools().then((r) => (r.ok ? r.value.tools.filter((t) => t.enabled).map((t) => t.name) : [])),
    agent.connected
      ? agent.query<{ commands?: { name?: string }[] }>('get_commands').then((r) => (r?.commands ?? []).map((c) => c.name ?? ''), () => [] as string[])
      : Promise.resolve([] as string[]),
  ]);
  return { skill: commands.some((n) => n === `skill:${SKILL}` || n === SKILL), configTool: tools.includes('game_config_inspect') };
}

/** 没有 game_config_inspect 时，把页面手里的启动设置写成一段资料 */
async function snapshot(): Promise<string> {
  try { await gameSettings.load(); } catch { /* 读不到就用当前内存里的值 */ }
  const mode = app.launchConfig.mode;
  const extra = gameSettings.value.extraArgs.trim();
  const cfg = gameSettings.cfgText().trim();
  const managed = gameSettings.value.autoexec.enabled;
  const lines = [
    '以下是 Matcha 现在保存的启动设置（发送时读取）：',
    `- 当前启动方式：${modeLabel(mode)}`,
    `- L4N 平台启动的最终参数：${gameSettings.args('modded').join(' ') || '（无）'}`,
    `- 纯净对抗的最终参数：${gameSettings.args('clean').join(' ') || '（无）'}`,
    `- 玩家自己加的启动项：${extra || '（无）'}`,
    `- autoexec.cfg：${gameSettings.autoexecPath || '（路径待游戏目录确定）'}，Matcha 管理段${managed ? '已开启' : '未开启'}`,
  ];
  if (cfg) {
    const cut = cfg.length > CFG_LIMIT ? cfg.slice(0, CFG_LIMIT) + '\n// ……（后面还有，已截断）' : cfg;
    lines.push('- Matcha 管理段内容：', '```cfg', cut, '```');
  } else lines.push('- Matcha 管理段内容：（空）');
  lines.push('Steam 库里填的启动选项、autoexec.cfg 管理段以外的内容和 cfg 目录里的其它文件我这边读不到，这几项请在报告里标「未检查」，不要猜。');
  return lines.join('\n');
}

export async function checkupPrompt(): Promise<string> {
  const { skill, configTool } = await probe();
  if (skill) return `/skill:${SKILL} 首次接入体检`;
  const game = app.ready && app.game?.installed;
  const steps = [
    '1. 游戏目录与平台：用 platform_inspect 看目录、游戏版本、Matcha 加载器和 Runtime 状态。',
    '2. DLL 模组：用 dll_inventory 看每个 Matcha 模组、L4N 子插件和整体加载的 DLL：启停、加载状态和失败原因、安全筛查结果、宿主对不对得上，依赖的 L4N / DXVK 有没有装、版本合不合适，有没有两个东西抢同一个入口（比如 d3d9.dll）。',
    configTool
      ? '3. 启动项：用 game_config_inspect 读实际启动参数（包括 Steam 库里填的启动选项），找重复、互相冲突、已经失效或和当前启动方式不搭的参数。'
      : '3. 启动项：看下面附的启动参数，找重复、互相冲突、已经失效或和当前启动方式不搭的参数。',
    configTool
      ? '4. CFG：用 game_config_inspect 读 cfg 目录（autoexec.cfg 全文、Matcha 管理段和其它 cfg），找写错的命令、超范围的值、和启动项重复设置的地方。'
      : '4. CFG：看下面附的 Matcha 管理段，找写错的命令、超范围的值、和启动项重复设置的地方。',
    '5. VPK Mod：用 mod_inventory 看已启用的 Mod 有没有资源冲突。',
  ];
  const head = game
    ? '第一次见面，帮我给游戏做个体检。这一轮只读检查，先别改任何东西。'
    : '第一次见面，帮我做个体检。还没选好游戏目录，能查的先查，查不了的告诉我缺什么。这一轮只读检查，先别改任何东西。';
  const tail = '报告先给一句总体结论，再按「需要处理 / 建议留意 / 正常」分组，每条写依据和建议怎么改。要改的先列清单，等我同意后再动手，改动走确认。';
  const parts = [head, '请依次看：\n' + steps.join('\n'), tail];
  if (!configTool) parts.push(await snapshot());
  return parts.join('\n\n');
}

/** 开始体检。助手窗口里调用时转给主窗口去拼指令 */
export async function startCheckup(): Promise<'sent' | 'drafted' | 'forwarded'> {
  mark('done');
  if (isAgentView) { void sendToMain({ type: 'checkup' }); return 'forwarded'; }
  if (checkup.starting) return 'sent';
  checkup.starting = true;
  try {
    const { askAgent } = await import('../plugins/intake');
    return askAgent(await checkupPrompt());
  } finally { checkup.starting = false; }
}
