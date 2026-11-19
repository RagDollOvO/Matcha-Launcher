import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { DesktopService } from '../desktop/service.mjs';
import { PiTransport } from './transport.mjs';
import { platformToolCatalog } from './platform-extension.mjs';
import { COMPACT_TIMEOUT_MS, MAX_BRIDGE_BYTES } from './limits.mjs';

async function fixture(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-pi-backend-'));
  const service = new DesktopService({ dataDir, core: { discover: async () => ({ games: [], warnings: [] }) }, piEnv: { OPENAI_API_KEY: 'env-secret-fixture' }, ...options });
  t.after(() => service.close());
  return { service, dir: path.join(dataDir, 'pi'), call: (c, p) => service.dispatch(c, p) };
}

test('offline config: masked keys, custom models, merged defaults and invalid-file preservation', async t => {
  const { call, dir, service } = await fixture(t);
  const events = []; service.on('event', e => events.push(e));
  assert.equal((await call('pi-auth-status')).providers.find(p => p.id === 'openai').source, 'env');
  await call('pi-auth-set', { provider: 'openai', apiKey: 'fixture-api-key-1234' });
  const status = await call('pi-auth-status');
  assert.equal(status.providers.find(p => p.id === 'openai').keyHint, '••••1234');
  assert(!JSON.stringify(status).includes('fixture-api-key')); assert.equal(events.length, 0);
  await call('pi-auth-set', { provider: 'local', apiKey: 'local-key-5678' });
  await call('pi-auth-remove', { provider: 'openai' });
  assert.equal((await call('pi-auth-status')).providers.find(p => p.id === 'openai').source, 'env');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'auth.json'))).local.key, 'local-key-5678');
  await assert.rejects(call('pi-auth-set', { provider: 'local', apiKey: ' !echo bad' }), { code: 'pi_config_invalid' });
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'user-theme', compaction: { reserveTokens: 8192 }, retry: { maxRetries: 7 } }));
  await Promise.all([call('pi-settings-set', { defaultProvider: 'local', defaultModel: 'fixture' }), call('pi-settings-set', { autoCompaction: false, defaultThinkingLevel: 'high', autoRetry: false })]);
  const settings = JSON.parse(await fs.readFile(path.join(dir, 'settings.json')));
  assert.equal(settings.theme, 'user-theme'); assert.equal(settings.compaction.reserveTokens, 8192); assert.equal(settings.retry.maxRetries, 7);
  assert.equal((await call('pi-settings-get')).defaultThinkingLevel, 'high');
  const models = { providers: { local: { baseUrl: 'http://localhost:1234/v1', api: 'openai-completions', apiKey: 'new-private-key', headers: { 'X-Custom': 'private-header' }, models: [{ id: 'fixture', contextWindow: 8192 }] } } };
  const saved = await call('pi-models-set', models);
  assert(!JSON.stringify(saved).includes('new-private-key')); assert(!JSON.stringify(saved).includes('private-header'));
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'auth.json'))).local.key, 'new-private-key');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'models.json'))).providers.local.apiKey, undefined);
  await call('pi-models-set', await call('pi-models-get'));
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'models.json'))).providers.local.headers['X-Custom'], 'private-header');
  // Editing a legacy endpoint must preserve the higher-priority auth.json key.
  const legacy = JSON.parse(await fs.readFile(path.join(dir, 'models.json')));
  legacy.providers.local.apiKey = 'older-fallback-key';
  await fs.writeFile(path.join(dir, 'models.json'), JSON.stringify(legacy));
  await call('pi-models-set', await call('pi-models-get'));
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'auth.json'))).local.key, 'new-private-key');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'models.json'))).providers.local.apiKey, 'older-fallback-key');
  await assert.rejects(call('pi-models-set', { providers: { local: { models: [{ id: 'x', contextWindow: -1 }] } } }), { code: 'pi_config_invalid' });
  await fs.writeFile(path.join(dir, 'auth.json'), '{"private-fixture":"broken');
  await assert.rejects(call('pi-auth-set', { provider: 'openai', apiKey: 'replacement' }), e => e.code === 'pi_config_invalid' && !e.message.includes('private-fixture'));
  assert.equal(await fs.readFile(path.join(dir, 'auth.json'), 'utf8'), '{"private-fixture":"broken');
  await assert.rejects(call('pi-unimplemented'), { code: 'unknown_command' });
  assert.deepEqual((await call('pi-tools')).tools, platformToolCatalog());
});

