import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory, exists, stamp, writeJson } from '../mods/files.mjs';
import { regular } from '../mods/vpk.mjs';
import { gameFolder } from '../legacy-names.mjs';

export const environmentVersion = 4;
const bases = ['update','left4dead2_dlc3','left4dead2_dlc2','left4dead2_dlc1','left4dead2','hl2'];
const contentDirs = ['maps','materials','models','resource','scenes','particles','expressions','scripts','shaders','gfx'];
const quote = value => '"'+value.replaceAll('\\','/')+'"';

// A complete, private installation layout. L4D2 can select its default game folder
// during startup, so a custom -game path alone is insufficient on current builds.
// Only immutable assets are linked; configs, logs and engine caches are private.
export async function environmentPlan(root, selected) {
  const files=[], dirs=new Set(['bin','platform/config','left4dead2/addons','left4dead2/cfg','flare/cfg','flare/addons','flare/maps','flare/scripts/vscripts','update']);
  const add=async(source,target,kind='link')=>{
    const s=kind==='junction'?(await directory(source),await fs.lstat(source)):await regular(source);
    files.push({source,target,kind,stamp:stamp(s)});
  };
  const fileIf=async(source,target,kind='link')=>{if(await exists(source))await add(source,target,kind);};
  await add(path.join(root,'left4dead2.exe'),'left4dead2.exe');
  await fileIf(path.join(root,'steam_appid.txt'),'steam_appid.txt','copy');
  for(const sub of ['bin','left4dead2/bin']) {
    dirs.add(sub);
    if(!await exists(path.join(root,sub)))continue;
    await directory(path.join(root,sub));
    for(const item of await fs.readdir(path.join(root,sub),{withFileTypes:true})) {
      if(item.isFile() && /\.(dll|flt|asi|cfg|txt|bin)$/i.test(item.name) && !/^(dxvk.*|d3d9|dinput8|winmm|winhttp|wininet|version|shaderapivk)\.dll$/i.test(item.name))
        await add(path.join(root,sub,item.name),path.join(sub,item.name),/\.(cfg|txt|bin)$/i.test(item.name)?'copy':'link');
    }
  }
  // Platform UI files are small. Copying also keeps any UI-written preferences local.
  async function platformFiles(sub) {
    const source=path.join(root,sub);await directory(source);dirs.add(sub);
    for(const item of await fs.readdir(source,{withFileTypes:true})) {
      if(item.name.toLowerCase()==='config')continue;
      if(item.isDirectory())await platformFiles(path.join(sub,item.name));
      else if(item.isFile())await add(path.join(source,item.name),path.join(sub,item.name),'copy');
    }
  }
  if(await exists(path.join(root,'platform')))await platformFiles('platform');
  const mounts=[];
  for(let i=0;i<selected.length;i++) {
    const sub=`mounts/mod-${i}`;dirs.add(sub);mounts.push(sub);
    for(const f of selected[i].vpk.files) {
      const name=f.file===selected[i].vpk.file?'pak01_dir.vpk':`pak01_${path.basename(f.file).match(/_(\d{3})\.vpk$/i)[1]}.vpk`;
      await add(f.file,`${sub}/${name}`);
    }
  }
  for(const base of bases) {
    const source=path.join(root,base);if(!await exists(source))continue;
    await directory(source);dirs.add(base);mounts.push(base);
    for(const name of await fs.readdir(source)) {
      if(/^pak\d+_(?:dir|\d{3})\.vpk$/i.test(name))await add(path.join(source,name),`${base}/${name}`);
      else if(/\.cache$/i.test(name))await add(path.join(source,name),`${base}/${name}`,'copy');
    }
    for(const name of contentDirs) {
      const target=`${base}/${name}`;
      if(await exists(path.join(source,name)))await add(path.join(source,name),target,'junction');
    }
    // Source's sound cache sits beside the sound directories. Give each mount
    // its own cache while reusing the large audio subtrees.
    if(await exists(path.join(source,'sound'))) {
      await directory(path.join(source,'sound'));dirs.add(`${base}/sound`);
      for(const item of await fs.readdir(path.join(source,'sound'),{withFileTypes:true})) {
        const src=path.join(source,'sound',item.name), dest=`${base}/sound/${item.name}`;
        if(item.isDirectory())await add(src,dest,'junction');
        else if(item.isFile())await add(src,dest,/\.cache$/i.test(item.name)?'copy':'link');
      }
    }
  }
  for(const name of ['steam.inf','dxsupport_override.cfg','glbaseshaders.cfg','shader_cache.cfg'])
    await fileIf(path.join(root,'left4dead2',name),`left4dead2/${name}`,'copy');
  const cfg=path.join(root,'left4dead2/cfg');await directory(cfg);
  for(const name of await fs.readdir(cfg))if(/^(config_default\.cfg|moddefaults\.txt|settings_default\.scr|user_default\.scr|(?:cpu|gpu|gpu_mem|mem)_level_\d_pc(?:_ss)?\.ekv)$/i.test(name))
    await add(path.join(cfg,name),`flare/cfg/${name}`,'copy');
  return {version:environmentVersion,files,dirs:[...dirs],mounts};
}

