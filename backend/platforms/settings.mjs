import { fail } from './files.mjs';

// Skeeto uses a byte-oriented line reader. Preserve all other bytes, comments and line endings.
export function patchSettings(bytes, changes) {
  if (bytes?.[0] === 0xff && bytes?.[1] === 0xfe || bytes?.[0] === 0xfe && bytes?.[1] === 0xff) fail('platform_settings_encoding', '此设置文件为 UTF-16，请先按 Skeeto 支持的字节编码保存。');
  const text = (bytes ?? Buffer.alloc(0)).toString('latin1'), newline = text.includes('\r\n') ? '\r\n' : '\n';
  const wanted = new Map(Object.entries(changes)), seen = new Set();
  for (const [key, value] of wanted) if (!/^[a-z0-9_]+$/.test(key) || !Number.isInteger(value)) fail('platform_setting_invalid', '平台开关键或数值无效。');
  let result = text.replace(/(^|\n)([a-z0-9_]+)=([^\r\n]*)/gi, (whole, prefix, key, raw) => {
    const canonical = key.toLowerCase();
    if (!wanted.has(canonical)) return whole;
    seen.add(canonical); const value = wanted.get(canonical);
    const prior = /^\s*([+-]?\d+)/.exec(raw);
    return key === canonical && prior && Number(prior[1]) === value ? whole : `${prefix}${canonical}=${value}`;
  });
  for (const [key, value] of wanted) if (!seen.has(key)) { if (result && !result.endsWith('\n')) result += newline; result += `${key}=${value}${newline}`; }
  return Buffer.from(result, 'latin1');
}

export function modulePolicy(adapter, { remote = false, modeId = '', managed = false } = {}) {
  const versus = /versus|scavenge/i.test(modeId), unknownMode = remote && !versus && !['coop', 'realism', 'survival'].includes(modeId);
  const selected = adapter.modules.filter(m => m.online === 'blocked' || (remote && m.online === 'local-only') || ((versus || unknownMode) && m.online === 'no-versus') || (managed && m.id === 'workshop-updater'));
  const changes = {}, modules = [], unresolved = [];
  for (const m of selected) {
    const mapping = adapter.moduleSwitches[m.id];
    modules.push({ id: m.id, name: m.name, reason: m.id === 'workshop-updater' ? 'flare-managed' : m.online });
    if (mapping?.coverage !== 'complete') unresolved.push({ id: m.id, name: m.name, reason: mapping?.note ?? '完整关闭键组待定位。' });
    else for (const s of mapping.switches) { changes[s.key] = s.off; for (const alias of s.aliases ?? []) changes[alias] = s.off; }
  }
  return { modules, changes, unresolved, unknownMode };
}
