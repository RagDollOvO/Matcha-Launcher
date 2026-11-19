// 「添加来源」：玩家给 GitHub / 创意工坊 / 本地文件，由 Agent 拉取并整理成 Matcha 的展示资料。
// 前端只负责收集来源、生成指令、展示结果；拉取、暂存、写补充资料由 Agent 的平台工具完成。
import { agent } from '../agent';
import { app } from '../stores/app.svelte';
import { agentWin, sendToAgent } from '../agent/window.svelte';
import type { FieldOrigin, PlatformPlugin, PluginSource, ProvenanceField } from '../types';

export type SourceKind = PluginSource['type'];
export const SOURCE_LABEL: Record<SourceKind, string> = { github: 'GitHub', workshop: '创意工坊', local: '本地文件' };

export function parseGithub(input: string): { repo: string; url: string } | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:[/?#].*)?$/i.exec(input.trim());
  if (!m || m[2] === '.' || m[2] === '..') return null;
  const repo = `${m[1]}/${m[2].replace(/\.git$/i, '')}`;
  return { repo, url: input.trim().startsWith('http') ? input.trim() : `https://${input.trim()}` };
}
export function parseWorkshop(input: string): { id: string; url: string } | null {
  const s = input.trim();
  const id = /^\d{6,12}$/.test(s) ? s : /^(?:https?:\/\/)?steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/?\?(?:[^#]*&)?id=(\d{6,12})/i.exec(s)?.[1];
  return id ? { id, url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}` } : null;
}

const RULES = [
  '要求：',
  '1. 读取来源里的 manifest.json、README、发布说明和图片，先告诉我找到了什么。',
  '2. 已经有完整 Matcha 展示资料（presentation.page 等）的，原样使用，不改写。',
  '3. 资料不完整的，只补简单字段：名称、作者、一句话简介（160 字内）、说明、标签（最多 8 个）、适用模式、快捷键、来源链接、封面。',
  '4. 补充的内容单独保存为 Agent 整理资料，并注明依据；不要修改作者的文件。',
  '5. 不确定的字段留空，不要编造。',
  '6. 导入前先给我看要导入的文件清单和整理结果，等我确认。',
].join('\n');

export function intakePrompt(kind: SourceKind, value: string): string {
  const head = kind === 'github' ? `把这个 GitHub 来源接入 Matcha 的 DLL 模组：${value}`
    : kind === 'workshop' ? `把这个创意工坊物品接入 Matcha 的 DLL 模组：${value}`
    : `把这个本地文件接入 Matcha 的 DLL 模组：${value}`;
  return `${head}\n\n${RULES}`;
}
const sourceLine = (p: PlatformPlugin) =>
  `来源：${p.source?.url ?? p.source?.label ?? '（未记录来源）'}\n当前版本 v${p.version}${p.source?.version ? `，接入时来源版本 ${p.source.version}` : ''}。`;
export function checkPrompt(p: PlatformPlugin): string {
  return `检查「${p.name}」（${p.id}）的来源有没有新版本。\n${sourceLine(p)}\n用 dll_source_record 按已登记的来源重新读取并记录结果，再告诉我有什么变化。只检查和记录，不要下载或替换文件。`;
}
export function changesPrompt(p: PlatformPlugin): string {
  const latest = p.source?.latest?.version ?? p.source?.latest?.publishedAt ?? '最新版本';
  return `「${p.name}」（${p.id}）的来源有新版本 ${latest}。\n${sourceLine(p)}\n用 dll_source_fetch（refresh: true）读取发布说明和附件，告诉我这次改了什么、附件是不是标准 Matcha SDK 包、作者和仓库有没有变化。先不要下载，等我决定。`;
}
export function refillPrompt(p: PlatformPlugin): string {
  return `重新整理「${p.name}」（${p.id}）的展示资料${p.source?.url ? `，来源：${p.source.url}` : ''}。\n\n${RULES}`;
}

/** 交给 Agent：能发就直接发，否则打开面板把指令放进输入框。 */
export function askAgent(text: string): 'sent' | 'drafted' {
  app.agentOpen = true;
  // 助手在独立窗口里：把指令送过去，由那边发送（没连上就放进它的输入框）
  if (agentWin.mode === 'window') { void sendToAgent({ type: 'send', text }); return 'sent'; }
  if (agent.send(text)) return 'sent';
  agent.draft = text;
  return 'drafted';
}

export const originOf = (p: PlatformPlugin, field: ProvenanceField): FieldOrigin => p.provenance?.fields[field] ?? 'developer';
export function provenanceSummary(p: PlatformPlugin): { kind: 'developer' | 'agent' | 'mixed' | 'user'; label: string; hasAgent: boolean; hasUser: boolean } {
  const origins = Object.values(p.provenance?.fields ?? {});
  const hasAgent = origins.includes('agent'), hasUser = origins.includes('user');
  if (!hasAgent) return { kind: hasUser ? 'user' : 'developer', label: hasUser ? '手动修改' : '开发者提供', hasAgent, hasUser };
  const basis = p.provenance?.basis ? ` · ${p.provenance.basis}` : '';
  const manual = hasUser ? ' · 含手动修改' : '';
  return !origins.includes('developer') && !p.presentation?.page
    ? { kind: 'agent', label: `茶茶整理${manual}${basis}`, hasAgent, hasUser }
    : { kind: 'mixed', label: `部分由茶茶补充${manual}${basis}`, hasAgent, hasUser };
}

// 宽松的版本比较：v1.6.0 / 1.6 / 1.6.0-beta.1
export function newerVersion(latest: string | undefined, current: string): boolean {
  if (!latest) return false;
  const parse = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map(x => /^\d+$/.test(x) ? Number(x) : x);
  const a = parse(latest), b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x > y;
    return typeof x === 'number'; // 1.6.0 > 1.6.0-beta
  }
  return false;
}
// GitHub 比版本号；创意工坊没有版本号，比接入时记录的更新时间（ISO 字符串）
export function sourceHasUpdate(p: PlatformPlugin): boolean {
  const latest = p.source?.latest;
  if (!latest) return false;
  if (latest.version) return newerVersion(latest.version, p.source?.version ?? p.version);
  return !!latest.publishedAt && !!p.source?.version && latest.publishedAt > p.source.version;
}
