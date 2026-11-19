// 功能详情页的「内容块」：开发者在 manifest.presentation.page 里按顺序排列，前端逐块渲染。
// 只接受声明式数据：文字一律按文本渲染，图片只读包内相对路径，外链只收 https。
// 不认识或填错的块直接跳过，不影响其余内容。
import type { PlatformPlugin } from '../types';
import { splitKeys } from './rich-text';

export type Aspect = '16:9' | '4:3' | '1:1' | '21:9' | '3:2' | '9:16' | 'auto';
export interface Media { src: string; caption?: string }
export type PageBlock =
  | { type: 'heading'; text: string; eyebrow?: string }
  | { type: 'text'; text: string }
  | { type: 'image'; src: string; caption?: string; aspect: Aspect; wide: boolean }
  | { type: 'gallery'; title?: string; items: Media[]; aspect: Aspect; columns: 2 | 3 | 4 }
  | { type: 'compare'; before: Media & { label: string }; after: Media & { label: string }; caption?: string; aspect: Aspect }
  | { type: 'hotkeys'; title?: string; items: { keys: string[]; label: string }[] }
  | { type: 'steps'; title?: string; items: { title: string; text?: string; image?: string }[] }
  | { type: 'callout'; tone: 'info' | 'tip' | 'warning'; title?: string; text: string }
  | { type: 'specs'; title?: string; rows: { label: string; value: string }[] }
  | { type: 'changelog'; title?: string; items: { version: string; date?: string; notes: string[] }[] }
  | { type: 'links'; title?: string; items: { label: string; url: string; note?: string }[] }
  | { type: 'credits'; title?: string; items: { name: string; role?: string }[] }
  | { type: 'video'; url: string; title?: string; poster?: string; note?: string }
  | { type: 'divider' };

export interface PageHero { layout: 'split' | 'banner' | 'poster' | 'minimal'; image?: string; accent?: string; tagline?: string }

const LIMIT = { blocks: 40, items: 24, text: 12000, line: 200, short: 80 };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown) => Array.isArray(v) ? v.slice(0, LIMIT.items) : [];
function str(v: unknown, max = LIMIT.line): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s && [...s].length <= max ? s : undefined;
}
// 与后端封面规则一致：包内相对路径，无 .. / 盘符 / 反斜杠，常见图片格式。
export function assetPath(v: unknown): string | undefined {
  const s = str(v, 240);
  if (!s || !/\.(png|jpe?g|webp|gif)$/i.test(s) || s.startsWith('/') || s.includes('\\') || /^[a-z]+:/i.test(s)) return undefined;
  return s.split('/').every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*\x00-\x1f]|[ .]$/.test(part)) ? s : undefined;
}
export function httpsUrl(v: unknown): string | undefined {
  const s = str(v, 400);
  if (!s) return undefined;
  try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
}
const aspect = (v: unknown, fallback: Aspect): Aspect => (['16:9', '4:3', '1:1', '21:9', '3:2', '9:16', 'auto'] as const).find(a => a === v) ?? fallback;
const media = (v: unknown): Media | undefined => {
  if (typeof v === 'string') { const src = assetPath(v); return src ? { src } : undefined; }
  if (!object(v)) return undefined;
  const src = assetPath(v.src);
  return src ? { src, caption: str(v.caption) } : undefined;
};

