// CFG 文本的直接赋值读写，页面（src/lib/settings/cfg-snippets.ts）和茶茶的 game_settings_update 共用同一套规则：
// 只认 `cvar 值` / `cvar "值"` 这种直接赋值，绑键、别名和其它命令原样保留；改值时保留注释、引号风格和原换行。

/** 拆行（奇数下标是原换行），找出每一条直接赋值 */
function scan(text) {
  const parts = text.split(/(\r\n|\r|\n)/), found = [];
  for (let n = 0; n < parts.length; n += 2) {
    const line = parts[n];
    let quoted = false, start = 0;
    for (let i = 0; i <= line.length; i++) {
      const c = line[i];
      if (c === '"') { quoted = !quoted; continue; }
      const comment = !quoted && c === '/' && line[i + 1] === '/';
      if (i < line.length && !comment && (quoted || c !== ';')) continue;
      if (quoted) break; // unfinished line in the editor
      const raw = line.slice(start, i), lead = raw.length - raw.trimStart().length, body = raw.trim();
      const part = /^(?:"(\w+)"|(\w+))\s+(.+)$/.exec(body);
      if (part) {
        const q = /^"([^"]*)"$/.exec(part[3]);
        found.push({ line: n, start: start + lead, end: start + lead + body.length, key: (part[1] ?? part[2]).toLowerCase(), value: q?.[1] ?? part[3], quoted: !!q });
      }
      if (comment) break;
      start = i + 1;
    }
  }
  return { parts, found };
}

/** 每个 cvar 最后一次直接赋值的值（键小写） */
export function assignments(text) {
  return new Map(scan(text).found.map(a => [a.key, a.value]));
}

/** 改掉某个 cvar 最后一次直接赋值的值，其余字符（注释、绑键、换行）原样保留 */
export function replaceAssignment(text, key, value) {
  const { parts, found } = scan(text);
  const hit = found.findLast(a => a.key === key.toLowerCase());
  if (!hit) return text;
  const line = parts[hit.line], seg = line.slice(hit.start, hit.end);
  const name = /^("?\w+"?)/.exec(seg)[1];
  parts[hit.line] = line.slice(0, hit.start) + `${name} ${hit.quoted ? `"${value}"` : value}` + line.slice(hit.end);
  return parts.join('');
}

/** 在末尾补一组命令，前面带一行 `// 标题` 注释 */
export function appendSection(text, title, lines) {
  const eol = /\r\n|\r|\n/.exec(text)?.[0] ?? '\n';
  const gap = !text || text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol;
  return text + gap + [`// ${title}`, ...lines].join(eol);
}

/** 删掉某个 cvar 的全部直接赋值；整行只剩空白时连同换行一起去掉，同一行的其它命令保留 */
export function removeAssignments(text, key) {
  const { parts, found } = scan(text);
  const hits = found.filter(a => a.key === key.toLowerCase());
  if (!hits.length) return text;
  for (const hit of [...hits].reverse()) {
    const line = parts[hit.line];
    let start = hit.start, end = hit.end;
    // 吃掉紧跟的分号；若在行尾，吃掉前面的分号
    const after = /^\s*;\s*/.exec(line.slice(end));
    if (after) end += after[0].length;
    else { const before = /;\s*$/.exec(line.slice(0, start)); if (before) start -= before[0].length; }
    parts[hit.line] = line.slice(0, start) + line.slice(end);
  }
  const out = [];
  for (let n = 0; n < parts.length; n += 2) {
    const touched = hits.some(h => h.line === n);
    if (touched && !parts[n].trim()) continue; // 这一行连同它的换行一起去掉
    out.push(parts[n]);
    if (n + 1 < parts.length) out.push(parts[n + 1]);
  }
  // 去掉因删最后一行留下的结尾换行，保持原文件结尾风格
  let joined = out.join('');
  if (!/[\r\n]$/.test(text)) joined = joined.replace(/(\r\n|\r|\n)$/, '');
  return joined;
}

const CVAR = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALUE = /^[^"\x00-\x1f\x7f;]*$/;
/**
 * 按 { cvar: 值 | null } 改一段 CFG：已有的就地改最后一次赋值，缺的补到末尾（`// 标题` 下面），null 删除。
 * 返回新文本和逐项变化；键名或值不合法时抛 `cfg_invalid`，details.field 指出是哪一项。
 */
export function setCvars(text, cvars, title = '茶茶调整') {
  if (!cvars || typeof cvars !== 'object' || Array.isArray(cvars)) throw Object.assign(new Error('cvars 需要 { 变量名: 值 } 对象。'), { code: 'cfg_invalid', details: { field: 'cvars' } });
  const current = assignments(text), changes = [], missing = [];
  let out = text;
  for (const [key, raw] of Object.entries(cvars)) {
    if (!CVAR.test(key) || key.length > 64) throw Object.assign(new Error(`变量名「${key}」无效。`), { code: 'cfg_invalid', details: { field: `cvars.${key}` } });
    if (raw !== null && (typeof raw !== 'string' && typeof raw !== 'number' || !VALUE.test(String(raw)) || String(raw).length > 200)) {
      throw Object.assign(new Error(`${key} 的值需要一段不含引号、分号和控制字符的文本。`), { code: 'cfg_invalid', details: { field: `cvars.${key}` } });
    }
    const before = current.get(key.toLowerCase()) ?? null, value = raw === null ? null : String(raw);
    if (value === before) continue;
    if (value === null) out = removeAssignments(out, key);
    else if (before !== null) out = replaceAssignment(out, key, value);
    else missing.push(`${key} "${value}"`);
    changes.push({ key, before, after: value });
  }
  if (missing.length) out = appendSection(out, title, missing);
  return { text: out, changes };
}
