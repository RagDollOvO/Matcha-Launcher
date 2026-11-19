import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ServerManager } from '../servers/manager.mjs';
import { emptyObservation } from '../servers/query.mjs';

test('friend discovery is temporary; split ports, explicit favorites and current presence govern join', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'matcha-friend-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const peer={name:'甲',ip:'93.184.216.34',port:27016,query:27015,lobby:'0'};
  let presence=[peer,{...peer,name:'乙'}, {...peer,ip:'127.0.0.1',lobby:'123',name:'丙'}, {...peer,ip:'0.0.0.0',port:0,name:'丁'}];
  let probes=0;
  const m=new ServerManager({dataDir:dir,readFriends:async()=>presence,query:async row=>{
    probes++;assert.equal(row.addr,peer.ip+':27015');return {...emptyObservation(),status:'online',modeId:'coop',map:'c1m1_hotel',vac:true,connectAddr:peer.ip+':27016'};
  }});
  const [server,lobby,menu]=await m.friends.list();
  assert.deepEqual(server.friends,['甲','乙']);assert.ok(!lobby.addr && !menu.addr);
  assert.equal((await m.friends.detail(server.id)).map,'c1m1_hotel');assert.equal(probes,1);
  assert.equal(await m.connectTarget(server.id,'clean'),peer.ip+':27016');
  assert.deepEqual(await fs.readdir(dir),[]);
  const [saved]=await m.favoriteFriend(server.id);
  assert.equal(saved.gamePort,27016);assert.equal(saved.favorite,true);
  assert.equal((await m.favoriteFriend(server.id)).length,1);
  assert.ok(!(await fs.readFile(m.file,'utf8')).includes('甲'));
  presence=[];await assert.rejects(m.connectTarget(server.id,'clean'),{code:'friend_server_missing'});
  assert.equal((await m.list()).length,1);
});
