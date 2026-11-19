import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const REDACTED = '__FLARE_REDACTED__';
// Common built-ins remain configurable even before Pi is installed. Custom IDs
// are discovered from models.json and auth.json, without executing key commands.
const PROVIDERS = [
  ['anthropic', 'Anthropic', 'both', ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']],
  ['openai', 'OpenAI', 'both', ['OPENAI_API_KEY']],
  ['google', 'Google Gemini', 'api_key', ['GEMINI_API_KEY']],
  ['deepseek', 'DeepSeek', 'api_key', ['DEEPSEEK_API_KEY']],
  ['openrouter', 'OpenRouter', 'both', ['OPENROUTER_API_KEY']],
  ['github-copilot', 'GitHub Copilot', 'oauth', ['COPILOT_GITHUB_TOKEN']],
  ['google-gemini-cli', 'Google Gemini CLI', 'oauth', []],
  ['radius', 'Radius', 'both', ['RADIUS_API_KEY']],
];
function providerId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || ['constructor', 'prototype', '__proto__'].includes(value)) fail('pi_config_invalid', '服务商 ID 格式无效。');
  return value;
}
const refValue = value => typeof value === 'string' && (/^\$(?:[A-Za-z_][\w]*|\{[A-Za-z_][\w]*\})$/.test(value) || value.startsWith('!'));
function resolvedPresence(value, env) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (value.startsWith('!')) return true; // configured command; never execute during status
  const match = value.match(/^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})$/);
  return match ? !!env[match[1] ?? match[2]] : true;
}

export function validateSettings(patch) {
  if (!object(patch)) fail('pi_config_invalid', 'Pi 设置需要 JSON 对象。');
  for (const [key, value] of Object.entries(patch)) {
    if (['defaultProvider', 'defaultModel'].includes(key)) {
      if (typeof value !== 'string' || !value.trim()) fail('pi_config_invalid', `${key} 需要非空文本。`);
      if (key === 'defaultProvider') providerId(value);
    } else if (key === 'defaultThinkingLevel') {
      if (!THINKING_LEVELS.includes(value)) fail('pi_config_invalid', '思考强度无效。');
    } else if (['autoCompaction', 'autoRetry'].includes(key)) {
      if (typeof value !== 'boolean') fail('pi_config_invalid', `${key} 需要布尔值。`);
    } else if (key === 'enabledModels') {
      if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !x.trim())) fail('pi_config_invalid', 'enabledModels 需要模型名称数组。');
    } else fail('pi_config_invalid', '存在未支持的 Pi 设置字段。');
  }
  return patch;
}
function settingsView(raw) {
  const result = { autoCompaction: raw.compaction?.enabled ?? true, autoRetry: raw.retry?.enabled ?? true };
  for (const key of ['defaultProvider', 'defaultModel', 'defaultThinkingLevel', 'enabledModels']) if (raw[key] !== undefined) result[key] = raw[key];
  return result;
}

function validateModels(config) {
  if (!object(config) || !object(config.providers)) fail('pi_config_invalid', 'models.json 需要 providers 对象。');
  for (const [id, provider] of Object.entries(config.providers)) {
    providerId(id);
    if (!object(provider)) fail('pi_config_invalid', '服务商配置需要 JSON 对象。');
    for (const key of ['api', 'apiKey', 'name']) if (provider[key] !== undefined && (typeof provider[key] !== 'string' || !provider[key].trim())) fail('pi_config_invalid', `服务商 ${key} 需要非空文本。`);
    if (provider.baseUrl !== undefined) {
      try {
        const url = new URL(provider.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { fail('pi_config_invalid', 'baseUrl 需要 HTTP(S) 地址；认证信息请使用密钥字段。'); }
    }
    if (provider.models !== undefined && !Array.isArray(provider.models)) fail('pi_config_invalid', 'models 需要数组。');
    if (provider.modelOverrides !== undefined && !object(provider.modelOverrides)) fail('pi_config_invalid', 'modelOverrides 需要对象。');
    for (const model of provider.models ?? []) {
      if (!object(model) || typeof model.id !== 'string' || !model.id.trim()) fail('pi_config_invalid', '每个模型需要 id。');
      for (const key of ['contextWindow', 'maxTokens']) if (model[key] !== undefined && (!Number.isSafeInteger(model[key]) || model[key] <= 0)) fail('pi_config_invalid', `${key} 需要正整数。`);
    }
  }
}
// A round trip through the endpoint editor keeps hidden header values intact.
// Secrets never appear in a GET or SET response, including older hand-edited files.
function hideSecrets(value, key = '') {
  if (key === 'apiKey' && typeof value === 'string') return refValue(value) && !value.startsWith('!') ? value : REDACTED;
  if (key === 'headers' && object(value)) return Object.fromEntries(Object.keys(value).map(k => [k, REDACTED]));
  if (Array.isArray(value)) return value.map(v => hideSecrets(v));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hideSecrets(v, k)]));
  return value;
}
function restoreSecrets(value, previous) {
  if (value === REDACTED) {
    if (previous === undefined) fail('pi_config_invalid', '隐藏凭据已变化，请重新读取配置。');
    return previous;
  }
  if (Array.isArray(value)) return value.map((v, i) => restoreSecrets(v, Array.isArray(previous) ? (v?.id ? previous.find(x => x?.id === v.id) : previous[i]) : undefined));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreSecrets(v, previous?.[k])]));
  return value;
}

