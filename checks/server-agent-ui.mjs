// Focused server-page check in an isolated browser profile; all bridge calls stay in memory.
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = await fs.mkdtemp(path.resolve('checks/.artifacts/server-agent-ui-'));
const fixture = {
  name: 'server-agent-ui-check',
  configureServer(server) {
    server.middlewares.use('/server-agent-check', async (_req, res) => {
      const html = await server.transformIndexHtml('/server-agent-check', `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
        <div id="app"></div><output id="report" hidden></output><script>
        localStorage.clear(); window.isTauri=true;
        window.fixture={saved:{groups:[{id:'coop',name:'战役',serverIds:['server-a']},{id:'versus',name:'对抗',serverIds:['server-b']}],loose:['server-c']},prompts:[],saves:0,hold:false};
        window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback(){return 1;},async invoke(cmd,args){
          const ok=result=>({ok:true,result}); if(cmd!=='beacon_call')return null;
          if(args.command==='server-state')return ok({servers:fixture.servers,serverLayout:structuredClone(fixture.saved)});
          if(args.command==='query-servers'||args.command==='list-servers')return ok(fixture.servers);
          if(args.command==='save-server-layout'){
            fixture.saves++; if(fixture.hold){fixture.hold=false;await new Promise(r=>fixture.release=r);}
            if(args.params.expected&&JSON.stringify(args.params.expected)!==JSON.stringify(fixture.saved))return {ok:false,error:{code:'server_layout_stale',message:'Fixture: 分类有新变化'}};
            fixture.saved=structuredClone(args.params.layout);return ok({status:'saved'});
          }
          return ok({});
        }};</script><script type="module" src="/server-agent-check-fixture.mjs"></script></html>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    });
  },
  resolveId(id) { if (id === '/server-agent-check-fixture.mjs') return id; },
  load(id) {
    if (id !== '/server-agent-check-fixture.mjs') return;
    return `
      import '/src/app.css';
      import {mount,tick} from 'svelte';
      import App from '/src/App.svelte';
      import {app} from '/src/lib/stores/app.svelte';
      import {agent} from '/src/lib/agent';
      const report=document.querySelector('#report');
      const check=(v,m)=>{if(!v)throw Error(m);};
      const wait=()=>new Promise(r=>setTimeout(r,5));
      const settle=async()=>{await tick();await wait();};
      const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
      try{
        fixture.servers=['战役服','对抗服','死门服'].map((name,i)=>({id:'server-'+String.fromCharCode(97+i),name,label:name,addr:'localhost:'+(27015+i),connectAddr:'localhost:'+(27015+i),gamePort:null,
          map:'c2m1_highway',mode:i===1?'对抗':i===2?'自定义':'战役',modeId:i===1?'versus':i===2?'custom':'coop',players:3+i,maxPlayers:8,ping:12+i,bots:1,tags:[],vac:true,password:false,favorite:i===0,status:'online',checkedAt:new Date().toISOString(),lastSeen:null,error:'',playerList:[]}));
        app.init=async()=>()=>{}; app.refresh=async()=>{};
        agent.connect=()=>{agent.connected=true;agent.current={id:'fixture',provider:'local',name:'离线检查'};};
        agent.send=text=>{fixture.prompts.push(text);return false;};
        app.ready=true;app.route='servers';app.servers=structuredClone(fixture.servers);app.acceptLayout(fixture.saved);
        app.game={installed:true,root:'D:/offline-fixture',running:false,build:'fixture',steamId:'550'};
        app.runtime={installed:true,status:'installed',version:'fixture'};app.dxvk={installed:true,enabled:true};
        app.capabilities={plugins:true,mods:false,servers:true,config:false};
        mount(App,{target:document.querySelector('#app')});await settle();
        const death=app.createServerGroup('死门');app.moveServers(['server-c'],death.id);
        check(await app.flushServerLayout(),'queued category drafts did not save');
        check(fixture.saved.groups.find(g=>g.id===death.id).serverIds[0]==='server-c','custom category member missing');
        app.agentOpen=true;await settle();
        const composer=document.querySelector('#agent-input');composer.value='保留我的草稿';composer.dispatchEvent(new Event('input',{bubbles:true}));
        await settle();document.querySelector('[data-card="server-c"] .idx').click();await settle();
        button('交给 Agent').click();await settle();await settle();
        check(fixture.prompts.length===1,'scope handoff missing');
        check(fixture.prompts[0].includes('server-c')&&!fixture.prompts[0].includes('server-a'),'handoff expanded the selected scope');
        const combined='保留我的草稿\\n\\n'+fixture.prompts[0];
        check(document.querySelector('#agent-input')?.value===combined,'Agent handoff overwrote the existing composer draft');
        app.agentOpen=false;await settle();
        check(agent.draft===combined,'closing the panel lost the server handoff text');
        fixture.hold=true;app.renameServerGroup(death.id,'死门草稿');
        for(let i=0;i<50&&!fixture.release;i++)await wait();check(fixture.release,'save did not enter controlled hold');
        fixture.saved.groups.find(g=>g.id===death.id).name='死门 · 已保存';fixture.release();
        check(!await app.flushServerLayout(),'stale category draft was accepted');await settle();
        check(app.serverLayoutConflict,'draft conflict feedback missing');
        check(localStorage.getItem('flare.serverLayout.pending').includes('死门草稿'),'local category draft lost');
        check(fixture.saved.groups.find(g=>g.id===death.id).name==='死门 · 已保存','remote category was overwritten');
        button('重试分类草稿').click();await settle();
        check(app.confirmation?.title==='重新提交分类草稿','draft retry preview missing');
        document.querySelector('dialog[open] button[aria-label="取消"]').click();await settle();
        check(app.serverLayoutConflict&&localStorage.getItem('flare.serverLayout.pending'),'cancel discarded the category draft');
        check(button('采用已保存分类')&&button('重试分类草稿'),'draft resolution actions missing');
        const bulk=document.querySelector('.bulk').getBoundingClientRect();
        check([...document.querySelectorAll('.bulk button')].every(b=>b.getBoundingClientRect().right<=bulk.right+1),'selected-server actions overflow the footer');
        button('重试分类草稿').click();await settle();app.answerConfirmation(true);await settle();
        check(await app.flushServerLayout(),'confirmed draft retry did not save');
        check(fixture.saved.groups.find(g=>g.id===death.id).name==='死门草稿','confirmed category draft missing');
        check(!app.serverLayoutConflict&&!localStorage.getItem('flare.serverLayout.pending'),'successful retry kept stale conflict state');
        fixture.release=null;fixture.hold=true;app.renameServerGroup(death.id,'死门第二份草稿');
        for(let i=0;i<50&&!fixture.release;i++)await wait();
        fixture.saved.groups.find(g=>g.id===death.id).name='死门';fixture.release();await app.flushServerLayout();await settle();
        button('采用已保存分类').click();await settle();app.answerConfirmation(true);await settle();
        check(!app.serverLayoutConflict&&app.serverLayout.groups.find(g=>g.id===death.id).name==='死门','adopting the saved layout failed');
        check(!localStorage.getItem('flare.serverLayout.pending'),'adopting the saved layout retained the discarded draft');
        report.dataset.complete='pass';report.textContent='custom categories, queued saves, scoped handoff and text drafts, conflict cancel, confirmed retry and saved-layout adoption';
      }catch(e){report.dataset.complete='failed';report.textContent=e.stack||e.message;}
    `;
  },
};
const server = await createServer({ configFile: false, cacheDir: path.join(base, 'vite-cache'), plugins: [svelte(), fixture],
  server: { host: '127.0.0.1', port: 0, strictPort: true, watch: { ignored: ['**/checks/**', '**/release/**', '**/vendor/**', '**/.backup/**'] } }, clearScreen: false });
await server.listen();
try {
  const port = server.httpServer.address().port;
  const { stdout } = await promisify(execFile)('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--window-size=1480,960',
    '--user-data-dir=' + path.join(base, 'edge'), '--virtual-time-budget=7000', '--dump-dom',
    '--screenshot=' + path.join(base, 'server-agent.png'), 'http://127.0.0.1:' + port + '/server-agent-check',
  ], { timeout: 45000, windowsHide: true, maxBuffer: 3 * 1024 * 1024 });
  const result = stdout.match(/<output id="report"[^>]*>[\s\S]*?<\/output>/)?.[0];
  console.log(JSON.stringify({ directory: base, result }));
  await fs.writeFile(path.join(base, 'result.txt'), result ?? stdout);
  if (!result?.includes('data-complete="pass"')) process.exitCode = 1;
} finally { await server.close(); }
