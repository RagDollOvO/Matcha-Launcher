// Focused renderer check: no real Pi process, provider requests or user data.
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const artifacts = path.resolve('checks/.artifacts/pi-autoconnect');
await fs.mkdir(artifacts, { recursive: true });
const fixture = {
  name: 'pi-autoconnect-check',
  configureServer(server) {
    server.middlewares.use('/pi-autoconnect', async (_req, res) => {
      const html = await server.transformIndexHtml('/pi-autoconnect', `<!doctype html><html lang="zh-CN">
        <meta charset="utf-8"><div id="app"></div><output id="report" hidden></output>
        <script>
          window.isTauri=true;
          window.fixture={callbacks:new Map(),connections:0,fail:false};
          window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},
            transformCallback(fn){const id=fixture.callbacks.size+1;fixture.callbacks.set(id,fn);return id;},
            async invoke(cmd,args){
              if(cmd==='plugin:event|listen')return 1;
              if(cmd==='plugin:event|unlisten')return;
              if(cmd!=='beacon_call')return null;
              const ok=result=>({ok:true,result});
              if(args.command==='pi-info')return ok({configDir:'D:/fixture/pi',loginCommand:'fixture'});
              if(['pi-connect','pi-reconnect'].includes(args.command)){
                fixture.connections++;await new Promise(r=>setTimeout(r,100));
                if(fixture.fail)return {ok:false,error:{code:'pi_fixture',message:'测试连接失败'}};
                return ok({model:{id:'fixture',provider:'local',name:'本地测试模型',reasoning:true,input:['text']}});
              }
              const type=args.params?.type;
              if(type==='get_messages')return ok({messages:[{role:'user',content:'保留原来的对话'}]});
              if(type==='get_available_models')return ok({models:[{id:'fixture',provider:'local',name:'本地测试模型'}]});
              if(type==='get_available_thinking_levels')return ok({levels:['off','medium','high']});
              return ok({});
            }
          };
        </script><script type="module" src="/pi-autoconnect-fixture.mjs"></script></html>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
    });
  },
  resolveId(id) { if (id === '/pi-autoconnect-fixture.mjs') return id; },
  load(id) {
    if (id !== '/pi-autoconnect-fixture.mjs') return;
    return `
      import '/src/app.css';
      import {mount,tick} from 'svelte';
      import App from '/src/App.svelte';
      import {app} from '/src/lib/stores/app.svelte';
      import {agent} from '/src/lib/agent';
      const report=document.querySelector('#report');
      const check=(ok,text)=>{if(!ok)throw Error(text);};
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const settle=async()=>{await tick();await wait(1);};
      const connected=async()=>{for(let i=0;i<50&&!agent.connected;i++)await wait(20);check(agent.connected,'automatic connection did not finish');};
      app.agentOpen=false; app.init=async()=>()=>{};app.refresh=async()=>{};
      try{
        mount(App,{target:document.querySelector('#app')});await settle();
        check(agent.connecting,'App did not start Pi with panel closed');
        agent.connect();agent.connect();await connected();
        check(fixture.connections===1,'startup or pending connect duplicated the process request');
        check(agent.modelReady && agent.models.length===1,'model handshake incomplete');
        app.agentOpen=true;await settle();
        check(!document.body.textContent.includes('连接 Pi CLI'),'manual startup gate remains');
        check(!document.querySelector('#agent-input').disabled,'connected composer stayed disabled');
        const history=agent.messages;
        app.agentOpen=false;await settle();app.agentOpen=true;await settle();agent.connect();
        check(fixture.connections===1 && agent.messages===history,'panel remount replaced connection/history');
        fixture.fail=true;agent.reconnect();await wait(160);await settle();
        check(!agent.connected && !agent.connecting && agent.connectionError.includes('测试连接失败'),'failed connection status missing');
        check(document.body.textContent.includes('重试连接'),'failure retry action missing');
        check(agent.messages===history,'connection failure changed saved history');
        fixture.fail=false;agent.connect();agent.connect();await connected();await settle();
        check(fixture.connections===3,'retry was duplicated or absent');
        check(!document.querySelector('#agent-input').disabled,'retry did not restore composer');
        report.dataset.complete='pass';report.textContent='background startup, single flight, handshake, panel remount, failure and retry';
      }catch(e){report.dataset.complete='failed';report.textContent=e.stack||e.message;}
    `;
  },
};
const server = await createServer({ configFile: false, plugins: [svelte(), fixture],
  server: { host: '127.0.0.1', port: 5196, strictPort: true, watch: { ignored: ['**/checks/**', '**/release/**', '**/vendor/**'] } } });
await server.listen();
try {
  const { stdout } = await promisify(execFile)('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--window-size=1200,820',
    '--user-data-dir=' + path.join(artifacts, 'edge'), '--virtual-time-budget=4000', '--dump-dom',
    '--screenshot=' + path.join(artifacts, 'connected.png'), 'http://127.0.0.1:5196/pi-autoconnect',
  ], { timeout: 35000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const result = stdout.match(/<output id="report"[^>]*>[\s\S]*?<\/output>/)?.[0];
  console.log(result);
  await fs.writeFile(path.join(artifacts, 'result.txt'), result ?? stdout);
  if (!result?.includes('data-complete="pass"')) process.exitCode = 1;
} finally { await server.close(); }