async function intact(folder,plan) {
  try {
    await directory(folder);
    for(const d of plan.dirs)await directory(path.join(folder,d));
    for(const f of plan.files) {
      const target=path.join(folder,f.target);
      if(f.kind==='junction') {
        const stat=await fs.lstat(target);
        if(!stat.isSymbolicLink() || (await fs.realpath(target)).toLowerCase()!==f.source.toLowerCase())return false;
      } else {
        const stat=await regular(target);
        if(f.kind==='link'&&stamp(stat)!==f.stamp)return false;
      }
    }
    for(const file of ['left4dead2/gameinfo.txt','update/gameinfo.txt','flare/cfg/config.cfg'])await regular(path.join(folder,file));
    return true;
  } catch(e) { if(['ENOENT','unsafe_path'].includes(e.code))return false;throw e; }
}

export async function prepareEnvironment(root,selected,cacheFile) {
  const plan=await environmentPlan(root,selected);
  let cache=[];
  try {cache=JSON.parse(await fs.readFile(cacheFile,'utf8'));} catch(e) {if(e.code!=='ENOENT')throw e;}
  const ids=selected.map(m=>m.id), sameSelection=e=>e.root===root&&JSON.stringify(e.ids)===JSON.stringify(ids);
  const candidate=cache.find(sameSelection);
  const parent=await directory(gameFolder(root,'tests'),true);
  if(candidate && /^[0-9a-f-]{36}$/.test(candidate.id)) {
    const folder=path.join(parent,candidate.id);
    let prior;
    try {prior=JSON.parse(await fs.readFile(path.join(folder,'environment.json'),'utf8'));} catch(e) {if(e.code!=='ENOENT')throw e;}
    if(JSON.stringify(prior)===JSON.stringify(plan)&&await intact(folder,plan))return {directory:folder,cacheHit:true,plan};
  }
  const id=randomUUID(), folder=path.join(parent,id);await fs.mkdir(folder);
  for(const d of plan.dirs)await fs.mkdir(path.join(folder,d),{recursive:true});
  for(const f of plan.files) {
    const dest=path.join(folder,f.target);await fs.mkdir(path.dirname(dest),{recursive:true});
    if(f.kind==='junction')await fs.symlink(f.source,dest,'junction');
    else if(f.kind==='copy')await fs.copyFile(f.source,dest);
    else await fs.link(f.source,dest);
  }
  // L4D2 did not infer MOD / DEFAULT_WRITE_PATH from absolute Game entries.
  // Declare them explicitly. Consistency checks also open root-relative names
  // such as left4dead2/pak01_dir.vpk, requiring the private install's root.
  const paths=['flare',...plan.mounts,'.'];
  const info=`"GameInfo" { game "Matcha - Quick Test" type multiplayer_only nomodels 1 nohimodel 1 l4dcrosshair 1 nodegraph 0 SupportsDX8 0\nFileSystem { SteamAppId 550 ToolsAppId 563\nSearchPaths {\nMOD ${quote(path.join(folder,'flare'))}\nDEFAULT_WRITE_PATH ${quote(path.join(folder,'flare'))}\nBASE_PATH ${quote(folder)}\n${paths.map(p=>'Game '+quote(path.join(folder,p))).join('\n')}\nGameBin ${quote(path.join(folder,'left4dead2/bin'))}\n} } }\n`;
  for(const base of ['left4dead2','update'])await fs.writeFile(path.join(folder,base,'gameinfo.txt'),info);
  await fs.writeFile(path.join(folder,'flare/cfg/config.cfg'),'exec config_default.cfg\n');
  await fs.writeFile(path.join(folder,'left4dead2/addonlist.txt'),'"AddonList" { }\n');
  await writeJson(path.join(folder,'environment.json'),plan);
  await fs.mkdir(path.dirname(cacheFile),{recursive:true});
  await writeJson(cacheFile,[...cache.filter(e=>!sameSelection(e)),{root,ids,id}]);
  return {directory:folder,cacheHit:false,plan};
}
