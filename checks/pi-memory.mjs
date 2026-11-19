// Exercise the shipped Pi RPC + extension with a scripted, loopback-only model.
// node checks/pi-memory.mjs [portable Matcha folder]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const portable = process.argv[2] && path.resolve(process.argv[2]);
const { PiTransport } = await import(portable
  ? pathToFileURL(path.join(portable, 'backend/pi/transport.mjs')).href : '../backend/pi/transport.mjs');
const nodePath = portable ? path.join(portable, 'runtime/node.exe') : process.execPath;
const piRoot = (portable ? undefined : process.env.BEACON_PI_PACKAGE)
  ?? path.join(path.dirname(nodePath), 'node_modules/@earendil-works/pi-coding-agent');
const piEntry = path.join(piRoot, 'dist/bundle/cli.js');
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-pi-memory-'));
const file = path.join(configDir, 'MEMORY.md');
const a = '本地武器 Mod 按替换对象分类。', b = '本地武器 Mod 按作者分类。';
let action, received = [], pi;
const server = http.createServer(async (req, res) => {
  const bytes = []; for await (const part of req) bytes.push(part);
  const body = JSON.parse(Buffer.concat(bytes).toString());
  received.push(body);
  const tool = action; action = undefined;
  const piece = (delta, finish_reason) => 'data: ' + JSON.stringify({
    id: 'chatcmpl-fixture', object: 'chat.completion.chunk', model: 'memory-fixture', created: 1,
    choices: [{ index: 0, delta, finish_reason }],
  }) + '\n\n';
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + received.length,
    type: 'function', function: { name: 'player_memory_edit', arguments: JSON.stringify(tool) } }] }
    : { role: 'assistant', content: '完成' };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(piece(delta, null) + piece({}, tool ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n');
});

async function turn(message, edit) {
  received = []; action = edit;
  const events = [];
  let timer, listen;
  const settled = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Pi did not settle')), 20_000);
    listen = e => { events.push(e); if (e.type === 'agent_settled') resolve(); };
    pi.on('event', listen);
  });
  try { await Promise.all([settled, pi.prompt(message)]); }
  finally { clearTimeout(timer); pi.off('event', listen); }
  const last = events.findLast(e => e.type === 'message_end' && e.message?.role === 'assistant');
  assert(received.length, last?.message?.errorMessage || 'No request reached the local model');
  if (edit) {
    const done = events.find(e => e.type === 'tool_execution_end' && e.toolName === 'player_memory_edit');
    assert(done && !done.isError && done.result?.details?.status === 'saved', JSON.stringify(done?.result));
  }
  return received;
}
async function openPi() {
  pi = new PiTransport({ nodePath, piEntry, configDir, ephemeral: true });
  await pi.start();
  await pi.request('set_model', { provider: 'matcha-fixture', modelId: 'memory-fixture' });
}
const injected = req => req.messages
  .filter(m => m.role === 'user' && JSON.stringify(m.content).includes('Matcha 的本地玩家偏好记录'))
  .map(m => JSON.stringify(m.content)).join('');
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  await fs.writeFile(path.join(configDir, 'models.json'), JSON.stringify({ providers: {
    'matcha-fixture': { baseUrl, api: 'openai-completions', apiKey: 'offline-fixture',
      models: [{ id: 'memory-fixture', name: 'memory-fixture', contextWindow: 32000, maxTokens: 512 }] },
  } }));
  await fs.writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
    defaultProvider: 'matcha-fixture', defaultModel: 'memory-fixture', defaultThinkingLevel: 'off', retry: { enabled: false },
  }));
  await openPi();
  const original = (await fs.readFile(file, 'utf8')) + '\r\n玩家手写的说明。\r\n';
  await fs.writeFile(file, original);
  await turn('记住这个分类偏好：' + a, { previous: '', note: a });
  assert((await fs.readFile(file, 'utf8')).includes('- ' + a));
  await pi.close();
  await openPi(); // independent process, no shared messages
  const [before, after] = await turn('改用按作者分类。', { previous: a, note: b });
  assert(injected(before).includes(a), 'New session should receive the previous preference');
  assert(injected(after).includes(b) && !injected(after).includes(a), 'The next request should see the edit');
  const [forget, cleared] = await turn('忘掉这个习惯。', { previous: b, note: '' });
  assert(injected(forget).includes(b) && !injected(cleared));
  assert.equal(await fs.readFile(file, 'utf8'), original, 'Handwritten content should survive all edits');
  console.log('Pi RPC: remembered, recalled after restart, corrected and forgot; handwritten text preserved.');
} finally {
  await pi?.close();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(configDir, { recursive: true, force: true });
}
