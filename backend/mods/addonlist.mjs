import fs from 'node:fs/promises';
import iconv from 'iconv-lite';
import { PlatformError } from '../core.mjs';
import { regular } from './vpk.mjs';

export const addonKey = s => s.replaceAll('\\', '/').toLowerCase();
const fail = () => { throw new PlatformError('invalid_addonlist', 'addonlist.txt 格式需要检查；原文件保持原样。'); };

/** Track scalar spans, preserving comments, ordering, unknown entries and encoding. */
export function parseAddonList(text) {
  const tokens = []; let i = 0;
  while (i < text.length) {
    if (/\s|\uFEFF/.test(text[i])) { i++; continue; }
    if (text.slice(i, i + 2) === '//') { while (i < text.length && text[i] !== '\n') i++; continue; }
    const start = i;
    if ('{}'.includes(text[i])) { tokens.push({ kind: text[i], start, end: ++i }); continue; }
    let value = '';
    if (text[i] === '"') {
      i++; let closed = false;
      while (i < text.length) {
        const c = text[i++]; if (c === '"') { closed = true; break; }
        if (c === '\\' && ['\\', '"'].includes(text[i])) value += text[i++]; else value += c;
      }
      if (!closed) fail();
    } else { while (i < text.length && !/[\s{}]/.test(text[i])) value += text[i++]; }
    tokens.push({ kind: 'string', value, start, end: i });
  }
  if (tokens[0]?.value?.toLowerCase() !== 'addonlist' || tokens[1]?.kind !== '{' || tokens.at(-1)?.kind !== '}') fail();
  const values = new Map();
  for (let n = 2; n < tokens.length - 1; n += 2) {
    const k = tokens[n], v = tokens[n + 1];
    if (k?.kind !== 'string' || v?.kind !== 'string' || !['0', '1'].includes(v.value)) fail();
    const key = addonKey(k.value);
    if (values.has(key)) fail();
    values.set(key, { ...v, keyStart:k.start, keyEnd:k.end, enabled: v.value === '1' });
  }
  return { text, values, closing: tokens.at(-1).start };
}
export async function readAddonList(file) {
  let original;
  try { const s = await regular(file); if (s.size > 1024 * 1024) fail(); original = await fs.readFile(file); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  let encoding = original?.[0] === 0xff && original?.[1] === 0xfe ? 'utf16le' : 'utf8';
  let text = '"AddonList"\r\n{\r\n}\r\n';
  if (original) {
    try { text = new TextDecoder(encoding === 'utf16le' ? 'utf-16le' : 'utf-8', { fatal: true, ignoreBOM: true }).decode(original); }
    catch {
      if (encoding === 'utf16le') fail();
      // Chinese Windows/Source installs also write GBK, a subset of GB18030.
      // Require a lossless round trip before retaining this encoding for writes.
      text = iconv.decode(original, 'gb18030');
      if (!iconv.encode(text, 'gb18030').equals(original)) fail();
      encoding = 'gb18030';
    }
  }
  return { ...parseAddonList(text), encoding, original };
}
export function updateAddonList(document, changes, removeKeys = []) {
  const replacements = [], lines = [];
  for (const file of new Set(removeKeys.map(addonKey))) {
    const v=document.values.get(file);
    if(v)replacements.push({start:v.keyStart,end:v.keyEnd,text:''},{start:v.start,end:v.end,text:''});
  }
  for (const [file, enabled] of changes) {
    if (typeof enabled !== 'boolean' || /["\r\n\0]/.test(file)) fail();
    const v = document.values.get(addonKey(file));
    if (v) { if (v.enabled !== enabled) replacements.push({ start: v.start, end: v.end, text: `"${enabled ? 1 : 0}"` }); }
    else lines.push(`\t"${file.replaceAll('/', '\\')}"\t\t"${enabled ? 1 : 0}"`);
  }
  const nl = document.text.includes('\r\n') ? '\r\n' : '\n';
  if (lines.length) replacements.push({ start: document.closing, end: document.closing, text: lines.join(nl) + nl });
  let text = document.text;
  for (const r of replacements.sort((a, b) => b.start - a.start)) text = text.slice(0, r.start) + r.text + text.slice(r.end);
  return document.encoding === 'gb18030' ? iconv.encode(text, 'gb18030') : Buffer.from(text, document.encoding);
}
