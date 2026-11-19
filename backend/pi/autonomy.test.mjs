import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPermissions, savePermissions, confirmAction, shellRisk, fileRisk } from './autonomy.mjs';
import { settingsTools } from './settings-tools.mjs';

async function configDir(t, mode) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-perm-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  if (mode) await savePermissions(dir, { mode });
  return dir;
}
function withEnv(t, dir) {
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; });
}
const fakeCtx = answer => { const asked = []; return { asked, hasUI: true, ui: { confirm: async (title) => { asked.push(title); return answer; } } }; };

test('permissions: player choice is stored per Pi config folder, unknown folder stays conservative', async t => {
  assert.deepEqual(readPermissions(undefined), { mode: 'ask' });
  const dir = await configDir(t);
  assert.deepEqual(readPermissions(dir), { mode: 'auto' });
  assert.deepEqual(await savePermissions(dir, { mode: 'ask' }), { mode: 'ask' });
  assert.deepEqual(readPermissions(dir), { mode: 'ask' });
  await assert.rejects(savePermissions(dir, { mode: 'yolo' }), { code: 'invalid_argument' });
  await fs.writeFile(path.join(dir, 'matcha-permissions.json'), '{ broken');
  assert.deepEqual(readPermissions(dir), { mode: 'auto' });
});

test('confirmAction: autonomy skips routine prompts only', async t => {
  withEnv(t, await configDir(t, 'auto'));
  let ctx = fakeCtx(false);
  assert.equal(await confirmAction(ctx, '整理', '', { risk: 'routine' }), true);
  assert.equal(await confirmAction(ctx, '永久删除', '', { risk: 'ask' }), false);
  assert.equal(await confirmAction(ctx, '默认', ''), false);
  assert.deepEqual(ctx.asked, ['永久删除', '默认']);
  withEnv(t, await configDir(t, 'ask'));
  ctx = fakeCtx(true);
  assert.equal(await confirmAction(ctx, '整理', '', { risk: 'routine' }), true);
  assert.deepEqual(ctx.asked, ['整理']);
});

test('shell commands: reading, extracting and copying run, executing or deleting asks', () => {
  const routine = [
    String.raw`$r='E:\SteamLibrary\steamapps\common\Left 4 Dead 2'; Get-ChildItem $r -Force | Select-Object Mode,Length,Name | Format-Table -AutoSize`,
    String.raw`$dst='C:\Users\A\Downloads\pkg'; if(Test-Path $dst){ Write-Output "复用" } else { Expand-Archive -LiteralPath 'C:\Users\A\Downloads\p.zip' -DestinationPath $dst -Force }`,
    String.raw`foreach($f in 'skeeto.dll','bin\wininet.dll'){ $g=Get-FileHash (Join-Path $r $f) -Algorithm SHA256; "{0}" -f $g.Hash }`,
    String.raw`Get-Content 'C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf' -Raw`,
    String.raw`Copy-Item -Recurse -Force 'C:\Users\A\Downloads\pkg\bin' 'E:\Games\Left 4 Dead 2\bin'`,
    'Start-Sleep -Seconds 2; Get-Date -Format yyyy-MM-dd; Get-Process -Name left4dead2 -ErrorAction SilentlyContinue 2>&1',
  ];
  for (const c of routine) assert.equal(shellRisk(c).risk, 'routine', c);
  const ask = [
    [String.raw`$root='E:\L4D2'; powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\A\Downloads\pkg\Maintain.ps1" -Mode Migrate`, '执行脚本或程序'],
    [String.raw`& 'C:\Users\A\Downloads\pkg\setup.exe' /S`, '执行脚本或程序'],
    [String.raw`.\install.bat`, '执行脚本或程序'],
    ['cmd /c install.cmd', '执行脚本或程序'],
    ['Start-Process notepad', '执行脚本或程序'],
    ["'Write-Host hi' | iex", '执行脚本或程序'],
    [String.raw`Remove-Item -Recurse 'E:\L4D2\left4dead2\addons'`, '删除文件'],
    ['rm -rf ./build', '删除文件'],
    ['reg add HKCU\\Software\\X /v Y /d 1', '改系统设置或进程'],
    ['Set-ItemProperty HKLM:\\SOFTWARE\\X -Name Y -Value 1', '改系统设置或进程'],
    ['Stop-Process -Name steam', '改系统设置或进程'],
    ['Invoke-WebRequest https://example.com/a.zip -OutFile a.zip', '联网下载或上传'],
    ['curl -L https://example.com/x.sh', '联网下载或上传'],
    [String.raw`Copy-Item a.dll 'C:\Windows\System32\a.dll'`, '写入系统目录'],
    ['', '空命令'],
  ];
  for (const [c, reason] of ask) assert.deepEqual(shellRisk(c), { risk: 'ask', reason }, c);
});