test('sessions: metadata streaming, current guard, traversal/junction guard and recoverable deletion', async t => {
  const { service, call, dir } = await fixture(t);
  const sessions = path.join(dir, 'sessions'); await fs.mkdir(sessions, { recursive: true });
  const file = path.join(sessions, 'one.jsonl');
  const entries = [
    { type: 'session', id: 'one', timestamp: '2026-11-16T12:00:00Z' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '字'.repeat(100) }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } },
    { type: 'session_info', name: 'old' }, { type: 'session_info', name: 'renamed' },
  ];
  await fs.writeFile(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  service.lastPiState = { sessionFile: file };
  const [listed] = (await call('pi-sessions')).sessions;
  assert.equal(listed.messageCount, 2); assert.equal(listed.firstMessage.length, 80); assert.equal(listed.name, 'renamed'); assert.equal(listed.current, true);
  await assert.rejects(call('pi-session-delete', { path: file }), { code: 'session_current' });
  await assert.rejects(call('pi-session-delete', { path: path.join(dir, 'outside.jsonl') }), { code: 'SESSION_SCOPE' });
  const outside = path.join(dir, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'linked.jsonl'), '{}');
  await fs.symlink(outside, path.join(sessions, 'linked'), 'junction');
  await assert.rejects(call('pi-session-delete', { path: path.join(sessions, 'linked', 'linked.jsonl') }), { code: 'SESSION_SCOPE' });
  service.lastPiState = undefined;
  assert.equal((await call('pi-session-delete', { path: file })).status, 'deleted');
  assert.equal((await call('pi-sessions')).sessions.length, 0);
  assert.equal((await fs.readdir(path.join(sessions, '.trash'))).length, 1);
  assert.equal(await fs.readFile(path.join(outside, 'linked.jsonl'), 'utf8'), '{}');
});

test('RPC: admitted controls, separate compact deadline, cancellation remains responsive', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-pi-transport-'));
  const pi = new PiTransport({ configDir: root, piEntry: fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url)), requestTimeoutMs: 1000 });
  t.after(() => pi.close());
  assert.equal(pi.options.compactTimeoutMs, COMPACT_TIMEOUT_MS); assert(MAX_BRIDGE_BYTES >= 28 * 1024 * 1024);
  await pi.start();
  for (const [type, params] of [['set_thinking_level', { level: 'high' }], ['get_available_thinking_levels', {}], ['set_auto_compaction', { enabled: true }], ['set_auto_retry', { enabled: false }], ['abort_retry', {}]]) await pi.request(type, params);
  const compact = pi.request('compact', { fixtureDelayMs: 1100 });
  await pi.cancel();
  assert.equal((await compact).summary, 'fixture summary');
  await assert.rejects(pi.request('bash'), { code: 'COMMAND_SCOPE' });
  await assert.rejects(pi.request('set_auto_retry', { enabled: 'yes' }), { code: 'PI_ARGUMENT' });
});

test('main and agent attach to one Pi session, including concurrent startup and reopening', async t => {
  let created = 0;
  const { service, dir, call } = await fixture(t, {
    createPi: config => { created++; return new PiTransport(config); },
  });
  service.piConfig = async () => ({ configDir: dir, piEntry: fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url)) });
  const [main, agent] = await Promise.all([call('pi-connect'), call('pi-connect')]);
  const pid = service.pi.pid;
  const reopened = await call('pi-connect');
  assert.equal(created, 1);
  assert.ok(pid && service.pi.pid === pid);
  assert.ok(main.sessionId && main.sessionFile);
  for (const view of [agent, reopened]) {
    assert.equal(view.sessionId, main.sessionId);
    assert.equal(view.sessionFile, main.sessionFile);
  }
});

test('successful model/thinking RPC choices persist across reconnect; rejected choices preserve defaults', async t => {
  let dir;
  class FakePi extends EventEmitter {
    running = false;
    state = { thinkingLevel: 'medium', model: { provider: 'local', id: 'initial' } };
    async start() { this.running = true; const raw = JSON.parse(await fs.readFile(path.join(dir, 'settings.json')).catch(() => '{}')); this.state = { thinkingLevel: raw.defaultThinkingLevel ?? 'medium', model: { provider: raw.defaultProvider ?? 'local', id: raw.defaultModel ?? 'initial' } }; return this.state; }
    async close() { this.running = false; }
    async request(type, params = {}) {
      if (type === 'get_state') return this.state;
      if (type === 'set_model') { if (params.modelId === 'bad') throw new Error('rejected'); this.state.model = { provider: params.provider, id: params.modelId }; return this.state.model; }
      if (type === 'set_thinking_level') this.state.thinkingLevel = params.level;
      return {};
    }
  }
  const f = await fixture(t, { createPi: () => new FakePi() });
  dir = f.dir; const { service, call } = f;
  service.piConfig = async () => ({ configDir: dir });
  await call('pi-connect');
  await call('pi-command', { type: 'set_model', params: { provider: 'local', modelId: 'chosen' } });
  await call('pi-command', { type: 'set_thinking_level', params: { level: 'high' } });
  await assert.rejects(call('pi-command', { type: 'set_model', params: { provider: 'local', modelId: 'bad' } }));
  const state = await call('pi-reconnect');
  assert.equal(state.model.id, 'chosen'); assert.equal(state.thinkingLevel, 'high');
});
