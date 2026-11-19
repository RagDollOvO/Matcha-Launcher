// Interactive offline fixture: real Flare UI -> shared service -> x86 smoke host.
// The synthetic left4dead2.exe is metadata only; only our l4p_smoke.exe is executed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import * as core from '../backend/core.mjs';
import { beaconBridge } from '../backend/desktop/vite-plugin.mjs';

const project = path.resolve(import.meta.dirname, '..');
const build = path.join(project, 'native/build-x86');
const base = await fs.mkdtemp(path.join(project, 'checks/.artifacts/desktop-ui-'));
const gameRoot = path.join(base, 'game'), dataDir = path.join(base, 'settings');
await fs.mkdir(path.join(gameRoot, 'bin'), { recursive: true });
await fs.mkdir(path.join(gameRoot, 'left4dead2'));
await fs.mkdir(dataDir);
const harness = path.join(build, 'fixtures/l4p_smoke.exe');
await fs.copyFile(harness, path.join(gameRoot, 'left4dead2.exe'));
await fs.copyFile(path.join(build, 'fixtures/dxvk.dll'), path.join(gameRoot, 'bin/dxvk_d3d9.dll'));
let pid = 0;
const api = { ...core, ...core.createPlatform({ getProcesses: async () => pid ? [{ pid, name: 'offline-fixture', path: path.join(gameRoot, 'left4dead2.exe') }] : [] }) };
api.discover = async () => ({ games: [await api.inspectGame(gameRoot)], warnings: [] });
const plan = await api.planInstall({ gameRoot, distRoot: path.join(build, 'dist') });
await api.applyInstall(plan, { confirmation: { approved: true, source: 'user' } });
const career = process.argv.includes('--career');
if (career) await api.setPluginEnabled({ gameRoot, pluginId: 'skeeto.career', enabled: true, confirmation: { approved: true, source: 'user' } });
const child = spawn(harness, [path.join(gameRoot, 'bin/dxvk_d3d9.dll'), 'serve', ...(career ? [path.join(build, 'fixtures/career/steam_api.dll')] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const exited = new Promise(resolve => child.once('exit', resolve));
try {
  pid = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Offline host readiness timeout')), 15000);
    child.once('error', reject);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.slice(0, output.indexOf('\n'))).pid); } });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
  });
  const server = await createServer({ root: project, cacheDir: path.join(base, 'vite-cache'), configFile: false, plugins: [svelte(), beaconBridge({ core: api, dataDir })], server: { port: 5174, strictPort: true }, clearScreen: false });
  await server.listen();
  console.log(JSON.stringify({ url: 'http://localhost:5174', gameRoot, pid, offline: true }));
  console.log('Send a newline to close the owned fixture server and smoke host.');
  await new Promise(resolve => { process.stdin.once('data', resolve); process.stdin.once('end', resolve); process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  process.stdin.pause();
  await server.close();
} finally {
  child.stdin.end('\n');
  const timer = setTimeout(() => child.kill(), 5000);
  await exited; clearTimeout(timer);
}
