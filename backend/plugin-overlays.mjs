import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { isDeepStrictEqual } from 'node:util';
import { PlatformError } from './errors.mjs';
import { directory, writeJson } from './mods/files.mjs';
import { regular, identity } from './mods/vpk.mjs';
import { platformPath, readBytes } from './platforms/files.mjs';
import { imagePath, imageData } from './plugin-assets.mjs';

const fail = (code, message, details) => { throw new PlatformError(code, message, details); };
export const metadataFields = ['name', 'author', 'summary', 'description', 'tags', 'modes', 'hotkeys', 'cover', 'links'];
const equal = isDeepStrictEqual;
const present = value => Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, max) {
  if (typeof value !== 'string' || [...value.trim()].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    fail('metadata_invalid', `资料文本需要在 ${max} 字以内。`);
  return value.trim();
}
export function httpsLink(value) {
  let url; try { url = new URL(text(value, 400)); } catch { fail('metadata_invalid', '资料链接需要完整 HTTPS 地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('metadata_invalid', '资料链接需要公开的 HTTPS 地址。');
  return url.href;
}
export function normalizeSource(value) {
  if (!object(value) || !['github', 'workshop', 'local'].includes(value.type)) fail('metadata_invalid', '请选择 GitHub、工坊或本地来源。');
  const out = { type: value.type };
  if (value.url) out.url = httpsLink(value.url);
  if (value.type !== 'local' && !out.url) fail('metadata_invalid', '远端来源需要来源页面地址。');
  for (const key of ['label', 'version']) if (value[key]) out[key] = text(value[key], key === 'label' ? 160 : 120);
  if (value.checkedAt) {
    if (!Number.isFinite(Date.parse(value.checkedAt))) fail('metadata_invalid', '来源检查时间无效。');
    out.checkedAt = new Date(value.checkedAt).toISOString();
  }
  if (value.latest === null) out.latest = null;
  else if (value.latest !== undefined) {
    if (!object(value.latest)) fail('metadata_invalid', '来源版本记录需要检查。');
    out.latest = {};
    if (value.latest.version) out.latest.version = text(value.latest.version, 120);
    if (value.latest.url) out.latest.url = httpsLink(value.latest.url);
    if (value.latest.publishedAt) {
      if (!Number.isFinite(Date.parse(value.latest.publishedAt))) fail('metadata_invalid', '来源发布时间无效。');
      out.latest.publishedAt = new Date(value.latest.publishedAt).toISOString();
    }
  }
  return out;
}
export function normalizeFields(fields) {
  if (!object(fields)) fail('metadata_invalid', '需要简单资料字段。');
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!metadataFields.includes(key)) fail('metadata_field_unknown', `此入口只整理简单资料：${key}`);
    if (['name', 'author', 'summary', 'description'].includes(key)) out[key] = text(value, key === 'description' ? 12000 : key === 'summary' ? 160 : 80);
    else if (key === 'cover') {
      out[key] = text(value, 2000);
      if (out[key] && !path.isAbsolute(out[key]) && !imagePath(out[key])) fail('metadata_invalid', '封面需要包内图片或已暂存图片。');
    } else if (key === 'tags' || key === 'modes') {
      if (!Array.isArray(value) || value.length > 8) fail('metadata_invalid', '标签或模式最多 8 项。');
      out[key] = [...new Set(value.map(v => text(v, 24)).filter(Boolean))];
      if (key === 'modes' && out[key].some(v => !['coop', 'realism', 'survival', 'versus', 'scavenge'].includes(v))) fail('metadata_invalid', '游戏模式标识需要检查。');
    } else if (key === 'hotkeys') {
      if (!Array.isArray(value) || value.length > 8) fail('metadata_invalid', '快捷键最多 8 项。');
      out[key] = value.map(v => ({ keys: text(v?.keys, 40), label: text(v?.label, 80) }));
      if (out[key].some(v => !v.keys || !v.label)) fail('metadata_invalid', '快捷键需要按键与说明。');
    } else {
      if (!Array.isArray(value) || value.length > 8) fail('metadata_invalid', '资料链接最多 8 项。');
      out[key] = value.map(v => ({ label: text(v?.label, 80), url: httpsLink(v?.url), ...(v?.note ? { note: text(v.note, 200) } : {}) }));
      if (out[key].some(v => !v.label)) fail('metadata_invalid', '链接需要名称。');
    }
  }
  return out;
}
export function developerValues(raw) {
  const p = raw.presentation ?? {};
  return { name: raw.host === 'l4n' ? undefined : raw.name, author: typeof raw.author === 'string' && raw.author || (typeof raw.developer?.author === 'string' ? raw.developer.author : undefined), summary: p.summary,
    description: p.description || raw.description, tags: p.tags, modes: p.modes, hotkeys: p.hotkeys, cover: p.cover,
    links: p.links ?? (Array.isArray(p.page) ? p.page.filter(b => b?.type === 'links' && Array.isArray(b.items)).flatMap(b => b.items) : undefined) };
}
const authoritative = (values, record, field) => present(values[field]) && !(record.generated && equal(values[field], record.generated[field]));
// A completed file import can precede its overlay write; the generated wrapper retains its provenance.
const metadataRecord = (raw, record = {}) => raw.intake?.preparedBy === 'agent' && !record.generated
  ? { ...record, generated: developerValues(raw) } : record;
export function mergePluginMetadata(raw, record = {}) {
  record = metadataRecord(raw, record);
  const result = structuredClone(raw), values = developerValues(raw), origins = {}, p = { schema: 1, ...result.presentation };
  result.author = values.author ?? '';
  const agent = normalizeFields(record.agent ?? {}), user = normalizeFields(record.user ?? {});
  for (const field of metadataFields) {
    let value, origin;
    if (present(user[field])) { value = user[field]; origin = 'user'; }
    else if (authoritative(values, record, field)) { value = values[field]; origin = 'developer'; }
    else if (present(agent[field])) { value = agent[field]; origin = 'agent'; }
    else if (present(values[field])) { value = values[field]; origin = record.generated && equal(values[field], record.generated[field]) ? 'agent' : 'developer'; }
    if (!origin) continue;
    origins[field] = origin;
    if (field === 'name' || field === 'author') result[field] = structuredClone(value);
    else { p[field] = structuredClone(value); if (field === 'description') result.description = value; }
  }
  if (raw.presentation || Object.keys(p).length > 1) result.presentation = p;
  result.provenance = { fields: origins, ...(record.basis ? { basis: record.basis } : {}), ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}) };
  if (record.source) result.source = normalizeSource(record.source);
  else if (raw.source) { try { result.source = normalizeSource(raw.source); } catch { delete result.source; } }
  return result;
}
export class PluginOverlays {
  constructor(dataDir) {
    this.dataDir = dataDir; this.base = path.join(dataDir, 'plugin-overlays'); this.file = path.join(this.base, 'records.json');
  }
  async all() {
    const file = await platformPath(this.base, 'records.json');
    if (!file) return {};
    const data = JSON.parse((await readBytes(file, 16 * 1024 * 1024)).toString('utf8'));
    if (data.version !== 1 || !object(data.plugins)) fail('metadata_invalid', '补充资料文件需要检查，原文件已保留。');
    return data.plugins;
  }
  async mutate(fn) {
    await fs.mkdir(this.base, { recursive: true }); await directory(this.base);
    const unlock = await lockfile.lock(this.base, { realpath: false, retries: { retries: 3, minTimeout: 50, maxTimeout: 150 } });
    try { const records = await this.all(), result = await fn(records); await writeJson(this.file, { version: 1, plugins: records }); return result; }
    finally { await unlock(); }
  }
  async cover(raw, packageDirectory, value) {
    if (!value) return null;
    if (value.startsWith('@overlay/')) { await this.image(raw.id, value); return { reference: value }; }
    if (!path.isAbsolute(value)) {
      const file = await platformPath(packageDirectory, value);
      if (!file) fail('file_missing', `封面文件缺失：${value}`);
      await imageData(file); return { reference: value };
    }
    let file;
    for (const base of this.stagingRoots ?? [path.join(this.dataDir, 'dll-intake'), path.join(this.dataDir, 'dll-sources')]) {
      const relative = path.relative(base, value);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) { file = await platformPath(base, relative.replaceAll('\\', '/')); break; }
    }
    if (!file) fail('asset_scope', '请选择来源抓取或包检查返回的暂存图片。');
    const before = identity(await regular(file)), { mime } = await imageData(file);
    if (identity(await regular(file)) !== before) fail('file_changed', '暂存封面有变化，请重新确认。');
    return { file, identity: before, mime };
  }
  async plan(raw, packageDirectory, input, layer = 'agent') {
    const current = metadataRecord(raw, (await this.all())[raw.id]), fields = normalizeFields(input.fields ?? {}), values = developerValues(raw);
    const blocked = layer === 'agent' ? Object.keys(fields).filter(k => present(fields[k]) && authoritative(values, current, k) && !equal(fields[k], values[k])) : [];
    if (blocked.length) fail('developer_field_locked', `作者已填写这些字段：${blocked.join('、')}。保留作者资料。`, { fields: blocked });
    const cover = fields.cover ? await this.cover(raw, packageDirectory, fields.cover) : null;
    const source = input.source ? normalizeSource(input.source) : undefined;
    const basis = input.basis === undefined ? undefined : text(input.basis, 500);
    if (layer === 'agent' && Object.keys(fields).length && !basis) fail('metadata_basis_required', '请说明整理所依据的 README、发布说明或作者资料。');
    return { fields, source, basis, publisher: input.publisher, cover,
      expected: { revision: current.revision ?? null, developer: values, coverIdentity: cover?.identity ?? null },
      changes: Object.entries(fields).map(([field, after]) => ({ field, before: mergePluginMetadata(raw, current)[field] ?? mergePluginMetadata(raw, current).presentation?.[field], after })),
      sourceChanged: !!(current.source && source && (current.source.type !== source.type || current.source.url !== source.url ||
        current.publisher && input.publisher && !equal(current.publisher, input.publisher))), previousSource: current.source };
  }
  async save(raw, packageDirectory, input, layer, confirmation, expected) {
    if (layer === 'agent' && (confirmation?.approved !== true || confirmation.source !== 'user')) fail('confirmation_required', '请确认 Agent 整理资料的修改。');
    return this.mutate(async records => {
      const current = metadataRecord(raw, records[raw.id]), plan = await this.plan(raw, packageDirectory, input, layer);
      if (expected && !equal(plan.expected, expected)) fail('metadata_stale', '资料或作者包刚有变化，请重新检查并确认。');
      const next = structuredClone(current); next[layer] ??= {};
      const baseline = mergePluginMetadata(raw, { ...current, user: {} }), values = developerValues(raw);
      for (const [field, incoming] of Object.entries(plan.fields)) {
        if (layer === 'agent' && authoritative(values, current, field) && equal(incoming, values[field])) continue;
        if (!present(incoming) || layer === 'user' && equal(incoming, field === 'name' || field === 'author' ? baseline[field] : baseline.presentation?.[field])) { delete next[layer][field]; continue; }
        next[layer][field] = incoming;
      }
      if (plan.cover?.file) {
        const { data, mime } = await imageData(plan.cover.file);
        if (identity(await regular(plan.cover.file)) !== plan.cover.identity) fail('file_changed', '暂存封面已变化，请重新确认。');
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime];
        const name = `${randomUUID()}.${extension}`, reference = `@overlay/${name}`;
        const folder = path.join(this.base, 'assets'); await fs.mkdir(folder, { recursive: true }); await directory(folder);
        await fs.writeFile(path.join(folder, name), data, { flag: 'wx' });
        next.assets ??= {}; next.assets[reference] = `assets/${name}`; next[layer].cover = reference;
      }
      if (plan.source) next.source = plan.source;
      if (plan.publisher) next.publisher = plan.publisher;
      if (plan.basis !== undefined) next.basis = plan.basis;
      next.updatedAt = new Date().toISOString(); next.revision = randomUUID(); records[raw.id] = next;
      return { ok: true };
    });
  }
  async attach(raw, { source, publisher, generated } = {}) {
    return this.mutate(records => {
      const next = records[raw.id] ?? {};
      if (source) next.source = normalizeSource(source);
      if (publisher) next.publisher = publisher;
      if (generated) {
        const values = developerValues(raw); next.generated = {}; next.agent ??= {};
        for (const field of metadataFields) if (present(values[field])) { next.generated[field] = values[field]; next.agent[field] = values[field]; }
        next.basis ??= '根据导入时确认的来源资料整理';
      }
      if (generated === false) delete next.generated;
      next.updatedAt = new Date().toISOString(); next.revision = randomUUID(); records[raw.id] = next;
    });
  }
  async image(id, reference) {
    const record = (await this.all())[id], relative = record?.assets?.[reference];
    if (!relative) fail('asset_not_declared', '此图片未在该模组的补充资料中声明。');
    const actual = await platformPath(this.base, relative);
    if (!actual) return { dataUrl: null };
    const { data, mime } = await imageData(actual);
    return { dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  }
  async checked(id, observed) {
    return this.mutate(records => {
      const next = records[id];
      if (!next?.source || next.source.type !== observed.source.type || next.source.url !== observed.source.url)
        fail('source_changed', '来源记录已变化，请先核对当前来源。');
      if (next.publisher && !equal(next.publisher, observed.publisher))
        fail('source_publisher_changed', '来源发布者或仓库身份有变化，请先给用户确认来源。');
      if (next.source.checkedAt && Date.parse(observed.source.checkedAt) < Date.parse(next.source.checkedAt))
        fail('source_stale', '当前记录已有较新的来源检查，请使用最新检查结果。');
      next.source = { ...next.source, latest: observed.source.latest, checkedAt: observed.source.checkedAt };
      next.publisher ??= observed.publisher; next.revision = randomUUID();
      return { ok: true, source: next.source };
    });
  }
}
