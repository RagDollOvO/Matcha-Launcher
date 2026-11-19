// First-party module lifecycle using the real x86 runtime and isolated files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPlatform } from '../backend/core.mjs';
import { peFixture } from '../backend/tests/fixtures.mjs';

const project = path.resolve(import.meta.dirname, '..');
const build = path.join(project, 'native/build-x86');
const artifacts = path.join(project, 'checks/.artifacts');
await fs.mkdir(artifacts, { recursive: true });
const root = await fs.mkdtemp(path.join(artifacts, 'radar-light-'));
const steamRoot = path.join(root, 'steam');
const steamApps = path.join(steamRoot, 'steamapps');
const steamExe = path.join(steamRoot, 'steam.exe');
const gameRoot = path.join(steamApps, 'common/Left 4 Dead 2');
const distRoot = path.join(root, 'dist');
const runtime = path.join(gameRoot, 'bin/l4p');
const radar = 'ragdoll.supply-radar';
const menu = 'flare.game-ui';
const confirmation = { approved: true, source: 'user' };
const sources = path.join(build, 'dist/bin');
await fs.mkdir(path.join(gameRoot, 'bin'), { recursive: true });
await fs.mkdir(path.join(gameRoot, 'left4dead2'));
await fs.mkdir(path.join(distRoot, 'bin/l4p/plugins'), { recursive: true });
await fs.writeFile(path.join(steamApps, 'appmanifest_550.acf'), '"AppState" { "appid" "550" "installdir" "Left 4 Dead 2" }');
await fs.writeFile(steamExe, 'Never executed');
await fs.writeFile(path.join(gameRoot, 'left4dead2.exe'), peFixture([], { dll: false }));
await fs.copyFile(path.join(build, 'fixtures/dxvk.dll'), path.join(gameRoot, 'bin/dxvk_d3d9.dll'));
for (const file of ['dxvk_d3d9.dll', 'l4p/l4p_runtime.dll', 'l4p/enabled.txt'])
  await fs.copyFile(path.join(sources, file), path.join(distRoot, 'bin', file));
for (const id of [menu, radar])
  await fs.cp(path.join(sources, 'l4p/plugins', id), path.join(distRoot, 'bin/l4p/plugins', id), { recursive: true });

const spawned = [];
const platform = createPlatform({
  getProcesses: async () => [],
  isSteamRunning: async () => true,
  launchGame: async (exe, args, cwd) => { spawned.push({ exe, args, cwd }); return {}; },
});
await platform.applyInstall(await platform.planInstall({ gameRoot, distRoot }), { confirmation });
const preview = path.join(root, 'radar-settings.bmp');
const run = mode => execFileSync(path.join(build, 'fixtures/radar_runtime_smoke.exe'),
  [runtime, mode, preview], { stdio: 'inherit', windowsHide: true, timeout: 10000 });
run('empty');
assert.deepEqual((await platform.setPluginEnabled({ gameRoot, pluginId: radar, enabled: true, confirmation })).enabled, [menu, radar]);
await platform.launch({ gameRoot, mode: 'modded', steamExe, confirmation, platformDataDir: root });
assert.deepEqual(spawned[0].args, ['-steam', '-novid']);
run('enabled');

// Use the identical menu state machine/renderer with a drawing sink on an
// offline host. The actual radar DLL handles edits and writes its own settings.
await fs.copyFile(path.join(build, 'fixtures/radar_settings_smoke.dll'), path.join(runtime, 'plugins', menu, 'plugin.dll'));
const radarData = path.join(runtime, 'data', radar);
await fs.mkdir(radarData, { recursive: true });
await fs.writeFile(path.join(radarData, 'settings.ini'), '[SupplyRadar]\r\nIconOpacity=100\r\n[Item33]\r\nY=3100\r\n');
run('settings');
assert.deepEqual((await platform.setPluginEnabled({ gameRoot, pluginId: radar, enabled: false, confirmation })).enabled, []);
run('empty');

await fs.copyFile(path.join(sources, 'l4p/plugins', menu, 'plugin.dll'), path.join(runtime, 'plugins', menu, 'plugin.dll'));
await platform.setPluginEnabled({ gameRoot, pluginId: radar, enabled: true, confirmation });
await assert.rejects(platform.launch({ gameRoot, mode: 'clean', steamExe, confirmation }), { code: 'clean_game_modified' });
assert.equal(spawned.length, 1);
await platform.restore(gameRoot, { confirmation });
await platform.launch({ gameRoot, mode: 'clean', steamExe, confirmation });
assert.deepEqual(spawned[1].args, ['-steam', '-novid']);
assert.equal(spawned[1].cwd, gameRoot);
await platform.resumeRuntime(gameRoot, { confirmation });
run('enabled');
assert.match(await fs.readFile(path.join(radarData, 'settings.ini'), 'utf8'), /IconOpacity=50/);
console.log(JSON.stringify({ preview, gameLaunch: 'stubbed', moddedStateRestored: true }));
