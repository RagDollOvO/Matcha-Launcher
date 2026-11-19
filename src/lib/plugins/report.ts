// Optional action result format. All text is rendered as text; old JSON results stay usable.
export interface ReportItem { label: string; value: number | string | null; format?: 'number' | 'duration' | 'percent'; unit?: string; key?: string }
export interface ReportSection { title: string; layout: 'metrics' | 'list'; note?: string; collapsed?: boolean; items: ReportItem[] }
export interface PluginReport { format: 'flare.report.v1'; title: string; summary: string; refreshedAt?: string; sections: ReportSection[] }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
export function pluginReport(value: unknown): PluginReport | null {
  if (!object(value) || value.format !== 'flare.report.v1' || !text(value.title,160) || !text(value.summary,1000)) return null;
  if (value.refreshedAt !== undefined && (!text(value.refreshedAt,64) || !Number.isFinite(Date.parse(value.refreshedAt as string)))) return null;
  if (!Array.isArray(value.sections) || value.sections.length > 12) return null;
  for (const s of value.sections) {
    if (!object(s) || !text(s.title,160) || !['metrics','list'].includes(s.layout as string) || (s.note !== undefined && !text(s.note,1000)) || (s.collapsed !== undefined && typeof s.collapsed !== 'boolean') || !Array.isArray(s.items) || s.items.length > 128) return null;
    for (const i of s.items) {
      if (!object(i) || !text(i.label,160) || !(i.value === null || text(i.value,256) || typeof i.value === 'number' && Number.isFinite(i.value)) || (i.format !== undefined && (!['number','duration','percent'].includes(i.format as string) || typeof i.value === 'string')) || (i.unit !== undefined && !text(i.unit,40)) || (i.key !== undefined && !text(i.key,240))) return null;
      if (i.format === 'duration' && i.value !== null && (!Number.isSafeInteger(i.value) || (i.value as number) < 0)) return null;
    }
  }
  return value as unknown as PluginReport;
}
export function reportValue(item: ReportItem): string {
  if (item.value === null) return '—';
  if (typeof item.value === 'string') return item.value;
  if (item.format === 'duration') {
    const v = item.value;
    return `${Math.floor(v / 3600).toLocaleString('zh-CN')} 小时 ${Math.floor(v / 60) % 60} 分 ${v % 60} 秒`;
  }
  return item.value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + (item.format === 'percent' ? '%' : '');
}
