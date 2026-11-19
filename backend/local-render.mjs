// Read only the two entrypoints the game imports. Never recurse into backups or load a DLL.
import fs from 'node:fs/promises';
import { platformPath, readBytes } from './platforms/files.mjs';

const cache = new Map();
async function probe(root, relative, probeBytes) {
  const file = await platformPath(root, relative);
  if (!file) return null;
  const stat = await fs.stat(file,{bigint:true});
  const key = [stat.dev,stat.ino,stat.ctimeNs,stat.mtimeNs,stat.size].join(':');
  if (cache.get(file)?.key === key) return cache.get(file).result;
  const result = stat.size <= 64n*1024n*1024n ? probeBytes(await readBytes(file,64*1024*1024)) : { unknown:true };
  if (cache.size >= 48) cache.clear();
  cache.set(file,{key,result}); return result;
}
function x86(b) {
  if (b.length < 64 || b.readUInt16LE()!==0x5a4d) return false;
  const offset=b.readUInt32LE(60);
  return offset+24<=b.length && b.readUInt32LE(offset)===0x4550 && b.readUInt16LE(offset+4)===0x14c;
}
const infoKey=Buffer.from('VS_VERSION_INFO\0','utf16le'), dxvkTag=Buffer.from('DXVK: \0');
function productVersion(b) {
  if(!x86(b)) return null;
  const i=b.indexOf(infoKey);
  if(i<6) return null;
  const o=Math.ceil((i+infoKey.length)/4)*4;
  if(o+52>b.length || b.readUInt16LE(i-4)!==52 || b.readUInt32LE(o)!==0xfeef04bd) return null;
  const a=b.readUInt32LE(o+16),z=b.readUInt32LE(o+20);
  if(!a&&!z) return null;
  return [a>>>16,a&65535,z>>>16,...(z&65535?[z&65535]:[])].join('.');
}
export async function localL4n(root) {
  const dll=await probe(root,'bin/left4neko.dll',b=>({version:productVersion(b),valid:x86(b)}));
  if(!dll) return {installed:false,enabled:false,version:null};
  const exe=await probe(root,'left4dead2.exe',b=>({neko:x86(b)&&b.includes(Buffer.from('left4neko.dll')),canSkip:b.includes(Buffer.from('-hide_neko')) || b.includes(Buffer.from('-hide_neko','utf16le'))}));
  return {installed:true,enabled:!!dll.valid && !!exe?.neko,version:dll.version??null, supportsLaunchToggle:!!dll.valid && !!exe?.neko && !!exe.canSkip};
}
export async function localRender(root) {
  const entries=[];
  for(const [route,path] of [['default','d3d9.dll'],['vulkan','bin/dxvk_d3d9.dll']]) {
    const result=await probe(root,path,b=>{
      if(!x86(b)) return {kind:'unknown'};
      if(b.includes(Buffer.from('L4P_RenderBackendControlV1')) || b.includes(Buffer.from('L4P_PlatformShimVersion'))) return {kind:'legacy-matcha'};
      const i=b.indexOf(dxvkTag);
      if(i<0) return {kind:'unknown'};
      const raw=b.toString('latin1',i+dxvkTag.length,i+dxvkTag.length+80).split('\0')[0];
      return {kind:'dxvk',version:/^(?:v|native-)?\d+\.\d+[a-z0-9.+_-]*$/i.test(raw)?raw.replace(/^v/,''):null};
    });
    if(result) entries.push({route,path,kind:result.kind??'unknown',version:result.version??null});
  }
  return entries;
}
