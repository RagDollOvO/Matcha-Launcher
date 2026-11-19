// 「导入已有参数」：Steam 启动选项拆成 Matcha 启动项、autoexec.cfg 接管进管理段、预览后被改过就不写。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseLaunchOptions, mergeExtraArgs, adoptAutoexecText, importHost } from './game-settings-import.mjs';
import { defaultGameSettings, validateGameSettings, writeAutoexec } from './game-settings.mjs';

test('Steam 启动选项：认得的进开关，其余整组进自定义启动项', () => {
  const a = parseLaunchOptions('-heapsize 2096999 -processheap +precache_all_survivors 1 -language English -lv');
  assert.deepEqual(a.patch, { lowViolence: true });
  assert.deepEqual(a.extra, ['-heapsize 2096999', '-processheap', '+precache_all_survivors 1', '-language English']);
  const b = parseLaunchOptions('-steam -novid -w 2560 -h 1440 -fullscreen -refresh 144 +fps_max 0 +connect 1.2.3.4 -x "a b"');
  assert.deepEqual(b.patch, { novid: true, fpsMax: 0, display: { mode: 'fullscreen', width: 2560, height: 1440, refreshHz: 144 } });
  assert.deepEqual(b.skipped.map(s => s.text), ['+connect 1.2.3.4', '-x "a b"']);
  const c = parseLaunchOptions('X=1 %command% -sw -noborder -freq 60 -w 1920');
  assert.deepEqual(c.patch, { display: { mode: 'noborder' } });
  assert.deepEqual(c.extra, ['-w 1920', '-freq 60'], '单个宽、非全屏刷新率原样保留');
  assert.equal(mergeExtraArgs('-hide_neko -language schinese', ['-language English']), '-hide_neko -language English');
});

test('autoexec：段外的行按原顺序搬进管理段，引号不成对的留在外面', () => {
  const r = adoptAutoexecText('// 注释\nrate 30000\n// >>> Flare（x）\nfps_max "0"\n// <<< Flare\nbad "x\nalias st "a;b"\n', { enabled: true, text: 'fps_max "144"' });
  assert.equal(r.text, '// 注释\nrate 30000\nfps_max "144"\nalias st "a;b"');
  assert.deepEqual(r.kept, ['bad "x']);
  assert.equal(r.outside, 2, '注释不计数');
});

async function fixture(autoexec, steamText) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-import-'));
  const root = path.join(dir, 'steamapps', 'common', 'Left 4 Dead 2'), cfg = path.join(root, 'left4dead2', 'cfg');
  await fs.mkdir(cfg, { recursive: true });
  if (autoexec !== null) await fs.writeFile(path.join(cfg, 'autoexec.cfg'), autoexec);
  const steam = path.join(dir, 'Steam'), user = path.join(steam, 'userdata', '42', 'config');
  await fs.mkdir(user, { recursive: true });
  await fs.writeFile(path.join(user, 'localconfig.vdf'), `"UserLocalConfigStore"{"Software"{"Valve"{"Steam"{"apps"{"550"{"LaunchOptions" "${steamText}"}}}}}}`);
  const events = [];
  const service = {
    steamRoots: [steam], settings: { gameSettings: defaultGameSettings() },
    root: async () => root, gameSettings() { return validateGameSettings(this.settings.gameSettings); },
    core: { inspectGame: async () => ({ processes: [] }) },
    emit: (_name, e) => events.push(e),
    async commitGameSettings(value) {
      this.settings.gameSettings = validateGameSettings(value);
      await writeAutoexec(root, this.settings.gameSettings.autoexec, async () => true);
      return this.settings.gameSettings;
    },
  };
  return { dir, root, file: path.join(cfg, 'autoexec.cfg'), service, events };
}

test('导入：启动项合并、autoexec 整份备份后只剩管理段，再预览就没有可导入的了', async () => {
  const original = '// 我的设置\r\nrate 30000\r\nnet_graph 1\r\nalias st "cl_destroy_ragdolls;wait 80;st"\r\n';
  const { dir, file, service, events } = await fixture(original, '-lv -language English');
  try {
    const host = importHost(service);
    const plan = await host.preview();
    assert.ok(plan.planId);
    assert.deepEqual(plan.launch.changes.map(c => c.field), ['lowViolence', 'extraArgs']);
    assert.equal(plan.cfg.lines, 3);
    assert.equal(await fs.readFile(file, 'utf8'), original, '预览不改文件');
    const done = await host.apply(plan.planId);
    assert.equal(await fs.readFile(done.backup, 'utf8'), original);
    const text = await fs.readFile(file, 'utf8');
    assert.match(text, /^\/\/ >>> Matcha/);
    assert.equal(text.split('rate 30000').length, 2, '设置只出现一次');
    assert.equal(service.settings.gameSettings.extraArgs, '-language English');
    assert.equal(service.settings.gameSettings.lowViolence, true);
    assert.ok(events.some(e => e.type === 'settings_changed'));
    const again = await host.preview();
    assert.equal(again.status, 'nothing');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('导入：预览后 autoexec 被改过就拒绝，原文件不动、不留备份', async () => {
  const { dir, file, service } = await fixture('rate 30000\n', '');
  try {
    const host = importHost(service);
    const plan = await host.preview();
    await fs.writeFile(file, 'rate 20000\n');
    await assert.rejects(host.apply(plan.planId), { code: 'settings_plan_stale' });
    assert.equal(await fs.readFile(file, 'utf8'), 'rate 20000\n');
    assert.deepEqual((await fs.readdir(path.dirname(file))).filter(n => n.includes('.bak')), []);
    assert.equal(service.settings.gameSettings.autoexec.enabled, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('导入：GBK 编码的旧 autoexec 也能读，注释按中文搬进去', async () => {
  const gbk = Buffer.from([0x2f, 0x2f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0a, 0x72, 0x61, 0x74, 0x65, 0x20, 0x31, 0x0a]); // "// 中文\nrate 1\n"
  const { dir, file, service } = await fixture(gbk, '');
  try {
    const host = importHost(service);
    const plan = await host.preview({ launch: false });
    assert.equal(plan.cfg.encoding, 'gbk');
    await host.apply(plan.planId);
    assert.match(await fs.readFile(file, 'utf8'), /\/\/ 中文\r?\nrate 1/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
