import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DesktopService } from '../desktop/service.mjs';
import { setCvars, removeAssignments } from '../cfg-text.mjs';
import { steamLaunchOptions } from '../game-config.mjs';
import { settingsHost } from './settings-host.mjs';
import { platformTools, platformToolCatalog } from './platform-extension.mjs';
import { CHECKUP_SKILL, readSkill } from './skill-files.mjs';
import { PiTransport } from './transport.mjs';

const USER_CFG = '// my binds\r\nbind "F1" "say hi"\r\nfps_max 120\r\n';

async function fixture(t, { running = false } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-settings-agent-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const steamRoot = path.join(base, 'Steam'), gameRoot = path.join(steamRoot, 'steamapps', 'common', 'Left 4 Dead 2');
  const cfgDir = path.join(gameRoot, 'left4dead2', 'cfg');
  await fs.mkdir(cfgDir, { recursive: true });
  await fs.writeFile(path.join(cfgDir, 'autoexec.cfg'), USER_CFG);
  await fs.writeFile(path.join(cfgDir, 'config.cfg'), 'unbindall\nbind "w" "+forward"\n');
  const userCfg = path.join(steamRoot, 'userdata', '4242', 'config');
  await fs.mkdir(userCfg, { recursive: true });
  await fs.writeFile(path.join(userCfg, 'localconfig.vdf'), '"UserLocalConfigStore"\n{\n "Software"\n {\n  "Valve"\n  {\n   "Steam"\n   {\n    "apps"\n    {\n     "550"\n     {\n      "LaunchOptions" "-novid -insecure"\n     }\n    }\n   }\n  }\n }\n}\n');
  const state = { running };
  const core = { discover: async () => ({ games: [{ gameRoot }], warnings: [] }),
    inspectGame: async root => ({ gameRoot: root, platform: { status: 'absent' }, processes: state.running ? [{ pid: 7, path: path.join(root, 'left4dead2.exe') }] : [] }),
    launch: async () => { throw new Error('launch stays with the user'); } };
  const service = new DesktopService({ dataDir: path.join(base, 'data'), core });
  t.after(() => service.close()); await service.ready;
  const events = [];
  service.on('event', e => events.push(e));
  const tools = new Map(platformTools('', { modRequest: settingsHost(service) }).map(tool => [tool.name, tool]));
  const prompts = [];
  const run = async (name, params = {}, answer = true) => (await tools.get(name).execute('fixture', params, new AbortController().signal, undefined,
    { hasUI: true, ui: { confirm: async (title, message) => { prompts.push({ title, message }); return typeof answer === 'function' ? answer() : answer; } } })).details;
  return { service, run, events, prompts, gameRoot, cfgDir, steamRoot, state };
}

test('cfg-text keeps comments and quote style, appends missing cvars and removes deleted ones', () => {
  const text = '// 准星\ncl_crosshair_alpha "200"\nnet_graph 1; net_graphpos 2\nbind "F1" "say hi"';
  const r = setCvars(text, { cl_crosshair_alpha: '255', net_graph: null, fps_max: 0 });
  assert.equal(r.text, '// 准星\ncl_crosshair_alpha "255"\nnet_graphpos 2\nbind "F1" "say hi"\n\n// 茶茶调整\nfps_max "0"');
  assert.deepEqual(r.changes.map(c => [c.key, c.before, c.after]), [['cl_crosshair_alpha', '200', '255'], ['net_graph', '1', null], ['fps_max', null, '0']]);
  assert.equal(removeAssignments('a 1\r\nb 2\r\n', 'a'), 'b 2\r\n');
  assert.throws(() => setCvars('', { 'bad key': '1' }), e => e.code === 'cfg_invalid' && e.details.field === 'cvars.bad key');
  assert.throws(() => setCvars('', { fps_max: '0; quit' }), e => e.code === 'cfg_invalid');
});

test('game_config_inspect reads launch argv, Steam launch options and cfg files without writing', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.cfgDir, 'autoexec.cfg'));
  const r = await f.run('game_config_inspect');
  assert.deepEqual(r.launch.effective.clean, ['-steam', '-novid']);
  assert.equal(r.launch.route, 'game-exe');
  assert.ok(r.launch.steamLaunchOptions.some(e => e.accountId === '4242' && e.text === '-novid -insecure'));
  assert.equal(r.cfg.autoexec.text, USER_CFG);
  assert.equal(r.cfg.autoexec.managed.present, false);
  assert.deepEqual(r.cfg.files.map(x => x.name), ['autoexec.cfg', 'config.cfg']);
  assert.match((await f.run('game_config_inspect', { file: 'config.cfg' })).cfg.file.text, /unbindall/);
  await assert.rejects(f.run('game_config_inspect', { file: '../left4dead2.exe' }), e => e.code === 'cfg_file_invalid');
  assert.deepEqual(await fs.readFile(path.join(f.cfgDir, 'autoexec.cfg')), before);
  const direct = await steamLaunchOptions(f.gameRoot, { roots: [] });
  assert.equal(direct.entries.length, 1);
});

