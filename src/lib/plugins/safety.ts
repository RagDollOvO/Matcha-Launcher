// 危险筛查的展示规则：四档徽标、发现分组、给茶茶的解释指令。
// 措辞约定（2026-11-16 定）：不写「无病毒」，静态检查证明不了；写「未发现问题」，并带上检查日期和规则版本。
import type { DllFinding, DllScreening, PlatformPlugin, TrustTier } from '../types';

/** 徽标档位：有筛查结果用筛查的；没有时按签名核验退回「已拦截 / 未核验」 */
export function trustTier(p: Pick<PlatformPlugin, 'screening' | 'verification'>): TrustTier {
  if (p.screening) return p.screening.tier;
  return p.verification?.state === 'rejected' ? 'blocked' : 'unverified';
}

export const TIER_TEXT: Record<TrustTier, string> = { verified: '已核验', closed: '闭源 · 未发现问题', unverified: '未核验', blocked: '已拦截' };

/** 一句话结论 */
export function screeningLine(s: DllScreening): string {
  const block = s.findings.filter(f => f.severity === 'block').length;
  const review = s.findings.filter(f => f.severity === 'review').length;
  if (s.tier === 'blocked') return block ? `命中 ${block} 项禁止行为，已拦下` : '核验没通过，已拦下';
  if (review) return `发现 ${review} 项敏感能力，值得看一眼`;
  return s.tier === 'verified' ? '源码公开、签名有效，审核通过' : '静态检查未发现问题';
}

export const SEVERITY_TEXT: Record<DllFinding['severity'], string> = { block: '拦截', review: '要留意', info: '说明' };
export const CATEGORY_TEXT: Record<DllFinding['category'], string> = {
  injection: '注入其他进程', network: '联网', process: '启动外部程序', credential: '读取账号或密码',
  'input-hook': '全局键盘鼠标钩子', memory: '修改内存', packed: '加壳或混淆', signature: '签名',
  reputation: '指纹信誉', other: '其他',
};

/** 按严重程度排：拦截在前 */
export const sortedFindings = (s: DllScreening) =>
  [...s.findings].sort((a, b) => ['block', 'review', 'info'].indexOf(a.severity) - ['block', 'review', 'info'].indexOf(b.severity));

const date = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? iso : d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }); };
/** 范围和时效：只是静态检查，结论只对这一版规则有效 */
export const screeningScope = (s: DllScreening) => `静态检查，没有运行这个 DLL · 规则 v${s.rulesVersion} · ${date(s.checkedAt)}`;

/** 确认框里的「安全检查」一行和发现清单 */
export function screeningConfirm(s: DllScreening | undefined) {
  if (!s) return { fact: { label: '安全检查', value: '这个版本还没有危险筛查' }, list: null };
  const fact = { label: '安全检查', value: `${TIER_TEXT[s.tier]} · ${screeningLine(s)}`, danger: s.tier === 'blocked' || s.findings.some(f => f.severity === 'review') };
  const rows = sortedFindings(s).filter(f => f.severity !== 'info').map(f => ({ k: `${SEVERITY_TEXT[f.severity]} · ${CATEGORY_TEXT[f.category]}`, v: f.title + (f.detail ? `（${f.detail}）` : '') }));
  return { fact, list: rows.length ? { title: `安全检查发现 · ${rows.length}`, rows } : null };
}

/** 让茶茶用大白话解释筛查结果 */
export function screeningPrompt(p: Pick<PlatformPlugin, 'id' | 'name'>, s: DllScreening): string {
  return `用大白话给我讲讲「${p.name}」（${p.id}）的危险筛查结果：结论是「${TIER_TEXT[s.tier]}」，规则 v${s.rulesVersion}。`
    + `先用 dll_inventory 查这个模组，再结合作者说明，逐条说每项发现意味着什么、作者有没有给出合理用途、我该怎么决定。`
    + `只是静态检查，不要说成「没有病毒」；拿不准的就说拿不准。不要改文件或开关。`;
}
