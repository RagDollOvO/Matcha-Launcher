import { spawn } from 'node:child_process';
const address = 'http://localhost:5173/__beacon/session';
let running = false;
try {
  const response = await fetch(address, { signal: AbortSignal.timeout(1500) });
  running = response.ok && typeof (await response.json()).token === 'string';
} catch {}
if (!running) {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', windowsHide: true });
  child.on('exit', code => process.exit(code ?? 1));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill());
}
