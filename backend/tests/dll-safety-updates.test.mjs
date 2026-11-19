import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createFixture, manifest, peFixture} from './fixtures.mjs';
import {zipFixture} from './browser-fixtures.mjs';
import {DesktopService} from '../desktop/service.mjs';
import {createPlatform} from '../core.mjs';
import {inspectBytes} from '../platforms/dll-screen.mjs';
const yes={source:'user',approved:true};
async function fixture(t,options={}) {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'matcha-safe-')), f=await createFixture(base,{l4n:true});
  const core=createPlatform({getProcesses:async()=>[]});await core.applyInstall(await core.planInstall(f),{confirmation:yes});
  const service=new DesktopService({dataDir:path.join(base,'data'),distRoot:f.distRoot,core:{...core,discover:async()=>({games:[],warnings:[]})},...options});
  t.after(()=>service.close());await service.ready;service.settings.gameRoot=f.gameRoot;
  return {...f,base,service,call:(cmd,p,c)=>service.dispatch(cmd,p,c)};
}
const dll=()=>peFixture(['L4P_GetPluginApi']);
async function signedFixture(base,m) {
  const dir=path.join(base,'signed-'+m.version), trust=dir+'-policy.json';await fs.mkdir(dir);
  const files={'manifest.json':Buffer.from(JSON.stringify(m)),'plugin.dll':dll()};
  for(const [n,b] of Object.entries(files))await fs.writeFile(path.join(dir,n),b);
  const record={schemaVersion:1,id:m.id,version:m.version,source:{visibility:'closed'},
    files:Object.entries(files).map(([path,b])=>({path,size:b.length,sha256:createHash('sha256').update(b).digest('hex')}))};
  files['release.json']=Buffer.from(JSON.stringify(record));await fs.writeFile(path.join(dir,'release.json'),files['release.json']);
  execFileSync('pwsh',['-NoProfile','-NonInteractive','-File',path.resolve('scripts/beacon-dev-sign.ps1'),'-PackageDirectory',dir,'-TrustOutput',trust],{windowsHide:true});
  files['release.p7s']=await fs.readFile(path.join(dir,'release.p7s'));
  return {dir,zip:zipFixture(files),trust:JSON.parse(await fs.readFile(trust,'utf8'))};
}
// Non-executable PE test data: import metadata only.
function netBinary(credential) {
  const b=dll(),opt=0x80+24;
  b.writeUInt32LE(0x1500,opt+104);b.writeUInt32LE(40,opt+108);
  b.writeUInt32LE(0x1540,0x700);b.writeUInt32LE(0x1580,0x70c);b.writeUInt32LE(0x1540,0x710);
  b.writeUInt32LE(0x15b0,0x740);
  b.write(credential?'crypt32.dll\0':'winhttp.dll\0',0x780,'ascii');
  b.write(credential?'CryptUnprotectData\0':'WinHttpOpen\0',0x7b2,'ascii');
  b.write('https://example.org\0',0x800,'utf16le');return b;
}
test('static screening protects actual import and rereads changed candidate; networking alone remains reviewable',async t=>{
  const f=await fixture(t), mod=manifest('author.checked'), input=path.join(f.base,'input.zip');
  const prepare=async b=>{await fs.writeFile(input,zipFixture({'manifest.json':JSON.stringify(mod),'plugin.dll':b}));return f.call('plugin-intake-inspect',{file:input});};
  const blocked=await prepare(netBinary(true));assert.equal(blocked.screening.tier,'blocked');assert.equal(blocked.outcome,'rejected');
  assert.ok(blocked.screening.findings.some(x=>x.rule==='CRED001'&&x.severity==='block'));
  const good=await prepare(netBinary(false));assert.equal(good.outcome,'sdk-ready');assert.ok(good.screening.findings.some(x=>x.category==='network'&&x.severity==='review'));
  const plan=await f.call('plugin-intake-import-preview',good);assert.equal(plan.screening.files.length,1);
  await fs.writeFile(path.join(good.preparedDirectory,'plugin.dll'),netBinary(true));
  await assert.rejects(f.call('plugin-intake-import',{planId:plan.planId},yes));
  await assert.rejects(f.call('install-plugin',{pluginDirectory:good.preparedDirectory},yes),{code:'dll_screen_blocked'});
  await assert.rejects(fs.access(path.join(f.runtime,'plugins',mod.id)));
  const retry=await prepare(netBinary(false)), p=await f.call('plugin-intake-import-preview',retry);
  await f.call('plugin-intake-import',{planId:p.planId},yes);
  const observed=await f.call('dll-screen',{pluginId:mod.id});assert.deepEqual(observed.files,p.screening.files);
  assert.equal(inspectBytes(Buffer.from([1])).some(h=>h.severity==='review'),true);
});
test('native downloads: pinned real archives, verification before publishing; game directory stays untouched', async t=>{
  const vendor=await fs.mkdtemp(path.join(os.tmpdir(),'matcha-catalog-'));
  const cat=JSON.parse(await fs.readFile('vendor/native-libraries.json','utf8'));
  await fs.writeFile(path.join(vendor,'native-libraries.json'),JSON.stringify(cat));
  let corrupt=true;
  const f=await fixture(t,{vendorRoot:vendor,nativeFetch:async url=>{
    assert.equal(url,cat.l4n.downloadUrl);const bytes=await fs.readFile('vendor/l4n/archives/L4N_v2.58.0.7z');
    if(corrupt)bytes[0]^=1;return new Response(bytes);
  }});
  // A fresh vanilla install for the independent L4N download/install path.
  await fs.unlink(path.join(f.bin,'left4neko.dll'));await fs.writeFile(path.join(f.gameRoot,'left4dead2.exe'),peFixture([],{dll:false}));
  await assert.rejects(f.call('library-download-preview',{id:'dxvk'}),{code:'renderer_read_only'});
  const lib=f.service.nativeLibraries; const before=await fs.readFile(path.join(f.gameRoot,'left4dead2.exe')),events=[];
  f.service.on('event',e=>{if(e.type==='task_progress') events.push([e.sourceId,e.state,e.unit]);});
  const get=async id=>{const plan=await f.call('library-download-preview',{id});await assert.rejects(f.call('library-download',{planId:plan.planId}),{code:'confirmation_required'});
    const {taskId}=await f.call('library-download',{planId:plan.planId},yes);return f.service.tasks.completed(taskId);};
  assert.equal((await lib.snapshot(null)).l4n.availability,'missing');
  await assert.rejects(get('l4n'),/校验/);assert.equal((await lib.snapshot(null)).l4n.availability,'missing');
  corrupt=false;
  for(const id of ['l4n']){
    await get(id);assert.equal((await lib.snapshot(null))[id].availability,'downloaded');
    assert.ok(events.some(e=>e.join(':')==='native:'+id+':verifying:bytes'));
  }
  assert.deepEqual(await fs.readFile(path.join(f.gameRoot,'left4dead2.exe')),before);
  await assert.rejects(fs.access(path.join(f.bin,'left4neko.dll')));
  const plan=await lib.preview(f.gameRoot,'l4n',true);assert.ok(plan.files.some(f=>f.path==='bin/left4neko.dll'));
  await assert.rejects(fs.access(path.join(f.bin,'left4neko.dll')));
});
test('SDK source registered at local ZIP import; daily metadata only, confirmed staged fetch bound to release and installed ID', async t=>{
  const id='author.release', old={...manifest(id),developer:{updates:{type:'github-release',repo:'Author/Feature',asset:'sdk-*.zip'}}};
  const next={...old,version:'0.2.0'}, zip=m=>zipFixture({'manifest.json':JSON.stringify(m),'plugin.dll':dll()});
  const payload=zip(next), repo='https://github.com/Author/Feature', api='https://api.github.com/repos/Author/Feature', tag='v0.2.0';
  const asset={name:'sdk-x86.zip',id:26,size:payload.length,digest:'sha256:'+createHash('sha256').update(payload).digest('hex'),browser_download_url:repo+'/releases/download/'+tag+'/sdk-x86.zip',state:'uploaded'};
  const release={tag_name:tag,html_url:repo+'/releases/tag/'+tag,body:'## 新版\n更新说明',assets:[asset]};const calls=[];
  const f=await fixture(t,{dllSourceFetch:async u=>{
    calls.push(u); if(u===api+'/releases/assets/26')return new Response(payload);
    if(u===api)return Response.json({id:24,owner:{id:3},full_name:'Author/Feature'});
    if(u.includes('/readme'))return new Response(null,{status:404});
    if(u===api+'/releases/latest'||u===api+'/releases/tags/'+tag)return Response.json(release);
    throw Error('unexpected '+u);
  }});
  const file=path.join(f.base,'old.zip');await fs.writeFile(file,zip(old));
  const first=await f.call('plugin-intake-inspect',{file}), install=await f.call('plugin-intake-import-preview',first);
  await f.call('plugin-intake-import',{planId:install.planId},yes);assert.equal((await f.service.pluginOverlays.all())[id].source.url,repo);
  const results=await f.call('dll-updates-check',{});assert.equal(results.updates,1);assert.deepEqual(calls,[api+'/releases/latest']);
  const snapshot=await f.service.dllInventory({id});assert.equal(snapshot.plugins[0].update.version,next.version);assert.equal(calls.length,1);
  await assert.rejects(f.call('plugin-update-fetch',{id}),{code:'confirmation_required'});
  const update=await f.call('plugin-update-fetch',{id},yes);assert.equal(update.updatePluginId,id);assert.equal(update.outcome,'sdk-ready');
  const preview=await f.call('plugin-intake-import-preview',update);assert.equal(preview.previousVersion,old.version);assert.equal(preview.version,next.version);
  assert.equal((await f.service.pluginRecord(id)).raw.version,old.version);assert.equal(f.service.tasks.list().at(-1).sourceId,'plugin:'+id);
  await f.call('plugin-intake-import',{planId:preview.planId},yes);assert.equal((await f.service.pluginRecord(id)).raw.version,next.version);
});

