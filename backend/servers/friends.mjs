import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BlockList, isIPv4 } from 'node:net';
import { fileURLToPath } from 'node:url';
import manifest from '../community/steampp-manifest.json' with { type: 'json' };
import { emptyObservation } from './query.mjs';
import { serverError } from './address.mjs';

const run = promisify(execFile);
const reader = fileURLToPath(new URL('matcha-steam-friends.exe', import.meta.url));
const api = fileURLToPath(new URL('../../vendor/steampp/'+manifest.version+'/assemblies/steam_api64.dll', import.meta.url));
export async function readPresence() {
  try {
    const { stdout } = await run(reader, [api], { windowsHide:true, timeout:8000, maxBuffer:2*1024*1024, encoding:'utf8' });
    return JSON.parse(stdout.replace(/^\uFEFF/, ''));
  } catch(e) {
    if(e.code===2) throw serverError('steam_offline','请打开并登录 Steam，再刷新。');
    throw serverError('steam_friends_unavailable', e.killed ? 'Steam 响应超时，请刷新。' : '好友状态读取失败。请检查 Steam 和内测包是否完整。');
  }
}

// Only query public game servers shared through presence; menus, lobbies and LAN games still show their friends.
const reserved=new BlockList();
for(const [net,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) reserved.addSubnet(net,bits);
const port=n=>Number.isInteger(n)&&n>0&&n<=65535;
export function groupPresence(rows) {
  const groups=new Map();
  for(const [i,p] of rows.entries()) {
    const endpoint=isIPv4(p.ip)&&!reserved.check(p.ip)&&port(p.port);
    const addr=endpoint?p.ip+':'+(port(p.query)?p.query:p.port):'';
    const connectAddr=endpoint?p.ip+':'+p.port:null;
    const lobby=p.lobby && p.lobby!=='0';
    const id='friend:'+(connectAddr || (lobby?'lobby:'+p.lobby:'player:'+i));
    let row=groups.get(id);
    if(!row){
      row={...emptyObservation(),id,addr,connectAddr,gamePort:endpoint?p.port:null,label:'',favorite:false,
        name:connectAddr || (lobby?'游戏大厅':'正在玩 Left 4 Dead 2'),friends:[],avatars:[]};
      groups.set(id,row);
    }
    row.friends.push(p.name.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,128)||'Steam 好友');
    row.avatars.push(p.avatar ?? null);
  }
  return groups;
}

export class FriendServers {
  constructor(probe, read=readPresence) { this.probe=probe; this.read=read; this.rows=new Map(); this.pending=null; this.queries=new WeakMap(); }
  async list() {
    if(!this.pending) this.pending=this.read().then(rows=>{
      this.rows=groupPresence(rows); return [...this.rows.values()];
    }).catch(e=>{this.rows.clear(); throw e}).finally(()=>{this.pending=null});
    return this.pending;
  }
  target(id) {
    const row=this.rows.get(id);
    if(!row?.addr) throw serverError('friend_server_missing','好友的服务器已变化，请刷新。');
    return row;
  }
  async detail(id) {
    const row=this.target(id);
    let task=this.queries.get(row);
    if(!task){
      task=this.probe(row).then(obs=>{
        const {playerList, ...status}=obs;
        Object.assign(row,status,{name:status.name||row.name,connectAddr:row.connectAddr,playerList:null});
        return row;
      }).finally(()=>this.queries.delete(row));
      this.queries.set(row,task);
    }
    return task;
  }
  async forJoin(id) {
    await this.list(); // Same endpoint must still be present when confirming launch.
    return this.detail(id);
  }
}