test('game_settings_update previews, respects cancel, then writes only the managed block after confirmation', async t => {
  const f = await fixture(t);
  const file = path.join(f.cfgDir, 'autoexec.cfg'), original = await fs.readFile(file);
  const params = { launch: { console: true, display: { mode: 'windowed' } }, cvars: { cl_glow_survivor_r: '0', net_graph: '1' } };
  assert.equal((await f.run('game_settings_update', params, false)).applied, false);
  assert.deepEqual(await fs.readFile(file), original);
  assert.equal(f.service.gameSettings().console, false);
  assert.match(f.prompts[0].message, /开局打开控制台：关 → 开/);
  assert.match(f.prompts[0].message, /窗口模式：默认 → 窗口/);
  assert.match(f.prompts[0].message, /L4N 平台启动：.*-console/);

  const done = await f.run('game_settings_update', params);
  assert.equal(done.applied, true);
  assert.equal(f.service.gameSettings().console, true);
  assert.equal(f.service.gameSettings().autoexec.enabled, true);
  const written = await fs.readFile(file, 'utf8');
  assert.ok(written.startsWith(USER_CFG), 'text outside the Matcha block stays byte-for-byte');
  assert.match(written, /cl_glow_survivor_r "0"\r\nnet_graph "1"\r\n\/\/ <<< Matcha/);
  assert.ok(f.events.some(e => e.type === 'settings_changed' && e.scopes.includes('game-settings')));
  assert.equal((await f.run('game_settings_update', params)).status, 'unchanged');

  // A page save between preview and confirmation invalidates the plan.
  const stale = await f.run('game_settings_update', { launch: { highPriority: true } }, async () => {
    await f.service.dispatch('game-settings-set', { ...f.service.gameSettings(), novid: false });
    return true;
  }).catch(e => e);
  assert.equal(stale.code, 'settings_plan_stale');
  assert.equal(f.service.gameSettings().highPriority, false);
  await assert.rejects(f.run('game_settings_update', { launch: { extraArgs: '+connect 1.2.3.4' } }), e => e.code === 'game_settings_invalid');
});

test('launcher_settings_update changes downloads and routes UI preferences through the main window', async t => {
  const f = await fixture(t);
  assert.equal((await f.run('launcher_settings_update', { section: 'downloads', patch: { maxConcurrent: 3 } })).applied, true);
  assert.equal(f.service.tasks.settings.maxConcurrent, 3);
  await assert.rejects(f.run('launcher_settings_update', { section: 'downloads', patch: { maxConcurrent: 9 } }), /1–4/);

  // Stand-in for the main window: answers ui_request through the ui-response bridge command.
  const prefs = { zoom: 1 };
  f.service.on('event', e => {
    if (e.type !== 'ui_request') return;
    const changes = e.action === 'prefs-set' ? Object.entries(e.patch).filter(([k, v]) => prefs[k] !== v).map(([key, to]) => ({ key, label: '界面缩放', from: prefs[key], to })) : [];
    if (e.action === 'prefs-set' && !e.dryRun) Object.assign(prefs, e.patch);
    void f.service.dispatch('ui-response', { requestId: e.requestId, ok: true, value: e.action === 'prefs-get' ? { prefs: [{ key: 'zoom', value: prefs.zoom }] } : { applied: !e.dryRun, changes } });
  });
  const seen = await f.run('launcher_settings_inspect');
  assert.deepEqual(seen.ui.prefs, [{ key: 'zoom', value: 1 }]);
  assert.ok(seen.readOnly.some(line => line.includes('API Key')));
  const r = await f.run('launcher_settings_update', { section: 'ui', patch: { zoom: 1.1 } });
  assert.equal(r.applied, true);
  assert.equal(prefs.zoom, 1.1);
  assert.match(f.prompts.at(-1).message, /界面缩放：1 → 1.1/);
  assert.deepEqual(await f.service.dispatch('ui-response', { requestId: 'gone', ok: true }), { status: 'expired' });
});

test('checkup skill and settings tools are registered for the Pi CLI', async () => {
  const catalog = platformToolCatalog();
  for (const [name, write] of [['game_config_inspect', false], ['game_settings_update', true], ['launcher_settings_inspect', false], ['launcher_settings_update', true]]) {
    assert.equal(catalog.find(tool => tool.name === name)?.write, write, name);
  }
  assert.match((await readSkill({ path: CHECKUP_SKILL })).content[0].text, /game_config_inspect/);
  const transport = new PiTransport({ piEntry: path.join(os.tmpdir(), 'pi.js'), nodePath: process.execPath, configDir: os.tmpdir(), sessionDir: os.tmpdir() });
  assert.ok(transport.buildArgs().includes(CHECKUP_SKILL));
});