test('live full access grants document work, keeps explicit program approval, and revokes immediately', async t => {
  const dir = await configDir(t,'auto'); withEnv(t,dir); const ctx=fakeCtx(false);
  const doc = () => confirmAction(ctx,'写文档','',{risk:'managed'});
  assert.equal(await doc(),false);
  await savePermissions(dir,{mode:'full'});
  assert.equal(await doc(),true);
  assert.equal(await confirmAction(ctx,'运行安装器','',shellRisk('Start-Process setup.exe')),false);
  await savePermissions(dir,{mode:'ask'}); assert.equal(await doc(),false);
  assert.deepEqual(ctx.asked,['写文档','运行安装器','写文档']);
});

test('local files: sensitive reads and writes outside game/download folders ask', () => {
  const opts = { gameRoot: String.raw`E:\L4D2`, workspace: String.raw`C:\M\pi\workspace`, home: String.raw`C:\Users\A` };
  assert.equal(fileRisk(String.raw`C:\Users\A\Downloads\pkg\README.txt`, opts).risk, 'routine');
  assert.equal(fileRisk(String.raw`D:\Anything\notes.txt`, opts).risk, 'routine');
  assert.equal(fileRisk(String.raw`C:\Users\A\.ssh\id_ed25519`, opts).risk, 'ask');
  assert.equal(fileRisk(String.raw`C:\Users\A\AppData\Local\Google\Chrome\User Data\Default\Login Data`, opts).risk, 'ask');
  assert.equal(fileRisk(String.raw`C:\M\pi\auth.json`, opts).risk, 'ask');
  assert.equal(fileRisk(String.raw`E:\L4D2\left4dead2\cfg\autoexec.cfg`, { ...opts, write: true }).risk, 'routine');
  assert.equal(fileRisk(String.raw`C:\Users\A\Downloads\x\a.txt`, { ...opts, write: true }).risk, 'routine');
  assert.equal(fileRisk(String.raw`C:\Users\A\Desktop\a.txt`, { ...opts, write: true }).risk, 'managed');
  assert.equal(fileRisk(String.raw`C:\Users\A\Desktop\setup.ps1`, { ...opts, write: true }).risk, 'ask');
  assert.equal(fileRisk(String.raw`E:\L4D2-other\a.txt`, { ...opts, write: true }).risk, 'ask');
  assert.equal(fileRisk('relative.txt', opts).risk, 'ask');
});

test('game settings update applies without a prompt in autonomy mode', async t => {
  withEnv(t, await configDir(t, 'auto'));
  const calls = [];
  const request = async (op, params, confirmation) => {
    calls.push([op, confirmation]);
    if (op === 'settings-game-preview') return { planId: 'p1', changes: [{ field: 'novid', label: '跳过开场动画', beforeText: '关', afterText: '开' }], cfgChanges: [],
      effective: { before: { modded: [], clean: [] }, after: { modded: ['-novid'], clean: [] } }, autoexec: { path: '', enabled: false } };
    return { applied: true };
  };
  const tool = settingsTools(request).find(x => x.name === 'game_settings_update');
  const ctx = fakeCtx(false);
  const out = (await tool.execute('1', { launch: { novid: true } }, undefined, undefined, ctx)).details;
  assert.equal(out.applied, true);
  assert.deepEqual(ctx.asked, []);
  assert.deepEqual(calls.at(-1), ['settings-game-apply', { approved: true, source: 'user' }]);
});
