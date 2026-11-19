// Generate packaging/ABI declarations from reviewed, checked-in feature tables.
// Run after changing preset.json. This script never reads or writes a game path.
import fs from 'node:fs/promises';
const root = new URL('../native/plugins/', import.meta.url);
const base = JSON.parse(await fs.readFile(new URL('skeeto.config-override/manifest.json', root)));
for (const dir of await fs.readdir(root)) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(dir)) continue;
  if (!dir.startsWith('skeeto.')) continue;
  const url = new URL(`${dir}/`, root), data = await fs.readFile(new URL('preset.json', url), 'utf8').catch(() => null);
  if (!data) continue;
  const p = JSON.parse(data);
  if (p.id !== dir || !Array.isArray(p.entries) || !p.entries.length) throw Error(`Invalid preset ${dir}`);
  for (const e of p.entries) {
    if (!/^[a-zA-Z0-9_]+$/.test(e.name)) throw Error(`Invalid Cvar ${e.name}`);
    for (const key of [e.option, e.setting, ...(e.any ?? [])].filter(Boolean)) if (!p.fields[key]) throw Error(`Missing field ${dir}.${key}`);
  }
  const m = structuredClone(base);
  m.id = p.id; m.name = p.name; m.version = p.version ?? '0.1.2';m.dependencies = [{id:'beacon.source',version:'0.4.0'}];
  m.developer.purpose = p.summary;
  m.developer.capabilities.filesystem = ['保存本模组 config.json'];
  m.developer.capabilities.hooks = ['通过 Beacon Source 服务订阅游戏帧'];
  if(p.lockApi) m.developer.capabilities.hooks.push('通过 Cvar API 2 即时拦截所持有参数的原生浮点 setter');
  m.developer.capabilities.memoryModification = ['通过独占租约设置声明的游戏参数，关闭或离开允许环境时恢复原值'];
  if (p.capabilities) m.developer.capabilities = p.capabilities;
  m.config = Object.entries(p.fields).map(([id, field]) => ({id,...field,apply:'immediate'}));
  m.actions = [
    {id:'status',label:'读取功能状态',effect:'read',requiresConfirmation:false,parameters:{},description:'显示每项参数的应用、等待、缺失或冲突状态。'},
    {id:'configure',label:'保存功能设置',effect:'write',requiresConfirmation:true,parameters:Object.fromEntries(Object.entries(p.fields).map(([id,{label,...field}])=>[id,field])),description:'保存独立设置；下一游戏帧应用，关闭选项后恢复所持有的原值。'}
  ];
  m.presentation.summary=p.summary;m.presentation.description=p.description+'\n\n每个选项关闭后，SDK 恢复启用前的游戏参数。游戏内切服会重新检查适用环境，冲突与缺失参数可在功能状态里查看。配置存入本 DLL 的 config.json。实际游戏效果待实测。';
  m.presentation.tags=p.tags;m.presentation.collections=p.collections;
  m.presentation.catalog.description='Skeeto 源码移植大合集。按用途进入小合集，选择具有独立说明、设置和启停开关的功能。完整移植进度见合集页面。';
  const write=(name,value)=>fs.writeFile(new URL(name,url),value);
  await write('manifest.json',JSON.stringify(m,null,2)+'\n');
  await write('feature.hpp',`// Generated from preset.json; run scripts/generate-skeeto-presets.mjs\nstatic constexpr const char* kPluginId = "${p.id}";\nstatic constexpr const char* kPluginVersion = "${m.version}";\nstatic constexpr const char* kDefinition = R"PRESET(${JSON.stringify(p)})PRESET";\n`);
  if (!p.customImplementation) await write('plugin.cpp','#include "feature.hpp"\n#include "preset_plugin.inc"\n');
  if (!p.customImplementation) await write('SOURCE.md',`# ${p.name}\n\nGPL-3.0。来源 Skeeto 2.2.19，提交 7a18b4988d089fdf6cc7e857560cf82a9609a32c。上游作者 regoists/Skeeto contributors。\n\n${p.source}\n\n${p.description}\n\n移植表在 preset.json；${p.entries.length} 个参数条目独立编译为 ${p.id}。Beacon Source 0.4.0 提供共享游戏线程和参数租约，保留原值、拒绝重叠占用，并在停用和离开适用环境时恢复。受限参数在本地服务器应用；sv_rollangle/sv_rollspeed 采用原作的客户端视觉路径。\n\nsource/ 内含完整编译输入、SDK、JSON 库和 CMake。Windows x86 C++17，CMake 3.22+。实际游戏表现待用户实测。\n`);
  for(const name of ['LICENSE','catalog.png'])await fs.copyFile(new URL(`skeeto.config-override/${name}`,root),new URL(name,url));
  // Preset DLLs use only public headers, without Source's private hook library.
  if (!p.customImplementation) await fs.copyFile(new URL('skeeto.config-override/Standalone.cmake',root),new URL('Standalone.cmake',url));
  console.log(`${p.id}: ${p.entries.length} parameters`);
}
