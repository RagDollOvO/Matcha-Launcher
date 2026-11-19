import fs from 'node:fs/promises';
import path from 'node:path';
import { createFixture } from './fixtures.mjs';
import { vpkFixture, addonInfo } from './mods-fixtures.mjs';
import * as core from '../core.mjs';
import { DesktopService } from '../desktop/service.mjs';
export async function quickFixture(base) {
  const f=await createFixture(base), content=path.join(f.gameRoot,'left4dead2');
  await fs.mkdir(path.join(content,'cfg'));await fs.mkdir(path.join(content,'maps'));
  await fs.writeFile(path.join(content,'cfg/config_default.cfg'),'bind w +forward\n');
  await fs.writeFile(path.join(content,'cfg/config.cfg'),'USER_CONFIG');
  await fs.writeFile(path.join(content,'addonlist.txt'),'"AddonList" { "b.vpk" "1" }');
  await vpkFixture(path.join(content,'pak01_dir.vpk'),{'models/base.mdl':'base'},{split:true});
  await vpkFixture(path.join(content,'addons/a_dir.vpk'),{'addoninfo.txt':addonInfo('AK-47 测试模型'),'models/v_models/v_rifle_ak47.mdl':'model'},{split:true});
  await vpkFixture(path.join(content,'addons/b.vpk'),{'addoninfo.txt':addonInfo('其他已启用 Mod'),'maps/custom_room.bsp':'BSP','models/v_models/v_rifle_ak47.mdl':'other'});
  await fs.writeFile(path.join(content,'maps/c1m1_hotel.bsp'),'BASE_MAP');
  let running=[],launches=[];
  const steamExe=path.join(base,'steam.exe');await fs.writeFile(steamExe,'fixture');
  const api={...core,...core.createPlatform({getProcesses:async()=>running,isSteamRunning:async()=>true,launchGame:async(file,args,cwd)=>{launches.push({file,args,cwd});running=[{pid:777,name:'left4dead2',path:file}];return {pid:777};}})};
  const launch=api.launchQuickTest;api.launchQuickTest=p=>launch({...p,steamExe});
  api.discover=async()=>({games:[await api.inspectGame(f.gameRoot)],warnings:[]});
  const service=new DesktopService({core:api,dataDir:path.join(base,'settings')});
  await service.ready;
  return {...f,content,api,service,launches,setRunning:p=>running=p};
}
