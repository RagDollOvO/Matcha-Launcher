import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exists, fail, writeJson } from '../mods/files.mjs';
import { regular } from '../mods/vpk.mjs';
import { isFolder } from '../legacy-names.mjs';
import { prepareEnvironment, environmentVersion } from './environment.mjs';

const assets = fileURLToPath(new URL('./assets/', import.meta.url));
const mapName = name => typeof name === 'string' && /^[a-z0-9_][a-z0-9_-]{0,95}$/i.test(name);
export function normalizePreset(p = {}) {
  if (!Array.isArray(p.modIds) || p.modIds.length > 64 || p.modIds.some(id=>typeof id!=='string')) fail('test_selection_invalid','请选择最多 64 个测试 Mod。');
  if(typeof p.mapModId!=='string'||!p.mapModId)fail('test_map_mod_required','请指定一个地图 Mod。');
  if (!mapName(p.map)) fail('test_map_invalid','请选择列表中的地图。');
  if (![960,1280,1600].includes(p.width)) fail('test_window_invalid','请选择窗口尺寸。');
  if (typeof p.quiet !== 'boolean' || typeof p.infiniteAmmo !== 'boolean') fail('test_options_invalid','测试选项需要开关值。');
  return { modIds:[...new Set(p.modIds)],mapModId:p.mapModId,map:p.map,width:p.width,quiet:p.quiet,infiniteAmmo:p.infiniteAmmo };
}
const defaultPreset = () => ({modIds:[],mapModId:'',map:'',width:960,quiet:true,infiniteAmmo:true});
async function assertLinkedVpkUnchanged(vpk) {
  // Creating our hardlinks updates ctime/nlink, while inode, size and mtime remain stable.
  for(const f of vpk.files) {
    const s=await regular(f.file);
    if(`${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`!==f.identity.split(':').slice(0,4).join(':'))fail('file_changed','准备期间来源 VPK 已变化，请重新测试。');
  }
}
export class QuickTest {
  constructor({ manager, core, dataDir }) { this.manager=manager; this.core=core; this.file=path.join(dataDir,'quick-test.json'); this.cacheFile=path.join(dataDir,'quick-test-cache.json'); }
  async saved() {
    try { return JSON.parse(await fs.readFile(this.file,'utf8')); }
    catch(e) { if(e.code==='ENOENT') return {}; throw e; }
  }
  async selected(root, ids) {
    if (!Array.isArray(ids) || ids.length>65 || ids.some(id=>typeof id!=='string')) fail('test_selection_invalid','请选择最多 64 个测试 Mod 和一个地图包。');
    return Promise.all([...new Set(ids)].map(async id=>({id,vpk:await this.manager.cached(await this.manager.resolve(root,id))})));
  }
  maps(selected) {
    const maps = [];
    for(const {id:modId,vpk} of selected) for(const r of vpk.resources) {
      const m=/^maps\/([^/]+)\.bsp$/i.exec(r);
      if(m&&mapName(m[1])) maps.push({id:m[1],source:vpk.title,modId});
    }
    return maps;
  }
  async describe(root, ids, mapModId) {
    const saved=await this.saved();
    const {weapon:_legacyWeapon,...previous}=saved.preset??{};
    const preset=saved.gameRoot===root ? {...defaultPreset(),...previous} : defaultPreset();
    const inventory=await this.manager.scan(root);
    const requested=ids??preset.modIds;
    if(!Array.isArray(requested)||requested.length>64||requested.some(id=>typeof id!=='string'))fail('test_selection_invalid','请选择最多 64 个测试 Mod。');
    const maps=[];
    for(const m of inventory.mods) if(!m.error&&m.kind!=='platform-package')maps.push(...this.maps([{id:m.id,vpk:await this.manager.cached(await this.manager.resolve(root,m.id))}]));
    const enabled=new Set([...requested,mapModId??preset.mapModId]);
    return { preset, maps,
      conflicts: inventory.conflicts.filter(c=>enabled.has(c.a)&&enabled.has(c.b)),
      status:await this.status(root) };
  }
  async status(root) {
    const saved=await this.saved(), game=await this.core.inspectGame(root);
    const last=saved.gameRoot===root?saved.last:null;
    if(!last)return {state:game.processes.length?'busy':'idle'};
    const owned=last.directory && path.dirname(path.dirname(last.directory))===root && isFolder(path.dirname(last.directory),'tests') && /^[0-9a-f-]{36}$/.test(path.basename(last.directory));
    const executable=owned&&last.environmentVersion>=2?path.join(last.directory,'left4dead2.exe'):path.join(root,'left4dead2.exe');
    const process=game.processes.find(p=>p.pid===last.pid&&p.path&&path.resolve(p.path).toLowerCase()===executable.toLowerCase());
    let ready=!!last.readyAt, configured=false, failure='', logFile;
    if(owned && last.token) {
      for(const sub of ['flare','left4dead2','update','bin','']) {
        const log=path.join(last.directory,sub,'console.log');
        if(!await exists(log))continue;
        const stat=await regular(log), h=await fs.open(log,'r');
        try {
          const b=Buffer.alloc(Math.min(stat.size,256*1024));await h.read(b,0,b.length,Math.max(0,stat.size-b.length));
          const current=b.includes(Buffer.from(`FLARE_TEST_CONFIG_${last.token}`));
          configured ||= current;
          ready ||= b.includes(Buffer.from(`FLARE_TEST_READY_${last.token}`));
          if(current) {
            logFile=log;
            const missing=/Server is enforcing consistency for this file:\s*File ([^\r\n]+) was not found\./.exec(b.toString('utf8'));
            if(missing)failure=`资源校验失败：找不到 ${missing[1]}。请使用更新后的测试环境。`;
          }
        } finally {await h.close();}
      }
    }
    if(process&&ready&&!last.readyAt) {
      last.readyAt=new Date().toISOString();await writeJson(this.file,{...saved,last});
    }
    if(!process&&!game.processes.length&&!last.readyAt&&!ready&&!failure)failure='游戏在进场前退出，请查看测试日志。';
    return {state:!process&&game.processes.length?'busy':failure?'failed':process?(ready?'ready':'loading'):'exited',...last,configured,processRunning:!!process,failure,logFile};
  }
  async prepare(root, raw) {
    const started=performance.now(), preset=normalizePreset(raw);
    await this.manager.idle(root);
    // Only selected files are needed here; avoid a second full-library scan.
    const selected=await this.selected(root,[...new Set([...preset.modIds.filter(id=>id!==preset.mapModId),preset.mapModId])]);
    if(!this.maps(selected.filter(m=>m.id===preset.mapModId)).some(m=>m.id===preset.map))
      fail('test_map_missing','指定地图包内没有这张地图，请重新选择。');
    const prepared=await prepareEnvironment(root,selected,this.cacheFile);
    const session=prepared.directory, content=path.join(session,'flare'), token=randomUUID();
    // Remove only the F6 binding previously generated by Matcha, including a
    // saved engine config in a reused environment. Keep other test preferences.
    const oldCfg=await fs.readFile(path.join(content,'cfg/flare_test.cfg'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
    const oldGive=/^bind F6 "(give [a-z0-9_]+)"$/m.exec(oldCfg)?.[1];
    if(oldGive) {
      const file=path.join(content,'cfg/config.cfg');
      const config=await fs.readFile(file,'utf8');
      const migrated=config.split(/\r?\n/).filter(line=>{
        const binding=/^\s*bind\s+"?F6"?\s+"([^"\r\n]+)"\s*$/i.exec(line);
        return binding?.[1]!==oldGive;
      }).join('\n');
      if(migrated!==config)await fs.writeFile(file,migrated);
    }
    await writeJson(path.join(session,'session.json'),{owner:'flare-quick-test',environmentVersion,gameRoot:root,preset,token});
    await fs.writeFile(path.join(content,'cfg/valve.rc'),'exec config.cfg\nexec autoexec.cfg\nstuffcmds\n');
    const cfg=`echo FLARE_TEST_CONFIG_${token}\nsv_lan 1\nsv_cheats 1\nsv_infinite_ammo ${preset.infiniteAmmo?1:0}\n${preset.quiet?'director_stop\nz_common_limit 0\n':''}bind F7 "thirdpersonshoulder"\nbind F8 "firstperson"\nbind F10 "quit"\npath\n`;
    await fs.writeFile(path.join(content,'cfg/flare_test.cfg'),cfg);
    await fs.writeFile(path.join(content,'cfg/autoexec.cfg'),'exec flare_test.cfg\n');
    // +exec runs before Host_NewGame. The listen-server config is run on map
    // creation; wait a few frames for VScript initialization, then wait for player.
    await fs.writeFile(path.join(content,'cfg/listenserver.cfg'),'exec flare_test.cfg\nwait 10\nscript_execute flare_quicktest\n');
    const helper=(await fs.readFile(path.join(assets,'flare_quicktest.nut'),'utf8')).replaceAll('__TOKEN__',token);
    await fs.writeFile(path.join(content,'scripts/vscripts/flare_quicktest.nut'),helper);
    await this.manager.idle(root);
    for(const {vpk} of selected)await assertLinkedVpkUnchanged(vpk);
    return {directory:session,preset,token,cacheHit:prepared.cacheHit,preparationMs:Math.round(performance.now()-started)};
  }
  async start(root,preset,confirmation) {
    if(confirmation?.approved!==true||confirmation.source!=='user')fail('confirmation_required','点击「开始测试」以启动游戏。');
    return this.manager.mutation(root,confirmation,async()=> {
      const prepared=await this.prepare(root,preset);
      const saved={gameRoot:root,preset:prepared.preset};
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      await writeJson(this.file,saved);
      const launched=await this.core.launchQuickTest({gameRoot:root,testDirectory:prepared.directory,map:prepared.preset.map,width:prepared.preset.width,confirmation});
      const last={pid:launched.pid,directory:prepared.directory,environmentVersion,token:prepared.token,map:prepared.preset.map,cacheHit:prepared.cacheHit,preparationMs:prepared.preparationMs,startedAt:new Date().toISOString()};
      await writeJson(this.file,{...saved,last});
      return {state:'loading',...last};
    });
  }
}
