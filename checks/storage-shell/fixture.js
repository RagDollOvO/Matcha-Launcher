// Fixed, isolated Shell → Node → WebView2 actions; only the fixture webserver reports observations.
const invoke=(command,args)=>window.__TAURI_INTERNALS__.invoke(command,args);
const call=async(command,params={},approved=false)=>{const r=await invoke('beacon_call',{command,params,confirmation:{source:'user',approved}});if(!r.ok)throw Object.assign(Error(r.error.message),{code:r.error.code});return r.result};
const web=(action,params={})=>invoke('browser_call',{action,params});
const eq=(a,b)=>{if(a!==b)throw Error(JSON.stringify(a)+' != '+JSON.stringify(b))};
let origin;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){const r=await fn();if(r)return r;await sleep(180)}throw Error('Timed out: '+String(fn).slice(0,120))}
async function run(){
  const info=await call('app-info');const [,port]=info.dataDir.match(/\\records-(\d+)$/);origin='http://127.0.0.1:'+port;
  const signal=(n)=>fetch(origin+'/'+n,{cache:'no-store'}).then(r=>r.text());
  const nav=async(stage)=>{await web('navigate',{id:'tab-storage-fixture',url:origin+'/'+stage});return JSON.parse(await until(()=>signal('seen-'+stage)))};
  const stat=await call('storage-get'),target=info.dataDir.replace(/\\records-\d+$/,'\\chosen');
  if(stat.location.custom){eq((await nav('restart')).cookie,'fixture=kept');await signal('finished-restart');return}
  const start=await nav('seed');eq(start.cookie,'fixture=kept');eq(start.cache,'true');
  await until(async()=>(await call('storage-clean-preview',{kinds:['browser-cache']})).totalBytes>0);
  await call('storage-clean',{kinds:['browser-cache']},true);const after=await nav('after');eq(after.cookie,'fixture=kept');eq(after.cache,'false');
  await nav('receive');await until(async()=>(await web('downloads')).some(d=>d.state==='downloading'));
  let code;try{await call('storage-move',{path:target},true)}catch(e){code=e.code}eq(code,'storage_busy');
  await signal('release');const row=await until(async()=>(await web('downloads')).find(d=>d.state==='done'));
  eq(row.path.startsWith(stat.location.path+'\\downloads\\browser\\'),true);
  const result=await call('browser-import',{id:row.id,selected:['fixture-storage.vpk']},true);eq(result.errors.length,0);eq((await web('downloads'))[0].cleaned,true);
  await call('storage-move',{path:target},true);await until(async()=>{const st=await call('storage-get');if(st.move?.error)throw Error(st.move.error);return !st.move});
  eq((await web('downloads'))[0].path.startsWith(target+'\\downloads\\browser\\'),true);await signal('finished-move');
}
try{await run()}catch(e){if(origin)await fetch(origin+'/failure?reason='+encodeURIComponent(e.stack||e.message||String(e)))}
await invoke('plugin:window|close',{label:'main'});
