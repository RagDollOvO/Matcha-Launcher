// Exercise the shipped Pi RPC and confirmation bridge against a loopback model.
// Usage: node backend/pi/local-tools-smoke.mjs <absolute path to Pi dist/bundle/cli.js>
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { localToolCatalog } from './local-catalog.mjs';
const { PiTransport } = await import(process.argv[3] ? pathToFileURL(path.resolve(process.argv[3])).href : './transport.mjs');

const root = await mkdtemp(path.join(tmpdir(), 'matcha-local-tools-'));
const cwd = path.join(root, '模拟 游戏目录'); await mkdir(cwd);
const file = path.join(cwd, '说明.txt');
const shell = process.platform === 'win32' ? 'local_powershell' : 'local_bash';
const command = process.platform === 'win32' ? '[IO.File]::ReadAllText((Join-Path (Get-Location) "说明.txt"))' : 'cat 说明.txt';
const steps = [
  ['local_write', { path: file, content: 'initial' }],
  ['local_edit', { path: file, edits: [{ oldText: 'initial', newText: '修改完成' }] }],
  ['local_read', { path: file }],
  [shell, { cwd, command }],
  ['local_write', { path: file, content: 'declined' }],
  ['local_ls', { path: cwd }],
  ['local_find', { path: cwd, pattern: '**/*.txt' }],
  ['local_grep', { path: cwd, pattern: '修改完成' }],
  ...(process.platform === 'win32' ? [['local_bash', { cwd, command: 'printf bash-ok' }]] : []),
];
let turn = 0, shown = [], errors = [], results = [];
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  shown = request.tools.map(t => t.function.name);
  results = request.messages.filter(m => m.role === 'tool');
  const step = steps[turn++];
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const part = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({
    id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }],
  }) + '\n\n');
  if (step) part({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + turn, type: 'function',
    function: { name: step[0], arguments: JSON.stringify(step[1]) } }] });
  else part({ role: 'assistant', content: 'done' });
  part({}, step ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const configDir = path.join(root, 'config'); await mkdir(configDir);
const provider = { baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', api: 'openai-completions',
  apiKey: 'local-fixture', models: [{ id: 'fixture', name: 'Fixture', contextWindow: 131072, maxTokens: 4096 }] };
await writeFile(path.join(configDir, 'models.json'), JSON.stringify({ providers: { fixture: provider } }));
const pi = new PiTransport({ configDir, cwd, ephemeral: true, piEntry: process.argv[2], requestTimeoutMs: 30000 });
const dialogs = [];
pi.on('diagnostic', d => errors.push(d.text));
pi.on('event', e => {
  if (e.type === 'extension_ui_request' && e.method === 'confirm') {
    dialogs.push(e.message); void pi.answerUi(e.id, { confirmed: !e.message.includes('declined') }).catch(e => errors.push(e.message));
  }
  if (e.type === 'message_end' && e.message.errorMessage) errors.push(e.message.errorMessage);
});
try {
  await pi.start();
  await pi.request('set_model', { provider: 'fixture', modelId: 'fixture' });
  const settled = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RPC timeout: ' + errors.join('\n'))), 45000);
    pi.on('event', e => { if (e.type === 'agent_settled') { clearTimeout(timer); resolve(); } });
  });
  await pi.prompt('Run the local fixture.'); await settled;
  assert.deepEqual([...shown.filter(n => n.startsWith('local_'))].sort(), localToolCatalog().map(t => t.name).sort(), errors.join('\n'));
  assert.equal(dialogs.length, steps.length, JSON.stringify({ errors, results }));
  assert(dialogs[3].includes(command) && dialogs[3].includes(cwd));
  assert.match(JSON.stringify(results[2].content), /修改完成/); assert.match(JSON.stringify(results[3].content), /修改完成/);
  assert.match(JSON.stringify(results[4].content), /取消/); assert.equal(await readFile(file, 'utf8'), '修改完成');
  for (const i of [5, 6, 7]) assert.match(JSON.stringify(results[i].content), /说明.txt/);
  if (steps.length > 8) assert.match(JSON.stringify(results[8].content), /bash-ok/);
  console.log('Local Pi RPC: catalog, write, edit, read, shell cwd/output and declined write passed.');
} finally { await pi.close(); server.close(); server.closeAllConnections(); }
