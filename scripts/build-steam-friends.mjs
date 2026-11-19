import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const csc = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(csc, ['/nologo','/platform:x64','/optimize+','/target:exe','/r:System.Web.Extensions.dll','/r:System.Drawing.dll',
  '/out:'+path.join(root,'backend','servers','matcha-steam-friends.exe'),path.join(root,'native','tools','SteamFriends.cs')], {cwd:root,stdio:'inherit',windowsHide:true});
