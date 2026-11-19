// Build using checks/storage-shell/tauri-fixture.json, then run this check.
// Uses a separate app ID, loopback site, game fixture and data directory.
import fs from 'node:fs/promises';import path from 'node:path';import http from 'node:http';
import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import {createFixture} from '../backend/tests/fixtures.mjs';import {vpkFixture,addonInfo} from '../backend/tests/mods-fixtures.mjs';import {zipFixture} from '../backend/tests/browser-fixtures.mjs';
const exe=path.resolve('src-tauri/target/release/Matcha.exe');
if(!(await fs.readFile(exe)).includes(Buffer.from('local.matcha.storagefixture')))throw Error('Build the isolated storage fixture first.');
const base=await fs.mkdtemp(path.resolve('checks/.artifacts/storage-shell-')),f=await createFixture(base);
const v=await vpkFixture(path.join(base,'test.vpk'),{'addoninfo.txt':addonInfo('Storage shell test'),'scripts/a.txt':'test'}),zip=zipFixture({'fixture-storage.vpk':await fs.readFile(v),'fixture-padding.txt':Buffer.alloc(131072,65)});
const reports=new Map(),finished=[];let stream,failure='',child;
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
  if(u.pathname==='/report'){reports.set(u.searchParams.get('stage'),Object.fromEntries(u.searchParams));res.end('ok');return}
  if(u.pathname.startsWith('/seen-')){res.end(JSON.stringify(reports.get(u.pathname.slice(6))));return}
  if(u.pathname.startsWith('/finished-')){finished.push(u.pathname.slice(10));res.end('ok');return}
  if(u.pathname==='/failure'){failure=u.searchParams.get('reason');res.end('ok');return}
  if(u.pathname==='/release'){stream?.end(zip.subarray(65536));res.end('ok');return}
  if(u.pathname==='/download.zip'){res.writeHead(200,{'Content-Disposition':'attachment; filename=storage.zip','Content-Type':'application/octet-stream','Content-Length':zip.length});res.write(zip.subarray(0,65536));stream=res;return}
  res.setHeader('Content-Type','text/html');res.end('<script>(async()=>{'+
   (u.pathname==='/seed'?"document.cookie='fixture=kept; Max-Age=3600; Path=/';const c=await caches.open('fixture-cache');await c.put('/blob',new Response(new Uint8Array(262144)));":'')+
   'await fetch("/report?stage="+location.pathname.slice(1)+"&cookie="+encodeURIComponent(document.cookie)+"&cache="+await caches.has("fixture-cache"));'+
   (u.pathname==='/receive'?'location.href="/download.zip";':'')+'})()</script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const data=path.join(base,'records-'+server.address().port);await fs.mkdir(data);
await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({version:1,gameRoot:f.gameRoot,profiles:[{id:'test',name:'Fixture',modIds:[],pluginIds:[]}],activeProfileId:'test',assignments:{},modMeta:{},categories:[]}));
try{
  for(const phase of ['move','restart']){
    child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,BEACON_DATA_DIR:data,BEACON_NODE:process.execPath}});
    const timeout=setTimeout(()=>{failure||='fixture timeout; saw '+JSON.stringify([...reports.keys()]);child.kill()},90000);
    try{await once(child,'exit')}finally{clearTimeout(timeout)}
    if(failure)throw Error(failure);assert.equal(finished.at(-1),phase);console.log('Passed native storage '+phase);
  }
}finally{if(child?.exitCode===null&&child.signalCode===null)child.kill();stream?.end();server.closeAllConnections();server.close();
  await fs.rm(base,{recursive:true,force:true,maxRetries:4,retryDelay:200});}
