import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchSpec } from '../launch.mjs';
import { defaultGameSettings } from '../game-settings.mjs';
import { createPlatform } from '../core.mjs';
import { DesktopService } from '../desktop/service.mjs';
import { emptyObservation } from '../servers/query.mjs';
import { createFixture } from './fixtures.mjs';

const confirmation = { approved: true, source: 'user' };

test('existing L4N starts with no Matcha deployment and preserves renderer files', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'matcha-standalone-l4n-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const f=await createFixture(dir,{l4n:true}), steamExe=path.join(dir,'steam.exe'), launches=[];
  await fs.writeFile(steamExe,'test');
  const api=createPlatform({getProcesses:async()=>[],isSteamRunning:async()=>true,launchGame:async(exe,args)=>launches.push({exe,args})});
  await api.launch({gameRoot:f.gameRoot,steamExe,mode:'modded',confirmation});
  assert.equal(launches[0].exe,path.join(f.gameRoot,'left4dead2.exe')); assert.deepEqual(launches[0].args,['-steam','-novid']);
  await assert.rejects(fs.access(f.runtime),{code:'ENOENT'});assert.deepEqual(await fs.readFile(path.join(f.bin,'dxvk_d3d9.dll')),f.original);
});

test('direct launch: selected executable/cwd, explicit confirmation, Steam and running guards, no Steam fallback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-direct-'));
  const fixture = await createFixture(root,{l4n:true});
  const steamExe = path.join(root, 'steam.exe'); await fs.writeFile(steamExe, 'offline fixture');
  let steamRunning = true, running = [], spawnError = null, launches = [];
  const core = createPlatform({ getProcesses: async () => running, isSteamRunning: async exe => { assert.equal(exe, steamExe); return steamRunning; },
    launchSteam: async () => assert.fail('Direct mode must keep the selected game entry'),
    launchGame: async (file, args, cwd) => { if (spawnError) throw spawnError; launches.push({ file, args, cwd }); return { pid: 1234 }; } });
  await core.applyInstall(await core.planInstall(fixture), { confirmation });
  const request = { gameRoot: fixture.gameRoot, steamExe, mode: 'direct', connect: 'dxnya.nekoidc.top:20080', confirmation };
  await assert.rejects(core.launch({ ...request, confirmation: undefined }), { code: 'confirmation_required' });
  await assert.rejects(core.launch({ ...request, mode: 'unknown' }), { code: 'launch_mode_invalid' });
  await assert.rejects(core.launch({ ...request, connect: 'host:1;quit' }), { code: 'server_address_invalid' });
  steamRunning = false;
  await assert.rejects(core.launch(request), { code: 'steam_not_running' });
  assert.equal(launches.length, 0);
  steamRunning = true;
  const result = await core.launch(request);
  assert.equal(result.pid, 1234); assert.equal(result.status, 'requested'); assert.equal(result.vacMode, 'game-default');
  assert.deepEqual(launches[0], { file: path.join(fixture.gameRoot, 'left4dead2.exe'), cwd: fixture.gameRoot,
    args: ['-steam', '-novid', '+connect', 'dxnya.nekoidc.top:20080'] });
  running = [{ pid: 42, name: 'left4dead2' }];
  await assert.rejects(core.launch(request), { code: 'game_running' });
  running = []; spawnError = Object.assign(new Error('fixture spawn failure'), { code: 'ENOENT' });
  await assert.rejects(core.launch(request), { code: 'ENOENT' });
  assert.equal(launches.length, 1);
  spawnError = null;
  const gameSettings = { ...defaultGameSettings(), fpsMax: 144, console: true, extraArgs: '-vulkan' };
  await core.launch({ ...request, gameSettings });
  assert.deepEqual(launches[1].args, launchSpec('direct', request.connect, gameSettings).launchOptions);
  assert.deepEqual(launches[1].args.slice(-3), ['-vulkan', '+connect', request.connect]);
  assert.deepEqual(launchSpec().launchOptions, ['-insecure']);
});

test('L4N and legacy DLL metadata preserve game-default arguments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-modded-'));
  const fixture = await createFixture(root,{l4n:true}), launches = [];
  const file = path.join(fixture.distRoot, 'bin/l4p/plugins/demo.hello/manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.launchScope = 'insecure';
  await fs.writeFile(file, JSON.stringify(manifest));
  await fs.appendFile(path.join(fixture.gameRoot, 'left4dead2.exe'), 'left4neko.dll');
  const steamExe = path.join(root, 'steam.exe'); await fs.writeFile(steamExe, 'offline fixture');
  const core = createPlatform({ getProcesses: async () => [], isSteamRunning: async () => true,
    launchGame: async (_, args) => { launches.push(args); } });
  await core.applyInstall(await core.planInstall(fixture), { confirmation });
  for (const mode of ['modded', 'direct']) {
    const result = await core.launch({ gameRoot: fixture.gameRoot, steamExe, mode, confirmation });
    assert.equal(result.vacMode, 'game-default');
    assert.deepEqual(launches.at(-1), ['-steam', '-novid']);
  }
  assert.equal(launchSpec('modded').label, 'L4N 平台启动');
});