export class PiConfigFiles {
  constructor(configDir, env = process.env) { this.configDir = configDir; this.env = env; this.queue = Promise.resolve(); }
  serial(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  async read(name, fallback = {}) {
    let source;
    try { source = await fs.readFile(path.join(this.configDir, name), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return structuredClone(fallback); throw e; }
    try { const value = JSON.parse(source.replace(/^\uFEFF/, '')); if (object(value)) return value; } catch { /* no secret-bearing parse errors */ }
    fail('pi_config_invalid', `${name} 格式需要检查；原文件已保留。`);
  }
  async update(name, change) {
    const file = path.join(this.configDir, name);
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    // Same lock protocol as Pi's auth/settings writers; read after acquiring it.
    const release = await lockfile.lock(file, { realpath: false, retries: { retries: 12, minTimeout: 20, maxTimeout: 200 } });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const value = await change(await this.read(name));
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, file);
      return value;
    } finally {
      try { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
      finally { await release(); }
    }
  }
  settings() { return this.serial(async () => settingsView(await this.read('settings.json'))); }
  saveSettings(patch) {
    validateSettings(patch);
    return this.serial(async () => settingsView(await this.update('settings.json', raw => {
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'autoCompaction') raw.compaction = { ...raw.compaction, enabled: value };
        else if (key === 'autoRetry') raw.retry = { ...raw.retry, enabled: value };
        else raw[key] = value;
      }
      return raw;
    })));
  }
  authStatus() {
    return this.serial(async () => {
      const auth = await this.read('auth.json'), models = await this.read('models.json');
      const catalog = new Map(PROVIDERS.map(([id, name, kind, env]) => [id, { id, name, kind, env }]));
      for (const id of new Set([...Object.keys(models.providers ?? {}), ...Object.keys(auth)])) {
        if (!catalog.has(id)) catalog.set(id, { id, name: models.providers?.[id]?.name ?? id, kind: auth[id]?.type === 'oauth' || models.providers?.[id]?.oauth ? 'both' : 'api_key', env: [] });
      }
      return { providers: [...catalog.values()].map(({ env, ...provider }) => {
        const credential = auth[provider.id], modelKey = models.providers?.[provider.id]?.apiKey;
        let source, key;
        if (credential?.type === 'oauth') source = 'oauth';
        else if (credential?.type === 'api_key' && resolvedPresence(credential.key, this.env)) { source = 'auth'; key = credential.key; }
        else if (resolvedPresence(modelKey, this.env)) { source = refValue(modelKey) && !modelKey.startsWith('!') ? 'env' : 'auth'; }
        else if (env.some(name => !!this.env[name])) source = 'env';
        const keyHint = source === 'auth' && key?.length > 4 && !refValue(key) ? `••••${key.slice(-4)}` : undefined;
        return { ...provider, configured: !!source, ...(source ? { source } : {}), ...(keyHint ? { keyHint } : {}) };
      }) };
    });
  }
  setKey(provider, apiKey) {
    providerId(provider);
    if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey) || apiKey.trim().startsWith('!')) fail('pi_config_invalid', '请输入有效的 API Key。');
    return this.serial(async () => {
      // Escape config interpolation so this UI always stores a literal API key.
      await this.update('auth.json', auth => ({ ...auth, [provider]: { ...(auth[provider]?.type === 'api_key' ? auth[provider] : {}), type: 'api_key', key: apiKey.trim().replaceAll('$', '$$') } }));
      return { status: 'saved' };
    });
  }
  removeKey(provider) {
    providerId(provider);
    return this.serial(async () => { await this.update('auth.json', auth => { delete auth[provider]; return auth; }); return { status: 'removed' }; });
  }
  models() { return this.serial(async () => hideSecrets(await this.read('models.json', { providers: {} }))); }
  saveModels(config) {
    validateModels(config);
    return this.serial(async () => {
      const saved = await this.update('models.json', async previous => {
        const next = restoreSecrets(config, previous), credentials = {};
        for (const [id, provider] of Object.entries(next.providers)) {
          if (provider.apiKey && config.providers[id].apiKey !== REDACTED && !refValue(provider.apiKey)) {
            credentials[id] = { type: 'api_key', key: provider.apiKey.replaceAll('$', '$$') };
            delete provider.apiKey; // Pi resolves auth.json using this same provider ID.
          }
        }
        if (Object.keys(credentials).length) await this.update('auth.json', auth => ({ ...auth, ...credentials }));
        return next;
      });
      return hideSecrets(saved);
    });
  }
}
