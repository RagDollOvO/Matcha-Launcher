import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const build = path.join(root, 'native/build-x86');
const run = args => execFileSync('cmake', args, { cwd: root, stdio: 'inherit', windowsHide: true });
if (!await fs.access(path.join(build, 'CMakeCache.txt')).then(() => true, () => false)) {
  const tools = path.join(root, '.tools');
  const portable = (await fs.readdir(tools).catch(() => [])).find(n => n.startsWith('llvm-mingw-') && !n.endsWith('.zip'));
  const compiler = process.env.FLARE_CXX ?? (portable && path.join(tools, portable, 'bin/i686-w64-mingw32-clang++.exe'));
  if (!compiler) throw new Error('Set FLARE_CXX to a Windows C++ compiler, or configure native/build-x86 first.');
  run(['-S', 'native', '-B', build, '-G', 'Ninja', `-DCMAKE_CXX_COMPILER=${compiler}`, '-DCMAKE_BUILD_TYPE=Release']);
}
// Keep audio:build narrow; desktop packaging also builds its bundled DLLs.
const targets = process.argv.includes('--desktop')
  ? ['flare_audio', 'matcha_recycle', 'matcha_l4n_bridge', 'l4p_runtime', 'beacon_verify', 'flare_game_ui', 'ragdoll_supply_radar']
  : ['flare_audio'];
run(['--build', build, '--target', ...targets, '-j', '2']);
