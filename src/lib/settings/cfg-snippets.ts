import { assignments, replaceAssignment, appendSection as append } from '../../../backend/cfg-text.mjs';

export interface CfgSnippet { label: string; title: string; lines: string[] }

function glow(title: string, target: string, color: string, rgb: [number, number, number]): CfgSnippet {
  return { label: `${title} · ${color}`, title, lines: ['r', 'g', 'b'].map((channel, i) => `cl_glow_${target}_${channel} ${rgb[i]}`) };
}

export const snippetGroups: { label: string; items: CfgSnippet[] }[] = [
  { label: '画面', items: [
    glow('队友轮廓', 'survivor', '绿色', [0, 1, 0]),
    glow('已重生特感轮廓', 'infected', '白色', [1, 1, 1]),
    glow('灵魂态特感轮廓', 'ghost_infected', '白色', [1, 1, 1]),
    glow('近处物品轮廓', 'item', '红色', [1, 0, 0]),
    glow('远处物品轮廓', 'item_far', '绿色', [0, 1, 0]),
    { label: '静态准星 · 青色', title: '准星', lines: [
      'cl_crosshair_dynamic 0', 'cl_crosshair_thickness 4', 'cl_crosshair_alpha 255',
      'cl_crosshair_red 0', 'cl_crosshair_green 255', 'cl_crosshair_blue 255',
    ] },
  ] },
  { label: '网络', items: [
    { label: '帧率与网络信息', title: '帧率与网络信息', lines: [
      'net_graph 4', 'net_graphpos 1', 'net_graphproportionalfont 0', 'net_graphshowinterp 0', 'net_graphshowlatency 0',
    ] },
  ] },
];

// 直接赋值的读写和茶茶的 game_settings_update 共用 backend/cfg-text.mjs，规则只有一份。

/**
 * 直接改一组设置：已有的命令就地改值，缺的命令按界面上显示的值一起补到末尾，
 * 这样改一个通道时整组（例如 RGB 三项）都落进 CFG，不会只剩半组。
 */
export function applySnippet(text: string, snippet: CfgSnippet, values: Record<string, string>) {
  const rows = snippetRows(text, snippet);
  let out = text;
  for (const row of rows) if (row.present && values[row.key] !== undefined && values[row.key] !== row.value) out = replaceAssignment(out, row.key, values[row.key]);
  const missing = rows.filter(row => !row.present).map(row => `${row.key} ${values[row.key] ?? row.value}`);
  return missing.length ? append(out, snippet.title, missing) : out;
}

/** Show the last direct assignment from the draft, or the suggested value for a missing cvar. */
export function snippetRows(text: string, snippet: CfgSnippet) {
  const values = assignments(text);
  return snippet.lines.map(line => {
    const space = line.indexOf(' '), key = line.slice(0, space);
    const actual = values.get(key.toLowerCase());
    return { key, value: actual ?? line.slice(space + 1), present: actual !== undefined };
  });
}

/** Add missing cvars only; keep every existing command, comment and empty line in place. */
export function insertSnippet(text: string, snippet: CfgSnippet) {
  const rows = snippetRows(text, snippet);
  const missing = snippet.lines.filter((_, i) => !rows[i].present);
  const kept = snippet.lines.length - missing.length;
  if (!missing.length) return { text, added: 0, kept };
  return { text: append(text, snippet.title, missing), added: missing.length, kept };
}
