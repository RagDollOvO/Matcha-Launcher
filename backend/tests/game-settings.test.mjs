import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultGameSettings, validateGameSettings, patchAutoexec, autoexecPath, writeAutoexec } from '../game-settings.mjs';
import { launchSpec } from '../launch.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { createPlatform } from '../core.mjs';
import { createFixture } from './fixtures.mjs';

test('game argv: validation, grouped dedup, explicit toggles and connect-last; old callers unchanged', () => {
  const value = defaultGameSettings();
  Object.assign(value, { fpsMax: 0, console: true, extraArgs: '-novid -w 2560 -h 2560 -heapsize 2097152' });
  value.display = { mode: 'noborder', width: 1920, height: 1080 };
  const direct = launchSpec('direct', 'localhost:27015', value).launchOptions;
  assert.deepEqual(direct.slice(-2), ['+connect', 'localhost:27015']);
  assert.equal(direct.filter(x => x === '-novid').length, 1);
  assert.equal(direct.filter(x => x === '-w').length, 1);
  assert.equal(direct[direct.indexOf('-w') + 1], '2560');
  assert.equal(direct[direct.indexOf('-h') + 1], '2560');
  assert(direct.includes('-windowed') && direct.includes('-noborder') && !direct.includes('-insecure'));
  assert.deepEqual(launchSpec('modded', 'localhost:27015', value).launchOptions, direct);
  assert(launchSpec('development', undefined, value).launchOptions.includes('-insecure'));
  assert.equal(launchSpec('direct', undefined, { ...value, novid: false, extraArgs: '' }).launchOptions.includes('-novid'), false);
  assert.deepEqual(launchSpec().launchOptions, ['-insecure']);
  const full = { ...value, lowViolence: true, consoleLog: true, display: { ...value.display, mode: 'fullscreen', refreshHz: 165 }, extraArgs: '' };
  assert.deepEqual(launchSpec('modded', undefined, full).launchOptions.filter((_, i, a) => a[i - 1] === '-refresh'), ['165']);
  assert(launchSpec('modded', undefined, full).launchOptions.includes('-condebug'));
  assert.equal(launchSpec('modded', undefined, { ...full, extraArgs: '-lv' }).launchOptions.filter(v => v === '-lv').length, 1);
  assert.equal(validateGameSettings({ ...value, lowViolence: undefined }).lowViolence, false);
  assert.deepEqual(launchSpec('clean', undefined, full).launchOptions, ['-steam', '-novid']);
  assert(!launchSpec('modded', undefined, { ...full, extraArgs: '-windowed' }).launchOptions.includes('-refresh'));
  const override = launchSpec('modded', undefined, { ...full, extraArgs: '-freq 144' }).launchOptions;
  assert(!override.includes('-refresh')); assert(override.includes('144'));
  assert.throws(() => validateGameSettings({ ...full, display: { ...full.display, refreshHz: 0 } }), { code: 'game_settings_invalid' });
  assert.equal(validateGameSettings({ ...value, consoleLog: undefined }).display.refreshHz, null);
  for (const arg of ['+connect host', '-INSECURE', '-game=x', '-applaunch 550', '-w "1920"', '-console\n-high']) {
    assert.throws(() => validateGameSettings({ ...value, extraArgs: arg }), e => e.code === 'game_settings_invalid' && e.details.field === 'extraArgs');
  }
  assert.throws(() => validateGameSettings({ ...value, fpsMax: 1001 }), { code: 'game_settings_invalid' });
  assert.throws(() => validateGameSettings({ ...value, display: { ...value.display, width: 319 } }), { code: 'game_settings_invalid' });
  assert.throws(() => validateGameSettings({ ...value, autoexec: { enabled: true, values: { volume: '1"\nquit' }, extra: '' } }), { code: 'game_settings_invalid' });
  assert.throws(() => validateGameSettings({ ...value, autoexec: { enabled: true, values: {}, extra: 'bind "F5 jpeg' } }), { code: 'game_settings_invalid' });
});

