import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { regular } from './vpk.mjs';
import { cacheModThumbnail } from './thumbnails.mjs';
import { directory, addonsDirectory, exists, fail, stamp, writeJson } from './files.mjs';
import { gameFolder } from '../legacy-names.mjs';

// 新部署用 matcha_ws_；改名前部署的 flare_ws_ 保持原名，直到下次取消部署。
export const deployName = id => `matcha_ws_${id}.vpk`;
const deployNames = id => [deployName(id), `flare_ws_${id}.vpk`];

export const workshopId = s => typeof s === 'string' && /^[1-9][0-9]{0,19}$/.test(s);
export const libraryId = id => `library:workshop:${id}`;
export function libraryWorkshopId(id) {
  const match = typeof id === 'string' && /^library:workshop:([1-9][0-9]{0,19})$/.exec(id);
  if (!match) fail('invalid_argument', '独立库 Mod ID 无效。');
  return match[1];
}
const owns = (r,s) => r && [r.stamp,r.previous].includes(stamp(s));
const fallback = e => ['EXDEV','EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS'].includes(e.code);
// Compare actual bytes only when replacing an older, independently owned copy.
async function equalFiles(a,b,size) {
  const h=await fs.open(a,'r'); try { const k=await fs.open(b,'r'); try {
    const x=Buffer.alloc(256*1024), y=Buffer.alloc(x.length);
    for(let at=0;at<size;) {const n=Math.min(x.length,size-at);
      const [l,r]=await Promise.all([h.read(x,0,n,at),k.read(y,0,n,at)]);
      if(l.bytesRead!==n || r.bytesRead!==n || !x.subarray(0,n).equals(y.subarray(0,n)))return false;at+=n;
    } return true;
  } finally {await k.close();}} finally {await h.close();}
}
export class ModLibrary {
  async base(root, create = false) {
    const content = await directory(path.join(root, 'left4dead2')), base = gameFolder(content, 'library');
    if (!create && !await exists(base)) return null;
    await directory(base, create); return base;
  }
  async folder(root, id, create = false) {
    if (!workshopId(id)) fail('invalid_argument', '工坊 ID 无效。');
    const base = await this.base(root, create);
    if (!base) fail('mod_missing', '独立库条目已移除。');
    const parent = await directory(path.join(base, 'workshop'), create);
    return directory(path.join(parent, id), create);
  }
  async read(root, id) {
    const folder = await this.folder(root, id), file = path.join(folder, 'item.json'); await regular(file);
    const r = JSON.parse(await fs.readFile(file, 'utf8'));
    if (r.version !== 1 || r.workshopId !== id || r.id !== libraryId(id) || (r.deployment && (!deployNames(id).includes(r.deployment.file) || typeof r.deployment.stamp !== 'string'))) fail('library_invalid', `独立库记录需要检查：${file}`);
    return r;
  }
  async write(root, r) { await writeJson(path.join(await this.folder(root, r.workshopId), 'item.json'), r); }
  async entries(root) {
    const base = await this.base(root);
    if (!base || !await exists(path.join(base, 'workshop'))) return [];
    const folder = await directory(path.join(base, 'workshop')), result = [];
    for (const id of await fs.readdir(folder)) if (workshopId(id)) {
      const dir = await directory(path.join(folder, id));
      if (!await exists(path.join(dir, 'mod.vpk')) || !await exists(path.join(dir, 'item.json'))) continue;
      const r = await this.read(root, id);
      let deployed = false, deploymentError;
      if (r.deployment) {
        const target = path.join(root, 'left4dead2', 'addons', r.deployment.file);
        if (await exists(target)) {
          if (owns(r.deployment,await regular(target))) deployed = true;
          else deploymentError = `部署副本已由外部修改，请先移走或保留改动：${target}`;
        }
      }
      result.push({ ...r, absolutePath: path.join(dir, 'mod.vpk'), deployed, deploymentError });
    }
    return result;
  }
  async resolve(root, id) {
    const wid = libraryWorkshopId(id); await this.read(root, wid);
    const file = path.join(await this.folder(root, wid), 'mod.vpk'); await regular(file); return file;
  }
  async cacheThumbnail(root, id, body) {
    await cacheModThumbnail(await this.resolve(root, id), body);
  }
  async deploy(c, id, enabled, idle) {
    const wid = libraryWorkshopId(id), r = await this.read(c.root, wid);
    const addons = await addonsDirectory(path.join(c.content, 'addons'), true), file = r.deployment?.file ?? deployName(wid), target = path.join(addons, file);
    if (!enabled && !r.deployment) return file;
    const present = await exists(target);
    if (present && !owns(r.deployment,await regular(target))) fail('deployment_conflict', `请先处理同名文件，原文件已保留：${target}`);
    if (!enabled) {
      if (present) { await idle(c.root); await fs.unlink(target); }
      if (r.deployment) { delete r.deployment; await this.write(c.root, r); }
      return file;
    }
    const source=await this.resolve(c.root,id), original=await regular(source);
    const prior=present ? await regular(target) : null;
    if(prior && (prior.dev===original.dev && prior.ino===original.ino || prior.size!==original.size ||
      !await equalFiles(source,target,original.size))) return file;
    await idle(c.root);
    if(stamp(await regular(source))!==stamp(original)) fail('file_changed','库文件已变化，请刷新。');
    if(present && !owns(r.deployment,await regular(target)))fail('deployment_conflict','已部署文件发生变化。');
    const stage=path.join(addons,'.matcha-deploy-'+randomUUID()+'.tmp');
    let staged=false;
    try {
      try { await fs.link(source,stage); staged=true; }
      catch(e) {
        if(!fallback(e))throw e;
        if(present)return file;
        // Exclusive creation also works on filesystems without hard links.
        await fs.copyFile(source,target,fs.constants.COPYFILE_EXCL);
        if(stamp(await regular(source))!==stamp(original))fail('file_changed','复制期间独立库源文件已变化，目标保留待检查。');
        r.deployment={file,stamp:stamp(await regular(target))}; await this.write(c.root,r);return file;
      }
      const after=stamp(await regular(stage));
      if(after!==stamp(original))fail('file_changed','库文件已变化，请重试。');
      r.deployment={file,stamp:after,...(prior?{previous:stamp(prior)}:{})};
      await this.write(c.root,r);await idle(c.root);
      if(prior){
        if(stamp(await regular(target))!==stamp(prior))fail('deployment_conflict','同名部署文件已变化。');
        await fs.rename(stage,target);staged=false;
        delete r.deployment.previous;await this.write(c.root,r);
      } else await fs.link(stage,target);
      return file;
    } finally {if(staged)await fs.unlink(stage);}
  }
  async deployments(root, verify=false) {
    const rows=[];
    for(const row of await this.entries(root)){
      if(!row.deployed)continue;
      const target=path.join(await addonsDirectory(path.join(root,'left4dead2','addons')),row.deployment.file);
      const src=await regular(row.absolutePath),dst=await regular(target),linked=src.dev===dst.dev&&src.ino===dst.ino;
      rows.push({id:row.id,linked,bytes:linked?0:dst.size,reclaimable:!linked && dst.nlink===1 && src.size===dst.size &&
        (!verify || await equalFiles(row.absolutePath,target,src.size))});
    }return rows;
  }
  async checkDeployment(c, id) {
    const wid = libraryWorkshopId(id), r = await this.read(c.root, wid);
    const addons = await addonsDirectory(path.join(c.content, 'addons'), true), target = path.join(addons, r.deployment?.file ?? deployName(wid));
    if (await exists(target) && !owns(r.deployment,await regular(target))) fail('deployment_conflict', `请先处理同名文件，原文件已保留：${target}`);
  }
  async publish(root, stage, item) {
    const base = await this.base(root, true), parent = await directory(path.join(base, 'workshop'), true);
    const target = path.join(parent, item.id);
    if (await exists(target)) {
      await directory(target);
      if ((await fs.readdir(target)).length) fail('already_in_library', '此工坊条目已在独立库或正在恢复，请刷新。');
      await fs.rmdir(target);
    }
    await writeJson(path.join(stage, 'item.json'), { version: 1, id: libraryId(item.id), workshopId: item.id,
      title: item.title, author: item.author, downloadedAt: new Date().toISOString(), workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}` });
    // Windows occasionally reports a short-lived sharing violation immediately after writing the package.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(stage, target); break; }
      catch (e) {
        if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || attempt >= 3) throw e;
        await delay(100 * (attempt + 1));
        if (await exists(target)) fail('already_in_library', '目标工坊目录已出现，请刷新后检查。');
      }
    }
    return libraryId(item.id);
  }
}
