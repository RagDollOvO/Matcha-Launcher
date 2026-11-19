import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CommunityAcceleration } from '../community/manager.mjs';

test('community consent, close, resume and scoped interrupted-session recovery', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-community-'));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = fixture;
  const hosts = path.join(fixture, 'hosts');
  const base = '# Original\r\n8.8.8.8 steamcommunity.com\r\n127.0.0.2 my.local\r\n';
  const active = '# Original\r\n127.0.0.2 my.local\r\n\r\n# Steam++ Start\r\n127.0.0.1 steamcommunity.com\r\n127.0.0.1 steamuserimages-a.akamaihd.net\r\n# Steam++ End\r\n\r\n# Steam++ Backup Start\r\n#2 8.8.8.8 steamcommunity.com\r\n# Steam++ Backup End\r\n';
  let running = false;
  let launchResult = 'started';
  let launches = 0;
  const create = () => {
    const manager = new CommunityAcceleration({ dataDir: fixture, supported: true });
    manager.hostsFile = hosts;
    manager.prepare = async () => {};
    manager.processes = async () => running ? [{ owned: true, main: true, pid: 100 }] : [];
    manager.configure = async () => {};
    manager.engineAlive = () => running;
    manager.localHealth = async () => 'test CA';
    manager.pipe = async command => {
      assert.equal(running,true);
      if(command==='shutdown'){running=false;return;}
      await fs.writeFile(hosts, command === 'proxy On' ? active : base);
    };
    manager.windows = async (action, args) => {
      if (action === 'preflight') return { startupTask: false, portBusy: false };
      if (action === 'launch') {
        if(launchResult!=='started')return {status:launchResult};
        await fs.mkdir(manager.plugin,{recursive:true});await fs.writeFile(path.join(manager.plugin,'LOCAL_ACCELERATE.json'),'{}');
        running=true;launches++;return {status:'started',pid:100};
      }
      if (action === 'terminate') { assert.deepEqual(args, ['-OwnerPid', '100']); running = false; }
      else if (action === 'repair') {
        const pair = args[1];
        assert.deepEqual(await fs.readFile(hosts), await fs.readFile(pair + '.before'));
        await fs.copyFile(pair + '.after', hosts);
      } else assert.fail(action);
    };
    return manager;
  };
  let manager = create();
  try {
    await fs.writeFile(hosts, base);
    assert.equal((await manager.status()).enabled, false);
    await assert.rejects(manager.setEnabled(true), { code: 'acceleration_consent' });
    assert.equal(launches, 0);
    launchResult='cancelled';
    await assert.rejects(manager.setEnabled(true,{consent:true}),{code:'acceleration_cancelled'});
    assert.equal((await manager.status()).phase,'off');assert.equal((await manager.status()).enabled,false);
    assert.equal(await fs.readFile(hosts,'utf8'),base);assert.equal(running,false);
    launchResult='started';
    const enabled = await manager.setEnabled(true, { consent: true });
    assert.equal(enabled.active, true);
    assert.equal(manager.state.ownerPid,100);
    assert.equal(enabled.sites.steamImages, 'accelerated');
    await manager.close();
    assert.equal((await manager.status()).sites.steamImages, 'normal');
    assert.equal(await fs.readFile(hosts, 'utf8'), base);
    assert.equal((await manager.status()).enabled, true);

    manager = create();
    await manager.resume();
    assert.equal(launches, 2);
    assert.equal((await manager.status()).active, true);
    // Simulate a dead engine with hosts left behind, plus a user's unrelated edit.
    running = false;
    clearInterval(manager.monitor);
    await manager.unlock();
    await fs.appendFile(hosts, '127.0.0.3 added.local\r\n');
    manager = create();
    assert.equal((await manager.status()).recoveryRequired, true);
    const result = await manager.recover();
    assert.equal(result.phase, 'off');
    assert.equal(result.enabled, false);
    const restored = await fs.readFile(hosts, 'utf8');
    assert.ok(restored.includes('8.8.8.8 steamcommunity.com'));
    assert.ok(restored.includes('127.0.0.3 added.local'));
    assert.ok(restored.includes('127.0.0.2 my.local'));
    assert.ok(!restored.includes('# Steam++'));

    await fs.writeFile(hosts, active);
    await assert.rejects(manager.setEnabled(true), { code: 'acceleration_conflict' });
    assert.equal(await fs.readFile(hosts, 'utf8'), active);
  } finally {
    await manager.close();
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
