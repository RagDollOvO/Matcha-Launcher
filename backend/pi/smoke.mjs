import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PiTransport, PLATFORM_TOOLS } from './transport.mjs';
import platformExtension from './platform-extension.mjs';
import { localToolCatalog } from './local-catalog.mjs';

const root = await mkdtemp(join(tmpdir(), 'l4p-pi-smoke-'));
const options = { configDir: join(root, 'agent'), gameRoot: join(root, 'fake-game'),
  piEntry: fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url)), requestTimeoutMs: 3000 };
const pi = new PiTransport(options);
const records = [];
pi.on('event', record => records.push(record));
const state = await pi.start();
try {
  assert.equal(state.configDir, options.configDir);
  assert.equal(state.gameRoot, options.gameRoot);
  assert.equal(state.cwd, join(options.configDir, 'workspace'));
  assert.equal(state.args[state.args.indexOf('--tools') + 1], PLATFORM_TOOLS.join(','));
  assert(state.args.includes('--no-extensions') && state.args.includes('--no-mcp'));
  const settle = new Promise(resolve => {
    const listener = event => {
      if (event.type === 'agent_settled') { pi.off('event', listener); resolve(); }
    };
    pi.on('event', listener);
  });
  await pi.prompt('fixture:text');
  await settle;
  assert.equal(records.find(record => record.type === 'message_update').assistantMessageEvent.delta, '中\u2028文\u2029保持一条 JSONL');
  const [slow, fast] = await Promise.all([pi.request('get_session_stats'), pi.request('get_messages')]);
  assert.equal(slow.fixture, true);
  assert.deepEqual(fast.messages, []);
  await assert.rejects(pi.request('bash', { command: 'anything' }), { code: 'COMMAND_SCOPE' });
  await pi.prompt('fixture:confirm');
  // The child can emit the dialog directly after the accepted prompt response.
  if (!records.some(record => record.type === 'extension_ui_request')) await once(pi, 'event');
  await pi.cancel();
  assert.equal(records.find(record => record.type === 'fixture_answer').answer.cancelled, true);
  await assert.rejects(pi.answerUi('dialog-1', { confirmed: true }), { code: 'DIALOG_EXPIRED' });
} finally { await pi.close(); }
assert.equal(pi.running, false);

const crash = new PiTransport(options);
const exits = [];
crash.on('exit', value => exits.push(value));
await crash.start();
const pending = crash.request('get_session_stats');
await crash.prompt('fixture:exit');
await assert.rejects(pending, { code: 'PI_EXIT' });
assert.equal(exits[0].code, 7);
assert.equal(exits[0].expected, false);

// A declined action returns before Core is imported or an invocation is sent.
const previousRoot = process.env.L4P_GAME_ROOT;
process.env.L4P_GAME_ROOT = options.gameRoot;
try {
  const tools = new Map();
  platformExtension({ registerTool: tool => tools.set(tool.name, tool), on() {} });
  assert.deepEqual([...tools.keys(), ...localToolCatalog().map(t => t.name)].sort(), [...PLATFORM_TOOLS].sort());
  const invoke = tools.get('plugin_invoke');
  assert.equal(invoke.parameters.properties.confirmation, undefined);
  assert.equal(invoke.parameters.additionalProperties, false);
  const declined = await invoke.execute('call-1', { pid: 1, pluginId: 'fixture', actionId: 'write', args: {} },
    new AbortController().signal, undefined, { hasUI: true, ui: { confirm: async () => false } });
  assert.equal(declined.details.applied, false);
  const cancellation = new AbortController();
  await assert.rejects(invoke.execute('call-2', { pid: 1, pluginId: 'fixture', actionId: 'write', args: {} },
    cancellation.signal, undefined, { hasUI: true, ui: { confirm: async () => {
      cancellation.abort();
      return true;
    } } }), /操作已取消/);
} finally {
  if (previousRoot === undefined) delete process.env.L4P_GAME_ROOT;
  else process.env.L4P_GAME_ROOT = previousRoot;
}
console.log(JSON.stringify({ ok: true, checked: ['startup isolation', 'JSONL UTF-8/chunks', 'request IDs',
  'UI cancellation', 'shell command rejection', 'normal EOF', 'unexpected exit', 'declined invocation'], fixtureRoot: root }, null, 2));