function block(raw: unknown): PageBlock | undefined {
  if (!object(raw)) return undefined;
  const title = str(raw.title, LIMIT.short);
  switch (raw.type) {
    case 'heading': { const text = str(raw.text, LIMIT.short); return text ? { type: 'heading', text, eyebrow: str(raw.eyebrow, 40) } : undefined; }
    case 'text': { const text = str(raw.text, LIMIT.text); return text ? { type: 'text', text } : undefined; }
    case 'image': { const m = media(raw); return m ? { type: 'image', ...m, aspect: aspect(raw.aspect, 'auto'), wide: raw.wide === true } : undefined; }
    case 'gallery': {
      const items = list(raw.items).map(media).filter((m): m is Media => !!m);
      const columns = raw.columns === 2 || raw.columns === 4 ? raw.columns : 3;
      return items.length ? { type: 'gallery', title, items, aspect: aspect(raw.aspect, '16:9'), columns } : undefined;
    }
    case 'compare': {
      const before = media(raw.before), after = media(raw.after);
      if (!before || !after) return undefined;
      const label = (v: unknown, fallback: string) => object(v) ? str(v.label, 24) ?? fallback : fallback;
      return { type: 'compare', before: { ...before, label: label(raw.before, '之前') }, after: { ...after, label: label(raw.after, '之后') }, caption: str(raw.caption), aspect: aspect(raw.aspect, '16:9') };
    }
    case 'hotkeys': {
      const items = list(raw.items).flatMap(i => {
        if (!object(i)) return [];
        const keys = str(i.keys, 40), label = str(i.label, LIMIT.short);
        const parts = keys ? splitKeys(keys) : [];
        return label && parts.length && parts.length <= 4 ? [{ keys: parts, label }] : [];
      });
      return items.length ? { type: 'hotkeys', title, items } : undefined;
    }
    case 'steps': {
      const items = list(raw.items).flatMap(i => {
        if (typeof i === 'string') { const t = str(i); return t ? [{ title: t }] : []; }
        if (!object(i)) return [];
        const t = str(i.title, LIMIT.short);
        return t ? [{ title: t, text: str(i.text, 2000), image: assetPath(i.image) }] : [];
      });
      return items.length ? { type: 'steps', title, items } : undefined;
    }
    case 'callout': {
      const text = str(raw.text, 2000);
      const tone = raw.tone === 'tip' || raw.tone === 'warning' ? raw.tone : 'info';
      return text ? { type: 'callout', tone, title, text } : undefined;
    }
    case 'specs': {
      const rows = list(raw.rows).flatMap(r => {
        if (Array.isArray(r)) { const [l, v] = [str(r[0], 40), str(r[1])]; return l && v ? [{ label: l, value: v }] : []; }
        if (!object(r)) return [];
        const l = str(r.label, 40), v = str(r.value);
        return l && v ? [{ label: l, value: v }] : [];
      });
      return rows.length ? { type: 'specs', title, rows } : undefined;
    }
    case 'changelog': {
      const items = list(raw.items).flatMap(i => {
        if (!object(i)) return [];
        const version = str(i.version, 32), notes = list(i.notes).map(n => str(n, 400)).filter((n): n is string => !!n);
        return version && notes.length ? [{ version, date: str(i.date, 32), notes }] : [];
      });
      return items.length ? { type: 'changelog', title, items } : undefined;
    }
    case 'links': {
      const items = list(raw.items).flatMap(i => {
        if (!object(i)) return [];
        const url = httpsUrl(i.url), label = str(i.label, LIMIT.short);
        return url && label ? [{ label, url, note: str(i.note) }] : [];
      });
      return items.length ? { type: 'links', title, items } : undefined;
    }
    case 'credits': {
      const items = list(raw.items).flatMap(i => {
        if (typeof i === 'string') { const n = str(i, LIMIT.short); return n ? [{ name: n }] : []; }
        if (!object(i)) return [];
        const name = str(i.name, LIMIT.short);
        return name ? [{ name, role: str(i.role, LIMIT.short) }] : [];
      });
      return items.length ? { type: 'credits', title, items } : undefined;
    }
    case 'video': {
      const url = httpsUrl(raw.url);
      return url ? { type: 'video', url, title, poster: assetPath(raw.poster), note: str(raw.note) } : undefined;
    }
    case 'divider': return { type: 'divider' };
  }
  return undefined;
}

/** 没写 page 的旧包：用 description 生成一个文字块，显示效果与以前一致。 */
export function pageBlocks(p: PlatformPlugin): PageBlock[] {
  const raw = (p.presentation as { page?: unknown } | undefined)?.page;
  const links = block({ type: 'links', title: '相关链接', items: p.presentation?.links });
  if (Array.isArray(raw)) {
    const blocks = raw.slice(0, LIMIT.blocks).map(block).filter((b): b is PageBlock => !!b);
    if (blocks.length) return links && !blocks.some(b => b.type === 'links') ? [...blocks, links] : blocks;
  }
  const text = p.presentation?.description || p.description;
  return [...(text ? [{ type: 'text' as const, text }] : []), ...(links ? [links] : [])];
}

// 强调色只在开发者自己的详情页内生效；太暗的颜色在黑底上看不清，直接忽略。
function readableAccent(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = /^#([0-9a-f]{6})$/i.exec(s);
  if (!m) return undefined;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05 >= 4.5 ? s.toLowerCase() : undefined;
}
export function pageHero(p: PlatformPlugin): PageHero {
  const raw = (p.presentation as { hero?: unknown } | undefined)?.hero;
  if (!object(raw)) return { layout: 'split' };
  const layout = raw.layout === 'banner' || raw.layout === 'poster' || raw.layout === 'minimal' ? raw.layout : 'split';
  return { layout, image: assetPath(raw.image), accent: readableAccent(raw.accent), tagline: str(raw.tagline, 60) };
}
