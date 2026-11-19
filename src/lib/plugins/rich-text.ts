// 开发者说明的轻量排版：段落、标题、列表、**粗体**、`代码`，正文里的按键组合渲染成键帽。
// 只产出数据，由组件逐个渲染，不拼 HTML。

export type Inline =
  | { kind: 'text' | 'strong' | 'code'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'keys'; keys: string[] };
export type Block =
  | { kind: 'p'; lines: Inline[][] }
  | { kind: 'h'; inline: Inline[] }
  | { kind: 'ul' | 'ol'; items: Inline[][] };

const KEY = '(?:Ctrl|Shift|Alt|Tab|Enter|Esc|Space|Backspace|Home|End|PgUp|PgDn|Insert|Delete|F(?:1[0-2]|[1-9]))';
// 单个功能键或「功能键 + 键」组合；前后不能紧贴字母数字，避免把 Altitude 读成 Alt。
const COMBO = new RegExp(`(?<![A-Za-z0-9])${KEY}(?:\\s*\\+\\s*(?:${KEY}|[A-Z0-9]))*(?![A-Za-z0-9])`, 'g');

export const splitKeys = (combo: string) => combo.split('+').map(k => k.trim()).filter(Boolean);

function keys(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of text.matchAll(COMBO)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    out.push({ kind: 'keys', keys: splitKeys(m[0]) });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  for (const part of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/)) {
    if (!part) continue;
    const link = /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
    if (link) out.push({ kind: 'link', text: link[1], url: link[2] });
    else if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) out.push({ kind: 'code', text: part.slice(1, -1) });
    else if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) out.push({ kind: 'strong', text: part.slice(2, -2) });
    else out.push(...keys(part));
  }
  return out;
}

export function parseRich(source: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] = [];
  let list: { kind: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const endPara = () => { if (para.length) blocks.push({ kind: 'p', lines: para }); para = []; };
  const endList = () => { if (list) blocks.push(list); list = null; };
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { endPara(); endList(); continue; }
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    const number = /^\s*\d+(?:[.)]\s+|、\s*)(.+)$/.exec(line);
    if (heading) { endPara(); endList(); blocks.push({ kind: 'h', inline: inline(heading[1]) }); }
    else if (bullet || number) {
      const kind = bullet ? 'ul' : 'ol';
      endPara();
      if (list && list.kind !== kind) endList();
      list ??= { kind, items: [] };
      list.items.push(inline((bullet ?? number)![1]));
    } else { endList(); para.push(inline(line)); }
  }
  endPara(); endList();
  return blocks;
}
