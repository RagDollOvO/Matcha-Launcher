// Cross-layer offline check: deploy owned native binaries to a synthetic game tree,
// run only l4p_smoke.exe, call the actual plugin through Core, then restore entry.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createPlatform } from '../backend/core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'native', 'build-x86');
const artifacts = path.join(root, 'checks', '.artifacts');
await fs.mkdir(artifacts, { recursive: true });
const gameRoot = await fs.mkdtemp(path.join(artifacts, 'native-core-'));
await fs.mkdir(path.join(gameRoot, 'bin'));
await fs.mkdir(path.join(gameRoot, 'left4dead2'));
const harness = path.join(build, 'fixtures', 'l4p_smoke.exe');
// This copy exists solely for the installer's PE/layout preconditions. It is never run.
await fs.copyFile(harness, path.join(gameRoot, 'left4dead2.exe'));
const original = await fs.readFile(path.join(build, 'fixtures', 'dxvk.dll'));
const entry = path.join(gameRoot, 'bin', 'dxvk_d3d9.dll');
await fs.writeFile(entry, original);
const confirmation = { approved: true, source: 'user' };
let ownedPid = 0;
const core = createPlatform({
  // The production entry retains OS process checks. Here only the owned offline
  // host is mapped into this synthetic game installation for end-to-end invocation.
  getProcesses: async () => ownedPid ? [{ pid: ownedPid, name: 'offline-fixture', path: path.join(gameRoot, 'left4dead2.exe') }] : [],
});
const plan = await core.planInstall({ gameRoot, distRoot: path.join(build, 'dist') });
assert.equal((await core.applyInstall(plan, { confirmation })).status, 'installed');
assert.ok((await core.listPlugins(gameRoot)).some(p => p.manifest.id === 'demo.hello'));
await core.setPluginEnabled({ gameRoot, pluginId: 'demo.hello', enabled: true, confirmation });

const child = spawn(harness, [entry, 'serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '', output = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', text => { stderr += text; });
const exited = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Offline host readiness timed out: ${stderr}`)), 15000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', text => {
      output += text;
      const end = output.indexOf('\n');
      if (end < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(output.slice(0, end))); } catch (error) { reject(error); }
    });
    exited.then(({ code }) => { clearTimeout(timer); reject(new Error(`Offline host exited before readiness (${code}): ${stderr}`)); }, reject);
  });
  ownedPid = ready.pid;
  assert.equal(ownedPid, child.pid);
  const status = await core.runtimeRequest(ownedPid, { type: 'status' });
  assert.equal(status.result.phase, 'render-init');
  assert.equal(status.result.plugins.find(p => p.id === 'demo.hello').state, 'initialized');
  const reply = await core.invokePlugin({ gameRoot, pid: ownedPid, pluginId: 'demo.hello', actionId: 'hello', args: { name: '幸存者' } });
  assert.equal(reply.result.message, 'Hello, 幸存者!');
  await assert.rejects(core.restore(gameRoot, { confirmation }), error => error.code === 'game_running');
  child.stdin.end('\n');
  const end = await Promise.race([exited, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Offline host shutdown timed out')), 10000);
    timer.unref();
  })]);
  assert.equal(end.code, 0, stderr);
  ownedPid = 0;
  const restored = await core.restore(gameRoot, { confirmation });
  assert.equal(restored.status, 'restored');
  assert.deepEqual(await fs.readFile(entry), original);
  console.log(JSON.stringify({ ok: true, gameRoot, nativeBitness: 32, plugin: 'demo.hello', reply: reply.result, restore: restored.status }, null, 2));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.stdin.end('\n');
    const stopTimer = setTimeout(() => child.kill(), 5000);
    await exited.finally(() => clearTimeout(stopTimer));
  }
}
