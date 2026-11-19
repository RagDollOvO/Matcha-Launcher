// Real frontend and preparation service; launchGame is injected and never executes a game.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { quickFixture } from '../backend/tests/quick-test-fixtures.mjs';
import { beaconBridge } from '../backend/desktop/vite-plugin.mjs';
const base=await fs.mkdtemp(path.resolve('checks/.artifacts/quick-test-ui-'));
const f=await quickFixture(base);
const launch=f.api.launchQuickTest;
f.api.launchQuickTest=async p=>{
  const result=await launch(p);
  const {token}=JSON.parse(await fs.readFile(path.join(p.testDirectory,'session.json'),'utf8'));
  const failed=process.env.QUICK_TEST_UI_FAILURE==='1';
  await fs.writeFile(path.join(p.testDirectory,failed?'bin/console.log':'flare/console.log'),`FLARE_TEST_CONFIG_${token}\n${failed?'Server is enforcing consistency for this file:\nFile left4dead2/pak01_dir.vpk was not found.':`FLARE_TEST_READY_${token}`}\n`);
  if(failed)f.setRunning([]);
  return result;
};
await f.service.close();
const server=await createServer({root:path.resolve('.'),configFile:false,cacheDir:path.join(base,'vite-cache'),plugins:[svelte(),beaconBridge({core:f.api,dataDir:path.join(base,'ui-settings')})],server:{host:'127.0.0.1',port:5181,strictPort:true},clearScreen:false});
await server.listen();console.log('http://127.0.0.1:5181 — offline launch fixture');
await new Promise(resolve=>{process.stdin.once('data',resolve);process.stdin.once('end',resolve);process.once('SIGINT',resolve);});
process.stdin.pause();await server.close();