test('autoexec: preserve outside bytes, BOM, newline style, backup and guarded writes', async () => {
  const config = { enabled: true, values: { mat_queue_mode: '2', volume: '' }, extra: 'bind "F5" "jpeg"' };
  for (const original of [Buffer.from('\uFEFF// 用户原文\r\nvolume "0.8"\r\n'), Buffer.from('last line without newline'), Buffer.from([0x2f,0x2f,0x20,0xd6,0xd0,0xce,0xc4,0x0d,0x0a])]) {
    const patched = patchAutoexec(original, config);
    assert(patched.subarray(0, original.length).equals(original));
    assert(patchAutoexec(patched, config).equals(patched));
    assert(patchAutoexec(patched, { ...config, enabled: false }).equals(original));
  }
  const original = Buffer.from('before\r\n// >>> Flare\r\nold "1"\r\n// <<< Flare\r\nafter');
  const patched = patchAutoexec(original, config).toString();
  // 旧版的 Flare 标记照样认，重写后换成 Matcha
  assert(patched.includes('// >>> Matcha') && patched.includes('// <<< Matcha') && !patched.includes('Flare'));
  assert(patched.startsWith('before\r\n')); assert(patched.endsWith('\r\nafter')); assert(!patched.includes('old "1"'));
  assert.throws(() => patchAutoexec(Buffer.from('// >>> Flare\nuser data'), config), { code: 'game_settings_invalid' });
  assert.throws(() => patchAutoexec(Buffer.from('// >>> Flare\n// >>> Flare\n// <<< Flare\n'), config), { code: 'game_settings_invalid' });
  const unmanaged = Buffer.from('\uFEFFvolume "0.8"', 'utf16le');
  assert(patchAutoexec(unmanaged, { ...config, enabled: false }).equals(unmanaged));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-autoexec-'));
  await fs.mkdir(path.join(root, 'left4dead2/cfg'), { recursive: true });
  const file = autoexecPath(root); await fs.writeFile(file, original);
  assert.equal((await writeAutoexec(root, config, async () => false)).pending, true);
  assert((await fs.readFile(file)).equals(original));
  await writeAutoexec(root, config, async () => true);
  await writeAutoexec(root, { ...config, values: { mat_queue_mode: '0' } }, async () => true);
  assert((await fs.readFile(`${file}.matcha.bak`)).equals(original));
  // 改名前留的 .flare.bak 是最早的原文件：改名接上，不拿当前内容另起一份
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-autoexec-legacy-'));
  await fs.mkdir(path.join(oldRoot, 'left4dead2/cfg'), { recursive: true });
  const oldFile = autoexecPath(oldRoot), pristine = Buffer.from('bind "h" "show_menu Menu"\r\n');
  await fs.writeFile(oldFile, original); await fs.writeFile(`${oldFile}.flare.bak`, pristine);
  await writeAutoexec(oldRoot, config, async () => true);
  assert((await fs.readFile(`${oldFile}.matcha.bak`)).equals(pristine));
  await assert.rejects(fs.access(`${oldFile}.flare.bak`));
  await fs.rm(oldRoot, { recursive: true, force: true });
  const linkedRoot = path.join(root, 'linked-game'); await fs.mkdir(path.join(linkedRoot, 'left4dead2'), { recursive: true });
  await fs.symlink(path.join(root, 'left4dead2/cfg'), path.join(linkedRoot, 'left4dead2/cfg'), 'junction');
  await assert.rejects(writeAutoexec(linkedRoot, config, async () => true), { code: 'game_settings_invalid' });
});

test('desktop: persisted settings reach launch and server connection; retired platform tasks stay retired', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-game-settings-'));
  const f = await createFixture(dir), launches = []; let running = [];
  const platform = createPlatform({ getProcesses: async () => running });
  const api = { ...platform, discover: async () => ({ games: [], warnings: [] }), launch: async p => {
    assert.match(await fs.readFile(autoexecPath(f.gameRoot), 'utf8'), /mat_queue_mode "2"/);
    launches.push({ ...p, spec: launchSpec(p.mode, p.connect, p.gameSettings) }); return { status: 'requested' };
  } };
  const dataDir = path.join(dir, 'profile'), service = new DesktopService({ dataDir, core: api, distRoot: f.distRoot });
  t.after(() => service.close()); await service.ready;
  const draft = defaultGameSettings(); draft.display = { mode: 'fullscreen', width: 1920, height: 1080, refreshHz: 165 }; draft.fpsMax = 144; draft.consoleLog = true;
  draft.autoexec = { enabled: true, values: { mat_queue_mode: '2', volume: '0.35', closecaption: '1', cc_subtitles: '0' }, extra: '' };
  // Saving without a selected game records settings for later use.
  const offline = await service.dispatch('game-settings-set', draft); assert.equal(offline.autoexecPath, undefined);
  service.settings.gameRoot = f.gameRoot;
  running = [{ pid: 10, name: 'left4dead2.exe' }];
  await service.dispatch('game-settings-set', draft);
  await assert.rejects(fs.access(autoexecPath(f.gameRoot)), { code: 'ENOENT' });
  await assert.rejects(service.dispatch('launch'), { code: 'confirmation_required' });
  await assert.rejects(service.dispatch('launch', {}, { approved: true, source: 'user' }), { code: 'game_running' });
  running = [];
  service.applyModProfile = async () => {};
  const confirmation = { approved: true, source: 'user' };
  await service.dispatch('launch', {}, confirmation);
  service.serverManager.connectTarget = async () => 'localhost:27015';
  await service.dispatch('connect-server', { id: 'fixture', mode: 'development' }, confirmation);
  await assert.rejects(service.runTask('platform-launch', { gameRoot: f.gameRoot, params: { mode: 'direct' }, planId: 'fixture' }, {}), { code: 'platform_retired' });
  assert.equal(launches.length, 2);
  const reply = await service.dispatch('game-settings-get');
  assert(reply.effective.modded.includes('165')); assert(reply.effective.modded.includes('-condebug'));
  assert.deepEqual(launches[0].spec.launchOptions, reply.effective.modded);
  assert.deepEqual(launches[1].spec.launchOptions, [...reply.effective.modded, '+connect', 'localhost:27015']);
  const snapshot = await service.dispatch('snapshot'); assert.equal(snapshot.capabilities.config, true);
  assert.deepEqual(snapshot.launch.launchOptions, reply.effective.modded);
  const restored = new DesktopService({ dataDir, core: api }); t.after(() => restored.close());
  assert.equal((await restored.dispatch('game-settings-get')).fpsMax, 144);
  await assert.rejects(service.dispatch('game-settings-set', { ...draft, fpsMax: -1 }), { code: 'game_settings_invalid' });
  assert.equal((await service.dispatch('game-settings-get')).fpsMax, 144);
});
