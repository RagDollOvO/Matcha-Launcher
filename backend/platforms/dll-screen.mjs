// Static PE inspection only. No shell, network or DLL loading.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { platformPath, readBytes, fail } from './files.mjs';
import { directory, writeJson } from '../mods/files.mjs';

export const rulesVersion = '1.0';
const hit=(rule,severity,category,title,detail)=>({rule,severity,category,title,detail});
const unable=()=>hit('PE001','review','packed','导入表未能完整读取','文件布局异常，部分能力无法静态识别');

function peImports(b) {
  const pe=b.readUInt32LE(60), opt=pe+24, size=b.readUInt16LE(pe+20), table=opt+size;
  if(b.readUInt16LE(0)!==0x5a4d || b.readUInt32LE(pe)!==0x4550 || ![0x10b,0x20b].includes(b.readUInt16LE(opt)))throw Error();
  const wide=b.readUInt16LE(opt)===0x20b, step=wide?8:4, dir=opt+(wide?112:96);
  const count=b.readUInt16LE(pe+6), sections=[];
  if(!count||count>96||table+40*count>b.length)throw Error();
  for(let i=0;i<count;i++){
    const s=table+i*40, start=b.readUInt32LE(s+20), length=b.readUInt32LE(s+16);
    if(length && start+length>b.length)throw Error();
    sections.push({name:b.toString('latin1',s,s+8).split('\0')[0],va:b.readUInt32LE(s+12),start,length});
  }
  const at=(v,n=1)=>{const s=sections.find(s=>v>=s.va && v+n<=s.va+s.length); if(!s)throw Error();return s.start+v-s.va;};
  const str=v=>{const start=at(v), end=b.subarray(start,start+513).indexOf(0);if(end<1||end>512)throw Error(); at(v,end+1);return b.toString('ascii',start,start+end);};
  const libs=new Set(), names=new Set(); let opaque=false, budget=65536;
  for(const [index,length] of [[1,20],[13,32]]){
    if(index>=b.readUInt32LE(dir-4))continue;
    if(dir+8*(index+1)>table)throw Error();
    const rva=b.readUInt32LE(dir+index*8);if(!rva)continue;
    for(let i=0;;i++){
      if(i>=1024)throw Error();const d=at(rva+i*length,length);
      if(b.subarray(d,d+length).every(x=>x===0))break;
      if(index===13&&b.readUInt32LE(d)!==1)throw Error();
      libs.add(str(b.readUInt32LE(d+(index===1?12:4))).toLowerCase());
      const thunk=b.readUInt32LE(d+(index===1?0:16)) || b.readUInt32LE(d+(index===1?16:12)); if(!thunk)throw Error();
      for(let j=0;;j++){
        if(--budget<=0)throw Error(); const p=at(thunk+j*step,step), low=b.readUInt32LE(p),high=wide?b.readUInt32LE(p+4):0;
        if(!high&&!low)break;
        if((wide?high:low)>=0x80000000){opaque=true;continue;}
        if(high)throw Error();names.add(str(low+2));
      }
    }
  }
  return {names:[...names],libs:[...libs],sections,opaque};
}
function highEntropy(bytes) {
  if(bytes.length<4096)return false;
  const counts=new Uint32Array(256);for(const x of bytes)counts[x]++;
  let bits=0;for(const n of counts)if(n){const p=n/bytes.length;bits-=p*Math.log2(p);}return bits>7.6;
}
export function inspectBytes(b) {
  let pe={names:[],libs:[],sections:[]}; const findings=[];
  try {pe=peImports(b);}catch{findings.push(unable());}
  const match=(rx)=>pe.names.filter(x=>rx.test(x)), add=(...args)=>findings.push(hit(...args));
  const flags=new Set();
  const patterns=[
    ['账号资料',/Login Data|Local State|ssfn|loginusers\.vdf|steamLoginSecure/i],['Discord webhook',/discord(?:app)?\.com\/api\/webhooks\//i],
    ['网址',/\b(?:https?|wss?):\/\/[a-z0-9]/i],['IP 地址',/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/],
    ['编码命令',/\b(?:powershell|pwsh)(?:\.exe)?\b[^\r\n\0]{0,180}?\s-(?:e|en|enc|encodedcommand)\s/i],
    ['命令解释器',/\bcmd(?:\.exe)?\s+\/[ck]\b/i],['Hook 库',/\b(?:MinHook|Detours|MH_CreateHook)\b/i],
  ];
  for(let p=0;p<b.length;p+=65536){
    const part=b.subarray(p,p+65536+512), texts=[part.toString('latin1'),part.toString('utf16le'),part.subarray(1).toString('utf16le')];
    for(const [name,rx] of patterns)if(!flags.has(name)&&texts.some(v=>rx.test(v)))flags.add(name);
  }
  const inj=match(/^(WriteProcessMemory|VirtualAllocEx|CreateRemoteThread(?:Ex)?)$/i);
  if(inj.length&&match(/^OpenProcess$/i).length)add('INJ001','block','injection','可打开其他进程并操作其内存或线程',['OpenProcess',...inj].join('、'));
  const net=[...pe.libs.filter(x=>/^(winhttp|wininet|ws2_32|wsock32)\.dll$/.test(x)),...match(/^(URLDownloadToFile|WinHttp|InternetOpen)/i),...['网址','IP 地址','Discord webhook'].filter(s=>flags.has(s))];
  if(net.length)add('NET001','review','network','含有网络通信能力或网络地址',net.slice(0,6).join('、'));
  const cred=[...match(/^CryptUnprotectData$/i),...['账号资料','Discord webhook'].filter(s=>flags.has(s))];
  if(cred.length)add('CRED001',net.length?'block':'review','credential',net.length?'账号资料线索与联网线索同时出现':'涉及账号或本机凭据资料',cred.join('、'));
  const proc=match(/^(CreateProcess|ShellExecute|WinExec)/i);if(flags.has('命令解释器'))proc.push('命令解释器');
  if(proc.length)add('PROC001','review','process','可启动外部程序',proc.slice(0,5).join('、'));
  if(flags.has('编码命令'))add('PROC002','block','process','包含编码执行的 PowerShell 命令','命中编码命令参数');
  const hooks=match(/^SetWindowsHookEx/i);if(hooks.length)add('HOOK001','review','input-hook','可安装系统输入钩子',hooks.join('、'));
  const mem=match(/^VirtualProtect/i);if(flags.has('Hook 库'))mem.push('Hook 库特征');
  if(mem.length)add('MEM001','info','memory','包含游戏插件常用的内存修改能力',mem.join('、'));
  const packed=pe.sections.filter(s=>/upx|themida|vmp|winlice/i.test(s.name)||highEntropy(b.subarray(s.start,s.start+s.length))).map(s=>s.name||'未命名区段');
  if(packed.length || pe.opaque || pe.names.length && pe.names.every(x=>/^(LoadLibrary|GetProcAddress)/i.test(x)))
    add('PACK001','review','packed','部分代码或依赖难以静态检查',packed.length?'高熵或壳特征区段：'+packed.slice(0,4).join('、'):pe.opaque?'存在按序号导入的函数':'只见动态装载入口');
  return findings;
}
export class DllScreen {
  constructor(dataDir) {this.base=path.join(dataDir,'dll-screen',rulesVersion); this.memo=new Map();}
  async scan(root, {verification, policyPath, fresh=false}={}) {
    const files=[], findings=[]; let entries=0, bytes=0;
    const walk=async dir=>{
      for(const e of await fs.readdir(dir,{withFileTypes:true})){
        if(++entries>8192)fail('screen_limit','模组文件数量超过筛查上限。');
        const full=path.join(dir,e.name), rel=path.relative(root,full).replaceAll('\\','/');
        if(e.isSymbolicLink())fail('unsafe_path','DLL 筛查需要真实文件或目录。');
        if(e.isDirectory()){await walk(full);continue;} if(!/\.dll$/i.test(e.name))continue;
        const file=await platformPath(root,rel), s=await fs.stat(file);
        if((bytes+=s.size)>2*1024**3)fail('screen_limit','DLL 总量超过筛查上限。');
        const stamp=[s.size,s.ctimeMs,s.mtimeMs,s.ino].join(':'); let row=this.memo.get(file);
        if(fresh||!row||row.stamp!==stamp){
          const b=await readBytes(file,256*1024**2), sha256=createHash('sha256').update(b).digest('hex'), dest=path.join(this.base,sha256+'.json');
          let hits; if(!fresh)try{hits=JSON.parse(await fs.readFile(dest,'utf8')).findings;}catch(e){if(e.code!=='ENOENT' && !(e instanceof SyntaxError))throw e;}
          if(!Array.isArray(hits)){hits=inspectBytes(b);await fs.mkdir(this.base,{recursive:true});await writeJson(dest,{rulesVersion,findings:hits});}
          row={stamp,sha256,hits};this.memo.set(file,row);if(this.memo.size>1024)this.memo.delete(this.memo.keys().next().value);
        }
        files.push({path:rel,sha256:row.sha256}); findings.push(...row.hits.map(h=>({...h,file:rel})));
      }
    };
    await directory(root);await walk(root);
    const cred=findings.find(f=>f.category==='credential'&&f.severity==='review'), net=findings.find(f=>f.category==='network'&&f.file!==cred?.file);
    if(cred&&net)findings.push({...hit('CRED002','block','credential','同包 DLL 同时涉及账户资料和联网',cred.file+'：'+cred.detail+'；'+net.file+'：'+net.detail),file:cred.file});
    if(verification?.state==='rejected')findings.push(hit('SIG001','block','signature','发布签名或文件核验未通过',String(verification.error?.message??'核验失败').slice(0,180)));
    const signed=verification?.state==='verified-development'&&verification.signature==='verified'&&verification.integrity==='verified';
    let tier='unverified';
    if(findings.some(f=>f.severity==='block'))tier='blocked';
    else if(files.length && signed && !findings.some(f=>f.severity==='review')){
      if(['private','closed'].includes(verification.source?.visibility))tier='closed';
      else if(verification.source?.visibility==='public' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(verification.source.commit) && verification.source.url?.startsWith('https://') && policyPath){
        // Publisher statements alone cannot award a maintainer review. The local trust policy binds independent evidence to these exact bytes.
        const policy=JSON.parse(await fs.readFile(policyPath,'utf8'));
        if(policy.reviewedReleases?.some(r=>r.releaseSha256===verification.releaseSha256 && r.commit===verification.source.commit && r.independentlyReproduced===true && r.maintainerReviewed===true))tier='verified';
      }
    }
    files.sort((a,b)=>a.path.localeCompare(b.path));
    return {tier,rulesVersion,checkedAt:new Date().toISOString(),files,findings};
  }
}
export function allowScreen(screen) { if(screen.tier==='blocked')fail('dll_screen_blocked','危险筛查已拦截：'+screen.findings.filter(f=>f.severity==='block').map(f=>f.title).join('；')); }
