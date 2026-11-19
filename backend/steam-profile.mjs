import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseKeyValues, windowsSteamRoots, steamIsRunning } from './core.mjs';

const exec = promisify(execFile);
const baseId = 76561197960265728n;
const missing = e => e.code === 'ENOENT' || e.code === 'ENOTDIR';

async function activeSteamId() {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await exec('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'], { windowsHide: true, timeout: 2500 });
    const value = /REG_DWORD\s+(0x[\da-f]+|\d+)/i.exec(stdout)?.[1];
    if (value !== undefined) return BigInt(value) ? String(baseId + BigInt(value)) : null;
  } catch { /* 登录状态是可选字段；仍然显示本机缓存的账号。 */ }
}

async function avatar(root, id) {
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const file = path.join(root, 'config', 'avatarcache', id + '.' + ext);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const data = await fs.readFile(file);
      const type = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png'
        : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff ? 'jpeg' : null;
      if (type) return `data:image/${type};base64,${data.toString('base64')}`;
    } catch (e) { if (!missing(e) && e.code !== 'EACCES' && e.code !== 'EPERM') throw e; }
  }
  return null;
}

// Only local display fields leave this module. No Web API key or network lookup.
export async function steamProfile({ gameRoot, roots, activeId = activeSteamId, running = steamIsRunning } = {}) {
  const dirs = new Set(roots ?? await windowsSteamRoots());
  if (gameRoot) {
    const common = path.dirname(gameRoot), apps = path.dirname(common);
    if (path.basename(common).toLowerCase() === 'common' && path.basename(apps).toLowerCase() === 'steamapps') dirs.add(path.dirname(apps));
  }
  for (const root of dirs) {
    let raw;
    try { raw = await fs.readFile(path.join(root, 'config', 'loginusers.vdf'), 'utf8'); }
    catch (e) { if (missing(e)) continue; throw e; }
    const db = parseKeyValues(raw);
    const users = Object.entries(db.users ?? db.Users ?? {}).filter(([id, v]) => /^\d{17}$/.test(id) && v && typeof v === 'object');
    if (!users.length) continue;
    const [id, live] = await Promise.all([activeId(), running(path.join(root, 'steam.exe')).catch(() => undefined)]);
    users.sort(([, a], [, b]) => Number(b.MostRecent === '1') - Number(a.MostRecent === '1') || (Number(b.Timestamp) || 0) - (Number(a.Timestamp) || 0));
    const [steamId, user] = (live && users.find(([key]) => key === id)) || users[0];
    const online = live === false ? false : live === true && id !== undefined ? id === steamId : undefined;
    return { profile: { steamId, personaName: (typeof user.PersonaName === 'string' && user.PersonaName.trim()) || 'Steam 玩家',
      avatar: await avatar(root, steamId), ...(online !== undefined && { online }) } };
  }
  return { profile: null };
}