test('a second development certificate is detected in the real signed ZIP before any update', {skip:process.platform!=='win32'}, async t=>{
  const id='author.signed', repo='https://github.com/Author/Signed', api='https://api.github.com/repos/Author/Signed';
  const m={...manifest(id),developer:{updates:{type:'github-release',repo:'Author/Signed'}}};
  let release, payload, binaryReads=0;
  const f=await fixture(t,{dllSourceFetch:async url=>{
    if(url===api)return Response.json({id:19,owner:{id:15},full_name:'Author/Signed'});
    if(url===api+'/releases/assets/2'){binaryReads++;return new Response(payload);}
    if(url.includes('/readme'))return new Response(null,{status:404});
    return Response.json(release);
  }});
  const a=await signedFixture(f.base,m), b=await signedFixture(f.base,{...m,version:'0.2.0'});
  const policy={...a.trust,signers:[...a.trust.signers,...b.trust.signers]};
  await fs.writeFile(path.join(f.runtime,'release-trust.json'),JSON.stringify(policy));
  await fs.writeFile(path.join(f.runtime,'l4p_runtime.dll'),peFixture(['L4P_RuntimeInitialize','L4P_RuntimeReleaseGateV1']));
  const original=await f.call('plugin-intake-inspect',{file:a.dir});
  assert.equal(original.screening.tier,'closed');const plan=await f.call('plugin-intake-import-preview',original);
  await f.call('plugin-intake-import',{planId:plan.planId},yes);
  payload=b.zip;release={tag_name:'v0.2.0',html_url:repo+'/releases/tag/v0.2.0',assets:[
    {id:2,state:'uploaded',name:'x86.zip',size:payload.length,browser_download_url:repo+'/releases/download/v0.2.0/x86.zip'}]};
  await f.call('dll-updates-check',{});await assert.rejects(f.call('plugin-update-fetch',{id},yes),{code:'plugin_signer_changed'});
  const p=(await f.service.dllInventory({id})).plugins[0];assert.equal(p.version,m.version);assert.equal(p.update.signer,'changed');
  await assert.rejects(f.call('plugin-update-fetch',{id},yes),{code:'plugin_signer_changed'});assert.equal(binaryReads,1);
});