test('desktop default modded mode, legacy selections, VAC connection and captured confirmation mode', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-launch-service-'));
  const calls = [];
  const core = { discover: async () => ({ games: [], warnings: [] }), launch: async params => { calls.push(params); return { status: 'requested', pid: 100 }; } };
  const queryServer = async () => ({ ...emptyObservation(), status: 'online', name: 'Fixture', vac: true, connectAddr: 'example.com:27015' });
  const service = new DesktopService({ dataDir, core, queryServer });
  try {
    const snapshot = await service.dispatch('snapshot');
    assert.equal(snapshot.launch.mode, 'modded'); assert.equal(snapshot.launch.launchOptions.includes('-insecure'), false);
    assert.equal(snapshot.profiles[0].launchOptions, '');
    service.settings.gameRoot = 'D:\\offline-only';
    let applies = 0; service.applyModProfile = async () => { applies++; };
    const [server] = await service.dispatch('add-server', { address: 'example.com' });
    await assert.rejects(service.dispatch('connect-server', { id: server.id }), { code: 'confirmation_required' });
    await service.dispatch('connect-server', { id: server.id, profileId: 'default', mode: 'direct' }, confirmation);
    assert.equal(calls[0].mode, 'modded'); assert.equal(calls[0].connect, 'example.com:27015'); assert.equal(applies, 1);
    await service.dispatch('set-launch-mode', { mode: 'development' });
    await service.dispatch('connect-server', { id: server.id, mode: 'development' }, confirmation);
    assert.equal(calls[1].mode, 'modded'); assert.equal(applies, 2);
    // A completed UI confirmation passes its captured mode, even if the preference changed.
    await service.dispatch('set-launch-mode', { mode: 'clean' });
    await service.dispatch('launch', { profileId: 'default', mode: 'direct' }, confirmation);
    assert.equal(calls[2].mode, 'modded');
    await assert.rejects(service.dispatch('set-launch-mode', { mode: 'invalid' }), { code: 'launch_mode_invalid' });
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'launch.json'), 'utf8')).mode, 'clean');
    const restored = new DesktopService({ dataDir, core });
    assert.equal((await restored.dispatch('snapshot')).launch.mode, 'clean');
    await restored.close();
    await service.dispatch('set-launch-mode', { mode: 'direct' });
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'launch.json'), 'utf8')).mode, 'modded');
  } finally { await service.close(); }
});

test('desktop migrates saved direct/development modes without rewriting profile drafts', async () => {
  for (const mode of ['direct', 'development']) {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-launch-migration-'));
    const settings = JSON.stringify({ version: 1, profiles: [{ id: 'custom', name: 'Draft', launchOptions: '-console -w 1600', pluginIds: ['local.custom'] }], activeProfileId: 'custom' });
    await fs.writeFile(path.join(dataDir, 'settings.json'), settings);
    await fs.writeFile(path.join(dataDir, 'launch.json'), JSON.stringify({ version: 1, mode }));
    const service = new DesktopService({ dataDir, core: { discover: async () => ({ games: [], warnings: [] }) } });
    try {
      const snapshot = await service.dispatch('snapshot');
      assert.equal(snapshot.launch.mode, 'modded');
      assert.equal(snapshot.launch.vacMode, 'game-default');
      assert.equal(snapshot.launch.launchOptions.includes('-insecure'), false);
      assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'launch.json'), 'utf8')).mode, 'modded');
      assert.equal(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8'), settings);
    } finally { await service.close(); }
  }
});

test('L4N startup preference round-trips; clean checks the Steam game before launch and ignores that preference', async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'matcha-mode-switch-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const f=await createFixture(dir,{l4n:true}),steam=path.join(dir,'Steam'),apps=path.join(steam,'steamapps');
  const root=path.join(apps,'common','L4D2'),exe=path.join(steam,'steam.exe');
  await fs.mkdir(path.dirname(root),{recursive:true});await fs.rename(f.gameRoot,root);
  await fs.writeFile(path.join(apps,'appmanifest_550.acf'),'"AppState" { "appid" "550" "installdir" "L4D2" }');
  await fs.writeFile(exe,'offline');await fs.appendFile(path.join(root,'left4dead2.exe'),'-hide_neko');
  const launches=[], core=createPlatform({getProcesses:async()=>[],isSteamRunning:async()=>true,launchGame:async(_,args)=>launches.push(args)});
  const settings=path.join(dir,'settings'),srv=new DesktopService({dataDir:settings,core});
  try {
    await srv.ready;srv.settings.gameRoot=root;srv.settings.gameSettings={...defaultGameSettings(),extraArgs:'-vulkan +fps_max 120',autoexec:{enabled:true,values:{},extra:'echo untouched'}};
    const set=enabled=>srv.dispatch('game-settings-l4n-launch',{gameRoot:root,enabled});
    const on=await set(true),off=await set(false);
    assert.deepEqual(off.effective.modded,[...on.effective.modded,'-hide_neko']);
    assert.deepEqual((await set(false)).effective,off.effective);
    assert.deepEqual(off.effective.clean,['-steam','-novid']);
    assert.equal(JSON.parse(await fs.readFile(srv.settingsFile)).gameSettings.extraArgs,off.extraArgs);
    await assert.rejects(fs.access(path.join(root,'left4dead2/cfg/autoexec.cfg')),{code:'ENOENT'});
    await core.launch({gameRoot:root,steamExe:exe,mode:'modded',gameSettings:srv.gameSettings(),confirmation});
    assert.deepEqual(launches,[off.effective.modded]);
    await assert.rejects(core.launch({gameRoot:root,steamExe:exe,mode:'clean',gameSettings:srv.gameSettings(),confirmation}),{code:'clean_game_modified'});
    assert.equal(launches.length,1);
    assert.deepEqual((await set(true)).effective.modded,on.effective.modded);
    // Vanilla, registered Steam install: the same custom settings never reach clean launch.
    await fs.writeFile(path.join(root,'left4dead2.exe'),(await import('./fixtures.mjs')).peFixture([],{dll:false}));
    await fs.unlink(path.join(root,'bin/left4neko.dll'));
    await core.launch({gameRoot:root,steamExe:exe,mode:'clean',gameSettings:off,confirmation});
    assert.deepEqual(launches[1],['-steam','-novid']);
  } finally {await srv.close();}
});
