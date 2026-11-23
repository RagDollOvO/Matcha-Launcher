import { PlatformError } from './errors.mjs';

const fail = (code, message) => { throw new PlatformError(code, message); };

/** Small KeyValues parser: supports strings, bare tokens, nested objects and // comments. */
export function parseKeyValues(source) {
  const tokens = []; let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c) || c === '\uFEFF') { i++; continue; }
    if (source.slice(i, i + 2) === '//') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '{' || c === '}') { tokens.push(c); i++; continue; }
    if (c === '"') {
      let s = ''; i++; let closed = false;
      while (i < source.length) {
        const ch = source[i++]; if (ch === '"') { closed = true; break; }
        if (ch === '\\' && i < source.length && ['\\', '"'].includes(source[i])) s += source[i++]; else s += ch;
      }
      if (!closed) fail('invalid_vdf', 'Unterminated KeyValues string'); tokens.push(s); continue;
    }
    const start = i; while (i < source.length && !/[\s{}]/.test(source[i])) i++; tokens.push(source.slice(start, i));
  }
  let cursor = 0;
  function block(nested) {
    const out = Object.create(null);
    while (cursor < tokens.length) {
      const key = tokens[cursor++];
      if (key === '}') { if (!nested) fail('invalid_vdf', 'Unexpected closing brace'); return out; }
      if (key === '{' || cursor >= tokens.length) fail('invalid_vdf', 'Invalid KeyValues key/value pair');
      const value = tokens[cursor++]; if (value === '}') fail('invalid_vdf', 'Missing KeyValues value');
      out[key] = value === '{' ? block(true) : value;
    }
    if (nested) fail('invalid_vdf', 'Unclosed KeyValues block'); return out;
  }
  return block(false);
}
